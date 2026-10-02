import {CATS,ITEMS,WIDTH,HEIGHT,cleanInput,stepGame,clamp,catIncomePerMinute,CAT_XP_PER_LEVEL,CAT_MAX_LEVEL} from './sim.js';
import {generateMap,cameraFor} from './maps.js';
import {createSocial} from './social-ui.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;').replaceAll("'",'&#39;');
const A={user:null,state:null,page:validPage(location.pathname),auth:'login',players:[],rooms:new Map(),connected:false,scene:'',home:null,visiting:new URLSearchParams(location.search).get('home'),ws:null,retry:0,ping:0,modal:null,pickDraft:{},edit:false,placing:null,target:null,keys:{},touch:{},pointer:{x:760,y:270,down:false},lastReceived:0,accountBusy:false};
function validPage(p){return ['/ft','/shoot','/nyan','/hall','/friends'].includes(p)?p:'/';}
const attr=(o={})=>Object.entries(o).map(([k,v])=>' data-'+k+'="'+esc(v)+'"').join('');
const B=(label,act,kind='',data={},disabled=false)=>'<button class="btn '+kind+'" data-act="'+act+'"'+attr(data)+(disabled?' disabled':'')+'>'+label+'</button>';
const item=id=>ITEMS.find(i=>i.id===id);
const cat=id=>CATS.find(c=>c.id===id)||CATS[0];
const ownedCats=()=>A.state?.cats||[];
const currentMode=()=>A.page==='/shoot'?'shoot':'ft';
const selected=()=>ownedCats().find(c=>c.id===A.state.selectedCat)||ownedCats()[0];
const modeName=m=>m==='ft'?'格斗场':'射击场';
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(A.toastTimer);A.toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200);}
async function api(path,method='GET',data){
 const response=await fetch(path,{method,credentials:'same-origin',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
 const result=await response.json();if(!response.ok){const error=new Error(result.error||'请求失败');error.status=response.status;throw error;}return result;
}
function applyState(state){if(!A.state||state.version>=A.state.version)A.state=state;}
function modeRooms(mode){return [...A.rooms.values()].filter(r=>r.mode===mode&&!r.hiddenFor?.includes(A.user.id)&&r.status!=='CANCELLED').sort((a,b)=>b.createdAt-a.createdAt);}
function activeRoom(mode=currentMode()){const list=modeRooms(mode);return list.find(r=>['BATTLE','PICKS','INVITED'].includes(r.status))||list.find(r=>r.status==='FINISHED');}
function opponent(r){return r.members.find(p=>p.id!==A.user.id);}
function roomStatus(r){return {INVITED:'等待接受',PICKS:'选择配置',BATTLE:'战斗中',FINISHED:'已结算',CANCELLED:'已关闭'}[r.status];}
function sceneName(scene){if(scene==='/ft')return '格斗场大厅';if(scene==='/shoot')return '射击场大厅';if(scene==='/hall')return '猫猫大厅';if(scene==='/nyan')return '与猫娘对话';if(scene==='/friends')return '好友大厅';if(scene==='home:'+A.user?.id)return '你的家';return '玩家家园';}
function desiredScene(){return A.page==='/'?'home:'+(A.visiting||A.user.id):A.page;}
function wsSend(data){if(A.ws?.readyState===1)A.ws.send(JSON.stringify(data));}
function joinScene(){if(A.connected)wsSend({type:'join',scene:desiredScene()});}
function navigate(page,home=null){A.page=validPage(page);A.visiting=A.page==='/'?home:null;A.target=null;A.keys={};A.touch={};A.edit=false;A.pointer.down=false;history.pushState({},'',A.page+(A.visiting?'?home='+encodeURIComponent(A.visiting):''));joinScene();render();social.navigate();}
function connect(){
 if(!A.user)return;if(A.ws){A.ws.onclose=null;A.ws.close();}
 const socket=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws');A.ws=socket;
 socket.onmessage=event=>{try{receive(JSON.parse(event.data));}catch(e){console.error('Invalid live update',e);}};
 socket.onopen=()=>{A.retry=0;A.connected=true;render();flushPending();};
 socket.onclose=event=>{A.connected=false;render();if(!A.user)return;const wait=Math.min(15000,1000*2**A.retry++);clearTimeout(A.reconnect);A.reconnect=setTimeout(async()=>{try{const me=await api('/api/me');applyState(me.state);connect();}catch(e){if(e.status===401){A.user=null;A.state=null;render();}else connect();}},wait);};
 socket.onerror=()=>{};
}
function receive(d){
 if(d.type==='hello'){A.rooms=new Map(d.rooms.map(r=>[r.id,r]));A.players=d.players;A.scene=d.scene;A.home=d.home;joinScene();render();}
 if(d.type==='joined'){A.scene=d.scene;A.home=d.home;A.target=null;if(d.hall)A.hall=d.hall;render();}
 if(d.type==='hall'){if(A.hall?.seed===d.hall.seed){A.hall={...d.hall,map:A.hall.map};social.refreshHall();}}
 if(d.type==='presence'){A.players=d.players;refreshPlayers();}
 if(d.type==='home'){if(A.scene==='home:'+d.home.owner.id){A.home=d.home;if(A.edit)render();}}
 if(d.type==='account'){applyState(d.state);if(A.modal?.type!=='settings')render();}
 if(d.type==='room'){const prev=A.rooms.get(d.room.id);A.rooms.set(d.room.id,d.room);A.lastReceived=performance.now();if(d.room.status==='CANCELLED'){toast(d.room.reason||'房间已关闭');render();}else if(prev?.status==='BATTLE'&&d.room.status==='BATTLE'&&$('#gameCanvas')?.dataset.kind==='battle'){updateHud(d.room);}else{render();}}
 if(d.type==='pong'){A.ping=Date.now()-d.echo;const el=$('#ping');if(el)el.textContent=A.ping+' ms';}
 if(d.type==='wave')toast(d.from+' 向 '+d.to+' 挥了挥爪 👋');
 if(d.type==='error')toast(d.error);
 social.receive(d);
}
function pendingKey(){return 'cw-pending-'+A.user.id;}
function pending(){try{return JSON.parse(localStorage.getItem(pendingKey())||'[]');}catch{return [];}}
async function command(data){
 const c={...data,opId:crypto.randomUUID()};
 const keep=data.type!=='settings';if(keep)localStorage.setItem(pendingKey(),JSON.stringify([...pending(),c]));
 try{const result=await api('/api/command','POST',c);applyState(result.state);if(keep)localStorage.setItem(pendingKey(),JSON.stringify(pending().filter(x=>x.opId!==c.opId)));render();return result;}
 catch(e){if(keep&&e.status&&e.status<500)localStorage.setItem(pendingKey(),JSON.stringify(pending().filter(x=>x.opId!==c.opId)));throw e;}
}
async function flushPending(){if(A.flushing||!A.user)return;A.flushing=true;try{for(const c of pending()){try{const r=await api('/api/command','POST',c);applyState(r.state);localStorage.setItem(pendingKey(),JSON.stringify(pending().filter(x=>x.opId!==c.opId)));}catch(e){if(e.status&&e.status<500)localStorage.setItem(pendingKey(),JSON.stringify(pending().filter(x=>x.opId!==c.opId)));else break;}}}finally{A.flushing=false;}render();}
async function roomPost(r,action,data={}){const out=await api('/api/rooms/'+r+'/'+action,'POST',data);A.rooms.set(out.room.id,out.room);render();return out.room;}
function render(){
 const focus=document.activeElement;const isSettings=A.modal?.type==='settings'&&focus?.closest('#settingsForm');
 if(isSettings)return;
 const activeId=focus?.closest('.social-form')?focus.id:null,start=focus?.selectionStart,end=focus?.selectionEnd;
 const logScroll=$('#chatLog')?.scrollTop;
 $('#app').innerHTML=A.user?appHTML():authHTML();
 if(activeId){const el=document.getElementById(activeId);el?.focus({preventScroll:true});if(el?.setSelectionRange&&el.type!=='checkbox')el.setSelectionRange(start,end);}
 if(logScroll!==undefined&&$('#chatLog'))$('#chatLog').scrollTop=logScroll;
 if(A.page==='/hall')social.refreshHall();
}
function pageContent(){return A.page==='/'?worldHTML():['/ft','/shoot'].includes(A.page)?arenaHTML(currentMode()):social.html(A.page);}
function authHTML(){return '<div class="auth-screen"><section class="card auth-card"><div class="brand"><div class="brand-icon">🐾</div><div><strong>猫猫世界</strong><small>ONE WORLD. EVERYWHERE.</small></div></div><h1>'+ (A.auth==='login'?'欢迎回到猫猫世界。':'给你的猫猫一个家。')+'</h1><p>养猫、装饰家园，和真实玩家来一场对战。<br>同一账号，跨设备保存进度。</p><div class="auth-tabs">'+B('登录','auth',A.auth==='login'?'active':'',{mode:'login'})+B('注册账号','auth',A.auth==='register'?'active':'',{mode:'register'})+'</div><form id="authForm"><label>用户名<input name="username" autocomplete="username" minlength="2" maxlength="20" required placeholder="2–20 位中文、字母、数字或下划线"></label><label>密码<input name="password" type="password" autocomplete="'+(A.auth==='login'?'current-password':'new-password')+'" minlength="8" maxlength="128" required placeholder="至少 8 位"></label><div id="authError" class="error" role="alert"></div><button class="btn primary full" type="submit">'+(A.auth==='login'?'进入我的世界 →':'注册并领养第一只猫 →')+'</button></form><footer>注册即可获得露娜、600 金币和初始补给。<br>无需模拟对手：邀请朋友加入，或在大厅选择 PC 练习。</footer></section></div>';}
function appHTML(){return '<div class="shell"><aside class="sidebar"><div class="brand"><div class="brand-icon">🐾</div><div><strong>猫猫世界</strong><small>CATWORLD ONLINE</small></div></div><nav>'+[['/','🏠','主世界'],['/ft','⚔️','格斗场'],['/shoot','🎯','射击场']].map(([p,i,n])=>'<button data-act="navigate" data-page="'+p+'" class="'+(A.page===p?'active':'')+'">'+i+' <span>'+n+'</span></button>').join('')+'</nav><div class="connection-box"><span class="online-dot '+(A.connected?'':'off')+'"></span>'+(A.connected?'实时连接':'正在重连')+'<br><small>D1 云端存档 · <span id="ping">'+A.ping+' ms</span><br>账号版本 '+A.state.version+'</small></div></aside><main><header class="topbar"><div class="crumb">猫猫世界 / '+(A.page==='/'?'我的家园':sceneName(A.page))+'</div><div class="resources">'+resourceHTML()+'<span class="pill">🐱 '+esc(A.user.username)+'</span>'+B('⚙️','open','small',{modal:'settings'})+B('退出','logout','small')+'</div></header>'+(!A.connected?'<div class="connect-banner">网络连接中断，正在重新连接。已确认的账号操作保存在云端；对战断线宽限为 20 秒。</div>':'')+crossInvites()+pageContent()+'</main>'+social.rail()+'</div>'+(A.modal?modalHTML():'');}
function resourceHTML(){return [['coins','🪙'],['food','🍣'],['soap','🧼'],['medicine','💊']].map(([k,e])=>'<span class="pill">'+e+' <b>'+Number(A.state.resources[k]||0).toLocaleString()+'</b></span>').join('');}
function crossInvites(){return [...A.rooms.values()].filter(r=>r.status==='INVITED'&&r.members[1].id===A.user.id&&A.page!=='/'+r.mode).map(r=>'<div class="connect-banner actions">📨 '+esc(r.members[0].username)+' 发来'+modeName(r.mode)+'挑战 '+B('查看挑战','navigate','small',{page:'/'+r.mode})+'</div>').join('');}
function section(title,sub='',action=''){return '<div class="section"><div><h2>'+title+'</h2>'+(sub?'<p>'+sub+'</p>':'')+'</div>'+action+'</div>';}
function canvasHTML(kind){return '<div class="card canvas-wrap"><div class="canvas-top"><strong id="sceneLabel">'+(kind==='hall'?'猫猫大厅 · 共享随机地图':kind==='battle'?'竞技场 · '+modeName(currentMode()):esc(A.home?.owner.username||A.user.username)+'的家')+'</strong><small>点击移动 / WASD · 同场景玩家实时可见</small></div><canvas id="gameCanvas" width="960" height="540" tabindex="0" aria-label="'+(kind==='battle'?'实时战斗场景':'实时家园场景')+'" data-kind="'+kind+'"></canvas>'+(kind==='world'?worldTools():kind==='hall'?'':hudHTML(activeRoom()))+controls(kind)+'<div class="canvas-help">'+(kind==='world'?'WASD / 方向键或点击地面移动。走近玩家后点击头像打招呼。摆放模式下拖动家具。':currentMode()==='ft'?'WASD 移动 · 鼠标指向 · J / 鼠标左键爪击 · K 技能 · L 格挡':'WASD 移动 · 鼠标瞄准 / 按住开火 · R 换弹 · 空格护盾。移动端在画面上拖动瞄准。')+'</div></div>';}
function controls(kind){return '<div class="controls"><div class="dpad"><span></span><button class="btn" data-control="up" aria-label="向上">↑</button><span></span><button class="btn" data-control="left" aria-label="向左">←</button><button class="btn" data-control="down" aria-label="向下">↓</button><button class="btn" data-control="right" aria-label="向右">→</button></div>'+(kind!=='world'?'<div class="actions"><button class="btn primary control-button" data-control="fire">'+(currentMode()==='ft'?'🐾 爪击':'🎯 开火')+'</button><button class="btn control-button" data-control="'+(currentMode()==='ft'?'skill':'reload')+'">'+(currentMode()==='ft'?'✨ 技能':'🔄 换弹')+'</button><button class="btn control-button" data-control="block">🛡️ 格挡</button></div>':'<small class="muted">👋 点击附近玩家互动</small>')+'</div>';}
function worldTools(){const own=A.home?.owner.id===A.user.id;if(!A.edit||!own)return '';const available=ITEMS.filter(i=>i.kind==='furniture'&&A.state.inventory[i.id]);return '<div class="furniture-tools"><span class="muted">选家具后点击地面摆放：</span>'+available.map(i=>B(i.emoji+' '+i.name,'place-mode',A.placing===i.id?'small primary':'small',{id:i.id})).join('')+B('拖动模式','place-mode','small',{id:''})+'</div>';}
function worldHTML(){const own=!A.visiting||A.visiting===A.user.id;return '<section class="hero"><div class="eyebrow">A LITTLE HOME. A SHARED WORLD.</div><h1>欢迎回家，'+esc(A.user.username)+'。<br>和猫猫一起，把世界变得热闹。</h1><p>喂食、洗澡、布置家园；带上你的伙伴参加实时格斗和射击对战。每次照顾、每次收获都跟着账号一起旅行。</p><div class="actions">'+B('⚔️ 进入格斗大厅','navigate','primary',{page:'/ft'})+B('🎯 进入射击大厅','navigate','',{page:'/shoot'})+B('🛍️ 商店 / 领养','open','',{modal:'shop'})+'</div></section><div class="grid three stats"><div class="card stat"><small>猫猫伙伴</small><strong>'+ownedCats().length+' / '+CATS.length+'</strong></div><div class="card stat"><small>竞技胜场</small><strong>'+A.state.achievements.wins+'</strong></div><div class="card stat"><small>此刻在线</small><strong id="onlineCount">'+A.players.length+'</strong></div></div>'+section(own?'我的家园':'正在拜访 · '+esc(A.home?.owner.username||'玩家'),own?'买家具、摆家具，让伙伴有个温暖的家。':'这里显示对方真实保存的家具和当前到访玩家。',own?B(A.edit?'✅ 完成布置':'🪑 布置家园','edit','small'):B('🏠 回我家','navigate','small',{page:'/'}))+'<div class="world-layout">'+canvasHTML('world')+'<div class="card stack"><div class="panel-title"><h3>在线玩家</h3><p>一键前往对方当前场景。</p></div><div id="players" class="stack">'+playersHTML()+'</div></div></div>'+section('我的猫猫','照顾状态、背包和金币都保存在同一份账号存档中。',B('📖 图鉴与成就','open','small',{modal:'codex'}))+'<div class="grid two">'+ownedCats().map(catCard).join('')+'</div>';}
function catCard(c){const meters=[['hp','生命',''],['happy','心情','p'],['clean','清洁','o']].map(([k,n,style])=>'<div class="meter"><span>'+n+'</span><div class="bar '+style+'"><span style="width:'+clamp(c[k],0,100)+'%"></span></div><b>'+c[k]+'</b></div>').join('');const healthy=c.hp>=70,level=Math.max(1,Math.min(CAT_MAX_LEVEL,Number(c.level)||1)),xp=Math.max(0,Number(c.xp)||0),need=level*CAT_XP_PER_LEVEL;return '<div class="card '+(A.state.selectedCat===c.id?'selected':'')+'"><div class="cat-top"><div class="emoji">'+c.emoji+'</div><div><h3>'+esc(c.name)+'</h3><small>'+esc(c.breed)+' · Lv.'+level+' · '+(healthy?'健康':'需要治疗')+'</small></div></div><div class="meters">'+meters+'</div><div class="cat-income"><strong>🪙 '+(healthy?catIncomePerMinute(level):0)+' 金币 / 分钟</strong><span>'+ (healthy?'健康产出中，离线最多累计 12 小时':'生命值达到 70 后开始产出')+'</span><div class="bar"><span style="width:'+clamp(xp/need*100,0,100)+'%"></span></div><small>经验 '+xp+' / '+need+(level>=CAT_MAX_LEVEL?' · 满级':'')+'</small></div><div class="actions">'+B('🍣 喂食','care','small',{cat:c.id,item:'food'})+B('🧼 洗澡','care','small',{cat:c.id,item:'soap'})+B('💊 治疗','care','small',{cat:c.id,item:'medicine'})+B('🐾 出战','select-cat','small',{cat:c.id})+'</div></div>';}
function playersHTML(mode){const players=A.players.filter(p=>p.id!==A.user.id);if(!players.length)return '<div class="empty">现在还没有其他玩家在线。<br>邀请朋友注册加入，或在竞技大厅先与 PC 练习。</div>';return players.map(p=>'<div class="player-row"><span class="avatar">🐱</span><div class="player-info"><strong>'+esc(p.username)+'</strong><small><span class="online-dot"></span>'+sceneName(p.scene)+'</small></div><div class="player-actions">'+(mode?B('挑战','challenge','primary small',{mode,id:p.id}):B('拜访','visit','small',{id:p.id}))+'</div></div>').join('');}
function refreshPlayers(){const el=$('#players');if(el)el.innerHTML=playersHTML(A.page==='/'?null:currentMode());const count=$('#onlineCount');if(count)count.textContent=A.players.length;}
function loadoutPanel(){const s=A.state;return '<div class="stack"><div class="card"><h3>我的出战配置</h3><p>猫、武器、防具可点选。准备后锁定本局配置。</p><div class="loadout-grid">'+[['cat','🐱','猫猫',selected().name],['equipment',item(s.loadout.weapon).emoji,'武器',item(s.loadout.weapon).name],['equipment',item(s.loadout.armor).emoji,'防具',item(s.loadout.armor).name],['opponent','🆚','对手','在线玩家']].map(([tab,emoji,label,name])=>'<button class="loadout-tile" data-act="loadout" data-tab="'+tab+'"><small>'+label+'</small><span>'+emoji+'</span><strong>'+esc(name)+'</strong></button>').join('')+'</div>'+B('🐱 出战配置','loadout','primary full',{tab:'cat'})+'</div><div class="card"><h3>竞技规则</h3><ul class="rules"><li>双方各自接受、选好猫和装备后准备。</li><li>击败玩家获得 70–100 金币和一件物品；PC 奖励减半。</li><li>落败扣最多 40 金币，出战猫生命 −12，装备耐久 −8。</li><li>退出战斗视为认输；断线有 20 秒重连宽限。</li></ul>'+B('🛒 补给与修理','open','small',{modal:'shop'})+'</div></div>';}
function draft(r){return A.pickDraft[r.id]||{...A.state.loadout};}
function pickSelectors(r){const p=draft(r);return '<div class="pick-selects">'+[['catId','🐱 猫',ownedCats().map(c=>({id:c.id,name:c.name}))],['weapon','🎒 武器',ITEMS.filter(i=>i.kind==='weapon'&&A.state.inventory[i.id])],['armor','🛡️ 防具',ITEMS.filter(i=>i.kind==='armor'&&A.state.inventory[i.id])]].map(([key,label,options])=>'<label>'+label+'<select data-pick-room="'+r.id+'" data-key="'+key+'">'+options.map(i=>'<option value="'+i.id+'"'+(p[key]===i.id?' selected':'')+'>'+i.name+'</option>').join('')+'</select></label>').join('')+'</div>';}
function arenaHTML(mode){const r=activeRoom(mode);if(r?.status==='BATTLE')return battleHTML(r);if(r?.status==='FINISHED')return resultHTML(r);let invitation='';if(r?.status==='INVITED'){const received=r.members[1].id===A.user.id;invitation='<div class="card invite"><h3>'+(received?'📨 '+esc(opponent(r).username)+' 向你发起挑战':'📨 已向 '+esc(opponent(r).username)+' 发出挑战')+'</h3><p>INVITED · 120 秒内接受。'+(received?'在卡片中选好猫与装备，再接受挑战。':'等待对方在大厅接受。')+'</p>'+(received?pickSelectors(r):'')+'<div class="actions">'+(received?B('✅ 接受并选择','accept','green',{id:r.id}):'')+B(received?'拒绝':'取消邀请','leave','small',{id:r.id})+'</div></div>';}return '<div class="title"><div><h1>'+modeName(mode)+'大厅</h1><p>先配置，再准备，最后进入同一场真实对战。</p></div>'+B('🏠 回主世界','navigate','small',{page:'/'})+'</div><div class="stack">'+invitation+'<div class="lobby-layout"><div>'+ (r?.status==='PICKS'?picksHTML(r):'<section class="hero"><div class="eyebrow">'+(mode==='ft'?'FIGHTING ARENA':'SHOOTING RANGE')+' · MULTIPLAYER</div><h1>'+(mode==='ft'?'带上猫猫，<br>来一场精彩的格斗。':'瞄准、移动、开火。<br>和伙伴较量一下。')+'</h1><p>'+(mode==='ft'?'自由走位、近身爪击、技能和格挡。':'每局随机生成 3840×2160 大地图，跟随镜头、小地图、掩体与实时弹道。')+'玩家输入由服务端处理，所有人看到同一场战斗。</p><div class="actions">'+B('🐱 出战配置','loadout','primary',{tab:'cat'})+B('🎮 单机打 PC','pc','',{mode})+'</div></section>')+section('在线玩家 · 点击挑战','这里只列出真实连接的账号。')+'<div id="players" class="stack">'+playersHTML(mode)+'</div></div>'+loadoutPanel()+'</div></div>';}
function picksHTML(r){return '<div class="card"><div class="eyebrow">PICKS · '+r.id.slice(0,8)+'</div><h2>双方选择出战配置</h2><div class="grid two">'+r.members.map(m=>{const me=m.id===A.user.id,p=r.picks[m.id];return '<div class="ready-player"><strong>'+esc(m.username)+(me?' · 你':'')+'</strong><div class="big">'+cat(p?.catId).emoji+'</div><p>'+(p?cat(p.catId).name+' · '+item(p.weapon).name+' · '+item(p.armor).name:'等待选择配置')+'</p>'+(r.ready[m.id]?'<span class="ready-label">✅ 已准备</span>':me?pickSelectors(r)+B('✅ 准备好了','ready','green',{id:r.id}):'<span class="muted">等待对手准备</span>')+'</div>';}).join('')+'</div><p>双方准备后由服务端生成共享 seed，自动进入战斗。</p>'+B('🏠 离开房间','leave','small',{id:r.id})+'</div>';}
function hudHTML(r){if(!r?.game)return '';return '<div class="hud">'+r.game.players.map((p,i)=>'<div class="fighter-hud '+(i?'right-hud':'')+'"><strong>'+p.emoji+' '+esc(p.name)+'</strong><div class="bar"><span id="hpbar-'+i+'" style="width:'+p.hp/p.maxHp*100+'%"></span></div><small id="hptext-'+i+'">'+p.hp+' / '+p.maxHp+' HP</small></div>').join('')+'</div>';}
function battleHTML(r){return '<div class="title"><div><h1>'+modeName(r.mode)+' · 对战中</h1><p>实时走位，服务端结算。断线自动尝试重连。</p></div><div class="actions">'+B('🏠 回大厅','leave','danger',{id:r.id})+'</div></div><div class="battle-info"><span>🟢 20 Hz · <span id="battleTime">'+Math.floor(r.game.tick/20)+' 秒</span></span><span>共享种子 '+r.seed+'</span></div>'+canvasHTML('battle');}
function updateHud(r){r.game.players.forEach((p,i)=>{const bar=$('#hpbar-'+i),text=$('#hptext-'+i);if(bar)bar.style.width=p.hp/p.maxHp*100+'%';if(text)text.textContent=p.hp+' / '+p.maxHp+' HP · '+(r.mode==='shoot'?'弹药 '+p.ammo+'/8'+(p.reloadTime>0?' · 换弹中':''):'能量 '+Math.floor(p.energy));});const time=$('#battleTime');if(time)time.textContent=Math.floor(r.game.tick/20)+' 秒';}
function resultHTML(r){const win=r.result?.winnerId===A.user.id,draw=!r.result?.winnerId,reward=r.result?.rewards?.[A.user.id];return '<div class="card result"><div class="big">'+(draw?'🤝':win?'🏆':'💫')+'</div><div class="eyebrow">MATCH COMPLETE · '+modeName(r.mode)+'</div><h2>'+(draw?'势均力敌，平局！':win?'赢得漂亮，猫猫！':'这次惜败，再接再厉。')+'</h2><p>奖励和损耗已由服务端写入账号。<br>'+(r.result?.reason==='disconnect'?'对手或本方断线超时。':r.result?.reason==='forfeit'?'本场通过认输结束。':'')+'</p><div class="rewards">'+(reward?'<span class="pill">🪙 '+(reward.coins>=0?'+':'')+reward.coins+' 金币</span>'+Object.entries(reward.items).map(([id,n])=>'<span class="pill">'+(item(id)?.emoji||'✨')+' '+(item(id)?.name||'星尘')+' +'+n+'</span>').join('')+(reward.hp?'<span class="pill">生命 '+reward.hp+' · 耐久 '+reward.durability+'</span>':''):'')+'</div><div class="actions">'+B('🏠 回大厅','ack','primary',{id:r.id})+B('回主世界','ack-home','',{id:r.id})+'</div></div>';}
function modalHTML(){
 const m=A.modal,titles={loadout:'出战配置',shop:'猫猫集市',codex:'图鉴与成就',settings:'账号与猫娘 API 配置'};let content='';
 if(m.type==='loadout'){
  const tab=m.tab||'cat';content='<div class="tabs">'+[['cat','🐱 选猫'],['equipment','🎒 选装备'],['opponent','🆚 选对手']].map(([id,label])=>B(label,'loadout',tab===id?'active':'',{tab:id})).join('')+'</div>';
  if(tab==='cat')content+='<div class="grid two">'+ownedCats().map(c=>'<div class="card '+(A.state.selectedCat===c.id?'selected':'')+'"><div class="emoji">'+c.emoji+'</div><h3>'+c.name+'</h3><p>战斗生命 '+cat(c.id).hp+' · 移速 '+cat(c.id).speed+'</p>'+B(A.state.selectedCat===c.id?'已选择':'选择这只猫','select-cat','small',{cat:c.id})+'</div>').join('')+'</div>';
  if(tab==='equipment')content+='<div class="grid two">'+ITEMS.filter(i=>['weapon','armor'].includes(i.kind)&&A.state.inventory[i.id]).map(i=>'<div class="card '+(A.state.loadout[i.kind]===i.id?'selected':'')+'"><div class="emoji">'+i.emoji+'</div><h3>'+i.name+'</h3><p>'+(i.kind==='weapon'?'伤害 '+i.damage:'减伤 '+Math.round(i.defense*100)+'%')+' · 耐久 '+(A.state.durability[i.id]??100)+'</p>'+B(A.state.loadout[i.kind]===i.id?'已装备':'装备','select-item','small',{id:i.id})+'</div>').join('')+'</div>';
  if(tab==='opponent')content+='<div class="stack">'+playersHTML(currentMode())+'</div>';
  content+='<div class="modal-footer">所选配置会保存到账号。已经点准备的对局保持本局锁定配置。</div>';
 }
 if(m.type==='shop'){
  content='<p class="muted">🪙 '+A.state.resources.coins+' 金币 · ✨ '+(A.state.resources.stardust||0)+' 星尘</p>'+section('领养新伙伴')+'<div class="grid two">'+CATS.filter(c=>!ownedCats().some(o=>o.id===c.id)).map(c=>'<div class="card"><div class="emoji">'+c.emoji+'</div><h3>'+c.name+' · '+c.breed+'</h3><p><span class="shop-price">'+c.price+' 金币</span></p>'+B('领养','adopt','small',{id:c.id})+'</div>').join('')+'</div>'+section('补给、家具与装备')+'<div class="grid three">'+ITEMS.filter(i=>i.price>0).map(i=>'<div class="card"><div class="emoji">'+i.emoji+'</div><h3>'+i.name+'</h3><p>'+i.price+' 金币 · 已有 '+(i.kind==='supply'?A.state.resources[i.id]:A.state.inventory[i.id]||0)+'</p>'+B('购买 ×1','buy','small',{id:i.id})+'</div>').join('')+'</div>'+section('修理装备 · 每件 20 金币')+'<div class="stack">'+ITEMS.filter(i=>['weapon','armor'].includes(i.kind)&&A.state.inventory[i.id]).map(i=>'<div class="player-row"><span>'+i.emoji+' '+i.name+' · 耐久 '+A.state.durability[i.id]+'</span>'+B('修理','repair','small',{id:i.id})+'</div>').join('')+'</div>';
 }
 if(m.type==='codex'){
  content='<div class="eyebrow">COLLECTION · '+ownedCats().length+' / '+CATS.length+'</div>'+section('猫咪图鉴')+'<div class="grid two">'+CATS.map(c=>{const has=ownedCats().some(x=>x.id===c.id);return '<div class="card '+(has?'':'locked')+'"><div class="emoji">'+(has?c.emoji:'❔')+'</div><h3>'+c.name+'</h3><p>'+c.breed+' · '+(has?'已解锁':'可在集市领养')+'</p></div>';}).join('')+'</div>'+section('成就')+'<div class="stack">'+[['🏆 首次胜利',A.state.achievements.firstWin?'已解锁':'赢得一场对战'],['🐱 猫咪收藏家',A.state.achievements.collector?'已解锁':ownedCats().length+' / 3 只猫'],['🧼 温柔照顾',A.state.achievements.care+' 次照顾'],['👋 串门伙伴',A.state.achievements.visits+' 个不同家园'],['🎒 家具与装备',(A.state.codex.items||[]).length+' 种已发现']].map(([name,text])=>'<div class="card"><strong>'+name+'</strong><p>'+text+'</p></div>').join('')+'</div>';
 }
 if(m.type==='settings'){content='<p class="muted">账号：'+esc(A.user.username)+' · 存档版本 '+A.state.version+'</p><form id="settingsForm"><label>猫娘 API 地址（HTTPS）<input name="baseUrl" type="url" value="'+esc(A.state.apiConfig.baseUrl)+'" required></label><label>模型名称<input name="model" value="'+esc(A.state.apiConfig.model)+'" maxlength="100"></label><label>API Key<input name="apiKey" type="password" autocomplete="off" placeholder="'+(A.state.apiConfig.hasKey?'已设置，留空保持原密钥':'尚未设置')+'"></label><label><span><input name="clearKey" type="checkbox"> 清除已保存的密钥</span></label><div class="field-help">配置属于个人账号。密钥在服务端加密保存，不会返回浏览器或其他玩家。保存配置本身不会调用 API。前往右侧「与猫娘对话」，确认同意后发送消息才会调用服务。</div><button type="submit" class="btn primary">保存配置</button></form>';}
 return '<div class="modal-backdrop" data-act="dismiss"><section class="modal" role="dialog" aria-modal="true" aria-label="'+titles[m.type]+'"><div class="modal-head"><h2>'+titles[m.type]+'</h2>'+B('×','dismiss','small')+'</div>'+content+'</section></div>';
}
async function handleAction(button){
 const d=button.dataset,action=d.act;
 if(await social.action(d))return;
 if(action==='auth'){A.auth=d.mode;render();return;}
 if(action==='navigate'){A.modal=null;navigate(d.page);return;}
 if(action==='logout'){await api('/api/auth/logout','POST',{});A.user=null;A.state=null;A.hall=null;social.reset();A.ws?.close();clearTimeout(A.reconnect);render();return;}
 if(action==='open'){A.modal={type:d.modal};render();return;}
 if(action==='loadout'){A.modal={type:'loadout',tab:d.tab||'cat'};render();return;}
 if(action==='dismiss'){A.modal=null;render();return;}
 if(action==='care'){await command({type:'care',item:d.item,catId:d.cat});toast('猫猫状态已保存');return;}
 if(action==='buy'){await command({type:'buy',itemId:d.id,quantity:1});toast('购买成功，已放入背包');return;}
 if(action==='adopt'){await command({type:'adopt',catId:d.id});toast('新伙伴已经来到家里！');return;}
 if(action==='repair'){await command({type:'repair',itemId:d.id});toast('装备已修复');return;}
 if(action==='select-cat'){await command({type:'loadout',pick:{...A.state.loadout,catId:d.cat}});toast('出战猫已切换');return;}
 if(action==='select-item'){const i=item(d.id);await command({type:'loadout',pick:{...A.state.loadout,[i.kind]:i.id}});toast('装备已切换');return;}
 if(action==='edit'){A.edit=!A.edit;A.placing=null;render();return;}
 if(action==='place-mode'){A.placing=d.id||null;render();return;}
 if(action==='visit'){const p=A.players.find(p=>p.id===d.id);if(!p)throw Error('对方已离线');A.modal=null;if(p.scene.startsWith('home:'))navigate('/',p.scene.slice(5));else navigate(p.scene);return;}
 if(action==='challenge'||action==='pc'){
  A.modal=null;const mode=d.mode||currentMode();if(A.page!=='/'+mode)navigate('/'+mode);
  const out=await api('/api/rooms','POST',{mode,opponentId:d.id,pc:action==='pc',pick:A.state.loadout});A.rooms.set(out.room.id,out.room);render();return;
 }
 if(action==='accept'){const r=A.rooms.get(d.id);await roomPost(d.id,'accept',{pick:draft(r)});return;}
 if(action==='ready'){const r=A.rooms.get(d.id);await roomPost(d.id,'ready',{pick:draft(r)});A.keys={};A.touch={};return;}
 if(action==='leave'){A.pointer.down=false;A.keys={};A.touch={};await roomPost(d.id,'leave');return;}
 if(action==='ack'||action==='ack-home'){await roomPost(d.id,'ack');if(action==='ack-home')navigate('/');return;}
}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-act]');if(!button)return;
 if(button.dataset.act==='dismiss'&&button.classList.contains('modal-backdrop')&&event.target!==button)return;
 event.preventDefault();if(button.disabled)return;button.disabled=true;
 try{await handleAction(button);}catch(e){toast(e.message);}finally{button.disabled=false;}
});
document.addEventListener('change',event=>{const el=event.target;if(el.dataset.pickRoom){const r=A.rooms.get(el.dataset.pickRoom);A.pickDraft[r.id]={...draft(r),[el.dataset.key]:el.value};}});
document.addEventListener('submit',async event=>{
 if(!['authForm','settingsForm'].includes(event.target.id))return;event.preventDefault();const form=event.target,data=Object.fromEntries(new FormData(form)),submit=form.querySelector('button[type=submit]');submit.disabled=true;
 try{
  if(form.id==='authForm'){const out=await api('/api/auth/'+A.auth,'POST',data);A.user=out.user;applyState(out.state);render();connect();}
  else{data.clearKey=data.clearKey==='on';await command({type:'settings',...data});A.modal=null;render();toast('API 配置已加密保存');}
 }catch(e){const error=$('#authError');if(error)error.textContent=e.message;else toast(e.message);}finally{submit.disabled=false;}
});
window.addEventListener('popstate',()=>{A.page=validPage(location.pathname);A.visiting=new URLSearchParams(location.search).get('home');A.modal=null;A.edit=false;joinScene();render();social.navigate();});
window.addEventListener('keydown',event=>{if(event.target.closest('input,select,textarea'))return;if(event.code==='Escape'){A.modal=null;render();}A.keys[event.code]=true;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))event.preventDefault();});
window.addEventListener('keyup',event=>{delete A.keys[event.code];});
window.addEventListener('blur',()=>{A.keys={};A.touch={};A.pointer.down=false;});
function point(event,canvas){const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*WIDTH/rect.width,y:(event.clientY-rect.top)*HEIGHT/rect.height};}
document.addEventListener('pointerdown',event=>{
 const control=event.target.closest('[data-control]');if(control){event.preventDefault();A.touch[control.dataset.control]=true;try{control.setPointerCapture(event.pointerId);}catch{}return;}
 const canvas=event.target.closest('#gameCanvas');if(!canvas)return;canvas.focus();const p=point(event,canvas);A.pointer={...p,down:true};
 if(canvas.dataset.kind==='hall'){
  const map=A.hall?.map||{width:WIDTH,height:HEIGHT},cam=cameraFor(A.hall?.players.find(q=>q.id===A.user.id),map);
  const hit=A.hall?.players.filter(q=>q.id!==A.user.id&&Math.hypot(q.x-(p.x+cam.x),q.y-(p.y+cam.y))<35).sort((a,b)=>Math.hypot(a.x-p.x-cam.x,a.y-p.y-cam.y)-Math.hypot(b.x-p.x-cam.x,b.y-p.y-cam.y))[0];
  A.target=hit?{x:hit.x,y:hit.y,playerId:hit.id}:{x:p.x+cam.x,y:p.y+cam.y};
 }
 if(canvas.dataset.kind==='world'){
  if(A.edit&&A.home?.owner.id===A.user.id){
   if(A.placing){command({type:'place',itemId:A.placing,x:p.x,y:p.y}).catch(e=>toast(e.message));return;}
   A.drag=A.home.furniture.find(f=>Math.hypot(f.x-p.x,f.y-p.y)<48);return;
  }
  const player=A.players.find(q=>q.id!==A.user.id&&q.scene===A.scene&&Math.hypot(q.x-p.x,q.y-p.y)<35);
  A.target={...p,playerId:player?.id};
 }
});
document.addEventListener('pointermove',event=>{const canvas=$('#gameCanvas');if(!canvas||!event.target.closest('#gameCanvas'))return;const p=point(event,canvas);A.pointer={...A.pointer,...p};if(A.drag){A.drag.x=clamp(p.x,35,925);A.drag.y=clamp(p.y,35,505);}});
function release(){A.pointer.down=false;A.touch={};if(A.drag){const f=A.drag;A.drag=null;command({type:'place',uid:f.uid,itemId:f.itemId,x:f.x,y:f.y}).catch(e=>toast(e.message));}}
document.addEventListener('pointerup',release);document.addEventListener('pointercancel',release);
function input(){
 let dx=(A.keys.KeyD||A.keys.ArrowRight||A.touch.right?1:0)-(A.keys.KeyA||A.keys.ArrowLeft||A.touch.left?1:0);
 let dy=(A.keys.KeyS||A.keys.ArrowDown||A.touch.down?1:0)-(A.keys.KeyW||A.keys.ArrowUp||A.touch.up?1:0);
 const r=['/ft','/shoot'].includes(A.page)?activeRoom():null,p=(A.page==='/hall'?A.hall?.players.find(p=>p.id===A.user?.id):r?.game?.players.find(p=>p.id===A.user?.id))||A.players.find(p=>p.id===A.user?.id)||{x:480,y:270};
 if((A.page==='/'||A.page==='/hall')&&A.target&&!dx&&!dy){const x=A.target.x-p.x,y=A.target.y-p.y,dist=Math.hypot(x,y),arrival=A.target.playerId?38:12;if(dist<arrival){if(A.target.playerId)wsSend({type:'interact',targetId:A.target.playerId});A.target=null;}else{dx=x/dist;dy=y/dist;}}else if(dx||dy)A.target=null;
 if(A.modal||A.edit||document.activeElement?.matches('input,select,textarea'))return cleanInput({});
 const map=A.page==='/hall'?A.hall?.map:r?.mode==='shoot'?r.game:null,cam=map?cameraFor(p,map):{x:0,y:0};
 return cleanInput({dx,dy,aim:Math.atan2(A.pointer.y+cam.y-p.y,A.pointer.x+cam.x-p.x),fire:!!(A.keys.KeyJ||A.pointer.down&&A.page!=='/'||A.touch.fire),skill:!!(A.keys.KeyK||A.touch.skill),block:!!(A.keys.KeyL||A.keys.Space||A.touch.block),reload:!!(A.keys.KeyR||A.touch.reload)});
}
setInterval(()=>{if(!A.connected||!A.user)return;const i=input(),r=['/ft','/shoot'].includes(A.page)?activeRoom():null;if(A.page==='/hall'&&A.scene==='/hall')wsSend({type:'hall-input',...i});else if(r?.status==='BATTLE')wsSend({type:'input',roomId:r.id,...i});else if(A.page==='/'&&(i.dx||i.dy))wsSend({type:'move',dx:i.dx,dy:i.dy});},50);
setInterval(()=>{if(A.connected)wsSend({type:'ping',time:Date.now()});},10000);
setInterval(async()=>{if(!A.user)return;try{const me=await api('/api/me');applyState(me.state);if(A.page==='/'&&!A.modal)render();}catch{}},30000);
setInterval(()=>{if(A.user&&pending().length)flushPending();},5000);
function round(ctx,x,y,w,h,r=12){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function catDrawing(ctx,x,y,color,me,aim=0,guard=false){
 ctx.save();ctx.translate(x,y);ctx.fillStyle='#070b1844';ctx.beginPath();ctx.ellipse(0,22,25,9,0,0,Math.PI*2);ctx.fill();
 if(guard){ctx.strokeStyle='#80e5f7';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,34,0,Math.PI*2);ctx.stroke();}
 ctx.fillStyle=color;ctx.strokeStyle=me?'#b8f4df':'#d7c2fa';ctx.lineWidth=2;
 ctx.beginPath();ctx.moveTo(-20,-10);ctx.lineTo(-22,-31);ctx.lineTo(-5,-21);ctx.lineTo(9,-21);ctx.lineTo(23,-31);ctx.lineTo(23,-8);ctx.bezierCurveTo(29,19,17,27,0,26);ctx.bezierCurveTo(-27,25,-28,9,-20,-10);ctx.fill();ctx.stroke();
 ctx.fillStyle='#ecabc5';ctx.beginPath();ctx.moveTo(-17,-13);ctx.lineTo(-18,-25);ctx.lineTo(-9,-19);ctx.fill();ctx.beginPath();ctx.moveTo(13,-18);ctx.lineTo(20,-25);ctx.lineTo(19,-12);ctx.fill();
 ctx.fillStyle='#1a1831';ctx.beginPath();ctx.ellipse(-9+Math.cos(aim)*2,0+Math.sin(aim),3,5,0,0,Math.PI*2);ctx.ellipse(9+Math.cos(aim)*2,0+Math.sin(aim),3,5,0,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#f2c3ce';ctx.beginPath();ctx.moveTo(-4,7);ctx.lineTo(4,7);ctx.lineTo(0,11);ctx.fill();ctx.strokeStyle='#31213f';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-15,8);ctx.lineTo(-26,5);ctx.moveTo(-14,12);ctx.lineTo(-26,13);ctx.moveTo(14,8);ctx.lineTo(27,5);ctx.moveTo(14,12);ctx.lineTo(27,13);ctx.stroke();
 ctx.restore();
}
function label(ctx,text,x,y,me=false){
 ctx.save();ctx.font='600 13px system-ui';const width=ctx.measureText(text).width+18;ctx.fillStyle='#080e24dd';round(ctx,x-width/2,y,width,25,8);ctx.fill();ctx.fillStyle=me?'#a1f1d4':'#e5e7fd';ctx.textAlign='center';ctx.fillText(text,x,y+17);ctx.restore();
}
function drawWorld(ctx){
 const g=ctx.createLinearGradient(0,0,960,540);g.addColorStop(0,'#363557');g.addColorStop(1,'#253e56');ctx.fillStyle=g;ctx.fillRect(0,0,960,540);
 ctx.strokeStyle='#b6bcda13';ctx.lineWidth=1;for(let x=0;x<960;x+=64){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,540);ctx.stroke();}for(let y=0;y<540;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(960,y);ctx.stroke();}
 ctx.fillStyle='#1a243e';round(ctx,52,30,854,92,18);ctx.fill();ctx.fillStyle='#8877ba';round(ctx,70,42,130,67,10);ctx.fill();ctx.fillStyle='#829fc1';round(ctx,77,49,116,53,5);ctx.fill();ctx.fillStyle='#fce6b5';ctx.beginPath();ctx.arc(101,68,12,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#222940';ctx.fillRect(133,49,5,53);ctx.fillStyle='#b7a2d936';ctx.beginPath();ctx.ellipse(480,335,165,94,-0.1,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#baa1dc55';ctx.lineWidth=3;ctx.stroke();
 ctx.fillStyle='#9babca';ctx.font='600 14px system-ui';ctx.textAlign='left';ctx.fillText('CATWORLD / '+(A.home?.owner.username||'家园'),230,73);ctx.font='12px system-ui';ctx.fillStyle='#7f91b3';ctx.fillText('一起在小小的家里，制造大大的快乐。',230,95);
 for(const f of A.home?.furniture||[]){
  const data=item(f.itemId);if(!data)continue;ctx.save();ctx.translate(f.x,f.y);ctx.fillStyle='#070a1738';ctx.beginPath();ctx.ellipse(0,29,40,11,0,0,Math.PI*2);ctx.fill();
  if(f.itemId==='sofa'){ctx.fillStyle='#66509b';round(ctx,-55,-16,110,49,12);ctx.fill();ctx.fillStyle='#9a7cc3';round(ctx,-49,-33,98,30,10);ctx.fill();ctx.fillStyle='#b69ada';round(ctx,-36,-12,32,23,6);ctx.fill();round(ctx,5,-12,32,23,6);ctx.fill();}
  else{ctx.font='53px Segoe UI Emoji,system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(data.emoji,0,0);}
  if(A.edit){ctx.strokeStyle='#caafe999';ctx.setLineDash([5,4]);ctx.strokeRect(-49,-45,98,86);ctx.setLineDash([]);}ctx.restore();
 }
 if(A.target){ctx.strokeStyle='#d6d6fc66';ctx.beginPath();ctx.arc(A.target.x,A.target.y,12,0,Math.PI*2);ctx.stroke();}
 const players=A.players.filter(p=>p.scene===A.scene).sort((a,b)=>a.y-b.y);
 for(const p of players){const me=p.id===A.user.id;catDrawing(ctx,p.x,p.y,me?'#d9c7ee':'#edc399',me);label(ctx,p.username+(me?' · 你':''),p.x,p.y+34,me);}
 if(!players.length){ctx.fillStyle='#aaaec9';ctx.font='16px system-ui';ctx.textAlign='center';ctx.fillText(A.connected?'正在进入家园…':'正在重连…',480,295);}
}
function drawBattle(ctx,r){
 const original=r.game;if(!original)return;let g=original;
 // Reuse the authoritative fixed-step engine for at most 100 ms of visual prediction.
 // HP, inventory and outcomes always come from server snapshots.
 const steps=Math.min(2,Math.floor((performance.now()-A.lastReceived)/50));
 if(steps>0&&A.connected){g=structuredClone(original);const inputs=Object.fromEntries(g.players.map(p=>[p.id,p.id===A.user.id?input():p.input]));for(let i=0;i<steps;i++)stepGame(g,inputs);}
 if(r.mode==='shoot'&&g.mapVersion){drawLarge(ctx,g,'shoot',original);return;}
 const grad=ctx.createLinearGradient(0,0,960,540);grad.addColorStop(0,r.mode==='ft'?'#302747':'#173440');grad.addColorStop(1,r.mode==='ft'?'#1d2544':'#20334f');ctx.fillStyle=grad;ctx.fillRect(0,0,960,540);
 ctx.strokeStyle='#adc2d71b';ctx.lineWidth=1;for(let x=0;x<960;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,540);ctx.stroke();}for(let y=0;y<540;y+=45){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(960,y);ctx.stroke();}
 ctx.strokeStyle='#9e8cd977';ctx.lineWidth=4;round(ctx,14,14,932,512,14);ctx.stroke();
 if(r.mode==='ft'){ctx.strokeStyle='#d4b4e322';ctx.lineWidth=3;ctx.beginPath();ctx.arc(480,270,185,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(480,270,95,0,Math.PI*2);ctx.stroke();}
 for(const b of g.cover){ctx.fillStyle='#10192f';round(ctx,b.x+4,b.y+9,b.w,b.h,10);ctx.fill();ctx.fillStyle='#43567b';round(ctx,b.x,b.y,b.w,b.h,9);ctx.fill();ctx.strokeStyle='#6d80a866';ctx.stroke();}
 for(const b of g.bullets){ctx.fillStyle=b.owner===A.user.id?'#96f2e0':'#ffb99d';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=11;ctx.beginPath();ctx.arc(b.x,b.y,5,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
 for(const e of original.events){const age=(original.tick-e.tick)*50;if(e.type==='swing'&&age<240){ctx.strokeStyle=e.skill?'#fae593aa':'#e9d8ff99';ctx.lineWidth=e.skill?9:5;ctx.beginPath();ctx.arc(e.x,e.y,e.skill?125:74,e.aim-0.85,e.aim+0.85);ctx.stroke();}}
 for(const p of g.players){
  const me=p.id===A.user.id;catDrawing(ctx,p.x,p.y,me?'#d9c7ee':'#efbd91',me,p.aim,p.guard);
  if(r.mode==='shoot'){ctx.strokeStyle=me?'#b8fff0':'#ffbea8';ctx.lineWidth=8;ctx.beginPath();ctx.moveTo(p.x+Math.cos(p.aim)*18,p.y+Math.sin(p.aim)*18);ctx.lineTo(p.x+Math.cos(p.aim)*40,p.y+Math.sin(p.aim)*40);ctx.stroke();}
  label(ctx,p.name+(me?' · 你':''),p.x,p.y+35,me);
 }
 for(const e of original.events){if(e.type==='hit'){const age=original.tick-e.tick;ctx.globalAlpha=Math.max(0,1-age/35);ctx.fillStyle=e.crit?'#fff0b1':'#ffbbca';ctx.font=(e.crit?'bold 24px':'bold 19px')+' system-ui';ctx.textAlign='center';ctx.fillText('-'+e.damage+(e.crit?'!':''),e.x,e.y-35-age*1.2);ctx.globalAlpha=1;}}
 ctx.fillStyle='#b7c1d3';ctx.font='600 11px system-ui';ctx.textAlign='left';ctx.fillText(r.mode==='ft'?'STARFALL RING · 实时格斗':'MOONLIGHT RANGE · 实时射击',35,38);
 ctx.fillStyle='#8f9fb9';ctx.font='11px system-ui';ctx.fillText('TICK '+original.tick+' / SHARED SEED '+r.seed,35,513);
}
const mapCache=new Map();
function drawLarge(ctx,g,kind,original=g){
 let map=kind==='hall'?g.map:mapCache.get(g.seed);
 if(!map){map=generateMap(g.seed,kind);mapCache.clear();mapCache.set(g.seed,map);}
 const me=original.players.find(p=>p.id===A.user.id),cam=cameraFor(me,map),colors=kind==='hall'?['#183e37','#203c4a','#303449']:['#172d39','#243249','#343145'];
 ctx.fillStyle=colors[map.theme];ctx.fillRect(0,0,WIDTH,HEIGHT);ctx.save();ctx.translate(-cam.x,-cam.y);
 ctx.fillStyle=kind==='hall'?'#6ba88b15':'#9aa9ce0e';ctx.fillRect(0,map.height/2-105,map.width,210);ctx.fillRect(map.width/2-105,0,210,map.height);
 ctx.strokeStyle='#b2d6d014';ctx.lineWidth=1;
 for(let x=Math.floor(cam.x/80)*80;x<cam.x+WIDTH;x+=80){ctx.beginPath();ctx.moveTo(x,cam.y);ctx.lineTo(x,cam.y+HEIGHT);ctx.stroke();}
 for(let y=Math.floor(cam.y/80)*80;y<cam.y+HEIGHT;y+=80){ctx.beginPath();ctx.moveTo(cam.x,y);ctx.lineTo(cam.x+WIDTH,y);ctx.stroke();}
 for(const d of map.decor){if(d.x<cam.x-20||d.x>cam.x+WIDTH+20||d.y<cam.y-20||d.y>cam.y+HEIGHT+20)continue;ctx.fillStyle=d.kind==='flower'?'#eab1d844':'#9ce1b933';ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,Math.PI*2);ctx.fill();}
 if(map.safe){ctx.fillStyle='#82efce19';ctx.strokeStyle='#82efce88';ctx.lineWidth=3;ctx.beginPath();ctx.arc(map.safe.x,map.safe.y,map.safe.r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.textAlign='center';ctx.fillStyle='#b4f4de';ctx.font='bold 16px system-ui';ctx.fillText('✦ 中央保护区 · 禁止打斗 ✦',map.safe.x,map.safe.y-110);}
 for(const b of map.cover){
  if(b.x+b.w<cam.x||b.x>cam.x+WIDTH||b.y+b.h<cam.y||b.y>cam.y+HEIGHT)continue;
  ctx.fillStyle='#06131d55';round(ctx,b.x+5,b.y+9,b.w,b.h,10);ctx.fill();ctx.fillStyle=b.kind==='rock'?'#526980':'#796580';round(ctx,b.x,b.y,b.w,b.h,10);ctx.fill();ctx.strokeStyle='#afc2d333';ctx.stroke();
  ctx.strokeStyle='#e4e0ee22';ctx.beginPath();ctx.moveTo(b.x+12,b.y+12);ctx.lineTo(b.x+b.w-12,b.y+b.h-12);ctx.stroke();
 }
 ctx.strokeStyle='#a899e9';ctx.lineWidth=5;ctx.strokeRect(12,12,map.width-24,map.height-24);
 for(const b of g.bullets||[]){ctx.fillStyle=b.owner===A.user.id?'#8df2e1':'#ffb5a5';ctx.beginPath();ctx.arc(b.x,b.y,5,0,Math.PI*2);ctx.fill();}
 for(const e of g.events||[]){
  const age=g.tick-e.tick;if(e.type==='swing'&&age<5){ctx.strokeStyle=e.skill?'#ffe294aa':'#f6d0ffa0';ctx.lineWidth=e.skill?9:5;ctx.beginPath();ctx.arc(e.x,e.y,e.skill?130:78,e.aim-.85,e.aim+.85);ctx.stroke();}
  if(e.type==='hit'){ctx.fillStyle='#ffc9ce';ctx.globalAlpha=Math.max(0,1-age/35);ctx.font='bold 19px system-ui';ctx.textAlign='center';ctx.fillText('-'+e.damage,e.x,e.y-40-age);ctx.globalAlpha=1;}
 }
 for(const p of [...g.players].sort((a,b)=>a.y-b.y)){
  if(p.x<cam.x-70||p.x>cam.x+WIDTH+70||p.y<cam.y-70||p.y>cam.y+HEIGHT+70)continue;
  if(p.hp<=0){label(ctx,'💫 '+p.name+' · 等待复活',p.x,p.y,p.id===A.user.id);continue;}
  const own=p.id===A.user.id;catDrawing(ctx,p.x,p.y,own?'#d9c7ee':'#efbd91',own,p.aim,p.guard||p.invulnerableUntil>g.tick);
  if(kind==='shoot'){ctx.strokeStyle=own?'#b8fff0':'#ffbea8';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(p.x+Math.cos(p.aim)*18,p.y+Math.sin(p.aim)*18);ctx.lineTo(p.x+Math.cos(p.aim)*38,p.y+Math.sin(p.aim)*38);ctx.stroke();}
  ctx.fillStyle='#152136';ctx.fillRect(p.x-25,p.y-43,50,5);ctx.fillStyle=own?'#91e5c7':'#e99cac';ctx.fillRect(p.x-25,p.y-43,50*p.hp/p.maxHp,5);
  label(ctx,p.name+(own?' · 你':''),p.x,p.y+33,own);
 }
 ctx.restore();
 // Always show navigation context, even when opponents are outside the camera.
 const mw=192,mh=mw*map.height/map.width,mx=WIDTH-mw-14,my=14,s=mw/map.width;
 ctx.fillStyle='#0b142be8';round(ctx,mx-5,my-5,mw+10,mh+10,10);ctx.fill();ctx.save();ctx.translate(mx,my);
 ctx.fillStyle='#74859c';for(const b of map.cover)ctx.fillRect(b.x*s,b.y*s,b.w*s,b.h*s);
 if(map.safe){ctx.fillStyle='#77d4ab55';ctx.beginPath();ctx.arc(map.safe.x*s,map.safe.y*s,map.safe.r*s,0,Math.PI*2);ctx.fill();}
 ctx.strokeStyle='#d5deff99';ctx.lineWidth=1;ctx.strokeRect(cam.x*s,cam.y*s,WIDTH*s,HEIGHT*s);
 for(const p of g.players){ctx.fillStyle=p.id===A.user.id?'#8cffd2':'#ffbfad';ctx.beginPath();ctx.arc(p.x*s,p.y*s,p.id===A.user.id?3.5:2.8,0,Math.PI*2);ctx.fill();}ctx.restore();
 ctx.fillStyle='#101b35df';round(ctx,14,HEIGHT-36,450,24,8);ctx.fill();ctx.fillStyle='#bfd1e7';ctx.font='11px system-ui';ctx.textAlign='left';ctx.fillText((kind==='hall'?'猫猫共享大厅':'月光射击场')+' · '+map.width+'×'+map.height+' · SEED '+g.seed+' · 右上角小地图',24,HEIGHT-20);
}
function animation(){const canvas=$('#gameCanvas');if(canvas&&A.user){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,WIDTH,HEIGHT);if(canvas.dataset.kind==='world')drawWorld(ctx);else if(canvas.dataset.kind==='hall'){if(A.hall)drawLarge(ctx,A.hall,'hall');}else{const r=activeRoom();if(r)drawBattle(ctx,r);}}requestAnimationFrame(animation);}
document.addEventListener('dblclick',event=>{const canvas=event.target.closest('#gameCanvas');if(!canvas||!A.edit||A.home?.owner.id!==A.user.id)return;const p=point(event,canvas);const f=A.home.furniture.find(f=>Math.hypot(f.x-p.x,f.y-p.y)<48);if(f)command({type:'unplace',uid:f.uid}).catch(e=>toast(e.message));});
async function boot(){try{const me=await api('/api/me');A.user=me.user;applyState(me.state);render();connect();}catch(e){render();if(e.status!==401)toast('无法连接服务器，请刷新重试');}}
const social=createSocial({A,api,B,esc,toast,render,wsSend,canvasHTML});
boot();requestAnimationFrame(animation);
