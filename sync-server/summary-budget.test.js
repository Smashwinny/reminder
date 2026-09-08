const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createSummaryBudget}=require('./summary-budget');
test('durable per-user and global limits include retries and reset only next UTC day',()=>{
 const dir=fs.mkdtempSync(path.resolve(__dirname,'../tmp/budget-test-'));
 let time=Date.UTC(2026,8,8);
 const options={perUser:2,global:3,now:()=>time};
 const a=createSummaryBudget(dir,options);
 assert(a.reserve('alice')); assert(a.reserve('alice'));
 assert.equal(a.reserve('alice'),false);
 const restarted=createSummaryBudget(dir,options);
 assert.equal(restarted.reserve('alice'),false);
 assert(restarted.reserve('bob')); assert.equal(restarted.reserve('charlie'),false);
 for(let i=0;i<6;i++)assert(restarted.reserve('alice','job'));
 assert.equal(restarted.reserve('alice','job'),false);
 time+=86400000; assert(restarted.reserve('alice'));
 fs.writeFileSync(a.file,'broken');assert.throws(()=>restarted.reserve('bob'),{name:'StorageError'});
 fs.unlinkSync(a.file);assert.throws(()=>restarted.reserve('bob'),{name:'StorageError'});
});
