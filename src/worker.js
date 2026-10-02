import {json,body,HttpError,requireThat,errorResponse,sha,token,passwordHash,equal} from './common.js';
import {initialState,loadState,publicState} from './model.js';
import {nyanRoute,checkNyanConnection} from './nyan.js';
export {PresenceDO} from './world.js';
const TTL=14*24*60*60*1000;
const cookie=(value,age=TTL/1000)=>'cw_session='+value+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+age;
async function session(request,env){
 const raw=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('cw_session='))?.slice(11);
 requireThat(raw&&/^[a-f0-9]{64}$/.test(raw),'请先登录',401);
 const hash=await sha(raw);
 const user=await env.DB.prepare('SELECT u.id,u.username,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').bind(hash,Date.now()).first();
 requireThat(user,'登录已过期，请重新登录',401);return {...user,sessionHash:hash};
}
async function auth(request,env,path){
 const input=await body(request);const username=String(input.username||'').trim(),password=String(input.password||'');
 requireThat(/^[\p{L}\p{N}_]{2,20}$/u.test(username),'用户名需要 2–20 位中文、字母、数字或下划线');
 requireThat(password.length>=8&&password.length<=128,'密码需为 8–128 位');
 const ip=request.headers.get('CF-Connecting-IP')||'local';
 const bucket=await sha(ip+':'+Math.floor(Date.now()/600000));
 const limit=await env.DB.prepare('INSERT INTO auth_limits(bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,Date.now()+1200000).first();
 requireThat(limit.attempts<=30,'尝试过于频繁，请稍后再试',429);
 let user=await env.DB.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').bind(username).first();
 if(path.endsWith('/register')){
  requireThat(!user,'用户名已被使用',409);
  const salt=token().slice(0,32),id=crypto.randomUUID(),hash=await passwordHash(password,salt);
  user={id,username};
  try{await env.DB.batch([
   env.DB.prepare('INSERT INTO users(id,username,password_hash,password_salt,created_at) VALUES (?,?,?,?,?)').bind(id,username,hash,salt,Date.now()),
   env.DB.prepare('INSERT INTO player_state(user_id,state_json,updated_at) VALUES (?,?,?)').bind(id,JSON.stringify(initialState(username)),Date.now())
  ]);}catch(e){if(String(e.message).includes('UNIQUE'))throw new HttpError('用户名已被使用',409);throw e;}
 }else{
  const actual=await passwordHash(password,user?.password_salt||'0'.repeat(32));
  requireThat(user&&equal(actual,user.password_hash),'用户名或密码错误',401);
 }
 const raw=token(),hash=await sha(raw);
 await env.DB.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(hash,user.id,Date.now()+TTL,Date.now()).run();
 return json({user:{id:user.id,username:user.username},state:publicState(await loadState(env,user))},200,{'Set-Cookie':cookie(raw)});
}
export default {
 async fetch(request,env){
  try{
   const url=new URL(request.url),path=url.pathname;
   if(path==='/api/health'){await env.DB.prepare('SELECT 1 AS ok').first();return json({ok:true,service:'catworld-copy',database:'D1',realtime:'PresenceDO',version:'2.1.1'});}
   if(!path.startsWith('/api/')&&path!=='/ws')return env.ASSETS.fetch(request);
   const origin=request.headers.get('Origin');
   if(origin)requireThat(origin===url.origin,'跨站请求被拒绝',403);
   if(['/api/auth/register','/api/auth/login'].includes(path)&&request.method==='POST')return await auth(request,env,path);
   const user=await session(request,env);
   // External model latency never holds the shared world's simulation queue.
   if(path==='/api/nyan/check')return await checkNyanConnection(request,env,user);
   if(path==='/api/nyan')return await nyanRoute(request,env,user);
   if(path==='/api/auth/logout'&&request.method==='POST'){
    await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(user.sessionHash).run();
    await env.WORLD.get(env.WORLD.idFromName('world-v1')).fetch(new Request('https://internal/logout',{method:'POST',headers:{'X-Session-Hash':user.sessionHash}}));
    return json({ok:true},200,{'Set-Cookie':cookie('',0)});
   }
   if(path==='/api/me'&&request.method==='GET')return json({user:{id:user.id,username:user.username},state:publicState(await loadState(env,user))});
   const headers=new Headers(request.headers);
   headers.set('X-User-Id',user.id);headers.set('X-User-Name',encodeURIComponent(user.username));
   headers.set('X-Session-Hash',user.sessionHash);headers.set('X-Session-Expires',String(user.expires_at));
   const forwarded=new Request('https://internal'+path+url.search,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body});
   return await env.WORLD.get(env.WORLD.idFromName('world-v1')).fetch(forwarded);
  }catch(e){return errorResponse(e);}
 },
 async scheduled(event,env){
  const now=Date.now();await env.DB.batch([
   env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now),
   env.DB.prepare('DELETE FROM auth_limits WHERE expires_at<?').bind(now),
   env.DB.prepare('DELETE FROM operations WHERE created_at<?').bind(now-7*86400000)
  ]);
 }
};
