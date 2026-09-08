const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createAuthStore}=require('./auth-store');
test('migration aliases retain old sessions, share storage, and password reset revokes both',()=>{
 const dir=fs.mkdtempSync(path.resolve(__dirname,'../tmp/alias-test-'));
 const store=createAuthStore(dir,{inviteCode:'migration-test-invite'});
 const old=store.register('original','old-password','migration-test-invite');
 const current=store.register('current','new-password','migration-test-invite');
 const users=JSON.parse(fs.readFileSync(store.usersFile));
 users.find(u=>u.id===old.user.id).aliasOf=current.user.id;
 users.find(u=>u.id===old.user.id).username='current';
 fs.writeFileSync(store.usersFile,JSON.stringify(users));
 assert.equal(store.authenticate('Bearer '+old.token).id,old.user.id);
 assert.equal(store.storageUserId(old.user.id),current.user.id);
 assert.equal(store.login('current','new-password').user.id,current.user.id);
 assert.throws(()=>store.login('current','old-password'));
 const reset=store.createPasswordReset('current');store.resetPassword(reset.token,'final-password');
 assert.equal(store.authenticate('Bearer '+old.token),null);
 assert.equal(store.authenticate('Bearer '+current.token),null);
});
