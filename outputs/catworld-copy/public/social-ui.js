export function createSocial({A,api,B,esc,toast,render,wsSend,canvasHTML}){
 const S={friends:[],requests:[],users:[],peer:null,messages:[],turns:[],search:'',dm:'',nyan:'',consent:false,busy:false,loading:false};
 const time=n=>new Date(n).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
 const back=()=>B('🏠 回主世界','navigate','small',{page:'/'});
 let friendTimer;
 async function refreshFriends(){if(!A.user)return;try{const d=await api('/api/friends');S.friends=d.friends;S.requests=d.requests;refreshBadges();if(A.page==='/friends')render();}catch(e){if(A.page==='/friends')toast(e.message);}}
 function scheduleFriends(){clearTimeout(friendTimer);friendTimer=setTimeout(refreshFriends,180);}
 function refreshBadges(){const el=document.querySelector('#socialBadge');if(el){const n=S.friends.reduce((v,f)=>v+f.unread,0)+S.requests.filter(r=>r.incoming).length;el.textContent=n?' '+n:'';}}
 async function loadMessages(before){
  if(!S.peer)return;const peer=S.peer,d=await api('/api/messages?peer='+encodeURIComponent(peer)+(before?'&before='+before:''));
  if(peer!==S.peer)return;S.messages=before?[...d.messages,...S.messages]:d.messages;S.hasMore=d.hasMore;render();if(!before)scrollChat();
  const seq=Math.max(0,...S.messages.filter(m=>m.recipient_id===A.user.id).map(m=>m.seq));
  if(seq)await api('/api/messages/read','POST',{peerId:peer,seq});
 }
 async function loadNyan(){try{const d=await api('/api/nyan');S.turns=d.turns;if(A.page==='/nyan'){render();scrollChat();}}catch(e){toast(e.message);}}
 function scrollChat(){const el=document.querySelector('#chatLog');if(el)el.scrollTop=el.scrollHeight;}
 function rail(){const n=S.friends.reduce((v,f)=>v+f.unread,0)+S.requests.filter(r=>r.incoming).length;return '<aside class="social-rail"><div class="eyebrow">TOGETHER</div><nav aria-label="社交菜单">'+[['/nyan','💬','与猫娘对话'],['/hall','🐾','猫猫大厅'],['/friends','👥','好友大厅']].map(([p,i,t])=>'<button data-act="navigate" data-page="'+p+'" class="'+(A.page===p?'active':'')+'"><span class="rail-icon">'+i+'</span><span>'+t+(p==='/friends'?'<b id="socialBadge" class="badge">'+(n?' '+n:'')+'</b>':'')+'</span></button>').join('')+'</nav><p>一个世界，<br>每一次相遇都真实。</p></aside>';}
 function friendActions(f){return '<div class="player-actions">'+B('私聊','friend-chat','small',{id:f.id})+B('⚔ 格斗','challenge','small',{id:f.id,mode:'ft'},!f.online)+B('🎯 射击','challenge','small',{id:f.id,mode:'shoot'},!f.online)+'</div>';}
 function friendsHTML(){
  const peer=S.friends.find(f=>f.id===S.peer);
  return '<div class="title"><div><h1>好友大厅</h1><p>申请、私聊和挑战；消息保存到云端，离线也不丢。</p></div>'+back()+'</div><div class="social-layout"><section class="card stack"><h3>寻找猫猫伙伴</h3><form id="friendSearch" class="inline-form social-form"><input id="friendQuery" data-draft="search" name="q" value="'+esc(S.search)+'" placeholder="用户名，至少 2 个字" minlength="2" maxlength="20" required><button class="btn primary" type="submit">搜索</button></form><div class="stack">'+S.users.map(u=>'<div class="player-row"><strong>'+esc(u.username)+'</strong>'+B('＋ 加好友','friend-request','small',{id:u.id})+'</div>').join('')+'</div><h3>好友申请</h3>'+(S.requests.length?S.requests.map(r=>'<div class="player-row"><div class="player-info"><strong>'+esc(r.username)+'</strong><small>'+(r.incoming?'请求成为你的好友':'已发送申请')+'</small></div>'+(r.incoming?B('接受','friend-accept','green small',{id:r.id}):'')+B(r.incoming?'拒绝':'撤回','friend-reject','small',{id:r.id})+'</div>').join(''):'<p>暂无好友申请。</p>')+'<h3>我的好友 · '+S.friends.length+'</h3>'+(S.friends.length?S.friends.map(f=>'<div class="card friend-card '+(S.peer===f.id?'selected':'')+'"><div class="player-row"><span class="avatar">🐱</span><div class="player-info"><strong>'+esc(f.username)+(f.unread?'<span class="badge"> '+f.unread+'</span>':'')+'</strong><small><span class="online-dot '+(f.online?'':'off')+'"></span>'+(f.online?'在线 · 可发起挑战':'离线 · 可留言')+'</small></div>'+B('移除','friend-remove','small',{id:f.id})+'</div>'+friendActions(f)+'</div>').join(''):'<div class="empty">搜索用户名发送申请，<br>或在猫猫大厅遇见新朋友。</div>')+'</section><section class="card chat-panel"><div class="chat-head"><h3>'+(peer?'与 '+esc(peer.username)+' 私聊':'好友私聊')+'</h3><small>仅你和好友可见 · 支持离线消息</small></div>'+(peer?'<div class="actions">'+B('⚔ 邀请格斗','challenge','small',{id:peer.id,mode:'ft'},!peer.online)+B('🎯 邀请射击','challenge','small',{id:peer.id,mode:'shoot'},!peer.online)+'</div>':'')+'<div id="chatLog" class="chat-log" role="log" aria-live="polite">'+(S.hasMore&&peer?B('加载更早消息','dm-older','small'):'')+(peer?S.messages.map(m=>bubble(m.content,m.sender_id===A.user.id,time(m.created_at))).join('')||'<div class="empty">打个招呼吧！</div>':'<div class="empty">选择一位好友开始聊天。</div>')+'</div>'+(peer?'<form id="dmForm" class="social-form"><textarea id="dmText" data-draft="dm" name="content" maxlength="2000" required placeholder="给好友留言…">'+esc(S.dm)+'</textarea><button type="submit" class="btn primary">发送消息</button></form>':'')+'</section></div>';
 }
 function bubble(content,me,sub){return '<article class="chat-bubble '+(me?'mine':'')+'"><div>'+esc(content)+'</div><small>'+esc(sub)+'</small></article>';}
 function nyanHTML(){return '<div class="title"><div><h1>与猫娘对话</h1><p>露娜陪你聊聊今天的猫猫生活。</p></div>'+back()+'</div><section class="card chat-panel nyan-panel"><div class="chat-head"><span class="nyan-avatar">🐱</span><div><h3>露娜 · AI 猫娘</h3><small>通过你配置的 API 真实回复，不模拟对话。</small></div>'+B('⚙ API 配置','open','small',{modal:'settings'})+'</div>'+(!A.state.apiConfig.hasKey||!A.state.apiConfig.model?'<div class="connect-banner">先在 API 配置中填写服务地址、模型与密钥。Cloudflare 部署 token 不是聊天 API 密钥。</div>':'')+'<div id="chatLog" class="chat-log" role="log" aria-live="polite">'+(S.turns.length?S.turns.map(t=>bubble(t.content,true,time(t.created_at))+(t.response?bubble(t.response,false,'露娜 · AI 回复'):t.status==='failed'?'<div class="chat-error">'+esc(t.error)+'</div>':'<div class="pending">露娜正在思考…</div>')).join(''):'<div class="empty">还没有对话。发送消息后，才会调用你的 API。</div>')+'</div><form id="nyanForm" class="social-form"><textarea id="nyanText" data-draft="nyan" name="content" maxlength="2000" required placeholder="想和露娜聊些什么？">'+esc(S.nyan)+'</textarea><label class="consent"><input id="nyanConsent" type="checkbox" data-draft="consent" '+(S.consent?'checked':'')+' required>同意将本次消息及最近对话发送至配置的 API 服务，费用由该服务按你的账号计费。</label><button class="btn primary" type="submit" '+(S.busy?'disabled':'')+'>'+(S.busy?'等待 API 回复…':'发送给露娜')+'</button></form><p class="field-help">聊天记录按账号保存在 D1；API 密钥只在服务端解密使用，不发送给其他玩家。AI 无法操作金币或背包。</p></section>';}
 function hallHTML(){
  const h=A.hall;
  return '<div class="title"><div><h1>猫猫大厅</h1><p>在同一张随机地图里相遇，离开中央保护区即可自由切磋。</p></div>'+back()+'</div><div class="battle-info"><span id="hallStats">连接共享地图中…</span><span>'+(h?'地图 '+h.map.width+' × '+h.map.height+' · 种子 '+h.seed:'服务端分配地图')+'</span></div><div class="world-layout">'+canvasHTML('hall')+'<section class="card stack"><h3>大厅里的猫猫</h3><div id="hallPlayers"></div><div class="field-help">只显示进入猫猫大厅的真实玩家。中央光圈内无法互相攻击，倒下后 5 秒复活，复活保护 3 秒。大厅属于免费切磋，不扣金币、不消耗装备耐久，也不刷奖励。地图在空场超过 6 小时后重新生成。</div></section></div>';
 }
 let roster='';
 function refreshHall(){
  const h=A.hall;if(!h)return;const p=h.players.find(p=>p.id===A.user?.id),stats=document.querySelector('#hallStats');
  if(stats)stats.textContent='在线 '+h.players.length+' · '+(p?(p.hp>0?'生命 '+Math.ceil(p.hp)+'/'+p.maxHp:'复活倒计时 '+Math.max(0,Math.ceil((p.respawnTick-h.tick)/20))):'进入中')+' · 击倒 '+(p?.kills||0)+' / 倒下 '+(p?.deaths||0);
  const el=document.querySelector('#hallPlayers'),signature=h.players.map(p=>p.id+':'+p.kills+':'+p.deaths).join(',');
  if(el&&(roster!==signature||!el.children.length)){roster=signature;el.innerHTML=h.players.map(p=>'<div class="player-row"><div class="player-info"><strong>'+esc(p.name)+(p.id===A.user.id?' · 你':'')+'</strong><small>击倒 '+p.kills+' / 倒下 '+p.deaths+'</small></div>'+(p.id!==A.user.id?'<div class="player-actions">'+B('👋','hall-wave','small',{id:p.id})+B('＋ 好友','friend-request','small',{id:p.id})+'</div>':'')+'</div>').join('');}
 }
 async function action(d){
  if(d.act==='friend-chat'){S.peer=d.id;S.messages=[];S.hasMore=false;render();await loadMessages();return true;}
  if(d.act==='dm-older'){await loadMessages(S.messages[0]?.seq);return true;}
  if(d.act.startsWith('friend-')){
   const kind=d.act.slice(7);if(kind==='remove'&&!confirm('移除好友后将无法继续私聊，确定吗？'))return true;
   const data=await api('/api/friends','POST',{action:kind,peerId:d.id});S.friends=data.friends;S.requests=data.requests;render();toast(kind==='request'?'好友申请已发送':'好友列表已更新');return true;
  }
  if(d.act==='hall-wave'){wsSend({type:'interact',targetId:d.id});return true;}
  return false;
 }
 async function submit(form){
  if(form.id==='friendSearch'){const d=await api('/api/friends/search?q='+encodeURIComponent(S.search));S.users=d.users;render();return;}
  if(form.id==='dmForm'){
   const content=S.dm.trim();if(!content)return;const peer=S.peer;
   const opId=S.dmOp?.content===content&&S.dmOp?.peer===peer?S.dmOp.id:crypto.randomUUID();S.dmOp={content,peer,id:opId};
   await api('/api/messages','POST',{peerId:peer,content,opId});S.dmOp=null;S.dm='';await loadMessages();return;
  }
  if(form.id==='nyanForm'){
   if(S.busy)return;const content=S.nyan.trim();if(!content)return;
   const opId=S.nyanOp?.content===content?S.nyanOp.id:crypto.randomUUID();S.nyanOp={content,id:opId};S.busy=true;render();
   try{await api('/api/nyan','POST',{content,opId,consent:S.consent});S.nyan='';S.nyanOp=null;await loadNyan();}finally{S.busy=false;render();scrollChat();}
  }
 }
 document.addEventListener('input',e=>{const key=e.target.dataset.draft;if(key)S[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;});
 document.addEventListener('submit',async e=>{
  if(!['friendSearch','dmForm','nyanForm'].includes(e.target.id))return;e.preventDefault();const form=e.target,b=form.querySelector('button[type=submit]');if(b?.disabled)return;if(b)b.disabled=true;
  try{await submit(form);}catch(err){toast(err.message);}finally{if(b)b.disabled=false;}
 });
 function receive(d){
  if(d.type==='hello'){refreshFriends();if(A.page==='/friends'&&S.peer)loadMessages().catch(e=>toast(e.message));if(A.page==='/nyan')loadNyan();}
  if(d.type==='social'||d.type==='presence')scheduleFriends();
  if(d.type==='nyan'&&A.page==='/nyan')loadNyan();
  if(d.type==='dm'){
   const m=d.message,peer=m.sender_id===A.user.id?m.recipient_id:m.sender_id;
   if(A.page==='/friends'&&S.peer===peer){if(!S.messages.some(x=>x.seq===m.seq))S.messages.push(m);S.messages.sort((a,b)=>a.seq-b.seq);render();scrollChat();if(m.recipient_id===A.user.id)api('/api/messages/read','POST',{peerId:peer,seq:m.seq}).catch(()=>{});}
   else if(m.recipient_id===A.user.id)toast('收到好友新消息');scheduleFriends();
  }
 }
 return {rail,html:page=>page==='/friends'?friendsHTML():page==='/nyan'?nyanHTML():hallHTML(),action,receive,refreshHall,
  navigate(){if(A.page==='/friends'){refreshFriends();if(S.peer)loadMessages().catch(e=>toast(e.message));}if(A.page==='/nyan')loadNyan();},
  reset(){Object.assign(S,{friends:[],requests:[],users:[],peer:null,messages:[],turns:[],search:'',dm:'',nyan:'',consent:false,busy:false});roster='';}};
}
