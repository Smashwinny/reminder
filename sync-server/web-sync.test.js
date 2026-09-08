const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createServer } = require('./server');

test('web retains edits during a slow response, persists failures and isolates accounts', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const html = await (await fetch(`http://127.0.0.1:${server.address().port}/`)).text();
    const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const disk = new Map([['reminder-auth-token', 'test-session']]);
    const requests = [];
    const nodes = new Map();
    const context = vm.createContext({
      localStorage: { getItem: k => disk.get(k) || null, setItem: (k,v) => disk.set(k,v), removeItem: k => disk.delete(k) },
      document: { querySelector: key => { if (!nodes.has(key)) nodes.set(key, { textContent: '', value: '', open: false, showModal(){this.open=true}, close(){this.open=false} }); return nodes.get(key); } },
      fetch: (url, options) => new Promise((resolve,reject) => requests.push({url,options,resolve,reject})),
      AbortSignal, setInterval(){}, crypto: require('node:crypto').webcrypto,
    });
    vm.runInContext(source, context);
    vm.runInContext('render=()=>{}', context);
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const reply = (request, tasks, user='a') => request.resolve({status:200,ok:true,json:async()=>({tasks,user:{id:user,username:user}})});
    await tick(); reply(requests.shift(), [{id:'old',text:'original',updatedAt:1}]); await tick();
    vm.runInContext("sync('merge')",context); await tick();
    vm.runInContext("tasks.push({id:'new',text:'during flight',updatedAt:2});persistTasks()",context);
    reply(requests.shift(), [{id:'old',text:'original',updatedAt:1}]); await tick();
    assert.equal(JSON.parse(disk.get('reminder-tasks-a')).length,2);
    vm.runInContext("sync('merge').catch(()=>{})",context); await tick(); requests.shift().reject(new Error('offline')); await tick();
    assert.equal(JSON.parse(disk.get('reminder-tasks-a')).length,2);
    vm.runInContext("sync('merge').catch(()=>{})",context); await tick();
    reply(requests.shift(), [{id:'old',text:'original',updatedAt:1}]); await tick();
    assert.match(nodes.get('#status').textContent,/云端缺少本地任务/);
    assert.equal(JSON.parse(disk.get('reminder-tasks-a')).length,2);
    vm.runInContext("sync('merge').catch(()=>{})",context); await tick();
    reply(requests.shift(), [], 'b'); await tick();
    assert.match(nodes.get('#status').textContent,/账号身份不一致/);
    assert.equal(JSON.parse(disk.get('reminder-tasks-a')).length,2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
