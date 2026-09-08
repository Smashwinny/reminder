const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const blocked4 = new net.BlockList();
for (const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked4.addSubnet(ip,bits,'ipv4');
const global6 = new net.BlockList();global6.addSubnet('2000::',3,'ipv6');
const blocked6 = new net.BlockList();
for(const [ip,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked6.addSubnet(ip,bits,'ipv6');
function privateAddress(address){
 const family=net.isIP(address);
 if(family===4)return blocked4.check(address,'ipv4');
 if(family===6)return !global6.check(address,'ipv6')||blocked6.check(address,'ipv6');
 return true;
}
function publicLookup(host, options, callback){
 dns.lookup(host,{all:true},(error,records)=>{
   if(error)return callback(error);
   if(!records.length||records.some(r=>privateAddress(r.address)))return callback(new Error('不允许访问内网地址'));
   // Return these exact checked records to the socket, never resolve twice.
   if(options.all)callback(null,records);
   else callback(null,records[0].address,records[0].family);
 });
}
function publicRequest(input,{timeoutMs=10000,maxBytes=1500000}={}){
 return new Promise((resolve,reject)=>{
   const url=new URL(input),host=url.hostname.replace(/^\[|\]$/g,'');
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password||
      (url.port&&!['80','443'].includes(url.port))||(net.isIP(host)&&privateAddress(host)))return reject(new Error('不允许访问此地址或端口'));
   const transport=url.protocol==='https:'?https:http;
   let timer;
   const request=transport.get(url,{lookup:publicLookup,agent:false,headers:{'User-Agent':'ReminderSummary/1.0','Accept':'text/html,text/plain,application/xhtml+xml,application/json','Accept-Encoding':'identity'}},response=>{
     const chunks=[];let size=0;
     response.on('data',chunk=>{
       size+=chunk.length;
       if(size>maxBytes){response.destroy(new Error('网页内容超过大小限制'));return;}
       chunks.push(chunk);
     });
     response.on('error',reject);
     response.on('end',()=>{
       clearTimeout(timer);
       const status=response.statusCode;
       const headers=new Headers();for(const [k,v]of Object.entries(response.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(', '):v);
       resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers}));
     });
   });
   timer=setTimeout(()=>request.destroy(new Error('网页读取 timeout')),timeoutMs);
   request.on('error',error=>{clearTimeout(timer);reject(error);});
   request.on('close',()=>clearTimeout(timer));
 });
}
module.exports={privateAddress,publicLookup,publicRequest};
