import {CATS,ITEMS,cleanInput,clamp,random,STEP} from './sim.js';
import {generateMap,moveOnMap,clearLine} from './maps.js';
export const sanctuary=(p,h)=>Math.hypot(p.x-h.map.safe.x,p.y-h.map.safe.y)<h.map.safe.r;
export function createHall(seed){return {seed:seed>>>0,rng:seed>>>0,map:generateMap(seed,'hall'),createdAt:Date.now(),tick:0,players:[],events:[]};}
export function addHallPlayer(h,user,pick){
 const old=h.players.find(p=>p.id===user.id);if(old)return old;
 const cat=CATS.find(c=>c.id===pick.catId)||CATS[0],spawn=h.map.spawns[h.players.length%h.map.spawns.length];
 const p={id:user.id,name:user.username,pick,...spawn,hp:cat.hp,maxHp:cat.hp,speed:cat.speed,aim:0,energy:100,cooldown:0,skillCooldown:0,guard:false,kills:0,deaths:0,respawnTick:0,invulnerableUntil:h.tick+60};
 h.players.push(p);return p;
}
export function stepHall(h,inputs={}){
 h.tick++;h.events=h.events.filter(e=>h.tick-e.tick<40);
 for(const p of h.players){
  if(p.hp<=0){if(h.tick>=p.respawnTick){Object.assign(p,h.map.spawns[p.deaths%h.map.spawns.length],{hp:p.maxHp,energy:100,invulnerableUntil:h.tick+60});}else continue;}
  const i=cleanInput(inputs[p.id]);p.input=i;p.aim=i.aim;
  p.cooldown=Math.max(0,p.cooldown-STEP);p.skillCooldown=Math.max(0,p.skillCooldown-STEP);
  p.guard=i.block&&p.energy>0;p.energy=clamp(p.energy+(p.guard?-28:18)*STEP,0,100);
  moveOnMap(p,i.dx*p.speed*STEP*(p.guard?.5:1),i.dy*p.speed*STEP*(p.guard?.5:1),h.map);
  if(sanctuary(p,h))p.hp=Math.min(p.maxHp,p.hp+.25);
 }
 for(const p of h.players){
  const i=p.input||{};if(p.hp<=0||sanctuary(p,h)||p.invulnerableUntil>h.tick)continue;
  const skill=i.skill&&p.energy>=35&&p.skillCooldown<=0;
  if((i.fire||skill)&&p.cooldown<=0){
   p.cooldown=skill?.85:.45;if(skill){p.energy-=35;p.skillCooldown=2;}
   h.events.push({type:'swing',tick:h.tick,id:p.id,x:p.x,y:p.y,aim:p.aim,skill});
   for(const q of h.players){
    if(q.id===p.id||q.hp<=0||sanctuary(q,h)||q.invulnerableUntil>h.tick)continue;
    const dx=q.x-p.x,dy=q.y-p.y,dist=Math.hypot(dx,dy);
    if(dist>(skill?150:96)||(Math.cos(p.aim)*dx+Math.sin(p.aim)*dy)/(dist||1)<-.15||!clearLine(p,q,h.map.cover,2))continue;
    const damage=Math.max(1,Math.floor((ITEMS.find(w=>w.id===p.pick.weapon)?.damage||16)*(skill?1.65:1)*(0.9+random(h)*.2)*(1-(ITEMS.find(w=>w.id===q.pick.armor)?.defense||0))*(q.guard?.3:1)));
    q.hp=Math.max(0,q.hp-damage);h.events.push({type:'hit',tick:h.tick,id:q.id,by:p.id,damage,x:q.x,y:q.y});
    if(!q.hp){q.deaths++;p.kills++;q.respawnTick=h.tick+100;h.events.push({type:'knockout',tick:h.tick,id:q.id,by:p.id,name:q.name,byName:p.name});}
   }
  }
 }
 return h;
}
