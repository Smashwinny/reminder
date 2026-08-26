const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const dns = require("node:dns").promises;
const net = require("node:net");

const port = Number(process.env.PORT || 8787);
const syncCode = process.env.SYNC_CODE || "123456";
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const dataFile = path.join(dataDir, "tasks.json");
const kimiKeyFile = process.env.KIMI_API_KEY_FILE || "/home/hulk/token_api/kimicode";
const kimiEndpoint = process.env.KIMI_ENDPOINT || "https://api.kimi.com/coding/v1/chat/completions";
const kimiModel = process.env.KIMI_MODEL || "k3";
const summarizing = new Set();
const summaryQueue = [];
let summaryWorkerActive = false;
fs.mkdirSync(dataDir, { recursive: true });

function readTasks() {
  try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); }
  catch { return []; }
}

function writeTasks(tasks) {
  const next = path.join(dataDir, "tasks.next.json");
  fs.writeFileSync(next, JSON.stringify(tasks, null, 2));
  fs.renameSync(next, dataFile);
}

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

function updateSummary(id, patch) {
  const tasks = readTasks();
  const index = tasks.findIndex(task => String(task.id) === String(id));
  if (index < 0 || tasks[index].deleted) return;
  tasks[index] = { ...tasks[index], ...patch, summaryUpdatedAt: Date.now() };
  writeTasks(tasks);
}

async function summarizeTask(task) {
  const id = String(task.id);
  try {
    const pageInfo = await fetchPage(task.text.trim());
    const summary = await kimiSummary(pageInfo);
    updateSummary(id, { summary, summaryStatus: "done", summaryError: "" });
  } catch (error) {
    updateSummary(id, { summaryStatus: "error", summaryError: String(error.message || error).slice(0, 240) });
  } finally { summarizing.delete(id); }
}

async function drainSummaryQueue() {
  if (summaryWorkerActive) return;
  summaryWorkerActive = true;
  try {
    while (summaryQueue.length) await summarizeTask(summaryQueue.shift());
  } finally { summaryWorkerActive = false; }
}

function scheduleSummaries(tasks) {
  let changed = false;
  for (const task of tasks) {
    if (task.deleted || task.summary || !onlyUrl(task.text)) continue;
    if (summarizing.has(String(task.id))) continue;
    if (task.summaryStatus === "error" && Number(task.summaryUpdatedAt || 0) > Date.now() - 5 * 60_000) continue;
    task.summaryStatus = "pending";
    task.summaryError = "";
    task.summaryUpdatedAt = Date.now();
    changed = true;
    summarizing.add(String(task.id));
    summaryQueue.push(task);
  }
  if (summaryQueue.length) setImmediate(drainSummaryQueue);
  return changed;
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
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
<title>渐明 · 电脑端</title><style>
:root{color-scheme:light;--brand:#265849;--soft:#e0ebe6;--paper:#f8f7f3;--ink:#222b27;--muted:#68716d;--line:#e2e5e1;--red:#ffe2e2;--red-strong:#c73e3e;--blue:#dfebff;--blue-strong:#3969b2;--yellow:#fff2bf;--yellow-strong:#a07310;--green:#ddf3e2;--green-strong:#2b7e46}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:auto;padding:42px 24px 80px}.brand{display:flex;align-items:center;gap:11px}.logo{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--brand);color:white;font-weight:800;font-size:20px}.brand strong{font-size:18px}.muted{color:var(--muted);font-size:13px}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:28px;align-items:end;margin:34px 0 28px}h1{font-size:38px;line-height:1.18;margin:0 0 10px;letter-spacing:-1.2px}.capture{background:white;border:1px solid var(--line);border-radius:18px;padding:16px}.capture label{font-size:12px;color:var(--brand);font-weight:700}textarea{width:100%;min-height:112px;border:0;resize:vertical;padding:10px 0;font:16px inherit;outline:0;color:var(--ink)}
button{border:0;border-radius:11px;padding:10px 15px;font:700 13px inherit;cursor:pointer;background:var(--soft);color:var(--brand)}button.primary{background:var(--brand);color:white}.capture footer{display:flex;justify-content:space-between;align-items:center}.toolbar{display:flex;align-items:center;justify-content:space-between;margin:26px 0 12px}.toolbar h2{margin:0;font-size:20px}.toolbar-actions{display:flex;align-items:center;gap:10px}.sync{font-size:12px;color:var(--muted)}
.tasks{display:grid;gap:9px}.task{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:16px;padding:15px;transition:background-color .7s,border-color .7s,transform .12s ease}.task:hover{transform:translateY(-1px)}.task.state-0{background:var(--red);border-color:var(--red-strong)}.task.state-2{background:var(--blue);border-color:var(--blue-strong)}.task.state-1{background:var(--yellow);border-color:var(--yellow-strong)}.task.state-3{background:var(--green);border-color:var(--green-strong)}.task .copy{cursor:pointer}.task h3{font-size:16px;margin:0 0 5px}.task p{margin:0;color:var(--muted);font-size:12px}.ai-summary{margin-top:8px;padding-top:8px;border-top:1px solid color-mix(in srgb,currentColor 18%,transparent);font-size:13px;white-space:pre-line}.ai-status{margin-top:7px;color:var(--muted);font-size:12px}.ai-status.error{color:var(--red-strong)}.complete{display:grid;place-items:center;width:42px;height:42px;padding:0;border:2px solid currentColor;border-radius:10px;background:transparent}.state-0 .complete{color:var(--red-strong)}.state-2 .complete{color:var(--blue-strong)}.state-1 .complete{color:var(--yellow-strong)}.state-3 .complete{background:var(--green-strong);color:white}.delete{padding:8px;background:transparent;color:var(--muted)}.empty{text-align:center;background:white;border:1px solid var(--line);border-radius:18px;padding:42px;color:var(--muted)}
.detail{width:min(680px,calc(100% - 28px));max-height:86vh;border:0;border-radius:22px;padding:0;box-shadow:0 22px 70px #15251f55}.detail::backdrop{background:#15251f66;backdrop-filter:blur(3px)}.detail-card{padding:25px;overflow:auto;max-height:86vh;transition:background-color .7s,border-color .7s;border:1px solid transparent}.detail-card h2{margin:7px 0 6px;font-size:23px;overflow-wrap:anywhere}.detail-card .full-summary{white-space:pre-line;font-size:16px;margin:20px 0 0;padding-top:16px;border-top:1px solid #0002}.detail-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:22px}.detail-actions .danger{color:var(--red-strong);margin-left:auto}.detail-card.state-0{background:var(--red);border-color:var(--red-strong)}.detail-card.state-2{background:var(--blue);border-color:var(--blue-strong)}.detail-card.state-1{background:var(--yellow);border-color:var(--yellow-strong)}.detail-card.state-3{background:var(--green);border-color:var(--green-strong)}
@media(max-width:700px){.hero{grid-template-columns:1fr}h1{font-size:31px}main{padding:24px 16px}.task{grid-template-columns:1fr auto}.task .delete{display:none}}
</style></head><body><main>
<div class="brand"><span class="logo">✓</span><div><strong>渐明</strong><div class="muted">电脑端 · 同步码 ${syncCode}</div></div></div>
<section class="hero"><div><h1>在手机上记下，<br>在电脑上完成。</h1><p class="muted">两端操作都会保存到这台电脑，并在下次同步时合并。</p></div><div class="capture"><label>快速收件箱</label><textarea id="draft" placeholder="输入要完成的任务…"></textarea><footer><span class="muted">Ctrl + Enter 快速记录</span><button class="primary" id="add">＋ 记录任务</button></footer></div></section>
<div class="toolbar"><h2 id="summary">任务列表</h2><div class="toolbar-actions"><span class="sync" id="status">正在连接…</span><button id="refresh">接收最新</button></div></div><section class="tasks" id="tasks"></section>
<dialog class="detail" id="detail"><div class="detail-card" id="detail-card"><div class="muted">任务详情</div><h2 id="detail-text"></h2><p class="muted" id="detail-meta"></p><div class="full-summary" id="detail-summary"></div><div class="detail-actions"><button id="detail-open">打开原链接</button><button id="detail-start">开始任务</button><button id="detail-done">标记完成</button><button class="danger" id="detail-delete">删除</button><button id="detail-close">关闭</button></div></div></dialog>
</main><script>
let tasks=[],stableOrder=[],detailTask=null;const stateNames=["未查看","进行中","已查看","已完成"],priority=[0,2,1,3];
function mergeDownload(incoming){const map=new Map(tasks.map(t=>[String(t.id),t]));for(const remote of incoming){const local=map.get(String(remote.id));if(!local){map.set(String(remote.id),remote);continue}if(Number(remote.updatedAt||0)>Number(local.updatedAt||0)){if(Number(local.summaryUpdatedAt||0)>Number(remote.summaryUpdatedAt||0))Object.assign(remote,{summary:local.summary,summaryStatus:local.summaryStatus,summaryError:local.summaryError,summaryUpdatedAt:local.summaryUpdatedAt});map.set(String(remote.id),remote)}else if(Number(remote.summaryUpdatedAt||0)>Number(local.summaryUpdatedAt||0))Object.assign(local,{summary:remote.summary,summaryStatus:remote.summaryStatus,summaryError:remote.summaryError,summaryUpdatedAt:remote.summaryUpdatedAt})}tasks=[...map.values()]}
async function sync(mode='merge'){document.querySelector('#status').textContent=mode==='download'?'正在接收…':'正在同步…';const response=await fetch('/api/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'${syncCode}',mode,tasks})});if(!response.ok)throw new Error('同步失败');const incoming=(await response.json()).tasks;if(mode==='download')mergeDownload(incoming);else tasks=incoming;render();document.querySelector('#status').textContent='已同步 · '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function orderedTasks(){const active=tasks.filter(t=>!t.deleted);if(!stableOrder.length)stableOrder=active.slice().sort((a,b)=>priority[a.state]-priority[b.state]||b.createdAt-a.createdAt).map(t=>String(t.id));for(const t of active)if(!stableOrder.includes(String(t.id)))stableOrder.unshift(String(t.id));return active.sort((a,b)=>stableOrder.indexOf(String(a.id))-stableOrder.indexOf(String(b.id)))}
function render(){const active=orderedTasks();document.querySelector('#summary').textContent=active.length?'任务 '+active.length+' 项 · 已完成 '+active.filter(t=>t.state===3).length+' 项':'任务列表';const root=document.querySelector('#tasks');root.innerHTML=active.length?'':'<div class="empty">先在手机或电脑上记录第一件事。</div>';for(const t of active){const el=document.createElement('article');el.className='task state-'+t.state;el.innerHTML='<div class="copy"><h3></h3><p>'+stateNames[t.state]+' · '+new Date(t.createdAt).toLocaleString()+'</p><div class="ai"></div></div><button class="complete" title="'+(t.state===3?'恢复任务':'标记完成')+'">'+(t.state===3?'✓':'')+'</button><button class="delete" title="删除任务">删除</button>';el.querySelector('h3').textContent=t.text.split('\\n')[0];const ai=el.querySelector('.ai');if(t.summary){ai.className='ai ai-summary';ai.textContent=t.summary}else if(t.summaryStatus==='pending'){ai.className='ai ai-status';ai.textContent='Kimi 正在阅读链接…'}else if(t.summaryStatus==='error'){ai.className='ai ai-status error';ai.textContent='摘要暂时失败，将在下次同步重试'}el.querySelector('.copy').onclick=()=>showDetail(t);el.querySelector('.complete').onclick=()=>{t.state=t.state===3?2:3;t.updatedAt=Date.now();el.className='task state-'+t.state;setTimeout(()=>sync('upload'),720)};el.querySelector('.delete').onclick=async()=>{if(confirm('删除这项任务？')){t.deleted=true;t.updatedAt=Date.now();await sync('upload')}};root.appendChild(el)}}
function updateDetail(){const t=detailTask,card=document.querySelector('#detail-card');card.className='detail-card state-'+t.state;document.querySelector('#detail-meta').textContent=stateNames[t.state]+' · '+new Date(t.createdAt).toLocaleString();document.querySelector('#detail-start').textContent=t.state===1?'进行中':t.state===3?'恢复任务':'开始任务';document.querySelector('#detail-done').textContent=t.state===3?'恢复为未完成':'标记完成'}
function showDetail(t){detailTask=t;document.querySelector('#detail-text').textContent=t.text;document.querySelector('#detail-summary').textContent=t.summary||'';const open=document.querySelector('#detail-open');open.hidden=!/^https?:\\/\\/\\S+$/.test(t.text.trim());open.onclick=()=>window.open(t.text.trim(),'_blank','noopener');updateDetail();document.querySelector('#detail').showModal();if(t.state===0)setTimeout(async()=>{if(detailTask===t&&t.state===0){t.state=2;t.updatedAt=Date.now();updateDetail();await sync('upload')}},450)}
document.querySelector('#detail-start').onclick=async()=>{if(!detailTask)return;detailTask.state=detailTask.state===3?2:1;detailTask.updatedAt=Date.now();updateDetail();await sync('upload')};document.querySelector('#detail-done').onclick=async()=>{if(!detailTask)return;detailTask.state=detailTask.state===3?2:3;detailTask.updatedAt=Date.now();updateDetail();await sync('upload')};document.querySelector('#detail-delete').onclick=async()=>{if(detailTask&&confirm('删除这项任务？')){detailTask.deleted=true;detailTask.updatedAt=Date.now();await sync('upload');document.querySelector('#detail').close()}};document.querySelector('#detail-close').onclick=()=>document.querySelector('#detail').close();document.querySelector('#detail').onclose=()=>{detailTask=null;render()};
async function add(){const input=document.querySelector('#draft');const text=input.value.trim();if(!text)return;const now=Date.now();tasks.unshift({id:crypto.randomUUID(),text,createdAt:now,updatedAt:now,reminderAt:0,state:0,deleted:false});input.value='';await sync('upload')}
document.querySelector('#add').onclick=add;document.querySelector('#refresh').onclick=()=>sync('download').catch(e=>document.querySelector('#status').textContent=e.message);document.querySelector('#draft').onkeydown=e=>{if(e.ctrlKey&&e.key==='Enter')add()};sync('download').catch(e=>document.querySelector('#status').textContent=e.message);setInterval(()=>{if(tasks.some(t=>t.summaryStatus==='pending'))sync('download').catch(()=>{})},5000);
</script></body></html>`;

http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return response.end(page);
  }
  if (request.method === "POST" && request.url === "/api/sync") {
    try {
      const body = await readJson(request);
      if (String(body.code || "") !== syncCode) return sendJson(response, 403, { error: "同步码不正确" });
      const mode = ["upload", "download", "merge"].includes(body.mode) ? body.mode : "merge";
      const current = readTasks();
      const merged = mode === "download" ? current : mergeTasks(current, Array.isArray(body.tasks) ? body.tasks : []);
      const summariesQueued = scheduleSummaries(merged);
      if (mode !== "download" || summariesQueued) writeTasks(merged);
      return sendJson(response, 200, { tasks: merged, mode, serverTime: Date.now() });
    } catch (error) {
      return sendJson(response, 400, { error: "请求格式错误" });
    }
  }
  sendJson(response, 404, { error: "not found" });
}).listen(port, "0.0.0.0", () => {
  console.log(`渐明同步服务已启动：http://0.0.0.0:${port}`);
  console.log(`同步码：${syncCode}`);
  const tasks = readTasks();
  if (scheduleSummaries(tasks)) writeTasks(tasks);
});
