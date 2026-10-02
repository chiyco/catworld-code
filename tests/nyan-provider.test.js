import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderError,providerURL,verifyPublicHost,providerFetch,requestReply,inspectConnection,storedError,REPLY_TIMEOUT_MS,LOCK_MS,STALE_TURN_MS} from '../src/nyan-provider.js';
import {nyanRoute,checkNyanConnection} from '../src/nyan.js';
import {initialState} from '../src/model.js';

const config={baseUrl:'https://api.example.com/v1',model:'example-model'};
const reply=content=>new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'Content-Type':'application/json'}});
const json=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json'}});
const dns=url=>json({Status:0,Answer:new URL(url).searchParams.get('type')==='A'?[{type:1,data:'1.1.1.1',TTL:60}]:[]});
test('root API URLs get v1; complete URLs and gateway prefixes stay unchanged',()=>{
 assert.equal(providerURL('https://api.example.com').pathname,'/v1/chat/completions');
 assert.equal(providerURL(' https://api.example.com/v1/ ').pathname,'/v1/chat/completions');
 assert.equal(providerURL('https://api.example.com/gateway/v1/chat/completions').pathname,'/gateway/v1/chat/completions');
 for(const path of ['/v1/messages','/v1/responses'])assert.throws(()=>providerURL('https://api.example.com'+path),e=>e.code==='API_PROTOCOL');
});
test('resolver network failure falls back and a missing AAAA record is valid',async()=>{
 const calls=[];
 const r=await verifyPublicHost('api.example.com',{transport:async url=>{
  calls.push(url);if(url.includes('cloudflare-dns'))throw new TypeError('network reset');return dns(url);
 }});
 assert.equal(r.resolver,'dns.google');assert.equal(calls.length,4);
});
test('one DNS-family network error retries the complete check with fallback resolver',async()=>{
 const r=await verifyPublicHost('api.example.com',{transport:async url=>{
  if(url.includes('cloudflare-dns')&&url.includes('AAAA'))throw new DOMException('timeout','TimeoutError');return dns(url);
 }});assert.equal(r.resolver,'dns.google');
});
test('private DNS never fails open and never uses fallback to hide private results',async()=>{
 let calls=0;
 await assert.rejects(verifyPublicHost('api.example.com',{transport:async()=>{calls++;return json({Status:0,Answer:[{type:1,data:'169.254.169.254'}]});}}),e=>e.code==='DNS_PRIVATE');
 assert.equal(calls,2);
});
test('DNS outage has its own error, not an API-key or generation-timeout error',async()=>{
 await assert.rejects(verifyPublicHost('api.example.com',{transport:async()=>{throw new Error('disconnected');}}),e=>e.code==='DNS_CHECK_FAILED'&&e.message.includes('尚未发送'));
 await assert.rejects(verifyPublicHost('api.example.com',{transport:async()=>json({Status:3})}),e=>e.code==='DNS_NOT_FOUND');
});
test('authentication failures do not expose upstream bodies or keys',async()=>{
 await assert.rejects(requestReply(config,' secret-token ',[],async()=>new Response('ECHO secret-token',{status:401})),e=>e.code==='API_HTTP_401'&&!e.message.includes('secret-token'));
});
test('redirects are not followed and authorization never moves to a new host',async()=>{
 let calls=0;
 await assert.rejects(requestReply(config,'secret-token',[],async(url,opts)=>{
  calls++;assert.equal(opts.redirect,'manual');return new Response('',{status:307,headers:{Location:'https://other.example.com/capture'}});
 }),e=>e.code==='API_REDIRECT');
 assert.equal(calls,1);
});
test('chat timeouts and network errors stay distinct; there is no automatic generation retry',async()=>{
 let calls=0;
 await assert.rejects(requestReply(config,'secret',[],async()=>{calls++;throw new DOMException('expired','TimeoutError');}),e=>e.code==='API_TIMEOUT');
 assert.equal(calls,1);
 await assert.rejects(requestReply(config,'secret',[],async()=>{throw new TypeError('secret in error');}),e=>e.code==='API_CONNECT_FAILED'&&!e.message.includes('secret'));
 const broken=new ReadableStream({start(c){c.error(new DOMException('body timeout','TimeoutError'));}});
 await assert.rejects(providerFetch('https://api.example.com/v1/chat/completions','secret',{kind:'chat',transport:async()=>new Response(broken)}),e=>e.code==='API_TIMEOUT');
 assert.equal(REPLY_TIMEOUT_MS,90000);assert(LOCK_MS>REPLY_TIMEOUT_MS+10000);assert(STALE_TURN_MS>LOCK_MS);
});
test('diagnostic only GETs models and cannot spend a chat-generation request',async()=>{
 let calls=0;
 const r=await inspectConnection(config,'secret',{verifyHost:async()=>({resolver:'test-dns'}),transport:async(url,opts)=>{
  calls++;assert.equal(opts.method,'GET');assert.equal(opts.body,undefined);assert.equal(new URL(url).pathname,'/v1/models');
  return json({data:[{id:config.model}]});
 }});
 assert.equal(calls,1);assert.equal(r.code,'CONNECTION_OK');assert.equal(r.ok,true);assert(!JSON.stringify(r).includes('secret'));
});
test('diagnostic tells model-list mismatch apart from unauthenticated response',async()=>{
 const verifyHost=async()=>({resolver:'test'});
 const absent=await inspectConnection(config,'secret',{verifyHost,transport:async()=>json({data:[{id:'another-model'}]})});
 assert.equal(absent.code,'MODEL_NOT_LISTED');assert.equal(absent.ok,true);
 const invalid=await inspectConnection(config,'secret',{verifyHost,transport:async()=>new Response('',{status:401})});
 assert.equal(invalid.code,'API_HTTP_401');assert.equal(invalid.ok,false);assert.equal(invalid.stage,'models');
 const dnsFailure=await inspectConnection(config,'secret',{verifyHost:async()=>{throw new ProviderError('DNS_CHECK_FAILED','DNS unavailable');},transport:async()=>{throw Error('must not call model');}});
 assert.equal(dnsFailure.stage,'dns');assert.equal(dnsFailure.code,'DNS_CHECK_FAILED');
 const noModels=await inspectConnection(config,'secret',{verifyHost,transport:async()=>new Response('',{status:404})});
 assert.equal(noModels.code,'MODEL_LIST_UNAVAILABLE');assert(noModels.message.includes('不代表聊天接口不可用'));
});
test('message content text blocks are supported but incompatible formats fail explicitly',async()=>{
 const r=await requestReply(config,'secret',[],async()=>reply([{type:'text',text:'你好'},{type:'text',text:'喵'}]));assert.equal(r,'你好\n喵');
 await assert.rejects(requestReply(config,'secret',[],async()=>json({output:'wrong protocol'})),e=>e.code==='API_NO_TEXT');
 await assert.rejects(requestReply(config,'secret',[],async()=>new Response('<html>login</html>')),e=>e.code==='API_INVALID_JSON');
});
test('saved errors reveal only structured stage, trace and safe messages',()=>{
 const s=storedError(new TypeError('SECRET key and SQL content'),'chat','01234567');assert(!s.includes('SECRET'));assert(s.includes('SERVER_ERROR / chat / 01234567'));
 const e=storedError(new ProviderError('API_TIMEOUT','timeout'),'chat','01234567');assert(e.includes('API_TIMEOUT'));
});
test('history recovery does not expire a 90 second generation at the old 60 second threshold',async()=>{
 let args,sql;
 const env={DB:{prepare(q){return {bind(...a){return {run:async()=>{sql=q;args=a;return {success:true};},all:async()=>({results:[]})};}};}}};
 const start=Date.now();const r=await nyanRoute(new Request('https://local/api/nyan'),env,{id:'user'});assert.equal(r.status,200);
 assert(sql.includes('NOT EXISTS'));assert.equal(args[0],'user');assert(args[1]>=start-STALE_TURN_MS&&args[1]<=Date.now()-STALE_TURN_MS);assert.equal(args[2],'user');
});
test('missing configuration diagnostic never sends a provider request',async()=>{
 const state=initialState('qa');state.incomeEpoch=1;
 const env={DB:{prepare(q){return {bind(){return {
  first:async()=>q.includes('auth_limits')?{attempts:1}:{state_json:JSON.stringify(state),updated_at:Date.now()},run:async()=>({meta:{changes:1}})
 };}};}}};
 const req=new Request('https://local/api/nyan/check',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 await assert.rejects(checkNyanConnection(req,env,{id:'user',username:'qa'}),e=>e.status===400&&e.message.includes('请先保存'));
});
