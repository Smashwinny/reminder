const test=require('node:test'),assert=require('node:assert/strict'),dns=require('node:dns');
const {privateAddress,publicLookup,publicRequest}=require('./public-request');
test('HTTP transport uses pinned lookup and rejects oversized responses',async(t)=>{
 const https=require('node:https'),{EventEmitter}=require('node:events');
 t.mock.method(https,'get',(url,options,callback)=>{
   assert.equal(options.lookup,publicLookup);assert.equal(options.agent,false);
   const request=new EventEmitter();request.destroy=e=>request.emit('error',e);
   process.nextTick(()=>{
     const response=new EventEmitter();response.statusCode=200;response.headers={'content-type':'text/plain'};
     response.destroy=e=>{response.emit('error',e);request.emit('close');};
     callback(response);response.emit('data',Buffer.alloc(20));
   });
   return request;
 });
 await assert.rejects(publicRequest('https://example.com',{maxBytes:10}),/大小限制/);
});
test('blocks private, mapped IPv6, metadata, transition and reserved destinations',async()=>{
 for(const ip of ['127.0.0.1','10.2.3.4','100.100.100.200','169.254.169.254','172.16.0.1','192.168.0.1','198.18.0.1','::1','::ffff:ac10:1','::ffff:7f00:1','64:ff9b::7f00:1','2002:7f00:1::','fe80::1','fd00::1','2001:db8::1','bad'])assert(privateAddress(ip),ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(privateAddress(ip),false,ip);
 for(const url of ['http://127.1','http://2130706433','http://[::ffff:7f00:1]/','http://example.com:8787/','http://user:pass@example.com','file:///etc/passwd'])await assert.rejects(publicRequest(url));
});
test('socket lookup returns exactly the checked addresses and rejects mixed DNS answers',async(t)=>{
 let calls=0;
 t.mock.method(dns,'lookup',(host,options,cb)=>{calls++;cb(null,calls===1?[{address:'8.8.8.8',family:4}]:[{address:'127.0.0.1',family:4}]);});
 const lookup=options=>new Promise((resolve,reject)=>publicLookup('rebind.example',options,(e,...r)=>e?reject(e):resolve(r)));
 assert.deepEqual(await lookup({}),['8.8.8.8',4]);assert.equal(calls,1);
 await assert.rejects(lookup({all:true}));
 t.mock.method(dns,'lookup',(host,options,cb)=>cb(null,[{address:'8.8.8.8',family:4},{address:'::1',family:6}]));
 await assert.rejects(lookup({all:true}));
});
