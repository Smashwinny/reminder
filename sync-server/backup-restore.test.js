const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validateRestore}=require('../deploy/offsite-check');
test('restore verification accepts identity aliases and rejects orphan sessions and damaged tasks',()=>{
 const dir=fs.mkdtempSync(path.resolve(__dirname,'../tmp/restore-test-'));
 const write=(f,a)=>{fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.writeFileSync(path.join(dir,f),JSON.stringify(a));};
 write('users.json',[{id:'current',passwordHash:'hash'},{id:'old',passwordHash:'hash',aliasOf:'current'}]);
 write('sessions.json',[{userId:'old',tokenHash:'hash'}]);
 write('users/current/tasks.json',[{id:'one',text:'kept',createdAt:1}]);
 assert.deepEqual(validateRestore(dir),{accounts:1,identities:2,tasks:1});
 write('sessions.json',[{userId:'missing',tokenHash:'hash'}]);assert.throws(()=>validateRestore(dir),/Orphan/);
 write('sessions.json',[]);write('users/current/tasks.json',[{id:'one',text:{},createdAt:1}]);assert.throws(()=>validateRestore(dir),/Invalid/);
});
