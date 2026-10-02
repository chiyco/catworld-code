// World coordinates are independent of the 960 x 540 viewport.
export function mapRandom(seed) {
 let value=seed>>>0;
 return ()=>{value=(value+0x6D2B79F5)>>>0;let t=value;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
export function generateMap(seed,kind='shoot'){
 const rnd=mapRandom(seed),width=kind==='shoot'?3840:2880,height=kind==='shoot'?2160:1800;
 const cover=[],decor=[],cx=width/2,cy=height/2;
 // Separate obstacle islands leave wide interconnected roads. A clear central
 // cross connects both spawns and the lobby sanctuary for every possible seed.
 for(let y=110;y<height-200;y+=300)for(let x=110;x<width-200;x+=320){
  if(rnd()<.22)continue;
  const b={x:Math.round(x+rnd()*38),y:Math.round(y+rnd()*30),w:Math.round(75+rnd()*92),h:Math.round(65+rnd()*93),kind:rnd()<.5?'rock':'crate'};
  if(b.y<cy+105&&b.y+b.h>cy-105||b.x<cx+105&&b.x+b.w>cx-105)continue;
  cover.push(b);
 }
 for(let i=0;i<100;i++)decor.push({x:Math.round(rnd()*width),y:Math.round(rnd()*height),r:Math.round(3+rnd()*10),kind:rnd()<.5?'flower':'grass'});
 return {version:1,seed:seed>>>0,kind,width,height,cover,decor,
  theme:Math.floor(rnd()*3),safe:kind==='hall'?{x:cx,y:cy,r:155}:null,
  spawns:kind==='shoot'?[{x:180,y:cy},{x:width-180,y:cy}]:[{x:cx-65,y:cy},{x:cx+65,y:cy},{x:cx,y:cy-65},{x:cx,y:cy+65}]};
}
export function blocked(x,y,r,boxes){return boxes.some(b=>x+r>b.x&&x-r<b.x+b.w&&y+r>b.y&&y-r<b.y+b.h);}
export function moveOnMap(p,dx,dy,map){
 const x=Math.max(24,Math.min(map.width-24,p.x+dx)),y=Math.max(24,Math.min(map.height-24,p.y+dy));
 if(!blocked(x,p.y,18,map.cover))p.x=x;
 if(!blocked(p.x,y,18,map.cover))p.y=y;
}
export function clearLine(a,b,boxes,padding=0){
 const dx=b.x-a.x,dy=b.y-a.y,steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/12));
 for(let n=0;n<=steps;n++)if(blocked(a.x+dx*n/steps,a.y+dy*n/steps,padding,boxes))return false;
 return true;
}
export function cameraFor(p,map,w=960,h=540){
 return {x:Math.max(0,Math.min(map.width-w,(p?.x??map.width/2)-w/2)),y:Math.max(0,Math.min(map.height-h,(p?.y??map.height/2)-h/2))};
}
