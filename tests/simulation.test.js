import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,stepGame,cleanInput} from '../public/sim.js';
import {initialState,applyCommand,publicState,validatePick,settleCatIncome,awardCatXp,catIsHealthy,catIncome} from '../src/model.js';
const players=[{id:'a',name:'A',pick:{catId:'luna',weapon:'claw',armor:'cloud'}},{id:'b',name:'B',pick:{catId:'luna',weapon:'bubble',armor:'cloud'}}];
for(const mode of ['ft','shoot'])test('identical seed and input stream reproduce every '+mode+' tick',()=>{
 const a=createGame(123456,mode,players),b=createGame(123456,mode,players);
 for(let t=0;t<3600;t++){const input={a:{dx:Math.sin(t/10),dy:Math.cos(t/16),aim:t%20/20*Math.PI,fire:true,skill:t%40<2},b:{dx:Math.cos(t/11),dy:Math.sin(t/14),aim:Math.PI,fire:t%4!==0,block:t%60>45}};stepGame(a,input);stepGame(b,input);assert.deepEqual(a,b);}
 assert.ok(a.result);
});
test('invalid input cannot teleport or generate NaN',()=>{
 assert.deepEqual(cleanInput({dx:Infinity,dy:NaN,aim:'bad',fire:'yes'}),cleanInput());
 const input=cleanInput({dx:1e20,dy:1e20});assert.ok(Math.hypot(input.dx,input.dy)<=1.00001);
});
test('completed games are immutable',()=>{const g=createGame(1,'ft',players);g.result={winnerId:'a'};const saved=structuredClone(g);stepGame(g,{a:{fire:true}});assert.deepEqual(g,saved);});
test('account commands preserve unknown fields and unrelated configuration',async()=>{
 const s=initialState('tester');s.customField={deep:{kept:1}};s.apiConfig.extra='keep-me';
 const updated=await applyCommand(s,{type:'care',catId:'luna',item:'food'},{});
 assert.equal(updated.resources.food,11);assert.equal(updated.resources.coins,600);assert.deepEqual(updated.customField,{deep:{kept:1}});assert.equal(updated.apiConfig.extra,'keep-me');
});
test('arbitrary currency writes and negative purchases are rejected',async()=>{
 await assert.rejects(applyCommand(initialState('a'),{type:'setCoins',coins:9999},{}));
 await assert.rejects(applyCommand(initialState('a'),{type:'buy',itemId:'food',quantity:-1},{}));
 assert.throws(()=>validatePick(initialState('a'),{catId:'taro',weapon:'sword',armor:'cape'}));
});
test('furniture requires ownership and cannot exceed owned count',async()=>{
 const s=initialState('a');await assert.rejects(applyCommand(s,{type:'place',itemId:'bed',x:100,y:100},{}));
 await assert.rejects(applyCommand(s,{type:'place',itemId:'plant',x:100,y:100},{}));
 await applyCommand(s,{type:'place',uid:'starter-plant',itemId:'plant',x:200,y:100},{});assert.equal(s.furniture.length,2);assert.equal(s.furniture[1].x,200);
});
test('settings keys never appear in public account response',()=>{const s=initialState('a');s.apiConfig.encryptedKey='secret';const p=publicState(s);assert.equal(p.apiConfig.hasKey,true);assert.equal(JSON.stringify(p).includes('secret'),false);});
test('healthy cats generate level-scaled coins exactly once across devices',()=>{
 const s=initialState('a'),now=Math.floor(Date.now()/60000)*60000;s.cats[0].level=3;s.cats[0].incomeAt=now-5*60000;
 const first=settleCatIncome(s,now);assert.equal(first.total,30);assert.equal(s.resources.coins,630);assert.equal(first.changed,true);
 const second=settleCatIncome(s,now);assert.equal(second.total,0);assert.equal(s.resources.coins,630);
 s.cats[0].hp=69;s.cats[0].incomeAt=now-600000;const unhealthy=settleCatIncome(s,now);assert.equal(unhealthy.total,0);const unchanged=settleCatIncome(s,now);assert.equal(unchanged.changed,false);assert.equal(catIsHealthy(s.cats[0]),false);assert.equal(catIncome(s.cats[0]),0);
});
test('care and battle xp raise cat level and increase production',async()=>{
 const s=initialState('a');s.cats[0].hp=80;s.cats[0].happy=0;s.cats[0].level=1;s.cats[0].xp=90;
 await applyCommand(s,{type:'care',catId:'luna',item:'food'},{});assert.equal(s.cats[0].xp,0);assert.equal(s.cats[0].level,2);assert.equal(catIncome(s.cats[0]),4);
 awardCatXp(s,'luna',200);assert.equal(s.cats[0].level,3);assert.equal(catIncome(s.cats[0]),6);
});
test('legacy accounts seed the income clock from D1 updated_at and migrate only once',async()=>{
 const now=Date.now(),base=initialState('legacy');delete base.incomeEpoch;delete base.cats[0].incomeAt;base.cats[0].level=2;
 const row={state_json:JSON.stringify(base),updated_at:Math.floor((now-5*60000)/60000)*60000},saved=[];
 const env={DB:{prepare(sql){return {bind(...args){return {async first(){return row},async run(){saved.push({sql,args});return {meta:{changes:1}};}};}};}}};
 const first=await (await import('../src/model.js')).loadState(env,{id:'legacy',username:'legacy'});
 assert.equal(first.resources.coins,base.resources.coins+20);assert.equal(first.incomeEpoch,1);assert.equal(saved.length,1);
 row.state_json=JSON.stringify(first);row.updated_at=saved[0].args[1];
 const next=await (await import('../src/model.js')).loadState(env,{id:'legacy',username:'legacy'});
 assert.equal(next.resources.coins,first.resources.coins);assert.equal(saved.length,1);
});
