import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.TEST_URL||'http://127.0.0.1:8787';
const tag=Date.now().toString(36), password='CatworldQA_'+tag+'!';
const browser=await chromium.launch({channel:'msedge',headless:true});
const errors=[],checks=[],contexts=[];
const log=(name,data={})=>{checks.push({name,...data});console.log('PASS '+name+' '+JSON.stringify(data));};
async function pageFor(mobile=false){
 const ctx=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000}});contexts.push(ctx);
 await ctx.addInitScript(()=>{
  window.__live={rooms:{},players:[],messages:[],frames:[],sockets:[],role:null,user:null};
  const Native=window.WebSocket;
  window.WebSocket=class extends Native{
   constructor(...args){super(...args);const live=window.__live;live.sockets.push(this);this.addEventListener('message',event=>{try{const d=JSON.parse(event.data);live.messages.push(d.type);if(d.type==='hello'){live.user=d.you;live.players=d.players;for(const r of d.rooms)live.rooms[r.id]=r;}if(d.type==='presence')live.players=d.players;if(d.type==='room'){live.rooms[d.room.id]=d.room;if(d.room.status==='BATTLE')live.frames.push({id:d.room.id,tick:d.room.game.tick,time:Date.now(),game:JSON.stringify(d.room.game)});}if(d.type==='account')live.state=d.state;if(d.type==='home'||d.type==='joined')live.home=d.home;}catch{}});}
   send(raw){let d;try{d=JSON.parse(raw);}catch{return super.send(raw);}const live=window.__live;
    if(d.type==='input'&&live.role){const r=live.rooms[d.roomId],p=r?.game?.players.find(p=>p.id===live.user),q=r?.game?.players.find(p=>p.id!==live.user);if(p&&q){d={type:'input',roomId:d.roomId};if(live.role==='attack'){let dx=q.x-p.x,dy=q.y-p.y;const dist=Math.hypot(dx,dy)||1;if(r.mode==='ft'){d.dx=dist>65?dx/dist:0;d.dy=dist>65?dy/dist:0;}else{d.dx=dist>260?dx/dist:0;d.dy=dist>260?dy/dist:0;d.reload=p.ammo===0;}d.aim=Math.atan2(dy,dx);d.fire=true;d.skill=r.mode==='ft';}raw=JSON.stringify(d);}}return super.send(raw);}
  };
 });
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);return page;
}
async function api(page,path,body){return page.evaluate(async({path,body})=>{const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{path,body});}
async function ok(page,path,body){const r=await api(page,path,body);assert(r.status<300,path+' '+JSON.stringify(r));return r.data;}
const waitLive=page=>page.waitForFunction(()=>window.__live?.user&&window.__live.sockets.some(s=>s.readyState===1),null,{timeout:20000});
const act=(page,name)=>page.locator('[data-act='+name+']').first();
async function register(page,name){await page.locator('[data-act=auth][data-mode=register]').click();await page.locator('[name=username]').fill(name);await page.locator('[name=password]').fill(password);await page.locator('#authForm button[type=submit]').click();await page.locator('#gameCanvas').waitFor({timeout:20000});await waitLive(page);return (await ok(page,'/api/me')).user;}
async function roomAt(page,id,status){await page.waitForFunction(({id,status})=>window.__live.rooms[id]?.status===status,{id,status},{timeout:60000});return page.evaluate(id=>window.__live.rooms[id],id);}
try{
 const a=await pageFor(),b=await pageFor();const ua=await register(a,'QAa_'+tag),ub=await register(b,'QAb_'+tag);
 await a.waitForFunction(id=>window.__live.players.some(p=>p.id===id),ub.id);log('registration, cookie authentication and real presence');
 await b.locator('[data-act=visit][data-id="'+ua.id+'"]').click();
 await a.waitForFunction(({a,b})=>window.__live.players.filter(p=>[a,b].includes(p.id)&&p.scene==='home:'+a).length===2,{a:ua.id,b:ub.id});
 const before=await a.evaluate(id=>window.__live.players.find(p=>p.id===id).x,ub.id);
 await b.keyboard.down('KeyD');await b.waitForTimeout(600);await b.keyboard.up('KeyD');
 await a.waitForFunction(({id,x})=>window.__live.players.find(p=>p.id===id)?.x>x+35,{id:ub.id,x:before});log('same-home avatars and network movement');
 await a.screenshot({path:'work/world-desktop.png',fullPage:true});
 const c=await pageFor(true);await c.locator('[name=username]').fill(ua.username);await c.locator('[name=password]').fill(password);await c.locator('#authForm button[type=submit]').click();await waitLive(c);
 const state0=(await ok(a,'/api/me')).state;const purchase={type:'buy',itemId:'food',quantity:1,opId:crypto.randomUUID()};
 const replies=await Promise.all([ok(a,'/api/command',purchase),ok(c,'/api/command',purchase)]);const after=(await ok(a,'/api/me')).state;
 assert.equal(after.resources.coins,state0.resources.coins-15);assert.equal(after.resources.food,state0.resources.food+1);assert(replies.some(r=>r.replayed));
 await c.waitForFunction(v=>window.__live.state?.version>=v,after.version);
 const settings=await ok(a,'/api/command',{type:'settings',baseUrl:'https://example.com/v1',model:'qa',apiKey:'test-only-key',opId:crypto.randomUUID()});assert(settings.state.apiConfig.hasKey);assert(!JSON.stringify(settings).includes('test-only-key'));
 await Promise.all([ok(a,'/api/command',{type:'buy',itemId:'soap',quantity:1,opId:crypto.randomUUID()}),ok(c,'/api/command',{type:'care',catId:'luna',item:'food',opId:crypto.randomUUID()})]);
 const unified=(await ok(c,'/api/me')).state;assert(unified.apiConfig.hasKey);assert.equal(unified.achievements.care,1);assert.equal(unified.resources.coins,state0.resources.coins-35);assert.equal(unified.resources.food,state0.resources.food);
 const invalid=await api(a,'/api/command',{type:'state',coins:999999,opId:crypto.randomUUID()});assert.equal(invalid.status,400);log('multi-device atomic writes, replay dedup, encrypted settings and tamper rejection');
 await ok(a,'/api/command',{type:'buy',itemId:'lamp',quantity:1,opId:crypto.randomUUID()});await ok(a,'/api/command',{type:'place',itemId:'lamp',x:340,y:200,opId:crypto.randomUUID()});
 await b.waitForFunction(()=>window.__live.home?.furniture.some(f=>f.itemId==='lamp'));log('furniture placement broadcast to visitors');
 await c.screenshot({path:'work/world-mobile.png',fullPage:true});assert(await c.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await c.context().close();
 for(const mode of ['ft','shoot']){
  for(const p of [a,b]){await p.locator('[data-act=navigate][data-page="/'+mode+'"]').first().click();await p.locator('h1').filter({hasText:'大厅'}).waitFor();assert.equal(await p.locator('#gameCanvas').count(),0);}
  await act(a,'loadout').click();await a.locator('[role=dialog]').waitFor();for(const tab of ['cat','equipment','opponent'])await a.locator('[role=dialog] [data-tab='+tab+']').click();await a.locator('[role=dialog] [data-act=dismiss]').click();
  const initialA=(await ok(a,'/api/me')).state,initialB=(await ok(b,'/api/me')).state;
  await a.locator('[data-act=challenge][data-id="'+ub.id+'"]').click();await act(b,'accept').waitFor();
  const room=(await ok(a,'/api/rooms')).rooms.find(r=>r.mode===mode&&r.status==='INVITED');assert(room);
  await b.locator('[data-pick-room="'+room.id+'"][data-key=weapon]').selectOption('bubble');await act(b,'accept').click();await roomAt(a,room.id,'PICKS');await roomAt(b,room.id,'PICKS');
  await a.evaluate(()=>window.__live.role='attack');await b.evaluate(()=>window.__live.role='defend');await act(a,'ready').click();await act(b,'ready').click();
  const [ra,rb]=await Promise.all([roomAt(a,room.id,'BATTLE'),roomAt(b,room.id,'BATTLE')]);assert.equal(ra.seed,rb.seed);assert.equal(rb.picks[ub.id].weapon,'bubble');
  await a.locator('#gameCanvas[data-kind=battle]').waitFor();await a.screenshot({path:'work/'+mode+'-battle.png',fullPage:true});
  const done=await roomAt(a,room.id,'FINISHED');await roomAt(b,room.id,'FINISHED');assert.equal(done.result.reason,'knockout');assert.equal(done.result.winnerId,ua.id);
  const finalA=(await ok(a,'/api/me')).state,finalB=(await ok(b,'/api/me')).state;assert.equal(finalA.resources.coins,initialA.resources.coins+done.result.rewards[ua.id].coins);assert.equal(finalB.resources.coins,initialB.resources.coins-40);assert.equal(finalB.durability.cloud,initialB.durability.cloud-8);assert(finalA.apiConfig.hasKey);
  const [fa,fb]=await Promise.all([a.evaluate(id=>window.__live.frames.filter(f=>f.id===id),room.id),b.evaluate(id=>window.__live.frames.filter(f=>f.id===id),room.id)]);const map=new Map(fb.map(f=>[f.tick,f.game]));let matched=0;for(const f of fa){if(map.has(f.tick)){assert.equal(f.game,map.get(f.tick));matched++;}}assert(matched>20);const gaps=fa.slice(1).map((f,i)=>f.time-fa[i].time).sort((x,y)=>x-y);
  await ok(a,'/api/rooms/'+room.id+'/leave',{});assert.equal((await ok(a,'/api/me')).state.resources.coins,finalA.resources.coins);
  log(mode+' actual knockout, identical snapshots and exactly-once rewards',{ticks:done.game.tick,matchedFrames:matched,p95FrameMs:gaps[Math.floor(gaps.length*.95)]});
  for(const p of [a,b]){await act(p,'ack').click();await p.locator('h1').filter({hasText:'大厅'}).waitFor();}
 }
 await a.evaluate(()=>window.__live.role=null);await act(a,'pc').click();await act(a,'ready').click();await a.locator('#gameCanvas[data-kind=battle]').waitFor();
 const pc=(await ok(a,'/api/rooms')).rooms.find(r=>r.status==='BATTLE');assert(pc.members.some(m=>m.bot));
 await a.reload();await waitLive(a);await a.locator('#gameCanvas[data-kind=battle]').waitFor();assert.equal((await ok(a,'/api/rooms')).rooms.find(r=>r.status==='BATTLE').id,pc.id);
 await act(a,'leave').click();await act(a,'ack').click();log('PC practice, battle reload recovery and lobby escape');
 await a.screenshot({path:'work/lobby-desktop.png',fullPage:true});
 assert.deepEqual(errors,[]);log('zero browser page errors and mobile layout');
 await fs.writeFile('work/integration-report.json',JSON.stringify({base,at:new Date().toISOString(),checks,errors},null,2));
}catch(e){console.error(e);await fs.writeFile('work/integration-failure.json',JSON.stringify({error:e.stack,checks,errors},null,2));for(let i=0;i<contexts.length;i++){const p=contexts[i].pages()[0];if(p)await p.screenshot({path:'work/failure-'+i+'.png',fullPage:true}).catch(()=>{});}process.exitCode=1;}finally{await browser.close();}
