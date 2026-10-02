import {json,body,requireThat,decrypt} from './common.js';
import {loadState} from './model.js';
import {operationId,chatText,rate} from './social.js';
import {providerURL,verifyPublicHost,requestReply,inspectConnection,storedError,LOCK_MS,STALE_TURN_MS} from './nyan-provider.js';
export {providerURL,publicIP,boundedJSON,requestReply} from './nyan-provider.js';
export async function checkNyanConnection(request,env,user){
 requireThat(request.method==='POST','不支持该方法',405);
 await body(request);await rate(env,'nyan-check:'+user.id,6);
 const {apiConfig:config}=await loadState(env,user);
 requireThat(config.encryptedKey&&config.model?.trim(),'请先保存 API 地址、密钥和模型名称');
 const key=await decrypt(config.encryptedKey,env.DATA_KEY);
 return json(await inspectConnection(config,key));
}
async function notify(env,id){try{await env.WORLD.get(env.WORLD.idFromName('world-v1')).fetch(new Request('https://internal/notify-ai',{method:'POST',headers:{'X-User-Id':id}}));}catch{}}
export async function nyanRoute(request,env,user){
 if(request.method==='GET'){
  // An isolate can die mid-request. Expired pending turns become retryable errors.
  await env.DB.prepare("UPDATE ai_turns SET status='failed',error='[REQUEST_INTERRUPTED] 上次请求已中断，请点击重试' WHERE user_id=? AND status='pending' AND created_at<? AND NOT EXISTS (SELECT 1 FROM ai_locks WHERE user_id=? AND expires_at>?)").bind(user.id,Date.now()-STALE_TURN_MS,user.id,Date.now()).run();
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
 const owner=crypto.randomUUID(),started=Date.now(),trace=owner.slice(0,8);
 const lock=await env.DB.prepare('INSERT INTO ai_locks(user_id,op_id,expires_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET op_id=excluded.op_id,expires_at=excluded.expires_at WHERE expires_at<? RETURNING op_id').bind(user.id,owner,Date.now()+LOCK_MS,Date.now()).first();
 requireThat(lock,'猫娘正在回复上一条消息，请稍候',409);
 let turn,stage='storage';
 try{
  turn=old?await env.DB.prepare("UPDATE ai_turns SET status='pending',error=NULL,created_at=? WHERE user_id=? AND op_id=? RETURNING seq,op_id,content,response,status,error,created_at").bind(Date.now(),user.id,opId).first():
   await env.DB.prepare("INSERT INTO ai_turns(user_id,op_id,content,status,created_at) VALUES (?,?,?,'pending',?) RETURNING seq,op_id,content,response,status,error,created_at").bind(user.id,opId,content,Date.now()).first();
  await notify(env,user.id);
  stage='dns';await verifyPublicHost(url.hostname);
  stage='key';const key=await decrypt(config.encryptedKey,env.DATA_KEY);
  stage='history';
  const previous=await env.DB.prepare("SELECT content,response FROM ai_turns WHERE user_id=? AND status='complete' ORDER BY seq DESC LIMIT 12").bind(user.id).all();
  const messages=[{role:'system',content:'你是猫猫世界里友善的虚拟猫娘露娜。用中文自然聊天，可以偶尔说喵。你是 AI 角色，不是真人；不能操作账户、物品或金币，也不要声称已执行游戏操作。'}];
  for(const p of previous.results.reverse()){messages.push({role:'user',content:p.content},{role:'assistant',content:p.response});}messages.push({role:'user',content});
  stage='chat';turn.response=await requestReply(config,key,messages);turn.status='complete';stage='save';
  await env.DB.prepare("UPDATE ai_turns SET status='complete',response=? WHERE user_id=? AND op_id=?").bind(turn.response,user.id,opId).run();
 }catch(e){
  if(!turn)throw e;
  turn.status='failed';turn.error=storedError(e,stage,trace);
  console.warn('nyan_request_failed',JSON.stringify({trace,stage,code:e.code||'SERVER_ERROR',elapsedMs:Date.now()-started}));
  await env.DB.prepare("UPDATE ai_turns SET status='failed',error=? WHERE user_id=? AND op_id=?").bind(turn.error,user.id,opId).run();
 }finally{
  await env.DB.prepare('DELETE FROM ai_locks WHERE user_id=? AND op_id=?').bind(user.id,owner).run();await notify(env,user.id);
 }
 return json({turn});
}
