import {CATS,ITEMS,clamp,CAT_MAX_LEVEL,CAT_XP_PER_LEVEL,catIncomePerMinute} from '../public/sim.js';
import {requireThat,encrypt} from './common.js';
const INCOME_CAP_MS=12*60*60*1000,HEALTHY_HP=70;
const freshCat=(c,now=Date.now())=>({id:c.id,name:c.name,emoji:c.emoji,breed:c.breed,hp:100,happy:80,clean:85,level:1,xp:0,incomeAt:now});
export const catIsHealthy=cat=>Number(cat?.hp||0)>=HEALTHY_HP;
export const catIncome=cat=>catIsHealthy(cat)?catIncomePerMinute(cat.level):0;
export function awardCatXp(s,catId,amount){
 const cat=s.cats.find(x=>x.id===catId);if(!cat)return false;
 cat.xp=Math.max(0,Number(cat.xp)||0)+Math.max(0,Number(amount)||0);
 let leveled=false;
 while(cat.level<CAT_MAX_LEVEL&&cat.xp>=cat.level*CAT_XP_PER_LEVEL){cat.xp-=cat.level*CAT_XP_PER_LEVEL;cat.level++;leveled=true;}
 return leveled;
}
export function settleCatIncome(s,now=Date.now(),legacySince=now){
 let changed=false,total=0,clock=Math.floor(now/60000)*60000;
 for(const cat of s.cats){
  // Pre-income accounts have no reliable per-cat clock. Start them from the
  // preserved D1 row timestamp once, instead of resetting the timer per request.
  const at=Number(cat.incomeAt)||Math.floor(legacySince/60000)*60000;
 if(!catIsHealthy(cat)){if(at<clock){cat.incomeAt=clock;changed=true;}continue;}
  const cappedAt=Math.max(at,clock-INCOME_CAP_MS),elapsed=Math.max(0,clock-cappedAt),minutes=Math.floor(elapsed/60000);
  if(minutes>0){const coins=minutes*catIncomePerMinute(cat.level);s.resources.coins+=coins;total+=coins;cat.incomeAt=cappedAt+minutes*60000;changed=true;}
 }
 return {changed,total};
}
export function initialState(username){return {version:1,profile:{username},resources:{coins:600,food:12,soap:5,medicine:3,stardust:0},cats:[freshCat(CATS[0])],selectedCat:'luna',loadout:{catId:'luna',weapon:'claw',armor:'cloud'},inventory:{claw:1,bubble:1,cloud:1,sofa:1,plant:1},durability:{claw:100,bubble:100,cloud:100},furniture:[{uid:'starter-sofa',itemId:'sofa',x:730,y:145},{uid:'starter-plant',itemId:'plant',x:130,y:420}],achievements:{wins:0,losses:0,kills:0,visits:0,care:0,firstWin:false,collector:false},codex:{cats:['luna'],items:['claw','bubble','cloud','sofa','plant']},apiConfig:{baseUrl:'https://api.openai.com/v1',model:'',encryptedKey:''}};}
export function normalize(raw,username,legacySince=Date.now()){
 const d=initialState(username);const s={...d,...raw};
 for(const key of ['profile','resources','loadout','inventory','durability','achievements','codex','apiConfig'])s[key]={...d[key],...(raw[key]||{})};
 const hasIncomeEpoch=Number(raw.incomeEpoch)>=1;
 s.cats=(raw.cats?.length?raw.cats:d.cats).map(rawCat=>{const base=freshCat(CATS.find(c=>c.id===rawCat.id)||CATS[0],legacySince);return {...base,...rawCat,level:Math.max(1,Math.min(CAT_MAX_LEVEL,Math.floor(Number(rawCat.level)||1))),xp:Math.max(0,Number(rawCat.xp)||0),incomeAt:hasIncomeEpoch?(Number(rawCat.incomeAt)||legacySince):legacySince};});
 s.incomeEpoch=1;
 s.furniture=Array.isArray(raw.furniture)?raw.furniture.filter(x=>x&&typeof x==='object'):d.furniture;
 s.selectedCat=s.cats.some(c=>c.id===s.selectedCat)?s.selectedCat:s.cats[0].id;
 s.loadout.catId=s.selectedCat;
 for(const k of ['weapon','armor'])s.loadout[k]=(ITEMS.find(i=>i.id===s.loadout[k]||i.name===s.loadout[k])||ITEMS.find(i=>i.id===d.loadout[k])).id;
 return s;
}
export function publicState(raw){const s=structuredClone(raw);s.apiConfig={baseUrl:s.apiConfig?.baseUrl||'',model:s.apiConfig?.model||'',hasKey:!!s.apiConfig?.encryptedKey};return s;}
export async function loadState(env,user){
 for(let attempt=0;attempt<3;attempt++){
  const row=await env.DB.prepare('SELECT state_json,updated_at FROM player_state WHERE user_id=?').bind(user.id).first();
  requireThat(row,'账号存档不存在',404);const raw=JSON.parse(row.state_json),state=normalize(raw,user.username,row.updated_at),income=settleCatIncome(state,Date.now(),row.updated_at);
  if(!income.changed&&Number(raw.incomeEpoch)>=1)return state;
  state.version=(state.version||0)+1;
  const saved=await env.DB.prepare('UPDATE player_state SET state_json=?,updated_at=? WHERE user_id=? AND updated_at=?').bind(JSON.stringify(state),Date.now(),user.id,row.updated_at).run();
  if(saved.meta?.changes===1)return state;
 }
 const row=await env.DB.prepare('SELECT state_json FROM player_state WHERE user_id=?').bind(user.id).first();
 requireThat(row,'账号存档不存在',404);return normalize(JSON.parse(row.state_json),user.username,row.updated_at);
}
export function validatePick(s,pick){
 requireThat(pick&&s.cats.some(c=>c.id===pick.catId),'请选择已领养的猫');
 for(const k of ['weapon','armor'])requireThat(ITEMS.some(i=>i.id===pick[k]&&i.kind===k)&&s.inventory[pick[k]]>0&&(s.durability[pick[k]]??100)>0,'装备未拥有或已损坏');
 return {catId:pick.catId,weapon:pick.weapon,armor:pick.armor};
}
export async function applyCommand(s,c,env){
 const take=(kind,n)=>{requireThat(Number(s.resources[kind]||0)>=n,'金币或物品不足');s.resources[kind]-=n;};
 switch(c.type){
 case 'care':{
  const cat=s.cats.find(x=>x.id===c.catId),m={food:['happy',20],soap:['clean',30],medicine:['hp',25]};
  requireThat(cat&&m[c.item],'无效照顾操作');const [field,amount]=m[c.item];
  requireThat(cat[field]<100,'猫猫这项状态已经满了');take(c.item,1);cat[field]=Math.min(100,cat[field]+amount);s.achievements.care++;awardCatXp(s,cat.id,10);break;
 }
 case 'buy':{
  const item=ITEMS.find(i=>i.id===c.itemId);requireThat(item&&item.price>0,'商品不存在');
  requireThat(Number.isInteger(c.quantity)&&c.quantity>0&&c.quantity<=20,'购买数量无效');
  if(['weapon','armor'].includes(item.kind))requireThat(!s.inventory[item.id]&&c.quantity===1,'装备已拥有');
  take('coins',item.price*c.quantity);
  if(item.kind==='supply')s.resources[item.id]=(s.resources[item.id]||0)+c.quantity;
  else{s.inventory[item.id]=(s.inventory[item.id]||0)+c.quantity;if(item.kind!=='furniture')s.durability[item.id]=100;}
  s.codex.items=[...new Set([...(s.codex.items||[]),item.id])];break;
 }
 case 'adopt':{
  const ctype=CATS.find(x=>x.id===c.catId);requireThat(ctype&&!s.cats.some(x=>x.id===ctype.id),'猫咪已领养或不存在');
  take('coins',ctype.price);s.cats.push(freshCat(ctype));s.codex.cats=s.cats.map(x=>x.id);s.achievements.collector=s.cats.length>=3;break;
 }
 case 'loadout':s.loadout={...s.loadout,...validatePick(s,c.pick)};s.selectedCat=c.pick.catId;break;
 case 'place':{
  const item=ITEMS.find(x=>x.id===c.itemId&&x.kind==='furniture');
  requireThat(item&&Number.isFinite(c.x)&&Number.isFinite(c.y),'家具位置无效');
  const existing=s.furniture.find(x=>x.uid===c.uid);
  if(existing){requireThat(existing.itemId===item.id,'家具不匹配');existing.x=clamp(c.x,35,925);existing.y=clamp(c.y,35,505);}
  else{requireThat(s.furniture.length<24&&s.furniture.filter(x=>x.itemId===item.id).length<(s.inventory[item.id]||0),'可摆放家具不足');s.furniture.push({uid:crypto.randomUUID(),itemId:item.id,x:clamp(c.x,35,925),y:clamp(c.y,35,505)});}break;
 }
 case 'unplace':s.furniture=s.furniture.filter(x=>x.uid!==c.uid);break;
 case 'repair':requireThat(s.inventory[c.itemId]&&s.durability[c.itemId]<100,'装备无需修理');take('coins',20);s.durability[c.itemId]=100;break;
 case 'settings':{
  requireThat(typeof c.baseUrl==='string'&&c.baseUrl.length<300&&typeof c.model==='string'&&c.model.length<100,'配置无效');
  const url=new URL(c.baseUrl);requireThat(url.protocol==='https:'&&!url.username&&!url.password,'API 地址必须为 HTTPS');
  s.apiConfig={...s.apiConfig,baseUrl:c.baseUrl,model:c.model};
  if(c.clearKey)s.apiConfig.encryptedKey='';
  else if(c.apiKey){requireThat(typeof c.apiKey==='string'&&c.apiKey.length<2048,'API Key 无效');s.apiConfig.encryptedKey=await encrypt(c.apiKey,env.DATA_KEY);}break;
 }
 default:requireThat(false,'不支持该账号操作');
 }
 s.version=(s.version||0)+1;return s;
}
