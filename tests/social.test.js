import test from 'node:test';
import assert from 'node:assert/strict';
import {generateMap,cameraFor,blocked} from '../public/maps.js';
import {createGame,stepGame} from '../public/sim.js';
import {createHall,addHallPlayer,stepHall,sanctuary} from '../public/hall.js';
import {providerURL,publicIP,requestReply} from '../src/nyan.js';
const picks={catId:'luna',weapon:'claw',armor:'cloud'};
test('seeded large shooting maps and camera are deterministic',()=>{
 const a=generateMap(123,'shoot'),b=generateMap(123,'shoot'),other=generateMap(124,'shoot');
 assert.deepEqual(a,b);assert.equal(a.width,3840);assert.equal(a.height,2160);assert.notDeepEqual(a.cover,other.cover);
 assert(a.cover.length>=30);assert(a.decor.length>=90);assert.deepEqual(a.spawns[0],{x:180,y:1080});assert.deepEqual(a.spawns[1],{x:3660,y:1080});
 assert.deepEqual(cameraFor({x:3660,y:1080},a),{x:2880,y:810});assert(blocked(a.cover[0].x+1,a.cover[0].y+1,1,a.cover));
});
test('shooting combat remains inside the seeded large map',()=>{
 const g=createGame(9823,'shoot',[{id:'a',name:'A',pick:picks},{id:'b',name:'B',pick:picks}]);
 assert.equal(g.width,3840);assert.equal(g.height,2160);assert(g.cover.length>0);
 for(let i=0;i<400;i++)stepGame(g,{a:{dx:1,aim:0,fire:true},b:{dx:-1,aim:Math.PI,fire:true}});
 assert(g.players.every(p=>p.x>=24&&p.x<=3816&&p.y>=24&&p.y<=2136));
});
test('shared cat hall protects sanctuary, permits combat and respawns',()=>{
 const h=createHall(777);addHallPlayer(h,{id:'a',username:'A'},picks);addHallPlayer(h,{id:'b',username:'B'},picks);
 assert(h.map.safe);assert(sanctuary(h.players[0],h));
 for(let i=0;i<90;i++)stepHall(h,{a:{dx:-1},b:{dx:1}});
 assert(!sanctuary(h.players[0],h));assert(!sanctuary(h.players[1],h));
 h.players[0].x=1000;h.players[0].y=900;h.players[1].x=1080;h.players[1].y=900;
 let defeated=false;
 for(let i=0;i<650;i++){stepHall(h,{a:{aim:0,fire:true},b:{aim:Math.PI}});if(h.players[1].hp===0){defeated=true;break;}}
 assert(defeated);assert.equal(h.players[0].kills,1);assert.equal(h.players[1].deaths,1);
 for(let i=0;i<105;i++)stepHall(h,{});assert(h.players[1].hp>0);assert(h.players[1].invulnerableUntil>h.tick);
});
test('catgirl provider URLs are HTTPS/public and compatible paths are normalized',()=>{
 assert.equal(providerURL('https://api.example.com/v1/').href,'https://api.example.com/v1/chat/completions');
 assert.equal(providerURL('https://api.example.com/v1/chat/completions').href,'https://api.example.com/v1/chat/completions');
 for(const u of ['http://api.example.com','https://localhost/v1','https://127.0.0.1/v1','https://api.example.com/?url=x','https://user:pass@api.example.com'])assert.throws(()=>providerURL(u));
 for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','fc00::1','2001:db8::1'])assert.equal(publicIP(ip),false,ip);
 assert.equal(publicIP('1.1.1.1'),true);assert.equal(publicIP('2606:4700:4700::1111'),true);
});
test('catgirl API requests keep the API key server-side and parse replies',async()=>{
 let request;
 const text=await requestReply({baseUrl:'https://api.example.com/v1',model:'test-model'},'server-only-key',[{role:'user',content:'你好'}],async(url,options)=>{
  request={url,options};return new Response(JSON.stringify({choices:[{message:{content:'喵，你好！'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
 });
 assert.equal(text,'喵，你好！');assert.equal(request.options.headers.Authorization,'Bearer server-only-key');assert.equal(new URL(request.url).pathname,'/v1/chat/completions');
 assert.equal(JSON.parse(request.options.body).messages[0].content,'你好');
});
