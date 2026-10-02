import {generateMap,clearLine} from './maps.js';
export const WIDTH = 960, HEIGHT = 540, STEP = 0.05;
export const CAT_MAX_LEVEL = 20, CAT_XP_PER_LEVEL = 100, CAT_BASE_INCOME_PER_MINUTE = 2;
export const catIncomePerMinute = level => Math.max(1, Math.min(CAT_MAX_LEVEL, Number(level)||1) * CAT_BASE_INCOME_PER_MINUTE);
export const CATS = [
 {id:'luna',name:'露娜',emoji:'🐈‍⬛',breed:'月影猫',price:0,hp:110,speed:205},
 {id:'momo',name:'糯米',emoji:'🐱',breed:'奶油猫',price:280,hp:100,speed:225},
 {id:'taro',name:'芋泥',emoji:'😺',breed:'蓝灰猫',price:380,hp:120,speed:190},
 {id:'mint',name:'薄荷',emoji:'😸',breed:'森林猫',price:520,hp:95,speed:240}
];
export const ITEMS = [
 {id:'claw',name:'星尘爪',emoji:'🐾',kind:'weapon',price:0,damage:16},
 {id:'bubble',name:'泡泡炮',emoji:'🫧',kind:'weapon',price:0,damage:15},
 {id:'sword',name:'月光剑',emoji:'⚔️',kind:'weapon',price:350,damage:19},
 {id:'blaster',name:'流星枪',emoji:'🔫',kind:'weapon',price:420,damage:18},
 {id:'cloud',name:'云朵护甲',emoji:'🛡️',kind:'armor',price:0,defense:0.12},
 {id:'cape',name:'星光斗篷',emoji:'🧥',kind:'armor',price:300,defense:0.18},
 {id:'food',name:'猫粮',emoji:'🍣',kind:'supply',price:15},
 {id:'soap',name:'肥皂',emoji:'🧼',kind:'supply',price:20},
 {id:'medicine',name:'药品',emoji:'💊',kind:'supply',price:30},
 {id:'sofa',name:'紫云沙发',emoji:'🛋️',kind:'furniture',price:120},
 {id:'plant',name:'小盆栽',emoji:'🪴',kind:'furniture',price:60},
 {id:'bed',name:'猫猫小床',emoji:'🛏️',kind:'furniture',price:140},
 {id:'tree',name:'猫爬架',emoji:'🌳',kind:'furniture',price:200},
 {id:'lamp',name:'星星灯',emoji:'💡',kind:'furniture',price:90}
];
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export function random(g){
 g.rng=(g.rng+0x6D2B79F5)>>>0; let t=g.rng;
 t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
 return ((t^(t>>>14))>>>0)/4294967296;
}
export function cleanInput(v={}){
 const finite=(x,d=0)=>Number.isFinite(x)?x:d;
 const dx=clamp(finite(v.dx),-1,1),dy=clamp(finite(v.dy),-1,1);
 const n=Math.max(1,Math.hypot(dx,dy));
 return {dx:dx/n,dy:dy/n,aim:clamp(finite(v.aim),-Math.PI,Math.PI),fire:v.fire===true,skill:v.skill===true,block:v.block===true,reload:v.reload===true};
}
export function createGame(seed,mode,players){
 const map=mode==='shoot'?generateMap(seed,'shoot'):null;
 return {seed:seed>>>0,rng:seed>>>0,mode,tick:0,bullets:[],events:[],result:null,nextBullet:1,width:map?.width||WIDTH,height:map?.height||HEIGHT,mapVersion:map?.version||0,
 cover:map?.cover||[],
 players:players.map((p,i)=>{const cat=CATS.find(c=>c.id===p.pick.catId)||CATS[0],spawn=map?.spawns[i]||{x:i?770:190,y:270};return {id:p.id,name:p.name,emoji:cat.emoji,pick:p.pick,...spawn,aim:i?Math.PI:0,hp:cat.hp,maxHp:cat.hp,speed:cat.speed,energy:100,ammo:8,cooldown:0,skillCooldown:0,reloadTime:0,guard:false,input:cleanInput()};})};
}
export function obstructed(x,y,r,boxes){return boxes.some(b=>x+r>b.x&&x-r<b.x+b.w&&y+r>b.y&&y-r<b.y+b.h);}
function move(p,dx,dy,g){
 const x=clamp(p.x+dx,24,(g.width||WIDTH)-24),y=clamp(p.y+dy,24,(g.height||HEIGHT)-24);
 if(!obstructed(x,p.y,18,g.cover))p.x=x;
 if(!obstructed(p.x,y,18,g.cover))p.y=y;
}
function strike(g,p,q,damage){
 const armor=ITEMS.find(x=>x.id===q.pick.armor);
 const crit=random(g)<0.12;
 const dealt=Math.max(1,Math.floor(damage*(0.9+random(g)*0.2)*(crit?1.5:1)*(1-(armor?.defense||0))*(q.guard?0.3:1)));
 q.hp=Math.max(0,q.hp-dealt);
 g.events.push({type:'hit',tick:g.tick,id:q.id,by:p.id,damage:dealt,crit,x:q.x,y:q.y});
}
export function botInput(g,botId){
 const p=g.players.find(x=>x.id===botId),q=g.players.find(x=>x.id!==botId);
 const x=q.x-p.x,y=q.y-p.y,d=Math.hypot(x,y)||1,near=g.mode==='ft'?65:250;
 const evade=g.mode==='shoot'&&d<650?Math.sin(g.tick*0.045)*0.55:0;
 let dx=(d>near?x/d:0)-y/d*evade,dy=(d>near?y/d:0)+x/d*evade;
 if(g.mode==='shoot'&&!clearLine(p,q,g.cover,24)){
  // Escape along the wide central road rather than walking into a cover island.
  const mid=(g.height||HEIGHT)/2;
  if(Math.abs(p.y-mid)>30){dx=0;dy=Math.sign(mid-p.y);}
  else{dx=Math.sign(x);dy=0;}
  if(obstructed(p.x+dx*30,p.y+dy*30,19,g.cover)){dx=Math.sign((g.width||WIDTH)/2-p.x);dy=0;}
 }
 return cleanInput({dx,dy,aim:Math.atan2(y,x),fire:d<(g.mode==='ft'?100:1250),skill:g.tick%47<3,block:g.tick%80>66,reload:p.ammo===0});
}
export function stepGame(g,inputs={}){
 if(g.result)return g;
 g.tick++;g.events=g.events.filter(e=>g.tick-e.tick<45);
 for(const p of g.players){
  p.input=cleanInput(inputs[p.id]);p.aim=p.input.aim;
  p.cooldown=Math.max(0,p.cooldown-STEP);p.skillCooldown=Math.max(0,p.skillCooldown-STEP);
  p.guard=p.input.block&&p.energy>0;p.energy=clamp(p.energy+(p.guard?-28:18)*STEP,0,100);
  const velocity=p.speed*(g.mode==='ft'?0.9:1)*(p.guard?0.5:1)*STEP;
  move(p,p.input.dx*velocity,p.input.dy*velocity,g);
  if(p.reloadTime>0){p.reloadTime-=STEP;if(p.reloadTime<=0)p.ammo=8;}
 }
 // Resolve both intents against the same tick, including simultaneous knockouts.
 for(const p of g.players){
  const q=g.players.find(x=>x.id!==p.id),i=p.input,weapon=ITEMS.find(x=>x.id===p.pick.weapon);
  const base=weapon?.damage||16;
  if(g.mode==='shoot'){
   if(i.reload&&p.ammo<8&&p.reloadTime<=0)p.reloadTime=1.1;
   if(i.fire&&p.ammo===0&&p.reloadTime<=0)p.reloadTime=1.1;
   if(i.fire&&p.cooldown<=0&&p.ammo>0&&p.reloadTime<=0){
    p.ammo--;p.cooldown=0.30;const a=p.aim+(random(g)-0.5)*0.07;
    g.bullets.push({id:g.nextBullet++,owner:p.id,x:p.x+Math.cos(a)*26,y:p.y+Math.sin(a)*26,vx:Math.cos(a)*720,vy:Math.sin(a)*720,life:1.9,damage:base});
   }
  }else{
   const skill=i.skill&&p.skillCooldown<=0&&p.energy>=35;
   if((i.fire||skill)&&p.cooldown<=0){
    p.cooldown=skill?0.85:0.45;if(skill){p.skillCooldown=2.0;p.energy-=35;}
    const d=Math.hypot(q.x-p.x,q.y-p.y),dot=(Math.cos(p.aim)*(q.x-p.x)+Math.sin(p.aim)*(q.y-p.y))/(d||1);
    g.events.push({type:'swing',tick:g.tick,id:p.id,skill,x:p.x,y:p.y,aim:p.aim});
    if(d<(skill?150:96)&&dot>-0.15){strike(g,p,q,base*(skill?1.65:1));move(q,Math.cos(p.aim)*12,Math.sin(p.aim)*12,g);}
   }
  }
 }
 g.bullets=g.bullets.filter(b=>{
  const ox=b.x,oy=b.y;b.x+=b.vx*STEP;b.y+=b.vy*STEP;b.life-=STEP;
  if(b.life<=0||b.x<0||b.y<0||b.x>(g.width||WIDTH)||b.y>(g.height||HEIGHT)||!clearLine({x:ox,y:oy},b,g.cover,4))return false;
  const q=g.players.find(x=>x.id!==b.owner),p=g.players.find(x=>x.id===b.owner);
  const vx=b.x-ox,vy=b.y-oy,t=clamp(((q.x-ox)*vx+(q.y-oy)*vy)/(vx*vx+vy*vy||1),0,1);
  if(Math.hypot(q.x-(ox+t*vx),q.y-(oy+t*vy))<23){strike(g,p,q,b.damage);return false;}
  return true;
 });
 const dead=g.players.filter(p=>p.hp<=0);
 if(dead.length||g.tick>=3600){
  const [a,b]=g.players;const winner=dead.length===2||a.hp===b.hp?null:a.hp>b.hp?a:b;
  const drop=['food','soap','medicine','stardust'][Math.floor(random(g)*4)];
  g.result={winnerId:winner?.id||null,loserId:winner?g.players.find(p=>p.id!==winner.id).id:null,drop,coins:70+Math.floor(random(g)*31),reason:dead.length?'knockout':'time'};
 }
 return g;
}
