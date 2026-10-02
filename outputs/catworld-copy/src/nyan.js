import {json,body,requireThat,HttpError,decrypt} from './common.js';
import {loadState} from './model.js';
import {operationId,chatText,rate} from './social.js';
export function providerURL(base){
 let u;try{u=new URL(base);}catch{throw new HttpError('API 地址无效');}
 requireThat(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443'),'API 仅支持无用户名、无参数的 HTTPS 地址');
 const host=u.hostname.toLowerCase();
 requireThat(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)&&host.includes('.')&&!/^[\d.]+$/.test(host)&&!/(^|\.)(localhost|local|internal|test|invalid)$/.test(host),'API 必须使用公网域名');
 u.pathname=u.pathname.replace(/\/+$/,'');
 if(!u.pathname.endsWith('/chat/completions'))u.pathname+='/chat/completions';
 return u;
}
export function publicIP(ip){
 if(ip.includes(':'))return /^[23][a-f\d]{0,3}:/i.test(ip)&&!/^2001:(?:db8|0:)/i.test(ip);
 const n=ip.split('.').map(Number);if(n.length!==4||n.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
 return n[0]!==0&&n[0]!==10&&n[0]!==127&&n[0]<224&&!(n[0]===169&&n[1]===254)&&!(n[0]===172&&n[1]>=16&&n[1]<=31)&&!(n[0]===192&&(n[1]===168||n[1]===0))&&!(n[0]===100&&n[1]>=64&&n[1]<=127)&&!(n[0]===198&&(n[1]===18||n[1]===19));
}
async function verifyPublicHost(host){
 const answers=await Promise.all(['A','AAAA'].map(async type=>{
  const r=await fetch('https://cloudflare-dns.com/dns-query?name='+encodeURIComponent(host)+'&type='+type,{headers:{Accept:'application/dns-json'},signal:AbortSignal.timeout(5000)});
  requireThat(r.ok,'无法检查 API 域名，请稍后再试',502);const d=await r.json();return (d.Answer||[]).filter(a=>a.type===1||a.type===28).map(a=>a.data);
 }));
 const addresses=answers.flat();requireThat(addresses.length&&addresses.every(publicIP),'API 域名必须解析到公网地址');
}
export async function boundedJSON(response){
 const reader=response.body?.getReader();requireThat(reader,'API 没有返回内容',502);const chunks=[];let size=0;
 for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>131072){await reader.cancel();throw new HttpError('API 回复过大，请减少回复长度',502);}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError('API 未返回有效 JSON',502);}
}
export async function requestReply(config,key,messages,transport=fetch){
 const url=providerURL(config.baseUrl);
 const r=await transport(url.toString(),{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,messages,stream:false})});
 if(!r.ok){await r.body?.cancel();throw new HttpError('猫娘 API 请求失败（HTTP '+r.status+'），请检查地址、模型、密钥或余额',502);}
 const data=await boundedJSON(r),content=data.choices?.[0]?.message?.content;
 requireThat(typeof content==='string'&&content.trim(),'API 未返回文本回复，请使用支持 Chat Completions 的模型',502);
 return content.slice(0,12000);
}
async function notify(env,id){try{await env.WORLD.get(env.WORLD.idFromName('world-v1')).fetch(new Request('https://internal/notify-ai',{method:'POST',headers:{'X-User-Id':id}}));}catch{}}
export async function nyanRoute(request,env,user){
 if(request.method==='GET'){
  // An isolate can die mid-request. Expired pending turns become retryable errors.
  await env.DB.prepare("UPDATE ai_turns SET status='failed',error='上次请求已中断，请重新发送' WHERE user_id=? AND status='pending' AND created_at<?").bind(user.id,Date.now()-60000).run();
  const rows=await env.DB.prepare('SELECT seq,op_id,content,response,status,error,created_at FROM ai_turns WHERE user_id=? ORDER BY seq DESC LIMIT 60').bind(user.id).all();
  return json({turns:rows.results.reverse()});
 }
 requireThat(request.method==='POST','不支持该方法',405);
 const c=await body(request),opId=operationId(c.opId),content=chatText(c.content);
 requireThat(c.consent===true,'发送前请确认将对话内容交给你配置的 API 服务');
 let old=await env.DB.prepare('SELECT seq,op_id,content,response,status,error,created_at FROM ai_turns WHERE user_id=? AND op_id=?').bind(user.id,opId).first();
 if(old){requireThat(old.content===content,'重复标识不能发送不同内容',409);if(old.status!=='failed')return json({turn:old,replayed:true});}
 const state=await loadState(env,user),config=state.apiConfig;
 requireThat(config.encryptedKey&&config.model?.trim(),'请先在设置中填写猫娘 API 密钥和模型',400);
 const url=providerURL(config.baseUrl);await rate(env,'nyan:'+user.id,8);
 const lock=await env.DB.prepare('INSERT INTO ai_locks(user_id,op_id,expires_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET op_id=excluded.op_id,expires_at=excluded.expires_at WHERE expires_at<? RETURNING op_id').bind(user.id,opId,Date.now()+45000,Date.now()).first();
 requireThat(lock,'猫娘正在回复上一条消息，请稍候',409);
 let turn;
 try{
  turn=old?await env.DB.prepare("UPDATE ai_turns SET status='pending',error=NULL,created_at=? WHERE user_id=? AND op_id=? RETURNING seq,op_id,content,response,status,error,created_at").bind(Date.now(),user.id,opId).first():
   await env.DB.prepare("INSERT INTO ai_turns(user_id,op_id,content,status,created_at) VALUES (?,?,?,'pending',?) RETURNING seq,op_id,content,response,status,error,created_at").bind(user.id,opId,content,Date.now()).first();
  await notify(env,user.id);
  await verifyPublicHost(url.hostname);
  const key=await decrypt(config.encryptedKey,env.DATA_KEY);
  const previous=await env.DB.prepare("SELECT content,response FROM ai_turns WHERE user_id=? AND status='complete' ORDER BY seq DESC LIMIT 12").bind(user.id).all();
  const messages=[{role:'system',content:'你是猫猫世界里友善的虚拟猫娘露娜。用中文自然聊天，可以偶尔说喵。你是 AI 角色，不是真人；不能操作账户、物品或金币，也不要声称已执行游戏操作。'}];
  for(const p of previous.results.reverse()){messages.push({role:'user',content:p.content},{role:'assistant',content:p.response});}messages.push({role:'user',content});
  turn.response=await requestReply(config,key,messages);turn.status='complete';
  await env.DB.prepare("UPDATE ai_turns SET status='complete',response=? WHERE user_id=? AND op_id=?").bind(turn.response,user.id,opId).run();
 }catch(e){
  if(!turn)throw e;
  turn.status='failed';turn.error=e instanceof HttpError?e.message:'猫娘 API 超时或无法连接，请检查配置后重试';
  await env.DB.prepare("UPDATE ai_turns SET status='failed',error=? WHERE user_id=? AND op_id=?").bind(turn.error,user.id,opId).run();
 }finally{
  await env.DB.prepare('DELETE FROM ai_locks WHERE user_id=? AND op_id=?').bind(user.id,opId).run();await notify(env,user.id);
 }
 return json({turn});
}
