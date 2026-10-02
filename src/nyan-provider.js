import {HttpError,requireThat} from './common.js';

export const REPLY_TIMEOUT_MS=90000;
export const LOCK_MS=150000;
export const STALE_TURN_MS=180000;
const DNS_TIMEOUT_MS=5000;
const dnsCache=new Map();
const DNS_SERVICES=['https://cloudflare-dns.com/dns-query','https://dns.google/resolve'];

export class ProviderError extends HttpError {
 constructor(code,message,status=502){super(message,status);this.code=code;}
}
const fault=(code,message,status=502)=>new ProviderError(code,message,status);
const timeout=e=>e?.name==='TimeoutError'||e?.name==='AbortError';

export function providerURL(base){
 let u;try{u=new URL(String(base).trim());}catch{throw fault('API_URL','API 地址无效',400);}
 requireThat(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443'),'API 仅支持无用户名、无参数的 HTTPS 地址');
 const host=u.hostname.toLowerCase();
 requireThat(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)&&host.includes('.')&&!/^[\d.]+$/.test(host)&&!/(^|\.)(localhost|local|internal|test|invalid)$/.test(host),'API 必须使用公网域名');
 let path=u.pathname.replace(/\/+$/,'')||'/v1';
 if(path.endsWith('/messages')||path.endsWith('/responses'))throw fault('API_PROTOCOL','当前支持 OpenAI Chat Completions。请填写该服务的 /v1 基础地址，而不是 /messages 或 /responses。',400);
 if(!path.endsWith('/chat/completions'))path+='/chat/completions';
 u.pathname=path;
 return u;
}
export function publicIP(ip){
 if(typeof ip!=='string')return false;
 if(ip.includes(':'))return /^[23][a-f\d]{0,3}:/i.test(ip)&&!/^2001:(?:db8|0:)/i.test(ip)&&!/^2002:/i.test(ip);
 const n=ip.split('.').map(Number);if(n.length!==4||n.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
 return n[0]!==0&&n[0]!==10&&n[0]!==127&&n[0]<224&&!(n[0]===169&&n[1]===254)&&!(n[0]===172&&n[1]>=16&&n[1]<=31)&&!(n[0]===192&&(n[1]===168||n[1]===0))&&!(n[0]===100&&n[1]>=64&&n[1]<=127)&&!(n[0]===198&&(n[1]===18||n[1]===19));
}
export async function boundedJSON(response,limit=524288){
 const reader=response.body?.getReader();if(!reader)throw fault('API_EMPTY_BODY','API 没有返回内容');
 const chunks=[];let size=0;
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit){await reader.cancel();throw fault('API_RESPONSE_LARGE','API 回复过大，请减少回复长度');}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw fault('API_INVALID_JSON','API 未返回有效 JSON；请检查是否误填了网站地址或流式专用地址');}
}
export async function verifyPublicHost(host,{transport=fetch,now=Date.now(),cache=transport===fetch,services=DNS_SERVICES}={}){
 const cached=dnsCache.get(host);if(cache&&cached?.until>now)return {...cached.result,cached:true};
 for(const service of services){
  // A missing AAAA record is fine; an unavailable resolver is not the same as
  // NXDOMAIN. Never bypass the public-address check when a resolver fails.
  const answers=await Promise.allSettled(['A','AAAA'].map(async type=>{
   let r;
   try{r=await transport(service+'?name='+encodeURIComponent(host)+'&type='+type,{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(DNS_TIMEOUT_MS)});}
   catch(e){throw fault(timeout(e)?'DNS_TIMEOUT':'DNS_CONNECT','DNS 检查服务暂时无法连接');}
   if(!r.ok){await r.body?.cancel();throw fault('DNS_SERVICE_HTTP','DNS 检查服务返回异常');}
   const data=await boundedJSON(r,32768);
   const entries=(data.Answer||[]).filter(a=>a.type===1||a.type===28);
   if(entries.some(a=>!publicIP(a.data)))throw fault('DNS_PRIVATE','API 域名解析到非公网地址，已阻止发送密钥',400);
   if(data.Status===3)throw fault('DNS_NOT_FOUND','API 域名不存在，请检查地址拼写',400);
   if(data.Status!==0)throw fault('DNS_RESOLVE_FAILED','DNS 检查服务无法解析 API 域名');
   return entries;
  }));
  for(const a of answers)if(a.status==='rejected'&&['DNS_PRIVATE','DNS_NOT_FOUND'].includes(a.reason.code))throw a.reason;
  if(answers.some(a=>a.status==='rejected'))continue;
  const entries=answers.flatMap(a=>a.value);
  if(!entries.length)throw fault('DNS_NO_ADDRESS','API 域名没有可用的公网地址',400);
  const result={ok:true,resolver:new URL(service).hostname,cached:false};
  if(cache){if(dnsCache.size>128)dnsCache.clear();const ttl=Math.max(0,Math.min(60,...entries.map(e=>Number(e.TTL)||0)));dnsCache.set(host,{until:now+ttl*1000,result});}
  return result;
 }
 throw fault('DNS_CHECK_FAILED','两个 DNS 检查服务均不可用；请求尚未发送到模型接口。这不是密钥错误，请稍后点击「检测连接」重试。');
}
function httpFailure(status,kind){
 const prefix=kind==='models'?'连接检测':'猫娘 API';
 const messages={
  400:'请求参数或模型名称不被服务商接受',
  401:'API Key 无效或已过期，请重新保存聊天密钥',
  402:'API 余额不足，请检查服务商账户',
  403:'密钥没有权限，或服务商拒绝来自 Cloudflare 的请求',
  404:'接口路径或模型不存在，请检查 /v1 地址和模型名称',
  405:'服务商不支持此请求方法，请检查接口路径',
  408:'服务商处理请求超时',
  413:'对话上下文过长，请使用较短对话',
  429:'服务商限流或额度不足，请稍后再试',
  500:'服务商内部错误',
  502:'服务商网关异常',
  503:'服务商暂时不可用',
  504:'服务商网关等待模型超时',
  522:'服务商源站连接超时',
  524:'服务商源站响应超时',
  525:'服务商源站 TLS 握手失败',
  526:'服务商源站 HTTPS 证书无效'
 };
 return fault('API_HTTP_'+status,prefix+'（HTTP '+status+'）：'+(messages[status]||'服务商返回异常，请检查该服务的状态'));
}
export async function providerFetch(url,key,{method='GET',payload,kind='models',timeoutMs=15000,transport=fetch}={}){
 const options={method,redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{Authorization:'Bearer '+String(key).trim(),Accept:'application/json'}};
 if(payload){options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload);}
 try{
  const r=await transport(url.toString(),options);
  if(r.status>=300&&r.status<400){
   // Deliberately do not follow a redirect with a user's Authorization header.
   await r.body?.cancel();throw fault('API_REDIRECT','API 返回重定向（HTTP '+r.status+'）。为防止密钥泄露未跟随跳转，请填写服务商最终 API 地址。');
  }
  if(!r.ok){await r.body?.cancel();throw httpFailure(r.status,kind);}
  return await boundedJSON(r);
 }catch(e){
  if(e instanceof ProviderError)throw e;
  if(timeout(e))throw fault('API_TIMEOUT',kind==='models'?'连接检测等待超过 15 秒；服务商未及时响应。':'模型回复等待超过 90 秒，尚未收到完整回复；请检查服务商状态或选择更快的模型。');
  // Never reflect raw fetch exceptions, provider bodies, prompts or credentials.
  throw fault('API_CONNECT_FAILED','Cloudflare 无法连接 API（网络或 TLS 失败），请求未得到有效 HTTP 响应；请检查域名证书、服务商防火墙或地区限制。');
 }
}
export async function requestReply(config,key,messages,transport=fetch){
 const data=await providerFetch(providerURL(config.baseUrl),key,{method:'POST',payload:{model:config.model.trim(),messages,stream:false},kind:'chat',timeoutMs:REPLY_TIMEOUT_MS,transport});
 const message=data.choices?.[0]?.message;
 const content=typeof message?.content==='string'?message.content:Array.isArray(message?.content)?message.content.filter(p=>p.type==='text'&&typeof p.text==='string').map(p=>p.text).join('\n'):'';
 if(!content.trim())throw fault('API_NO_TEXT','API 未返回文本回复，请使用支持 Chat Completions 的文本模型');
 return content.slice(0,12000);
}
export async function inspectConnection(config,key,{transport=fetch,verifyHost=verifyPublicHost}={}){
 const started=Date.now(),url=providerURL(config.baseUrl),endpoint=url.origin+url.pathname;
 let stage='dns';
 try{
  const dns=await verifyHost(url.hostname);stage='models';
  const modelsURL=new URL(url);modelsURL.pathname=modelsURL.pathname.replace(/\/chat\/completions$/,'/models');
  const data=await providerFetch(modelsURL,key,{transport});
  if(!Array.isArray(data.data))throw fault('API_MODELS_FORMAT','服务返回的模型列表格式不兼容，请确认 OpenAI 兼容地址');
  const available=data.data.some(m=>m.id===config.model.trim());
  return {ok:true,code:available?'CONNECTION_OK':'MODEL_NOT_LISTED',stage,endpoint,model:config.model,resolver:dns.resolver,elapsedMs:Date.now()-started,
   message:available?'连接与鉴权成功，模型列表中包含所选模型。此检测没有生成回复；请再发送一条消息验证生成。':'连接与鉴权成功，但模型列表未包含当前模型；请向服务商确认完整模型名称。'};
 }catch(e){
  const p=e instanceof ProviderError||e instanceof HttpError?e:fault('CHECK_FAILED','连接检测未完成，请稍后重试');
  if(stage==='models'&&['API_HTTP_404','API_HTTP_405'].includes(p.code))return {ok:false,code:'MODEL_LIST_UNAVAILABLE',stage,endpoint,model:config.model,elapsedMs:Date.now()-started,message:'服务商没有开放此 /models 接口，暂时无法检测模型列表；这不代表聊天接口不可用，请向服务商确认路径，或发送消息查看具体错误。'};
  return {ok:false,code:p.code||'API_CONFIG',stage,endpoint,model:config.model,elapsedMs:Date.now()-started,message:p.message};
 }
}
export function storedError(e,stage,trace){
 const reason=e instanceof HttpError?e.message:'服务端处理失败，请稍后重试；该错误不一定来自模型 API';
 const code=e instanceof HttpError?e.code||'API_CONFIG':'SERVER_ERROR';
 return '['+code+' / '+stage+' / '+trace+'] '+reason;
}
