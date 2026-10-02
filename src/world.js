import {json,body,requireThat,HttpError,errorResponse} from './common.js';
import {loadState,publicState,applyCommand,validatePick,awardCatXp} from './model.js';
import {createGame,stepGame,botInput,cleanInput,clamp,random} from '../public/sim.js';
import {createHall,addHallPlayer,stepHall} from '../public/hall.js';
import {socialRoute} from './social.js';
const active=r=>['INVITED','PICKS','BATTLE'].includes(r.status);
export class PresenceDO {
 constructor(ctx,env){
  this.ctx=ctx;this.env=env;this.rooms=new Map();this.chain=Promise.resolve();this.timer=null;this.ticking=false;this.lastPresence=0;this.hall=null;this.hallInputs={};
  ctx.blockConcurrencyWhile(async()=>{
   const rows=await ctx.storage.list({prefix:'room:'});for(const r of rows.values())this.rooms.set(r.id,r);
   this.hall=await ctx.storage.get('hall-v1')||null;
   if([...this.rooms.values()].some(r=>r.status==='BATTLE')||this.hall?.players.length)this.startTicking();
  });
 }
 serial(fn){const result=this.chain.then(fn);this.chain=result.catch(()=>{});return result;}
 meta(ws){try{return ws.deserializeAttachment();}catch{return null;}}
 sockets(){return this.ctx.getWebSockets().filter(ws=>ws.readyState===1);}
 send(ws,data){try{ws.send(JSON.stringify(data));}catch{}}
 sendUser(id,data){for(const ws of this.sockets())if(this.meta(ws)?.id===id)this.send(ws,data);}
 players(){
  const byId=new Map();for(const ws of this.sockets()){const m=this.meta(ws);if(!m||m.last<Date.now()-45000||m.expires<Date.now())continue;if(!byId.has(m.id)||byId.get(m.id).last<m.last)byId.set(m.id,m);}
  return [...byId.values()].map(m=>{const h=m.scene==='/hall'?this.hall?.players.find(p=>p.id===m.id):null;return {id:m.id,username:m.username,scene:m.scene,x:h?.x??m.x,y:h?.y??m.y,last:m.last};});
 }
 connected(id){return this.players().some(p=>p.id===id);}
 roomList(id){return [...this.rooms.values()].filter(r=>r.members.some(m=>m.id===id)&&r.status!=='CANCELLED'&&!(r.hiddenFor||[]).includes(id));}
 pub(r){const {inputs,disconnectedSince,...out}=r;return out;}
 broadcastPresence(){const data={type:'presence',players:this.players(),time:Date.now()};for(const ws of this.sockets())this.send(ws,data);this.lastPresence=Date.now();}
 broadcastRoom(r){for(const m of r.members)if(!m.bot)this.sendUser(m.id,{type:'room',room:this.pub(r),time:Date.now()});}
 async persistRoom(r){await this.ctx.storage.put('room:'+r.id,r);}
 async account(user){return loadState(this.env,user);}
 async announceAccount(user){const state=publicState(await this.account(user));this.sendUser(user.id,{type:'account',state});return state;}
 hallSockets(){return this.sockets().filter(ws=>{const m=this.meta(ws);return m?.scene==='/hall'&&m.last>Date.now()-45000&&m.expires>Date.now();});}
 hallView(full=false){if(!this.hall)return null;const {map,...state}=this.hall;return full?this.hall:state;}
 broadcastHall(){const data={type:'hall',hall:this.hallView(),time:Date.now()};for(const ws of this.hallSockets())this.send(ws,data);}
 async enterHall(user){
  requireThat(![...this.rooms.values()].some(r=>active(r)&&r.members.some(m=>m.id===user.id)),'请先结束或离开竞技房间再进入猫猫大厅',409);
  if(!this.hall||(!this.hallSockets().length&&Date.now()-this.hall.createdAt>6*3600000)){
   this.hall=createHall(crypto.getRandomValues(new Uint32Array(1))[0]);
  }
  requireThat(this.hall.players.length<40||this.hall.players.some(p=>p.id===user.id),'猫猫大厅已满（40 人），请稍后再来',409);
  const s=await this.account(user);addHallPlayer(this.hall,user,validatePick(s,s.loadout));
  await this.ctx.storage.put('hall-v1',this.hall);this.startTicking();
 }
 async home(id){
  const row=await this.env.DB.prepare('SELECT u.id,u.username,p.state_json FROM users u JOIN player_state p ON p.user_id=u.id WHERE u.id=?').bind(id).first();
  requireThat(row,'家园不存在',404);const s=JSON.parse(row.state_json);return {owner:{id:row.id,username:row.username},furniture:s.furniture||[],cats:(s.cats||[]).map(c=>({id:c.id,name:c.name,emoji:c.emoji}))};
 }
 async fetch(request){
  return this.serial(async()=>{try{
   const path=new URL(request.url).pathname;
   if(path==='/notify-ai'){this.sendUser(request.headers.get('X-User-Id'),{type:'nyan'});return json({ok:true});}
   if(path==='/logout'){for(const ws of this.sockets())if(this.meta(ws)?.sessionHash===request.headers.get('X-Session-Hash'))ws.close(4001,'Logged out');return json({ok:true});}
   const user={id:request.headers.get('X-User-Id'),username:decodeURIComponent(request.headers.get('X-User-Name')||'')};requireThat(user.id,'未认证',401);
   if(path.startsWith('/api/friends')||path.startsWith('/api/messages')){
    const response=await socialRoute(this,user,request,new URL(request.url));if(response)return response;
   }
   if(path==='/ws'){
    requireThat(request.headers.get('Upgrade')?.toLowerCase()==='websocket','需要 WebSocket',426);
    requireThat(this.sockets().length<200,'世界暂时满员，请稍后重试',503);
    const same=this.sockets().filter(w=>this.meta(w)?.id===user.id);if(same.length>=5)same[0].close(4000,'Too many sessions');
    const pair=new WebSocketPair(),client=pair[0],ws=pair[1];this.ctx.acceptWebSocket(ws);
    const meta={...user,sessionHash:request.headers.get('X-Session-Hash'),expires:Number(request.headers.get('X-Session-Expires')),scene:'home:'+user.id,x:480,y:290,last:Date.now(),lastMove:Date.now(),window:Date.now(),messages:0};
    ws.serializeAttachment(meta);this.send(ws,{type:'hello',you:meta.id,scene:meta.scene,players:this.players(),rooms:this.roomList(user.id).map(r=>this.pub(r)),home:await this.home(user.id)});
    this.broadcastPresence();await this.ctx.storage.setAlarm(Date.now()+10000);
    return new Response(null,{status:101,webSocket:client});
   }
   if(path==='/api/live'&&request.method==='GET')return json({players:this.players(),rooms:this.roomList(user.id).map(r=>this.pub(r))});
   if(path==='/api/hall'&&request.method==='GET')return json({hall:this.hallView(true)});
   if(path==='/api/home'&&request.method==='GET')return json(await this.home(new URL(request.url).searchParams.get('id')||user.id));
   if(path==='/api/command'&&request.method==='POST'){
    const c=await body(request);requireThat(typeof c.opId==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(c.opId),'操作需要唯一标识');
    const existing=await this.env.DB.prepare('SELECT op_id FROM operations WHERE user_id=? AND op_id=?').bind(user.id,c.opId).first();
    if(existing)return json({state:publicState(await this.account(user)),replayed:true});
    const state=await applyCommand(await this.account(user),c,this.env);const view=publicState(state);
    await this.env.DB.batch([
     this.env.DB.prepare('UPDATE player_state SET state_json=?,updated_at=? WHERE user_id=?').bind(JSON.stringify(state),Date.now(),user.id),
     this.env.DB.prepare('INSERT INTO operations(user_id,op_id,response_json,created_at) VALUES (?,?,?,?)').bind(user.id,c.opId,JSON.stringify({version:state.version}),Date.now())
    ]);
    this.sendUser(user.id,{type:'account',state:view});
    if(['place','unplace','adopt'].includes(c.type)){const h=await this.home(user.id);for(const ws of this.sockets())if(this.meta(ws)?.scene==='home:'+user.id)this.send(ws,{type:'home',home:h});}
    return json({state:view});
   }
   if(path==='/api/rooms'&&request.method==='GET')return json({rooms:this.roomList(user.id).map(r=>this.pub(r))});
   if(path==='/api/rooms'&&request.method==='POST')return json({room:this.pub(await this.createRoom(user,await body(request)))},201);
   const match=path.match(/^\/api\/rooms\/([a-zA-Z0-9-]+)\/(accept|pick|ready|leave|ack)$/);
   if(match&&request.method==='POST'){const c=await body(request);return json({room:this.pub(await this.roomCommand(user,match[1],match[2],c))});}
   throw new HttpError('接口不存在',404);
  }catch(e){return errorResponse(e);}});
 }
 async createRoom(user,c){
  requireThat(['ft','shoot'].includes(c.mode),'竞技模式无效');
  requireThat(![...this.rooms.values()].some(r=>active(r)&&r.members.some(m=>m.id===user.id)),'你已有房间，请先结束或退出',409);
  let opponent;
  if(c.pc===true)opponent={id:'pc',username:'PC 训练猫',bot:true};
  else{
   requireThat(typeof c.opponentId==='string'&&c.opponentId!==user.id,'请选择其他玩家');
   const p=this.players().find(p=>p.id===c.opponentId);requireThat(p,'对方已离线',409);
   requireThat(![...this.rooms.values()].some(r=>active(r)&&r.members.some(m=>m.id===p.id)),'对方已有房间',409);opponent={id:p.id,username:p.username};
  }
  const s=await this.account(user),pick=validatePick(s,c.pick||s.loadout);
  const r={id:crypto.randomUUID(),mode:c.mode,status:opponent.bot?'PICKS':'INVITED',members:[{id:user.id,username:user.username},opponent],picks:{[user.id]:pick},ready:{},createdAt:Date.now(),expiresAt:Date.now()+120000,inputs:{},game:null,hiddenFor:[]};
  if(opponent.bot){r.picks.pc={catId:'momo',weapon:c.mode==='ft'?'claw':'bubble',armor:'cloud'};r.ready.pc=true;}
  this.rooms.set(r.id,r);await this.persistRoom(r);this.broadcastRoom(r);await this.ctx.storage.setAlarm(Date.now()+10000);return r;
 }
 async roomCommand(user,id,action,c){
  const r=this.rooms.get(id);requireThat(r&&r.members.some(m=>m.id===user.id),'房间不存在或无权访问',404);
  if(action==='ack'){requireThat(['FINISHED','CANCELLED'].includes(r.status),'对局尚未结束');r.hiddenFor=[...new Set([...r.hiddenFor,user.id])];}
  else if(action==='leave'){
   if(r.status==='BATTLE'){r.game.result=this.forfeitResult(r,user.id,'forfeit');await this.finish(r);return r;}
   if(active(r)){r.status='CANCELLED';r.reason='玩家取消';r.finishedAt=Date.now();}
  }else if(action==='accept'){
   requireThat(r.members[1].id===user.id&&r.status==='INVITED','邀请已失效',409);
   const s=await this.account(user);r.picks[user.id]=validatePick(s,c.pick||s.loadout);r.status='PICKS';r.expiresAt=Date.now()+120000;
  }else{
   requireThat(r.status==='PICKS','不在选人阶段',409);
   requireThat(!r.ready[user.id],'已准备的配置不能再更改',409);
   const s=await this.account(user);r.picks[user.id]=validatePick(s,c.pick||r.picks[user.id]||s.loadout);
   if(action==='ready')r.ready[user.id]=true;
   if(r.members.every(m=>r.ready[m.id])){
    r.seed=crypto.getRandomValues(new Uint32Array(1))[0];r.status='BATTLE';r.startedAt=Date.now();r.expiresAt=Date.now()+190000;
    r.game=createGame(r.seed,r.mode,r.members.map(m=>({id:m.id,name:m.username,pick:r.picks[m.id]})));
    r.disconnectedSince={};this.startTicking();
   }
  }
  await this.persistRoom(r);this.broadcastRoom(r);return r;
 }
 forfeitResult(r,id,reason){const opponent=r.members.find(m=>m.id!==id);return {winnerId:opponent.id,loserId:id,drop:['food','soap','medicine','stardust'][Math.floor(random(r.game)*4)],coins:70+Math.floor(random(r.game)*31),reason};}
 async finish(r){
  if(!r.game.result)return;
  const ledger=await this.env.DB.prepare('SELECT result_json FROM settlements WHERE room_id=?').bind(r.id).first();
  if(ledger)r.result=JSON.parse(ledger.result_json);
  else{
   const result={...r.game.result,rewards:{}};const batch=[];
   for(const member of r.members){
    if(member.bot)continue;const user={id:member.id,username:member.username};const s=await this.account(user);
    const win=result.winnerId===user.id,lose=result.loserId===user.id;let coins=0;const items={};
    if(win){coins=r.members.some(m=>m.bot)?Math.floor(result.coins/2):result.coins;s.resources.coins+=coins;s.resources[result.drop]=(s.resources[result.drop]||0)+1;items[result.drop]=1;s.achievements.wins++;s.achievements.kills++;s.achievements.firstWin=true;}
    if(lose){coins=-Math.min(s.resources.coins,r.members.some(m=>m.bot)?20:40);s.resources.coins+=coins;s.achievements.losses++;const cat=s.cats.find(c=>c.id===r.picks[user.id].catId);if(cat)cat.hp=Math.max(1,cat.hp-12);for(const k of ['weapon','armor']){const item=r.picks[user.id][k];s.durability[item]=Math.max(0,(s.durability[item]??100)-8);}}
    awardCatXp(s,r.picks[user.id].catId,win?60:25);
    s.version=(s.version||0)+1;result.rewards[user.id]={coins,items,hp:lose?-12:0,durability:lose?-8:0};
    batch.push(this.env.DB.prepare('UPDATE player_state SET state_json=?,updated_at=? WHERE user_id=? AND NOT EXISTS (SELECT 1 FROM settlements WHERE room_id=?)').bind(JSON.stringify(s),Date.now(),user.id,r.id));
   }
   batch.push(this.env.DB.prepare('INSERT OR IGNORE INTO settlements(room_id,result_json,created_at) VALUES (?,?,?)').bind(r.id,JSON.stringify(result),Date.now()));
   await this.env.DB.batch(batch);r.result=result;
  }
  r.status='FINISHED';r.finishedAt=r.finishedAt||Date.now();
  await this.persistRoom(r);
  await this.env.DB.prepare('INSERT INTO match_history(id,mode,challenger_id,opponent_id,state_json,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').bind(r.id,r.mode,r.members[0].id,r.members[1].id,JSON.stringify(this.pub(r)),Date.now()).run();
  this.broadcastRoom(r);for(const m of r.members)if(!m.bot)await this.announceAccount({id:m.id,username:m.username});
 }
 startTicking(){if(this.timer)return;this.timer=setInterval(()=>{if(this.ticking)return;this.ticking=true;this.serial(()=>this.tick()).catch(e=>console.error('Tick failed',e.message)).finally(()=>{this.ticking=false;});},50);}
 async tick(){
  let playing=false;const writes={};const now=Date.now();
  if(this.hall){
   const ids=new Set(this.hallSockets().map(ws=>this.meta(ws).id));
   const before=this.hall.players.length;
   this.hall.players=this.hall.players.filter(p=>ids.has(p.id));
   for(const id of Object.keys(this.hallInputs))if(!ids.has(id))delete this.hallInputs[id];
   if(ids.size){
    playing=true;
    const inputs=Object.fromEntries(this.hall.players.map(p=>[p.id,this.hallInputs[p.id]?.at>now-300?this.hallInputs[p.id].input:{}]));
    stepHall(this.hall,inputs);writes['hall-v1']=this.hall;
   }else if(before)writes['hall-v1']=this.hall;
  }
  for(const r of this.rooms.values()){
   if(r.status!=='BATTLE')continue;playing=true;
   for(const member of r.members){
    if(member.bot){r.inputs[member.id]={at:now,input:botInput(r.game,member.id)};continue;}
    if(!this.connected(member.id)){r.disconnectedSince[member.id]??=now;if(now-r.disconnectedSince[member.id]>20000)r.game.result=this.forfeitResult(r,member.id,'disconnect');}
    else delete r.disconnectedSince[member.id];
   }
   if(now>r.expiresAt){const [a,b]=r.game.players;r.game.result={winnerId:a.hp===b.hp?null:a.hp>b.hp?a.id:b.id,loserId:a.hp===b.hp?null:a.hp>b.hp?b.id:a.id,coins:70,drop:'food',reason:'time'};}
   const inputs=Object.fromEntries(r.members.map(m=>[m.id,r.inputs[m.id]?.at>now-300?r.inputs[m.id].input:{}]));
   stepGame(r.game,inputs);
   if(r.game.result){await this.finish(r);continue;}
   writes['room:'+r.id]=r;
  }
  if(Object.keys(writes).length){await this.ctx.storage.put(writes);for(const [key,r] of Object.entries(writes))if(key==='hall-v1')this.broadcastHall();else this.broadcastRoom(r);}
  if(now-this.lastPresence>3000)this.broadcastPresence();
  if(!playing){clearInterval(this.timer);this.timer=null;}
 }
 webSocketMessage(ws,message){return this.serial(async()=>{
  let m=this.meta(ws);try{
   requireThat(m&&m.expires>Date.now(),'登录已过期',401);requireThat(typeof message==='string'&&message.length<4096,'消息过大');
   const data=JSON.parse(message),now=Date.now();if(now-m.window>1000){m.window=now;m.messages=0;}requireThat(++m.messages<60,'操作过快',429);
   m.last=now;
   if(data.type==='ping'){ws.serializeAttachment(m);this.send(ws,{type:'pong',time:now,echo:data.time});return;}
   if(data.type==='join'){
    const scene=String(data.scene||'');requireThat(['/ft','/shoot','/hall','/friends','/nyan'].includes(scene)||scene.startsWith('home:'),'场景无效');
    if(scene==='/hall')await this.enterHall(m);
    let h;if(scene.startsWith('home:'))h=await this.home(scene.slice(5));
    m.scene=scene;m.x=480;m.y=300;m.lastMove=now;ws.serializeAttachment(m);
    this.send(ws,{type:'joined',scene,home:h||null,hall:scene==='/hall'?this.hallView(true):null});this.broadcastPresence();
    if(h&&h.owner.id!==m.id){const s=await this.account(m);if(!(s.visited||[]).includes(h.owner.id)){s.visited=[...(s.visited||[]),h.owner.id];s.achievements.visits++;s.version++;await this.env.DB.prepare('UPDATE player_state SET state_json=?,updated_at=? WHERE user_id=?').bind(JSON.stringify(s),now,m.id).run();await this.announceAccount(m);}}
    return;
   }
   if(data.type==='move'){
    requireThat(m.scene.startsWith('home:'),'只允许在家园发送移动消息');
    const input=cleanInput(data),dt=clamp((now-m.lastMove)/1000,0,0.15);m.lastMove=now;
    m.x=clamp(m.x+input.dx*200*dt,24,936);m.y=clamp(m.y+input.dy*200*dt,24,516);
   }else if(data.type==='hall-input'){
    requireThat(m.scene==='/hall'&&this.hall?.players.some(p=>p.id===m.id),'请先进入猫猫大厅');
    requireThat(![...this.rooms.values()].some(r=>active(r)&&r.members.some(p=>p.id===m.id)),'竞技房间中不能同时在大厅攻击');
    this.hallInputs[m.id]={input:cleanInput(data),at:now};this.startTicking();
   }else if(data.type==='input'){
    const r=this.rooms.get(data.roomId);requireThat(r?.status==='BATTLE'&&r.members.some(p=>p.id===m.id),'不在该战斗中');
    r.inputs[m.id]={input:cleanInput(data),at:now};this.startTicking();
   }else if(data.type==='interact'){
    const own=m.scene==='/hall'?this.hall?.players.find(p=>p.id===m.id):m;
    const p=this.players().find(p=>p.id===data.targetId&&p.scene===m.scene);requireThat(own&&p&&Math.hypot(p.x-own.x,p.y-own.y)<260,'走近同场景玩家再打招呼');
    requireThat(!m.lastWave||now-m.lastWave>2000,'打招呼太频繁');m.lastWave=now;
    for(const socket of this.sockets())if(this.meta(socket)?.scene===m.scene)this.send(socket,{type:'wave',from:m.username,to:p.username});
   }else throw new HttpError('消息类型无效');
   ws.serializeAttachment(m);if(data.type!=='hall-input'&&data.type!=='input'&&now-this.lastPresence>100)this.broadcastPresence();
  }catch(e){if(m)ws.serializeAttachment(m);this.send(ws,{type:'error',error:e.status?e.message:'消息无效'});if(e.status===401)ws.close(4001,'Session expired');}
 });}
 webSocketClose(ws,code,reason){try{ws.close(code,reason);}catch{}return this.serial(async()=>{this.broadcastPresence();await this.ctx.storage.setAlarm(Date.now()+10000);});}
 webSocketError(ws){return this.webSocketClose(ws,1011,'Connection error');}
 alarm(){return this.serial(async()=>{
  const now=Date.now();for(const ws of this.sockets()){const m=this.meta(ws);if(!m||m.last<now-45000||m.expires<now)ws.close(4001,'Idle or expired');}
  for(const r of [...this.rooms.values()]){
   if(['INVITED','PICKS'].includes(r.status)&&now>r.expiresAt){r.status='CANCELLED';r.reason='邀请或准备超时';r.finishedAt=now;await this.persistRoom(r);this.broadcastRoom(r);}
   if(['FINISHED','CANCELLED'].includes(r.status)&&now-(r.finishedAt||r.createdAt)>600000){await this.ctx.storage.delete('room:'+r.id);this.rooms.delete(r.id);}
  }
  if([...this.rooms.values()].some(r=>r.status==='BATTLE')||this.hallSockets().length)this.startTicking();
  this.broadcastPresence();if(this.sockets().length||this.rooms.size)await this.ctx.storage.setAlarm(now+10000);
 });}
}
