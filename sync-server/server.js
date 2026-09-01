const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");
const { createAuthStore } = require("./auth-store");

const port = Number(process.env.PORT || 8787);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const usersDataDir = path.join(dataDir, "users");
const authStore = createAuthStore(dataDir, { inviteCode: process.env.REGISTRATION_INVITE_CODE });
const kimiKeyFile = process.env.KIMI_API_KEY_FILE || "/home/hulk/token_api/kimicode";
const kimiEndpoint = process.env.KIMI_ENDPOINT || "https://api.kimi.com/coding/v1/chat/completions";
const kimiModel = process.env.KIMI_MODEL || "k3";
const dailySummaryLimit = Math.max(0, Number(process.env.KIMI_DAILY_SUMMARY_LIMIT || 20));
const summarizing = new Set();
const summaryQueue = [];
let summaryWorkerActive = false;
const authAttempts = new Map();
fs.mkdirSync(dataDir, { recursive: true });

function authAttemptKey(route, username) { return `${route}:${String(username || "").trim().toLowerCase()}`; }
function assertAuthAllowed(key) {
  const record = authAttempts.get(key);
  if (record && record.blockedUntil > Date.now()) throw new Error("尝试次数过多，请15分钟后再试");
}
function recordAuthFailure(key) {
  const now = Date.now();
  const old = authAttempts.get(key);
  const record = old && now - old.startedAt < 10 * 60_000 ? old : { count: 0, startedAt: now, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= 5) record.blockedUntil = now + 15 * 60_000;
  authAttempts.set(key, record);
  if (authAttempts.size > 5000) authAttempts.delete(authAttempts.keys().next().value);
}

function userTasksFile(userId) { return path.join(usersDataDir, String(userId), "tasks.json"); }
function readUserTasks(userId) {
  try { return JSON.parse(fs.readFileSync(userTasksFile(userId), "utf8")); } catch { return []; }
}
function writeUserTasks(userId, tasks) {
  const file = userTasksFile(userId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = `${file}.next`;
  fs.writeFileSync(next, JSON.stringify(tasks, null, 2), { mode: 0o600 });
  fs.renameSync(next, file);
}

function authenticatedUser(request) { return authStore.authenticate(request.headers.authorization); }

function mergeTasks(serverTasks, clientTasks) {
  const merged = new Map(serverTasks.map(task => [String(task.id), task]));
  for (const task of clientTasks) {
    if (!task || task.id == null || typeof task.text !== "string") continue;
    const id = String(task.id);
    const current = merged.get(id);
    if (!current) merged.set(id, { ...task, id });
    else {
      const newest = Number(task.updatedAt || task.createdAt || 0) >= Number(current.updatedAt || current.createdAt || 0) ? task : current;
      const newestSummary = Number(task.summaryUpdatedAt || 0) >= Number(current.summaryUpdatedAt || 0) ? task : current;
      merged.set(id, {
        ...newest,
        id,
        summary: newestSummary.summary || "",
        summaryStatus: newestSummary.summaryStatus || "",
        summaryError: newestSummary.summaryError || "",
        summaryUpdatedAt: Number(newestSummary.summaryUpdatedAt || 0)
      });
    }
  }
  return [...merged.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function onlyUrl(text) {
  const value = String(text || "").trim();
  if (/\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch { return null; }
}

function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const value = address.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}

async function assertPublicUrl(url) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("不支持此链接");
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some(record => privateAddress(record.address))) throw new Error("不允许访问内网地址");
}

async function fetchPage(startUrl) {
  let url = new URL(startUrl);
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    await assertPublicUrl(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "ReminderSummary/1.0", "Accept": "text/html,text/plain,application/xhtml+xml" }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("网页重定向缺少地址");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`网页返回 ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/xhtml+xml")) throw new Error("链接不是可阅读网页");
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1_500_000) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString("utf8");
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, " ");
    const content = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
    if (content.length < 80) throw new Error("网页正文太少");
    return { finalUrl: String(url), title: title.replace(/\s+/g, " ").trim(), content: content.slice(0, 24_000) };
  }
  throw new Error("网页重定向过多");
}

function readKimiKey() {
  const key = (process.env.KIMI_API_KEY || fs.readFileSync(kimiKeyFile, "utf8")).trim();
  if (!key) throw new Error("Kimi API Key 为空");
  return key;
}

async function kimiSummary(pageInfo) {
  const response = await fetch(kimiEndpoint, {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: { "Authorization": `Bearer ${readKimiKey()}`, "Content-Type": "application/json", "User-Agent": "reminder-app/1.4" },
    body: JSON.stringify({
      model: kimiModel,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: "你是任务阅读助手。根据网页正文写简洁中文摘要，直接输出两部分：第一行是20字以内的标题；第二行是80到140字摘要。不要使用Markdown，不要虚构。" },
        { role: "user", content: `链接：${pageInfo.finalUrl}\n网页标题：${pageInfo.title}\n网页正文：${pageInfo.content}` }
      ]
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Kimi 返回 ${response.status}`);
  const result = body?.choices?.[0]?.message?.content;
  if (typeof result !== "string" || !result.trim()) throw new Error("Kimi 未返回摘要");
  return result.trim().slice(0, 800);
}

function updateSummary(userId, id, patch) {
  const tasks = readUserTasks(userId);
  const index = tasks.findIndex(task => String(task.id) === String(id));
  if (index < 0 || tasks[index].deleted) return;
  tasks[index] = { ...tasks[index], ...patch, summaryUpdatedAt: Date.now() };
  writeUserTasks(userId, tasks);
}

async function summarizeTask(job) {
  const { userId, task } = job;
  const id = `${userId}:${task.id}`;
  try {
    const pageInfo = await fetchPage(task.text.trim());
    const summary = await kimiSummary(pageInfo);
    updateSummary(userId, task.id, { summary, summaryStatus: "done", summaryError: "" });
  } catch (error) {
    updateSummary(userId, task.id, { summaryStatus: "error", summaryError: String(error.message || error).slice(0, 240) });
  } finally { summarizing.delete(id); }
}

async function drainSummaryQueue() {
  if (summaryWorkerActive) return;
  summaryWorkerActive = true;
  try {
    while (summaryQueue.length) await summarizeTask(summaryQueue.shift());
  } finally { summaryWorkerActive = false; }
}

function scheduleSummaries(userId, tasks) {
  let changed = false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let dailyCount = tasks.filter(task => Number(task.summaryUpdatedAt || 0) >= today.getTime()).length;
  for (const task of tasks) {
    if (dailyCount >= dailySummaryLimit) break;
    if (task.deleted || task.summary || !onlyUrl(task.text)) continue;
    const jobId = `${userId}:${task.id}`;
    if (summarizing.has(jobId)) continue;
    if (task.summaryStatus === "error" && Number(task.summaryUpdatedAt || 0) > Date.now() - 5 * 60_000) continue;
    task.summaryStatus = "pending";
    task.summaryError = "";
    task.summaryUpdatedAt = Date.now();
    changed = true;
    summarizing.add(jobId);
    summaryQueue.push({ userId, task });
    dailyCount += 1;
  }
  if (summaryQueue.length) setImmediate(drainSummaryQueue);
  return changed;
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) request.destroy();
    });
    request.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>拾遗 · 电脑端</title><style>
:root{color-scheme:light;--brand:#265849;--soft:#e0ebe6;--paper:#f8f7f3;--ink:#222b27;--muted:#68716d;--line:#e2e5e1;--red:#ffe2e2;--red-strong:#c73e3e;--blue:#dfebff;--blue-strong:#3969b2;--yellow:#fff2bf;--yellow-strong:#a07310;--green:#ddf3e2;--green-strong:#2b7e46}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:auto;padding:42px 24px 80px}.brand{display:flex;align-items:center;gap:11px}.logo{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--brand);color:white;font-weight:800;font-size:20px}.brand strong{font-size:18px}.muted{color:var(--muted);font-size:13px}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:28px;align-items:end;margin:34px 0 28px}h1{font-size:38px;line-height:1.18;margin:0 0 10px;letter-spacing:-1.2px}.capture{background:white;border:1px solid var(--line);border-radius:18px;padding:16px}.capture label{font-size:12px;color:var(--brand);font-weight:700}textarea{width:100%;min-height:112px;border:0;resize:vertical;padding:10px 0;font:16px inherit;outline:0;color:var(--ink)}
button{border:0;border-radius:11px;padding:10px 15px;font:700 13px inherit;cursor:pointer;background:var(--soft);color:var(--brand)}button.primary{background:var(--brand);color:white}.capture footer{display:flex;justify-content:space-between;align-items:center}.toolbar{display:flex;align-items:center;justify-content:space-between;margin:26px 0 12px}.toolbar h2{margin:0;font-size:20px}.toolbar-actions{display:flex;align-items:center;gap:10px}.sync{font-size:12px;color:var(--muted)}.key-help{margin-top:9px;font-size:12px;color:var(--muted)}.key-help code{padding:3px 7px;border-radius:6px;background:var(--soft);color:var(--brand);font-weight:700}
.search{width:100%;margin:0 0 14px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:white;font:14px inherit}.section-title{margin:24px 0 10px;font-size:16px;color:var(--muted)}.tasks{display:grid;gap:9px}.task{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:16px;padding:15px;transition:background-color .7s,border-color .7s,transform .12s ease}.task:hover{transform:translateY(-1px)}.task.state-3{background:var(--green);border-color:var(--green-strong)}.task .copy{cursor:pointer}.task h3{font-size:16px;margin:0 0 5px}.task p{margin:0;color:var(--muted);font-size:12px}.cobweb{margin-top:7px;color:var(--yellow-strong);font-size:12px;font-weight:700}.ai-summary{margin-top:8px;padding-top:8px;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent);font-size:13px;white-space:pre-line}.ai-status{margin-top:7px;color:var(--muted);font-size:12px}.ai-status.error{color:var(--red-strong)}.complete{display:grid;place-items:center;width:28px;height:28px;padding:0;border:2px solid currentColor;border-radius:8px;background:transparent}.state-3 .complete{background:var(--green-strong);color:white}.delete{padding:8px;background:transparent;color:var(--muted)}.empty{text-align:center;background:white;border:1px solid var(--line);border-radius:18px;padding:28px;color:var(--muted)}.auth-card{width:min(390px,calc(100% - 28px));border:0;border-radius:22px;padding:26px}.auth-card::backdrop{background:#15251fcc;backdrop-filter:blur(5px)}.auth-card input{width:100%;margin:6px 0;padding:12px;border:1px solid var(--line);border-radius:11px;font:15px inherit}.auth-actions{display:flex;gap:9px;margin-top:12px}.auth-error{min-height:22px;color:var(--red-strong);font-size:13px}
.detail{width:min(680px,calc(100% - 28px));max-height:86vh;border:0;border-radius:22px;padding:0;box-shadow:0 22px 70px #15251f55}.detail::backdrop{background:#15251f66;backdrop-filter:blur(3px)}.detail-card{padding:25px;overflow:auto;max-height:86vh;transition:background-color .7s,border-color .7s;border:1px solid transparent}.detail-card h2{margin:7px 0 6px;font-size:23px;overflow-wrap:anywhere}.detail-card .full-summary{white-space:pre-line;font-size:16px;margin:20px 0 0;padding-top:16px;border-top:1px solid #0002}.detail-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.detail-actions .danger{color:var(--red-strong);margin-left:auto}.detail-card.state-0{background:var(--red);border-color:var(--red-strong)}.detail-card.state-2{background:var(--blue);border-color:var(--blue-strong)}.detail-card.state-1{background:var(--yellow);border-color:var(--yellow-strong)}.detail-card.state-3{background:var(--green);border-color:var(--green-strong)}
@media(max-width:700px){.hero{grid-template-columns:1fr}h1{font-size:31px}main{padding:24px 16px}.task{grid-template-columns:1fr auto}.task .delete{display:none}}
</style></head><body><main>
<div class="brand"><span class="logo">✓</span><div><strong>拾遗</strong><div class="muted">电脑端 · 私密账号同步</div><div class="key-help" id="account-label">正在检查登录状态…</div></div></div>
<section class="hero"><div><h1>在手机上记下，<br>在电脑上完成。</h1><p class="muted">两端操作都会保存到这台电脑，并在下次同步时合并。</p></div><div class="capture"><label>快速收件箱</label><textarea id="draft" placeholder="输入要完成的任务…"></textarea><footer><span class="muted">Ctrl + Enter 快速记录</span><button class="primary" id="add">＋ 记录任务</button></footer></div></section>
<div class="toolbar"><h2 id="summary">任务列表</h2><div class="toolbar-actions"><span class="sync" id="status">正在连接…</span><button id="refresh">接收最新</button></div></div><input class="search" id="search" placeholder="搜索任务或摘要中的关键词…"><section class="tasks" id="tasks"></section><h3 class="section-title">已完成</h3><section class="tasks" id="completed"></section>
<dialog class="detail" id="detail"><div class="detail-card" id="detail-card"><div class="muted">任务详情</div><h2 id="detail-text"></h2><p class="muted" id="detail-meta"></p><div class="full-summary" id="detail-summary"></div><div class="detail-actions"><button id="detail-open">打开原链接</button><button id="detail-start">开始任务</button><button id="detail-done">标记完成</button><button class="danger" id="detail-delete">删除</button><button id="detail-close">关闭</button></div></div></dialog>
<dialog class="auth-card" id="auth"><h2>登录拾遗</h2><p class="muted">手机和电脑使用同一账号，任务完全隔离。</p><input id="auth-user" autocomplete="username" placeholder="用户名"><input id="auth-password" type="password" autocomplete="current-password" placeholder="密码（至少8位）"><input id="auth-invite" placeholder="邀请码（仅注册时填写）"><div class="auth-error" id="auth-error"></div><div class="auth-actions"><button class="primary" id="login">登录</button><button id="register">邀请码注册</button></div></dialog>
</main><script>
let tasks=[],stableOrder=[],detailTask=null,query='',authToken=localStorage.getItem('reminder-auth-token')||'';const DAY=86400000;function ageDays(t){return(Date.now()-Number(t.lastViewedAt||t.createdAt||Date.now()))/DAY}function stale(t){return t.state!==3&&ageDays(t)>=7}function cobweb(t){return t.state!==3&&ageDays(t)>=30}function stateName(t){if(t.state===3)return'已完成';if(cobweb(t))return'🕸 久未查看';if(stale(t))return'久未查看';if(t.state===1)return'进行中 · 已查看 '+(t.viewCount||0)+' 次';return(t.viewCount||0)?'已查看 '+t.viewCount+' 次':'未查看'}function visual(t){if(t.state===3)return['#ddf3e2','#2b7e46'];if(stale(t)){const p=Math.max(0,Math.min(1,(ageDays(t)-7)/23));return['rgb('+(255-11*p)+','+(248-33*p)+','+(218-92*p)+')','#a07310']}const fills=['#ffcdcd','#ffdcdc','#ffe8e8','#fff0f0','#fff6f6'],borders=['#be2c2c','#cd4d4d','#d86b6b','#e08989','#e6a4a4'],i=Math.max(0,Math.min(4,t.viewCount||0));return[fills[i],borders[i]]}
function mergeDownload(incoming){const map=new Map(tasks.map(t=>[String(t.id),t]));for(const remote of incoming){const local=map.get(String(remote.id));if(!local){map.set(String(remote.id),remote);continue}if(Number(remote.updatedAt||0)>Number(local.updatedAt||0)){if(Number(local.summaryUpdatedAt||0)>Number(remote.summaryUpdatedAt||0))Object.assign(remote,{summary:local.summary,summaryStatus:local.summaryStatus,summaryError:local.summaryError,summaryUpdatedAt:local.summaryUpdatedAt});map.set(String(remote.id),remote)}else if(Number(remote.summaryUpdatedAt||0)>Number(local.summaryUpdatedAt||0))Object.assign(local,{summary:remote.summary,summaryStatus:remote.summaryStatus,summaryError:remote.summaryError,summaryUpdatedAt:remote.summaryUpdatedAt})}tasks=[...map.values()]}
async function sync(mode='merge'){if(!authToken){showAuth();throw new Error('请先登录')}document.querySelector('#status').textContent=mode==='download'?'正在接收…':'正在同步…';const response=await fetch('/api/sync',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+authToken},body:JSON.stringify({mode,tasks})});if(response.status===401){authToken='';localStorage.removeItem('reminder-auth-token');showAuth();throw new Error('登录已过期')}if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'同步失败');const result=await response.json(),incoming=result.tasks;document.querySelector('#account-label').textContent='已登录：'+result.user.username;if(mode==='download')mergeDownload(incoming);else tasks=incoming;render();document.querySelector('#status').textContent='已同步 · '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function orderedTasks(){const active=tasks.filter(t=>!t.deleted&&((t.text||'')+' '+(t.summary||'')).toLowerCase().includes(query));if(!stableOrder.length)stableOrder=active.slice().sort((a,b)=>(a.state===3)-(b.state===3)||(a.viewCount||0)-(b.viewCount||0)||b.createdAt-a.createdAt).map(t=>String(t.id));for(const t of active)if(!stableOrder.includes(String(t.id)))stableOrder.unshift(String(t.id));return active.sort((a,b)=>stableOrder.indexOf(String(a.id))-stableOrder.indexOf(String(b.id)))}
function render(){const all=orderedTasks(),active=all.filter(t=>t.state!==3),done=all.filter(t=>t.state===3);document.querySelector('#summary').textContent=all.length?'任务 '+all.length+' 项 · 已完成 '+done.length+' 项':'任务列表';renderGroup(document.querySelector('#tasks'),active,query?'未找到未完成任务':'没有未完成任务');renderGroup(document.querySelector('#completed'),done,query?'未找到已完成任务':'完成的任务会收在这里')}
function renderGroup(root,items,empty){root.innerHTML=items.length?'':'<div class="empty">'+empty+'</div>';for(const t of items){const el=document.createElement('article'),colors=visual(t);el.className='task state-'+t.state;el.style.background=colors[0];el.style.borderColor=colors[1];el.innerHTML='<div class="copy"><h3></h3><p>'+stateName(t)+' · '+new Date(t.createdAt).toLocaleString()+'</p>'+(cobweb(t)?'<div class="cobweb">🕸 久置落灰 · 点击重新唤醒</div>':'')+'<div class="ai"></div></div><button class="complete" title="'+(t.state===3?'恢复任务':'标记完成')+'">'+(t.state===3?'✓':'')+'</button><button class="delete" title="删除任务">删除</button>';el.querySelector('h3').textContent=t.text.split('\\n')[0];const ai=el.querySelector('.ai');if(t.summary){ai.className='ai ai-summary';ai.textContent=t.summary}else if(t.summaryStatus==='pending'){ai.className='ai ai-status';ai.textContent='Kimi 正在阅读链接…'}else if(t.summaryStatus==='error'){ai.className='ai ai-status error';ai.textContent='摘要暂时失败，将在下次同步重试'}el.querySelector('.copy').onclick=()=>showDetail(t);el.querySelector('.complete').onclick=async()=>{t.state=t.state===3?2:3;t.updatedAt=Date.now();await sync('upload')};el.querySelector('.delete').onclick=async()=>{if(confirm('删除这项任务？')){t.deleted=true;t.updatedAt=Date.now();await sync('upload')}};root.appendChild(el)}}
function updateDetail(){const t=detailTask,card=document.querySelector('#detail-card'),colors=visual(t);card.className='detail-card state-'+t.state;card.style.background=colors[0];card.style.borderColor=colors[1];document.querySelector('#detail-meta').textContent=stateName(t)+' · '+new Date(t.createdAt).toLocaleString();document.querySelector('#detail-start').textContent=t.state===1?'进行中':t.state===3?'恢复任务':'开始任务';document.querySelector('#detail-done').textContent=t.state===3?'恢复为未完成':'标记完成'}
async function showDetail(t){detailTask=t;if(t.state!==3){t.viewCount=stale(t)?0:Math.min(4,(t.viewCount||0)+1);t.lastViewedAt=t.updatedAt=Date.now()}document.querySelector('#detail-text').textContent=t.text;document.querySelector('#detail-summary').textContent=t.summary||'';const open=document.querySelector('#detail-open');open.hidden=!/^https?:\\/\\/\\S+$/.test(t.text.trim());open.onclick=()=>window.open(t.text.trim(),'_blank','noopener');updateDetail();document.querySelector('#detail').showModal();if(t.state!==3)await sync('upload')}
document.querySelector('#detail-start').onclick=async()=>{if(!detailTask)return;detailTask.state=detailTask.state===3?2:1;detailTask.updatedAt=Date.now();updateDetail();await sync('upload')};document.querySelector('#detail-done').onclick=async()=>{if(!detailTask)return;detailTask.state=detailTask.state===3?2:3;detailTask.updatedAt=Date.now();updateDetail();await sync('upload')};document.querySelector('#detail-delete').onclick=async()=>{if(detailTask&&confirm('删除这项任务？')){detailTask.deleted=true;detailTask.updatedAt=Date.now();await sync('upload');document.querySelector('#detail').close()}};document.querySelector('#detail-close').onclick=()=>document.querySelector('#detail').close();document.querySelector('#detail').onclose=()=>{detailTask=null;render()};
async function add(){const input=document.querySelector('#draft');const text=input.value.trim();if(!text)return;const now=Date.now();tasks.unshift({id:crypto.randomUUID(),text,createdAt:now,updatedAt:now,reminderAt:0,state:0,deleted:false});input.value='';await sync('upload')}
function showAuth(message=''){document.querySelector('#auth-error').textContent=message;const dialog=document.querySelector('#auth');if(!dialog.open)dialog.showModal()}
async function authenticate(kind){const username=document.querySelector('#auth-user').value.trim(),password=document.querySelector('#auth-password').value,inviteCode=document.querySelector('#auth-invite').value.trim();document.querySelector('#auth-error').textContent='正在验证…';try{const response=await fetch('/api/auth/'+kind,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password,inviteCode})}),result=await response.json();if(!response.ok)throw new Error(result.error||'登录失败');authToken=result.token;localStorage.setItem('reminder-auth-token',authToken);document.querySelector('#account-label').textContent='已登录：'+result.user.username;document.querySelector('#auth').close();tasks=[];stableOrder=[];await sync('download')}catch(error){showAuth(error.message)}}
document.querySelector('#login').onclick=()=>authenticate('login');document.querySelector('#register').onclick=()=>authenticate('register');
document.querySelector('#add').onclick=add;document.querySelector('#refresh').onclick=()=>sync('download').catch(e=>document.querySelector('#status').textContent=e.message);document.querySelector('#draft').onkeydown=e=>{if(e.ctrlKey&&e.key==='Enter')add()};document.querySelector('#search').oninput=e=>{query=e.target.value.trim().toLowerCase();render()};sync('download').catch(e=>document.querySelector('#status').textContent=e.message);setInterval(()=>{if(tasks.some(t=>t.summaryStatus==='pending'))sync('download').catch(()=>{})},5000);
</script></body></html>`;

const resetPage = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>重置密码 · 拾遗</title><style>
:root{--brand:#265849;--paper:#f8f7f3;--ink:#222b27;--muted:#68716d;--line:#dfe5e1;--error:#b83232}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}.card{width:min(420px,calc(100% - 32px));padding:30px;background:white;border:1px solid var(--line);border-radius:24px;box-shadow:0 18px 60px #18382b18}.brand{display:flex;align-items:center;gap:10px}.logo{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--brand);color:white;font-size:20px;font-weight:800}h1{margin:25px 0 6px;font-size:27px}.muted{margin:0 0 20px;color:var(--muted)}input{width:100%;margin:6px 0;padding:13px;border:1px solid var(--line);border-radius:12px;font:15px inherit;outline:none}input:focus{border-color:var(--brand);box-shadow:0 0 0 3px #26584918}button{width:100%;margin-top:12px;padding:13px;border:0;border-radius:12px;background:var(--brand);color:white;font:700 15px inherit;cursor:pointer}.status{min-height:24px;margin-top:12px;color:var(--error);font-size:13px}.ok{color:var(--brand)}</style></head><body><main class="card"><div class="brand"><span class="logo">✓</span><strong>拾遗</strong></div><h1>设置新密码</h1><p class="muted">密码至少 8 位。提交成功后，其他设备上的旧登录会自动失效。</p><input id="password" type="password" autocomplete="new-password" placeholder="输入新密码（至少8位）"><input id="confirm" type="password" autocomplete="new-password" placeholder="再次输入新密码"><button id="submit">确认并登录</button><div class="status" id="status"></div></main><script>
const status=document.querySelector('#status'),button=document.querySelector('#submit');button.onclick=async()=>{const password=document.querySelector('#password').value,confirm=document.querySelector('#confirm').value,token=location.hash.slice(1);if(!token){status.textContent='重置链接无效';return}if(password.length<8){status.textContent='密码至少需要8位';return}if(password!==confirm){status.textContent='两次输入的密码不一致';return}button.disabled=true;status.textContent='正在设置…';try{const response=await fetch('/api/auth/reset-password',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token,password})}),result=await response.json();if(!response.ok)throw new Error(result.error||'重置失败');localStorage.setItem('reminder-auth-token',result.token);history.replaceState(null,'','/reset');status.className='status ok';status.textContent='密码已更新，正在进入拾遗…';setTimeout(()=>location.replace('/'),700)}catch(error){status.textContent=error.message;button.disabled=false}};
</script></body></html>`;

function createServer() { return http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/api/healthz") {
    return sendJson(response, 200, { ok: true, service: "reminder", storage: "portable-json-v1" });
  }
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
    return response.end(page);
  }
  if (request.method === "GET" && request.url === "/reset") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
    return response.end(resetPage);
  }
  if (request.method === "POST" && request.url === "/api/auth/register") {
    let key;
    try {
      const body = await readJson(request);
      key = authAttemptKey("register", body.username); assertAuthAllowed(key);
      const result = authStore.register(body.username, body.password, body.inviteCode); authAttempts.delete(key);
      return sendJson(response, 201, result);
    } catch (error) { if (key) recordAuthFailure(key); return sendJson(response, 400, { error: String(error.message || error) }); }
  }
  if (request.method === "POST" && request.url === "/api/auth/login") {
    let key;
    try {
      const body = await readJson(request);
      key = authAttemptKey("login", body.username); assertAuthAllowed(key);
      const result = authStore.login(body.username, body.password); authAttempts.delete(key);
      return sendJson(response, 200, result);
    } catch (error) { if (key) recordAuthFailure(key); return sendJson(response, 401, { error: String(error.message || error) }); }
  }
  if (request.method === "POST" && request.url === "/api/auth/reset-password") {
    try {
      const body = await readJson(request);
      return sendJson(response, 200, authStore.resetPassword(body.token, body.password));
    } catch (error) { return sendJson(response, 400, { error: String(error.message || error) }); }
  }
  if (request.method === "GET" && request.url === "/api/auth/me") {
    const user = authenticatedUser(request);
    return user ? sendJson(response, 200, { user }) : sendJson(response, 401, { error: "登录已过期" });
  }
  if (request.method === "POST" && request.url === "/api/auth/logout") {
    authStore.logout(request.headers.authorization);
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === "POST" && request.url === "/api/sync") {
    try {
      const user = authenticatedUser(request);
      if (!user) return sendJson(response, 401, { error: "请先登录" });
      const body = await readJson(request);
      const mode = ["upload", "download", "merge"].includes(body.mode) ? body.mode : "merge";
      const current = readUserTasks(user.id);
      const merged = mode === "download" ? current : mergeTasks(current, Array.isArray(body.tasks) ? body.tasks : []);
      const summariesQueued = scheduleSummaries(user.id, merged);
      if (mode !== "download" || summariesQueued) writeUserTasks(user.id, merged);
      return sendJson(response, 200, { tasks: merged, mode, serverTime: Date.now(), user });
    } catch (error) {
      return sendJson(response, 400, { error: "请求格式错误" });
    }
  }
  sendJson(response, 404, { error: "not found" });
}); }

function startServer() { return createServer().listen(port, "0.0.0.0", () => {
  console.log(`拾遗同步服务已启动：http://0.0.0.0:${port}`);
  console.log("多用户账号同步已启用");
}); }

if (require.main === module) startServer();

module.exports = { mergeTasks, onlyUrl, privateAddress, createServer };
