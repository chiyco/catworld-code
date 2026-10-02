// Real local Worker + D1 + WebSocket test. Records inputs without replacing
// them; CDP sends real simultaneous touch contacts to the displayed controls.
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base=process.env.TEST_URL||'http://127.0.0.1:8787';
const browser=await chromium.launch({channel:'msedge',headless:true});
const checks=[],errors=[],contexts=[],tag=Date.now().toString(36);
await fs.mkdir('work',{recursive:true});
const check=(name,details={})=>{checks.push({name,...details});console.log('PASS '+name+' '+JSON.stringify(details));};
async function newPlayer(suffix){
 const ctx=await browser.newContext({hasTouch:true,viewport:{width:1440,height:1000}});contexts.push(ctx);
 await ctx.addInitScript(()=>{
  window.__controlsQA={user:null,scene:null,hall:null,rooms:{},last:null,inputs:[],pointerEvents:[]};
  for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>window.__controlsQA.pointerEvents.push({type,id:e.pointerId,button:e.button,target:e.target.dataset?.control||e.target.id}));
  const Native=window.WebSocket;
  window.WebSocket=class extends Native {
   constructor(...args){super(...args);this.addEventListener('message',e=>{const d=JSON.parse(e.data),q=window.__controlsQA;
    if(d.type==='hello')q.user=d.you;
    if(d.type==='joined'){q.scene=d.scene;if(d.hall)q.hall=d.hall;}
    if(d.type==='hall')q.hall={...q.hall,...d.hall};
    if(d.type==='room')q.rooms[d.room.id]=d.room;
   });}
   send(raw){const d=JSON.parse(raw);if(['input','hall-input','move'].includes(d.type)){const q=window.__controlsQA;q.last=d;q.inputs.push(d);if(q.inputs.length>500)q.inputs.shift();}return super.send(raw);}
  };
 });
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 p.on('console',m=>{if(m.type()==='error'&&m.text().includes('Invalid live update'))errors.push(m.text());});
 await p.goto(base);await p.locator('[data-act=auth][data-mode=register]').click();
 await p.locator('[name=username]').fill('CT'+suffix+tag);await p.locator('[name=password]').fill('Controls_'+tag+'!');
 await p.locator('#authForm button[type=submit]').click();await p.locator('#gameCanvas').waitFor({timeout:20000});
 await p.waitForFunction(()=>window.__controlsQA.user&&window.__controlsQA.scene?.startsWith('home:'));
 return p;
}
async function api(p,path,body){
 return p.evaluate(async({path,body})=>{
  const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const d=await r.json();if(!r.ok)throw Error(path+': '+JSON.stringify(d));return d;
 },{path,body});
}
async function nav(p,path){await p.locator('[data-act=navigate][data-page="'+path+'"]').first().click();await p.waitForFunction(scene=>window.__controlsQA.scene===scene,path==='/'?'home:'+await p.evaluate(()=>window.__controlsQA.user):path);}
const control=(p,id)=>p.locator('[data-control="'+id+'"]');
async function center(el){const b=await el.boundingBox();assert(b);return {x:b.x+b.width/2,y:b.y+b.height/2};}
async function expectInput(p,values){await p.waitForFunction(values=>Object.entries(values).every(([k,v])=>window.__controlsQA.last?.[k]===v),values,{timeout:8000});}
async function verifyLayout(p,kind){
 const sizes=[[1440,1000],[1024,900],[650,844],[390,844],[320,780],[844,390]];
 for(const [width,height] of sizes){
  await p.setViewportSize({width,height});await p.locator('.map-stage').scrollIntoViewIfNeeded();
  const data=await p.evaluate(()=>{
   const canvas=document.querySelector('#gameCanvas').getBoundingClientRect();
   const buttons=[...document.querySelectorAll('[data-control]')].map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.control,x:r.x,y:r.y,w:r.width,h:r.height};});
   return {canvas:{x:canvas.x,y:canvas.y,w:canvas.width,h:canvas.height},buttons,
    overlayCount:document.querySelectorAll('.map-stage .controls').length,
    outsideCount:document.querySelectorAll('.canvas-wrap > .controls').length,
    centerHit:document.elementFromPoint(canvas.x+canvas.width/2,canvas.y+canvas.height/2)?.id,
    documentWidth:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert.equal(data.overlayCount,1);assert.equal(data.outsideCount,0);assert.equal(data.buttons.length,7);assert(data.documentWidth<=data.viewport+1);
  const c=data.canvas;
  for(const b of data.buttons){assert(b.x>=c.x&&b.y>=c.y&&b.x+b.w<=c.x+c.w+1&&b.y+b.h<=c.y+c.h+1,kind+': clipped button '+b.id+' at '+width);assert(b.w>=38&&b.h>=38);}
  for(let i=0;i<data.buttons.length;i++)for(let j=i+1;j<data.buttons.length;j++){
   const a=data.buttons[i],b=data.buttons[j];assert(a.x+a.w<=b.x+.5||b.x+b.w<=a.x+.5||a.y+a.h<=b.y+.5||b.y+b.h<=a.y+.5,kind+': overlapping buttons');
  }
  const minimap={x:c.x+c.w*(960-192-19)/960,y:c.y+c.h*9/540,w:c.w*202/960,h:c.h*(kind==='hall'?130:118)/540};
  for(const b of data.buttons)assert(b.x+b.w<=minimap.x||b.y>=minimap.y+minimap.h||b.x>=minimap.x+minimap.w);
  if(height>=780)assert.equal(data.centerHit,'gameCanvas','transparent overlay must not block map aiming');
  if(width===390||width===1440)await p.locator('.canvas-wrap').screenshot({path:'work/'+kind+'-map-controls-'+width+'.png'});
 }
 check(kind+' controls stay inside map at 320–1440px; minimap and centre unobstructed');
}
async function verifyInput(p,kind){
 await p.setViewportSize({width:390,height:844});await p.locator('.map-stage').scrollIntoViewIfNeeded();
 const cdp=await p.context().newCDPSession(p);
 const right={...await center(control(p,'right')),id:1},fire={...await center(control(p,'fire')),id:2};
 const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(pt=>({...pt,radiusX:2,radiusY:2,force:1}))});
 // Hold direction then fire; releasing fire must leave movement active.
 await touch('touchStart',[right]);await expectInput(p,{dx:1,fire:false});
 await touch('touchStart',[right,fire]);await expectInput(p,{dx:1,fire:true});
 await touch('touchEnd',[right]);await expectInput(p,{dx:1,fire:false});
 assert.equal(await control(p,'right').getAttribute('aria-pressed'),'true');assert.equal(await control(p,'fire').getAttribute('aria-pressed'),'false');
 await touch('touchCancel',[]);await expectInput(p,{dx:0,fire:false});
 // Three fingers: direction, attack and a separate aim finger on the canvas.
 const rect=await p.locator('#gameCanvas').boundingBox();
 const aim={x:rect.x+rect.width*.58,y:rect.y+rect.height*.42,id:3};
 await touch('touchStart',[right]);await touch('touchStart',[right,fire]);await touch('touchStart',[right,fire,aim]);await expectInput(p,{dx:1,fire:true});
 await touch('touchEnd',[right,fire]);await expectInput(p,{dx:1,fire:true});
 await touch('touchEnd',[fire]);await expectInput(p,{dx:0,fire:true});
 await touch('touchEnd',[]);await expectInput(p,{dx:0,fire:false});
 // A lost pointer capture and a blurred window must not leave controls stuck.
 await control(p,'right').dispatchEvent('pointerdown',{pointerId:71,button:0,pointerType:'touch',bubbles:true});
 await expectInput(p,{dx:1});
 await control(p,'right').dispatchEvent('lostpointercapture',{pointerId:71,button:0,bubbles:true});await expectInput(p,{dx:0});
 await touch('touchStart',[right,fire]);await expectInput(p,{dx:1,fire:true});
 await p.evaluate(()=>window.dispatchEvent(new Event('blur')));await expectInput(p,{dx:0,fire:false});await touch('touchCancel',[]);
 // Overlay hit target never forwards to the canvas: movement does not fire.
 await p.setViewportSize({width:1440,height:1000});await p.locator('.map-stage').scrollIntoViewIfNeeded();
 const before=await p.evaluate(kind=>kind==='hall'?window.__controlsQA.hall.players.find(p=>p.id===window.__controlsQA.user).x:Object.values(window.__controlsQA.rooms).find(r=>r.status==='BATTLE').game.players.find(p=>p.id===window.__controlsQA.user).x,kind);
 const mouse=await center(control(p,'right'));await p.mouse.move(mouse.x,mouse.y);await p.mouse.down();
 await expectInput(p,{dx:1,fire:false});await p.waitForTimeout(350);await p.mouse.up();await expectInput(p,{dx:0,fire:false});
 await p.waitForFunction(({kind,x})=>{const q=window.__controlsQA,g=kind==='hall'?q.hall:Object.values(q.rooms).find(r=>r.status==='BATTLE')?.game;return g?.players.find(p=>p.id===q.user).x>x+10;},{kind,x:before});
 // Held keyboard controls and WASD are still supported.
 await control(p,'fire').focus();await p.keyboard.down('Space');await expectInput(p,{fire:true,block:false});await p.keyboard.up('Space');await expectInput(p,{fire:false});
 await p.locator('#gameCanvas').focus();await p.keyboard.down('KeyD');await expectInput(p,{dx:1});await p.keyboard.up('KeyD');await expectInput(p,{dx:0});
 await cdp.detach();check(kind+' real multitouch, pointer cancel, blur, mouse and keyboard inputs');
}
let a,b;
try{
 a=await newPlayer('a');b=await newPlayer('b');
 assert.equal(await a.locator('.map-stage').count(),0);assert.equal(await a.locator('.canvas-wrap > .controls').count(),1);
 check('home keeps its original controls below the map');
 await nav(a,'/hall');await a.waitForFunction(()=>window.__controlsQA.hall?.players.some(p=>p.id===window.__controlsQA.user));
 await verifyLayout(a,'hall');await verifyInput(a,'hall');
 await nav(a,'/shoot');await nav(b,'/shoot');assert.equal(await a.locator('.map-stage').count(),0);
 const opponent=await b.evaluate(()=>window.__controlsQA.user);
 const room=(await api(a,'/api/rooms',{mode:'shoot',opponentId:opponent})).room;
 await api(b,'/api/rooms/'+room.id+'/accept',{});await api(a,'/api/rooms/'+room.id+'/ready',{});await api(b,'/api/rooms/'+room.id+'/ready',{});
 await a.locator('#gameCanvas[data-kind=battle]').waitFor();
 await verifyLayout(a,'shoot');await verifyInput(a,'shoot');
 assert.equal(await a.locator('[data-act=leave]').count(),1);assert.equal(await a.locator('.hud').count(),1);
 // Scene changes clear held touch controls before a different map is joined.
 await control(a,'right').dispatchEvent('pointerdown',{pointerId:72,button:0,pointerType:'touch',bubbles:true});await expectInput(a,{dx:1});
 await api(a,'/api/rooms/'+room.id+'/leave',{});await a.locator('[data-act=ack]').click();assert.equal(await a.locator('.map-stage').count(),0);
 await nav(a,'/ft');const pc=(await api(a,'/api/rooms',{mode:'ft',pc:true})).room;await api(a,'/api/rooms/'+pc.id+'/ready',{});
 await a.locator('#gameCanvas[data-kind=battle]').waitFor();assert.equal(await a.locator('.map-stage').count(),0);assert.equal(await a.locator('.canvas-wrap > .controls').count(),1);
 await expectInput(a,{dx:0,fire:false});await api(a,'/api/rooms/'+pc.id+'/leave',{});
 check('shoot lobby has no battle buttons; exit and HUD kept; fighting arena unchanged');
 assert.deepEqual(errors,[]);
 await fs.writeFile('work/in-map-controls-report.json',JSON.stringify({base,at:new Date().toISOString(),checks,errors},null,2));
}catch(e){if(a){console.log(await a.evaluate(()=>({last:window.__controlsQA.last,pointerEvents:window.__controlsQA.pointerEvents,pressed:[...document.querySelectorAll('[aria-pressed=true]')].map(x=>x.dataset.control)})));await a.screenshot({path:'work/in-map-controls-failure.png',fullPage:true}).catch(()=>{});}throw e;}
finally{await browser.close();}
