import {json,body,requireThat} from './common.js';
export const pair=(a,b)=>[a,b].sort();
export function operationId(id){requireThat(typeof id==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(id),'操作标识无效');return id;}
export function chatText(s,max=2000){requireThat(typeof s==='string'&&s.trim().length>0&&s.length<=max,'消息需为 1–'+max+' 字');return s.trim();}
export async function rate(env,key,limit,window=60000){
 const bucket='social:'+key+':'+Math.floor(Date.now()/window);
 const r=await env.DB.prepare('INSERT INTO auth_limits(bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,Date.now()+window*2).first();
 requireThat(r.attempts<=limit,'操作太频繁，请稍后重试',429);
}
async function accepted(env,userId,peer){
 const [a,b]=pair(userId,peer);
 const f=await env.DB.prepare("SELECT status FROM friendships WHERE a=? AND b=?").bind(a,b).first();
 requireThat(f?.status==='accepted','仅好友之间可以私聊',403);
}
export async function friends(world,user){
 const rows=await world.env.DB.prepare("SELECT f.*,u.id,u.username FROM friendships f JOIN users u ON u.id=CASE WHEN f.a=? THEN f.b ELSE f.a END WHERE f.a=? OR f.b=? ORDER BY f.created_at DESC").bind(user.id,user.id,user.id).all();
 const unread=await world.env.DB.prepare('SELECT d.sender_id,COUNT(*) AS n FROM direct_messages d LEFT JOIN friend_reads r ON r.user_id=d.recipient_id AND r.peer_id=d.sender_id WHERE d.recipient_id=? AND d.seq>COALESCE(r.seq,0) GROUP BY d.sender_id').bind(user.id).all();
 const counts=new Map(unread.results.map(r=>[r.sender_id,r.n])),online=new Map(world.players().map(p=>[p.id,p]));
 return {friends:rows.results.filter(r=>r.status==='accepted').map(r=>({id:r.id,username:r.username,online:online.has(r.id),scene:online.get(r.id)?.scene||'',unread:counts.get(r.id)||0})),
  requests:rows.results.filter(r=>r.status==='pending').map(r=>({id:r.id,username:r.username,incoming:r.requester!==user.id,createdAt:r.created_at}))};
}
export async function socialRoute(world,user,request,url){
 const env=world.env,path=url.pathname;
 if(path==='/api/friends'&&request.method==='GET')return json(await friends(world,user));
 if(path==='/api/friends/search'&&request.method==='GET'){
  const q=(url.searchParams.get('q')||'').trim();
  requireThat(q.length>=2&&q.length<=20,'请至少输入 2 个字搜索玩家');await rate(env,'search:'+user.id,30);
  const rows=await env.DB.prepare("SELECT id,username FROM users WHERE username LIKE ? ESCAPE '\\' AND id<>? ORDER BY username LIMIT 15").bind(q.replace(/[\\%_]/g,'\\$&')+'%',user.id).all();
  return json({users:rows.results});
 }
 if(path==='/api/friends'&&request.method==='POST'){
  const c=await body(request);requireThat(typeof c.peerId==='string'&&c.peerId!==user.id,'请选择其他玩家');
  const peer=await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(c.peerId).first();requireThat(peer,'玩家不存在',404);
  const [a,b]=pair(user.id,peer.id);await rate(env,'friend:'+user.id,40);
  const old=await env.DB.prepare('SELECT * FROM friendships WHERE a=? AND b=?').bind(a,b).first();
  if(c.action==='request'){
   if(old?.status==='pending'&&old.requester!==user.id)await env.DB.prepare("UPDATE friendships SET status='accepted' WHERE a=? AND b=?").bind(a,b).run();
   else if(!old)await env.DB.prepare("INSERT INTO friendships(a,b,requester,status,created_at) VALUES (?,?,?,'pending',?)").bind(a,b,user.id,Date.now()).run();
  }else if(c.action==='accept'){
   requireThat(old&&(old.status==='accepted'||old.requester!==user.id),'没有收到该好友申请',409);
   await env.DB.prepare("UPDATE friendships SET status='accepted' WHERE a=? AND b=?").bind(a,b).run();
  }else if(c.action==='remove'||c.action==='reject'){
   await env.DB.prepare('DELETE FROM friendships WHERE a=? AND b=?').bind(a,b).run();
  }else requireThat(false,'好友操作无效');
  world.sendUser(a,{type:'social'});world.sendUser(b,{type:'social'});
  return json(await friends(world,user));
 }
 if(path==='/api/messages'&&request.method==='GET'){
  const peer=url.searchParams.get('peer');requireThat(typeof peer==='string','请选择好友');await accepted(env,user.id,peer);
  const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);requireThat(Number.isSafeInteger(before)&&before>0,'消息游标无效');
  const rows=await env.DB.prepare('SELECT * FROM direct_messages WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) AND seq<? ORDER BY seq DESC LIMIT 100').bind(user.id,peer,peer,user.id,before).all();
  return json({messages:rows.results.reverse(),hasMore:rows.results.length===100});
 }
 if(path==='/api/messages'&&request.method==='POST'){
  const c=await body(request);requireThat(typeof c.peerId==='string','请选择好友');await accepted(env,user.id,c.peerId);
  const opId=operationId(c.opId),content=chatText(c.content);
  const existing=await env.DB.prepare('SELECT * FROM direct_messages WHERE sender_id=? AND op_id=?').bind(user.id,opId).first();
  if(existing){requireThat(existing.recipient_id===c.peerId&&existing.content===content,'重复标识不能用于另一条消息',409);return json({message:existing,replayed:true});}
  await rate(env,'dm:'+user.id,60);
  const message=await env.DB.prepare('INSERT INTO direct_messages(sender_id,recipient_id,op_id,content,created_at) VALUES (?,?,?,?,?) RETURNING *').bind(user.id,c.peerId,opId,content,Date.now()).first();
  const data={type:'dm',message};world.sendUser(user.id,data);world.sendUser(c.peerId,data);
  return json({message});
 }
 if(path==='/api/messages/read'&&request.method==='POST'){
  const c=await body(request);requireThat(typeof c.peerId==='string'&&Number.isSafeInteger(c.seq)&&c.seq>=0,'已读游标无效');await accepted(env,user.id,c.peerId);
  const max=await env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM direct_messages WHERE sender_id=? AND recipient_id=?').bind(c.peerId,user.id).first();
  await env.DB.prepare('INSERT INTO friend_reads(user_id,peer_id,seq) VALUES (?,?,?) ON CONFLICT(user_id,peer_id) DO UPDATE SET seq=MAX(seq,excluded.seq)').bind(user.id,c.peerId,Math.min(max.seq,c.seq)).run();
  world.sendUser(user.id,{type:'social'});return json({ok:true});
 }
 return null;
}
