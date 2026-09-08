const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const dir=path.resolve(__dirname,'../tmp/friend-flow');
async function main(){
 process.umask(0o077);fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const stateFile=path.join(dir,'state.json');
 let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):null;
 function save(){fs.writeFileSync(stateFile+'.next',JSON.stringify(state),{mode:0o600});fs.renameSync(stateFile+'.next',stateFile);}
 if(!state){const suffix=Date.now().toString(36);state={a:{username:'qa_a_'+suffix,password:crypto.randomBytes(24).toString('hex')},b:{username:'qa_b_'+suffix,password:crypto.randomBytes(24).toString('hex')}};save();}
 const post=async(route,body,token)=>{
   const response=await fetch('https://reminder.geniusqi.com'+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
   return {status:response.status,body:await response.json()};
 };
 const invite=execFileSync('ssh',['-i','/home/hulk/.ssh/id_ed25519_reminder_server','-o','BatchMode=yes','-o','ConnectTimeout=15','root@8.153.101.153',"docker exec reminder_app node -e 'process.stdout.write(process.env.REGISTRATION_INVITE_CODE)'"],{encoding:'utf8',timeout:30000}).trim();
 for(const name of ['a','b']){
   const account=state[name];
   let response=await post('/api/auth/login',{username:account.username,password:account.password});
   if(response.status===401)response=await post('/api/auth/register',{username:account.username,password:account.password,inviteCode:invite});
   assert([200,201].includes(response.status),'Test account authentication failed');
   account.token=response.body.token;account.id=response.body.user.id;save();
 }
 const a=state.a,b=state.b;
 const second=await post('/api/auth/login',{username:a.username,password:a.password});assert.equal(second.status,200);
 const sync=(token,tasks,mode='merge')=>post('/api/sync',{mode,tasks},token);
 const time=Date.now(),phone={id:'qa-phone',text:'独立验收：手机记录',createdAt:time,updatedAt:time},desktop={id:'qa-desktop',text:'独立验收：电脑记录',createdAt:time,updatedAt:time};
 const results=await Promise.all([sync(a.token,[phone]),sync(second.body.token,[desktop])]);results.forEach(r=>assert.equal(r.status,200));
 let read=await sync(a.token,[],'download');assert.equal(read.status,200);
 assert(read.body.tasks.some(t=>t.id===phone.id)&&read.body.tasks.some(t=>t.id===desktop.id));
 assert.equal((await sync(b.token,[],'download')).body.tasks.length,0);
 assert.equal((await sync(a.token,[{...phone,state:3,updatedAt:time+1}])).status,200);
 assert.equal((await sync(second.body.token,[],'download')).body.tasks.find(t=>t.id===phone.id).state,3);
 assert.equal((await sync(second.body.token,[{...desktop,deleted:true,updatedAt:time+2}])).status,200);
 assert.equal((await sync(a.token,[],'download')).body.tasks.find(t=>t.id===desktop.id).deleted,true);
 assert.equal((await sync('invalid',[],'download')).status,401);
 assert.equal((await post('/api/auth/logout',{},second.body.token)).status,200);
 assert.equal((await sync(second.body.token,[],'download')).status,401);
 assert.equal((await sync(a.token,[],'download')).status,200);
 const report={verifiedAt:new Date().toISOString(),ok:true,checks:['register/login','two sessions concurrent merge','account isolation','complete/delete propagation','invalid token','logout revokes only one session'],testAccounts:[a.username,b.username]};
 fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
 // Keep test identities: never rewrite a live auth store to clean up tests.
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
