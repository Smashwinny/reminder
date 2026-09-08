#!/usr/bin/env node
// Laptop-side, read-only access to production. Never starts a local sync server.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'backups/offsite');
const remote = 'root@8.153.101.153';
const sshArgs = ['-i', '/home/hulk/.ssh/id_ed25519_reminder_server', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
const run = (cmd,args) => execFileSync(cmd,args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});

function validateRestore(dir) {
  const read = file => {const a=JSON.parse(fs.readFileSync(path.join(dir,file)));if(!Array.isArray(a))throw Error('Invalid backup array');return a;};
  const users=read('users.json'),sessions=read('sessions.json');
  const ids=new Set(users.map(u=>u.id));
  if(ids.size!==users.length)throw Error('Duplicate backup identity');
  let tasks=0;
  for(const u of users){
    if(typeof u.id!=='string'||!/^[a-zA-Z0-9-]+$/.test(u.id)||typeof u.passwordHash!=='string')throw Error('Invalid backup identity');
    if(u.aliasOf){if(!users.some(t=>t.id===u.aliasOf&&!t.aliasOf))throw Error('Broken backup alias');continue;}
    const file=`users/${u.id}/tasks.json`;
    if(!fs.existsSync(path.join(dir,file)))continue; // Newly registered accounts may be empty.
    const list=read(file);
    if(new Set(list.map(t=>t.id)).size!==list.length||list.some(t=>!t||typeof t.text!=='string'||!Number.isSafeInteger(t.createdAt)))throw Error('Invalid backup tasks');
    tasks+=list.length;
  }
  if(sessions.some(s=>!ids.has(s.userId)||typeof s.tokenHash!=='string'))throw Error('Orphan backup session');
  for(const file of ['password-reset-tokens.json','summary-usage.json'])if(fs.existsSync(path.join(dir,file)))read(file);
  return {accounts:users.filter(u=>!u.aliasOf).length,identities:users.length,tasks};
}

async function main(){
  process.umask(0o077);fs.mkdirSync(destination,{recursive:true,mode:0o700});
  const statusFile=path.join(destination,'status.json');
  let prior={};try{prior=JSON.parse(fs.readFileSync(statusFile));}catch{}
  const result={checkedAt:new Date().toISOString(),ok:false};
  // A public outage must not prevent rescue of a still-accessible cloud backup.
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch('https://reminder.geniusqi.com/api/healthz',{signal:AbortSignal.timeout(15000)});
      if(!response.ok||(await response.json()).service!=='reminder')throw Error('Public health check failed');
      result.publicHealthy=true;break;
    }catch{result.publicHealthy=false;}
  }
  try{
    const listing=run('ssh',[...sshArgs,remote,'find /opt/reminder/backups -maxdepth 1 -type f -name "reminder-data-*.tar.gz" -printf "%f\\n"']);
    const name=listing.trim().split('\n').filter(n=>/^reminder-data-\d{8}T\d{6}Z\.tar\.gz$/.test(n)).sort().at(-1);
    if(!name)throw Error('No cloud backup');
    const stamp=name.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
    const at=Date.UTC(...stamp.slice(1).map(Number).map((v,i)=>i===1?v-1:v));
    if(Date.now()-at>36*3600000||at>Date.now()+300000)throw Error('Cloud backup stale or invalid clock');
    const checksum=run('ssh',[...sshArgs,remote,`cat /opt/reminder/backups/${name}.sha256`]).trim().split(/\s+/)[0];
    if(!/^[a-f0-9]{64}$/.test(checksum))throw Error('Invalid backup checksum');
    const archive=path.join(destination,name);
    if(!fs.existsSync(archive)){
      run('scp',[...sshArgs,`${remote}:/opt/reminder/backups/${name}`,archive+'.partial']);
      const actual=crypto.createHash('sha256').update(fs.readFileSync(archive+'.partial')).digest('hex');
      if(actual!==checksum)throw Error('Downloaded backup checksum mismatch');
      fs.renameSync(archive+'.partial',archive);
    }
    if(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==checksum)throw Error('Local backup damaged');
    const entries=run('tar',['-tzf',archive]).trim().split('\n');
    if(entries.some(n=>n.startsWith('/')||n.split('/').includes('..')))throw Error('Unsafe archive paths');
    if(run('tar',['-tvzf',archive]).trim().split('\n').some(n=>!['d','-'].includes(n[0])))throw Error('Unsupported archive entry');
    const reuse=prior.ok&&prior.sha256===checksum&&typeof prior.restoreDirectory==='string'&&prior.restoreDirectory.startsWith(destination+'/verify-')&&fs.existsSync(prior.restoreDirectory);
    const restored=reuse?prior.restoreDirectory:fs.mkdtempSync(path.join(destination,'verify-'));
    if(!reuse)run('tar',['-xzf',archive,'--no-same-owner','--no-same-permissions','-C',restored]);
    result.restored=validateRestore(restored);
    // Keep extracted evidence; no automatic deletion of recovery data.
    result.archive=name;result.sha256=checksum;result.restoreDirectory=restored;result.ok=result.publicHealthy;
    if(!result.publicHealthy)result.error='Public health check failed; offsite backup verified';
  }catch(error){result.error=String(error.message).split('\n')[0].slice(0,200);}
  fs.writeFileSync(statusFile+'.next',JSON.stringify(result,null,2),{mode:0o600});fs.renameSync(statusFile+'.next',statusFile);
  if(!result.ok){
    try{run('notify-send',['--urgency=critical','拾遗需要检查','公网服务或异机备份验证失败，请查看 backups/offsite/status.json']);}catch{}
    console.error(result.error);process.exitCode=1;
  }else{if(prior.ok===false)try{run('notify-send',['拾遗恢复正常','公网检查和异机备份恢复验证通过']);}catch{}console.log(JSON.stringify(result));}
}
if(require.main===module)main();
module.exports={validateRestore};
