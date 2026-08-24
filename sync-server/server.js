const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 8787);
const syncCode = process.env.SYNC_CODE || "123456";
const dataDir = path.join(__dirname, "data");
const dataFile = path.join(dataDir, "tasks.json");
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
    if (!current || Number(task.updatedAt || task.createdAt || 0) >= Number(current.updatedAt || current.createdAt || 0)) {
      merged.set(id, { ...task, id });
    }
  }
  return [...merged.values()].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
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
:root{color-scheme:light;--brand:#265849;--soft:#e0ebe6;--paper:#f8f7f3;--ink:#222b27;--muted:#68716d;--line:#e2e5e1}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:auto;padding:42px 24px 80px}.brand{display:flex;align-items:center;gap:11px}.logo{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:var(--brand);color:white;font-weight:800;font-size:20px}.brand strong{font-size:18px}.muted{color:var(--muted);font-size:13px}
.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:28px;align-items:end;margin:34px 0 28px}h1{font-size:38px;line-height:1.18;margin:0 0 10px;letter-spacing:-1.2px}.capture{background:white;border:1px solid var(--line);border-radius:18px;padding:16px}.capture label{font-size:12px;color:var(--brand);font-weight:700}textarea{width:100%;min-height:112px;border:0;resize:vertical;padding:10px 0;font:16px inherit;outline:0;color:var(--ink)}
button{border:0;border-radius:11px;padding:10px 15px;font:700 13px inherit;cursor:pointer;background:var(--soft);color:var(--brand)}button.primary{background:var(--brand);color:white}.capture footer{display:flex;justify-content:space-between;align-items:center}.toolbar{display:flex;align-items:center;justify-content:space-between;margin:26px 0 12px}.toolbar h2{margin:0;font-size:20px}.sync{font-size:12px;color:var(--muted)}
.tasks{display:grid;gap:9px}.task{display:grid;grid-template-columns:7px 1fr auto;gap:13px;align-items:center;background:white;border:1px solid var(--line);border-radius:16px;padding:14px}.mark{height:58px;border-radius:99px;background:var(--brand)}.task h3{font-size:16px;margin:0 0 5px}.task p{margin:0;color:var(--muted);font-size:12px}.empty{text-align:center;background:white;border:1px solid var(--line);border-radius:18px;padding:42px;color:var(--muted)}
@media(max-width:700px){.hero{grid-template-columns:1fr}h1{font-size:31px}main{padding:24px 16px}.task{grid-template-columns:7px 1fr}.task button{grid-column:2}}
</style></head><body><main>
<div class="brand"><span class="logo">✓</span><div><strong>渐明</strong><div class="muted">电脑端 · 同步码 ${syncCode}</div></div></div>
<section class="hero"><div><h1>在手机上记下，<br>在电脑上完成。</h1><p class="muted">两端操作都会保存到这台电脑，并在下次同步时合并。</p></div><div class="capture"><label>快速收件箱</label><textarea id="draft" placeholder="输入要完成的任务…"></textarea><footer><span class="muted">Ctrl + Enter 快速记录</span><button class="primary" id="add">＋ 记录任务</button></footer></div></section>
<div class="toolbar"><h2 id="summary">任务列表</h2><span class="sync" id="status">正在连接…</span></div><section class="tasks" id="tasks"></section>
</main><script>
let tasks=[];const stateNames=["未查看","进行中","已查看","已完成"];
async function sync(){document.querySelector('#status').textContent='正在同步…';const response=await fetch('/api/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'${syncCode}',tasks})});if(!response.ok)throw new Error('同步失败');tasks=(await response.json()).tasks;render();document.querySelector('#status').textContent='已同步 · '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function render(){const active=tasks.filter(t=>!t.deleted).sort((a,b)=>a.state-b.state||b.createdAt-a.createdAt);document.querySelector('#summary').textContent=active.length?'任务 '+active.length+' 项 · 已完成 '+active.filter(t=>t.state===3).length+' 项':'任务列表';const root=document.querySelector('#tasks');root.innerHTML=active.length?'':'<div class="empty">先在手机或电脑上记录第一件事。</div>';for(const t of active){const el=document.createElement('article');el.className='task';el.innerHTML='<span class="mark" style="opacity:'+([1,.78,.49,.2][t.state]||1)+'"></span><div><h3></h3><p>'+stateNames[t.state]+' · '+new Date(t.createdAt).toLocaleString()+'</p></div><button>'+(t.state===3?'恢复':'完成')+'</button>';el.querySelector('h3').textContent=t.text.split('\n')[0];el.querySelector('button').onclick=async()=>{t.state=t.state===3?2:3;t.updatedAt=Date.now();await sync()};el.ondblclick=async()=>{if(confirm('删除这项任务？')){t.deleted=true;t.updatedAt=Date.now();await sync()}};root.appendChild(el)}}
async function add(){const input=document.querySelector('#draft');const text=input.value.trim();if(!text)return;const now=Date.now();tasks.unshift({id:crypto.randomUUID(),text,createdAt:now,updatedAt:now,reminderAt:0,state:0,deleted:false});input.value='';await sync()}
document.querySelector('#add').onclick=add;document.querySelector('#draft').onkeydown=e=>{if(e.ctrlKey&&e.key==='Enter')add()};sync().catch(e=>document.querySelector('#status').textContent=e.message);
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
      const merged = mergeTasks(readTasks(), Array.isArray(body.tasks) ? body.tasks : []);
      writeTasks(merged);
      return sendJson(response, 200, { tasks: merged, serverTime: Date.now() });
    } catch (error) {
      return sendJson(response, 400, { error: "请求格式错误" });
    }
  }
  sendJson(response, 404, { error: "not found" });
}).listen(port, "0.0.0.0", () => {
  console.log(`渐明同步服务已启动：http://0.0.0.0:${port}`);
  console.log(`同步码：${syncCode}`);
});
