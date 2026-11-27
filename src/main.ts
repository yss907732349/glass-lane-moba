import './style.css';
import { bootArena } from './arena.ts';
import { hudMarkup } from './ui-hud.ts';
import { HERO_PRESENTATION, skillName, numericSkillDetails } from './hero-presentation.ts';
import { HEROES, HERO_IDS, skillForRank, canUpgradeSkill, ITEMS, RULES, WORLD, TERRAIN, SUMMONERS, xpForNextLevel } from './shared/data.ts';
import { createMatch, stepMatch, isUnitVisibleToTeam } from './shared/simulation.ts';
import type { Command, HeroKind, MatchState, Team, Unit } from './shared/types.ts';

type Layout={scale:number;opacity:number};
declare global { interface Window { desktop?:{ info:()=>Promise<{addresses:string[];localUrl?:string;defaultServerUrl?:string;diagnosticMode?:boolean;scale?:number;opacity?:number}>, pin:(v:boolean)=>void, opacity:(v:number)=>void,scale:(v:number)=>void,startResize:(x:number,y:number)=>void,resize:(x:number,y:number)=>void,endResize:()=>void,onLayout:(callback:(layout:Layout)=>void)=>void|(()=>void), hide:()=>void, close:()=>void, passthrough:(v:boolean)=>void }; } }
type Player={id:string,name:string,hero:HeroKind,team:Team,ready:boolean,bot:boolean,connected:boolean};
type Room={code:string,hostId:string,phase:'lobby'|'playing'|'finished',players:Player[],paused?:boolean,notice?:string};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const html=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const glyph=(kind:string)=>{const paths:Record<string,string>={sword:'M7 18 18 7l2-5-5 2L4 15m0-4 9 9m-8-2-3 3',potion:'M9 2h6v4l4 6v7q0 3-7 3t-7-3v-7l4-6ZM9 6h6M5 14h14M9 2v4m6-4v4',heart:'m12 3 7 8-7 10-7-10Z',boots:'m8 3 8 1-2 9 6 4v4H4v-7l3-2Z',focus:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z',bow:'M5 3q21 9 0 18l4-9ZM3 12h18m-4-4 4 4-4 4',guard:'m12 2 8 4v7q-2 6-8 9-6-3-8-9V6Z',shield:'m12 2 8 4v7q-2 6-8 9-6-3-8-9V6Zm0 5v10m-4-6h8',slash:'M4 18Q16 18 20 4M5 14l5 5m-5-2-3 4M9 4l2 3m5 11 3 2',dash:'m4 7 7 5-7 5m8-10 7 5-7 5',bolt:'m14 2-9 12h7l-2 8L21 9h-8Z',nova:'M12 2v20M2 12h20M5 5l14 14M5 19 19 5m-7 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10',heal:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',tower:'M5 21V8H3V3h4v3h3V3h4v3h3V3h4v5h-2v13Zm5 0v-7h4v7',camera:'M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5M8 12h8m-4-4v8'};return`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[kind]??paths.focus}"/></svg>`;};
const app=$('app');
app.innerHTML=`<main class="shell">
  <header class="topbar"><button id="resize-corner" class="resize-corner" aria-label="拖动左上角缩放" title="拖动缩放整个游戏"></button><span class="drag-grip" title="拖动移动窗口"><i></i><i></i><i></i><i></i><i></i><i></i></span><button id="scale-button" title="调整整体缩放" aria-expanded="false"><span id="scale-label">100%</span></button><button id="opacity-button" title="调整整体透明度" aria-expanded="false">透 <span id="opacity-label">100%</span></button><button id="menu-button" class="menu-button" title="窗口与房间菜单" aria-label="打开菜单" aria-expanded="false">···</button></header>
  <aside id="window-menu" class="window-menu panel" hidden><div id="connection" class="connection">正在连接房间服务</div><button id="settings-button">连接与操作说明</button><button id="map-toggle">隐藏小地图 <kbd>M</kbd></button><button id="camera-follow" aria-pressed="true">锁定镜头 <kbd>Y</kbd></button><button id="pin">取消置顶</button><button id="hide">隐藏游戏 <kbd>Ctrl+Shift+J</kbd></button><button id="leave-match" hidden>离开房间</button><button id="close">退出游戏</button></aside>
  <aside id="scale-popup" class="layout-popup panel" hidden><label>整体缩放 <output id="scale-value">100%</output><input id="scale" type="range" min="50" max="120" value="100" step="5"></label></aside>
  <aside id="opacity-popup" class="layout-popup panel" hidden><label>整体透明度 <output id="opacity-value">100%</output><input id="opacity" type="range" min="15" max="100" value="100" step="5"></label></aside>
  <section id="arena" aria-label="竞技场，右键移动和攻击，Q W E释放技能"></section>
  <div id="matchbar" class="matchbar" hidden></div>
  <section id="lobby" class="lobby">
    <header class="lobby-header"><h1>单线</h1><span>桌面竞技场</span><small>1 / 1</small></header>
    <div class="lobby-stage"><div class="hero-select" role="group" aria-label="选择英雄">${HERO_IDS.map((id,i)=>`<button class="hero-choice ${i===0?'selected':''}" data-hero="${id}"><strong>${HERO_PRESENTATION[id].name}</strong><small>${HERO_PRESENTATION[id].role.split(' · ')[0]}</small></button>`).join('')}</div><div id="hero-detail" class="hero-summary"></div></div>
    <div class="room-panel"><p id="room-service-label" class="muted" role="status">正在连接房间服务…</p><div id="entry"><div class="entry-fields"><label>昵称<input id="name" maxlength="16" placeholder="输入昵称" value="玩家" autocomplete="nickname"></label><label>房间密码<input id="password" type="password" maxlength="32" placeholder="4～32 位" autocomplete="off"></label></div><div class="entry-actions"><button id="create" class="primary">创建房间</button><button id="practice">单人练习</button></div><div class="join-row"><input id="room-code" aria-label="房间号" maxlength="32" placeholder="输入 6 位房间号" inputmode="numeric"><button id="join">加入房间</button></div></div><div id="room-detail" hidden></div></div>
  </section>
  <aside id="settings" class="settings panel" hidden><div class="panel-title"><h2>连接与操作</h2><button id="settings-close" aria-label="关闭设置">×</button></div><label>房间服务地址<input id="server-url" placeholder="http://朋友的电脑IP:4327"></label><button id="connect" class="wide">连接</button><p id="local-address" class="muted"></p><details><summary>操作与规则</summary><p></p></details><p class="muted">Ctrl+Shift+J 隐藏／显示，Ctrl+Shift+0 恢复窗口。</p></aside>
  <aside id="minimap" class="minimap" hidden><canvas id="minimap-canvas" width="400" height="224" tabindex="0" role="button" title="点击移动镜头，M 隐藏小地图" aria-label="战场小地图，点击移动镜头，M 切换显示"></canvas></aside>
  <section id="hud" class="hud" hidden></section><aside id="shop" class="shop panel" hidden></aside>
  <section id="result" class="result panel" hidden></section>
  <div id="toast" role="status" class="toast" hidden></div>
  <footer id="hint" class="hint" hidden></footer>
  <div class="small-screen">请使用电脑鼠标与键盘游玩；可缩放或放大窗口。</div>
</main>`;
const {scene}=bootArena($('arena'));
let room:Room|null=null,state:MatchState|null=null,playerId='',hero:HeroKind='dain',socket:WebSocket|null=null,online=false,practicePending:'creating'|'adding-bot'|'readying'|'starting'|null=null,toastTimer:ReturnType<typeof setTimeout>,retry:ReturnType<typeof setTimeout>,manualLeave=false;
let serverUrl=localStorage.getItem('lane.server')||location.origin;
let localServerUrl='',defaultServerUrl='',startPracticeOnConnect=false;
let practiceFallback=false,pendingRoomAction:Record<string,unknown>|null=null;
let hudKey='',shopBuilt=false,resultKey='',mapVisible=true;
let preview=createMatch(['dain','sylra'],[0,1]);for(let t=0;t<22;t+=.05)stepMatch(preview,.05);
scene.state=preview;
function toast(message:string){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function send(data:Record<string,unknown>){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(['create','join','resume'].includes(String(data.type))?{...data,protocol:'glass-lane-v2'}:data));else toast('尚未连接房间服务，请在设置中检查地址。');}
function me(){return room?.players.find(p=>p.id===playerId);}
function command(c:Command){if(room?.phase==='playing'&&!room.paused)send({type:'command',command:c});}
function updateServiceLabel(){
  let name=serverUrl;try{name=new URL(serverUrl).host;}catch{}
  const local=!!localServerUrl&&serverUrl===localServerUrl;
  $('room-service-label').textContent=`${online?'已连接':'连接中'} · ${local?'本机 / 局域网':name}${practiceFallback?' · 练习专用，退出后恢复联机':''}`;
  $('room-service-label').title=`当前房间服务：${serverUrl}。好友必须使用同一服务、房间号和密码。`;
}
function multiplayer(action:Record<string,unknown>){
  if(room||pendingRoomAction)return;
  if(practiceFallback&&defaultServerUrl){practiceFallback=false;serverUrl=defaultServerUrl;$<HTMLInputElement>('server-url').value=serverUrl;manualLeave=true;pendingRoomAction=action;connect();return;}
  if(!online){pendingRoomAction=action;toast('正在连接房间服务，连接成功后会继续。');return;}
  send(action);
}
function clearRoom(){room=null;state=null;playerId='';practicePending=null;scene.cancelAim();renderRoom();}
function advancePractice(){
  if(!practicePending||!room||room.hostId!==playerId)return;
  if(room.phase!=='lobby'){practicePending=null;return;}
  if(practicePending==='adding-bot'&&room.players.some(p=>p.bot)){practicePending='readying';send({type:'ready',ready:true});}
  if(practicePending==='readying'&&room.players.length===2&&room.players.every(p=>p.ready&&p.connected)){practicePending='starting';send({type:'start'});}
}
scene.onCommand=command;
function connect(){
  clearTimeout(retry);const old=socket;socket=null;if(old){old.onclose=null;old.close();}online=false;
  let url:URL;try{url=new URL(serverUrl);if(!['http:','https:','ws:','wss:'].includes(url.protocol))throw Error();url.protocol=url.protocol==='https:'||url.protocol==='wss:'?'wss:':'ws:';url.pathname='/ws';url.search='';}catch{toast('请输入完整的 http:// 或 https:// 服务地址');return;}
  $('connection').textContent='正在连接房间服务，首次连接可能稍慢';updateServiceLabel();socket=new WebSocket(url);const current=socket;let resumePending=false;
  const flushRoomAction=()=>{if(pendingRoomAction&&!room){const action=pendingRoomAction;pendingRoomAction=null;send(action);}else if(room)pendingRoomAction=null;};
  current.onopen=()=>{if(socket!==current)return;online=true;updateServiceLabel();$('connection').textContent='房间服务已连接';$('connection').classList.add('connected');const token=sessionStorage.getItem(`lane.token:${serverUrl}`);if(token&&!manualLeave){resumePending=true;send({type:'resume',token});}else{if(manualLeave)clearRoom();flushRoomAction();}if(startPracticeOnConnect){startPracticeOnConnect=false;beginPractice();}};
  current.onmessage=event=>{if(socket!==current)return;const message=JSON.parse(event.data);
    if(message.type==='welcome'){resumePending=false;pendingRoomAction=null;playerId=message.playerId;sessionStorage.setItem(`lane.token:${serverUrl}`,message.token);manualLeave=false;room=message.room;state=null;renderRoom();if(practicePending==='creating'){practicePending='adding-bot';send({type:'bot'});}else advancePractice();}
    if(message.type==='room'&&playerId){room=message.room;renderRoom();advancePractice();}
    if(message.type==='state'&&room&&playerId){state=message.state;scene.state=state!;renderHud();}
    if(message.type==='error'){if(resumePending&&/重连凭据已失效|房间已关闭或重连时间已过/.test(message.message)){resumePending=false;sessionStorage.removeItem(`lane.token:${serverUrl}`);clearRoom();flushRoomAction();}practicePending=null;toast(message.message==='房间不存在或密码错误。'?'无法加入：请核对房间号和密码，并确认双方连接同一服务。服务重启后需重新建房。':message.message);}
    if(message.type==='left'){sessionStorage.removeItem(`lane.token:${serverUrl}`);clearRoom();}
  };
  current.onclose=()=>{if(socket!==current)return;online=false;updateServiceLabel();scene.active=false;$('connection').textContent='连接断开，正在重连…';$('connection').classList.remove('connected');retry=setTimeout(connect,2000);};
  current.onerror=()=>{if(socket===current)$('connection').textContent='服务暂时不可用，可在设置更换地址';};
}
function heroDetail(){const h=HEROES[hero];$('hero-detail').innerHTML=`<div class="hero-avatar"><img src="/assets/heroes/${hero}.png" alt="${h.name}"></div><div class="hero-info"><h2>${h.name}</h2><span>${h.role}</span><p>${HERO_PRESENTATION[hero].summary}</p><div class="skill-preview">${h.skills.map((s,i)=>`<span title="${html(s.sourceName+'：'+s.description)}"><kbd>${s.key}</kbd><span>${skillName(hero,i)}</span></span>`).join('')}</div></div>`;document.querySelectorAll<HTMLElement>('[data-hero]').forEach(b=>{b.classList.toggle('selected',b.dataset.hero===hero);b.setAttribute('aria-pressed',String(b.dataset.hero===hero));});}
function renderRoom(){
  const playing=room?.phase==='playing'||room?.phase==='finished';$('lobby').hidden=!!playing;$('entry').hidden=!!room;$('room-detail').hidden=!room;$('hud').hidden=!playing;$('matchbar').hidden=!playing;$('minimap').hidden=!playing||!mapVisible;$('leave-match').hidden=!room;$('result').hidden=room?.phase!=='finished';app.classList.toggle('in-match',!!playing);
  scene.inMatch=!!playing;scene.active=room?.phase==='playing'&&!room?.paused&&online;scene.team=me()?.team??0;if(!playing){scene.state=preview;$('shop').hidden=true;state=null;hudKey='';resultKey='';}
  if(room&&!playing){const mine=me(),host=room.hostId===playerId;hero=mine?.hero??hero;heroDetail();$('room-detail').innerHTML=`<div class="room-heading"><small>房间号</small><strong>${room.code}</strong><button id="copy-room" title="复制房间号">复制</button></div><div class="roster">${[0,1].map(team=>{const p=room!.players.find(p=>p.team===team);return`<div class="seat ${team===0?'blue':'red'}">${p?`<img src="/assets/heroes/${p.hero}.png" alt=""><div><strong>${html(p.name)}${p.id===playerId?'（你）':''}</strong><small>${HEROES[p.hero].name} · ${p.bot?'机器人':p.connected?(p.ready?'已准备':'未准备'):'等待重连'}</small></div>`:'<span>等待另一位玩家加入</span>'}</div>`;}).join('')}</div><p class="muted">${html(room.notice||'选择英雄后准备，房主开始对局。')}</p><div class="room-actions"><button id="ready">${mine?.ready?'取消准备':'准备'}</button>${host?`<button id="start" class="primary">开始对局</button>`:''}</div>${host&&room.players.length<2?'<button id="add-bot" class="wide">添加机器人陪练</button>':''}<button id="leave" class="text-button wide">离开房间</button>`;
    $('ready').onclick=()=>send({type:'ready',ready:!mine?.ready});if(host)$('start').onclick=()=>send({type:'start'});if($('add-bot'))$('add-bot').onclick=()=>send({type:'bot'});$('leave').onclick=leave;$('copy-room').onclick=()=>{navigator.clipboard?.writeText(room!.code).then(()=>toast('已复制房间号')).catch(()=>toast(`房间号：${room!.code}`));};
  }
  if(playing&&room){if(!$('clock'))$('matchbar').innerHTML=`<strong id="clock">00:00</strong><span id="match-score">0 : 0</span><small id="wave-label" hidden></small>`;$('matchbar').title=`${room.players.find(p=>p.team===0)?.name||'青方'} 对 ${room.players.find(p=>p.team===1)?.name||'赤方'}`;if(room.paused)toast('有玩家断线，对局已暂停，等待重连。');}
  if(room?.phase==='finished'&&state)renderResult();
}
function leave(){manualLeave=true;pendingRoomAction=null;sessionStorage.removeItem(`lane.token:${serverUrl}`);if(socket?.readyState===WebSocket.OPEN)send({type:'leave'});clearRoom();if(practiceFallback&&defaultServerUrl){practiceFallback=false;serverUrl=defaultServerUrl;$<HTMLInputElement>('server-url').value=serverUrl;connect();}}
function setText(id:string,value:string){const node=$(id);if(node&&node.textContent!==value)node.textContent=value;}
function myHero(){return state?.units.find(u=>u.kind==='hero'&&u.team===me()?.team);}
function ensureHud(u:Unit){
  const key=u.heroKind+':'+u.team;if(hudKey===key)return;hudKey=key;
  $('hud').innerHTML=hudMarkup(u,glyph);
  $('attack-aim').onclick=()=>scene.selectAttack();
  for(let i=0;i<4;i++){
    $('ability-'+i).onclick=()=>scene.selectSkill(i);
    $('upgrade-'+i).onclick=()=>command({type:'upgrade',slot:i as 0|1|2|3});
  }
  $('summoner-heal').onclick=()=>scene.selectSummoner('heal');
  $('summoner-flash').onclick=()=>scene.selectSummoner('flash');
  $('use-potion').onclick=()=>command({type:'usePotion'});
  $('shop-toggle').onclick=toggleShop;
}
function renderHud(){
  if(!state||!room)return;scene.active=room.phase==='playing'&&!room.paused&&online;const u=myHero();if(!u)return;ensureHud(u);
  const h=HEROES[u.heroKind??'dain'],dead=u.hp<=0,time=Math.floor(state.time);
  setText('clock',room.paused?'等待重连':`${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`);setText('wave-label',`第 ${state.wave} 波 · ${Math.max(0,Math.ceil(state.nextWave-state.time))}秒后出兵`);
  setText('match-score',`${state.teamKills?.[0]??state.units.find(u=>u.kind==='hero'&&u.team===0)?.kills??0} : ${state.teamKills?.[1]??state.units.find(u=>u.kind==='hero'&&u.team===1)?.kills??0}`);
  const statusNames:Record<string,string>={stun:'眩晕',root:'禁锢',stealth:'隐身',untargetable:'不可选中',slow:'减速'};const status=u.statuses?.filter(s=>s.until>state!.time&&statusNames[s.kind]).map(s=>statusNames[s.kind])??[];setText('respawn-label',dead?`${Math.max(0,Math.ceil((u.respawnAt??0)-state.time))} 秒复活`:[...new Set(status)].slice(0,2).join(' · '));
  $('health-fill').style.width=`${Math.max(0,u.hp/u.maxHp)*100}%`;$('mana-fill').style.width=`${(u.mana??0)/(u.maxMana||1)*100}%`;
  setText('health-label',`${Math.ceil(Math.max(0,u.hp))} / ${Math.round(u.maxHp)}`);setText('mana-label',`${Math.floor(u.mana??0)} / ${Math.round(u.maxMana??0)}`);setText('combat-score',`补刀 ${u.lastHits??0}　击杀 ${u.kills??0} / 阵亡 ${u.deaths??0}`);setText('gold-value',String(Math.floor(u.gold??0)));
  setText('hero-level',`Lv.${u.level}`);$('hud').querySelector('.hero-badge')?.setAttribute('title',`${h.sourceName} · ${h.passive?.name??''}：${h.passive?.description??''} 当前层数 ${u.passiveStacks??0}`);$('xp-fill').style.width=`${u.level>=10?100:Math.min(100,u.xp/xpForNextLevel(u.level)*100)}%`;$('xp-track').title=u.level>=10?'已达到满级 10 级':`经验 ${Math.floor(u.xp)} / ${xpForNextLevel(u.level)}，每升一级获得一个技能点`;
  setText('skill-points',u.skillPoints>0?`+${u.skillPoints} 技能点`:'' );
  for(let i=0;i<h.skills.length;i++){const rank=u.skillRanks[i]??0,skill=skillForRank(u.heroKind??'dain',i as 0|1|2|3,Math.max(1,rank)),cd=u.cooldowns?.[i]??0,recast=u.recastSlot===i&&(u.recastUntil??0)>state.time,button=$<HTMLButtonElement>(`ability-${i}`);button.disabled=dead||(!recast&&(cd>0||rank===0||(u.mana??0)<skill.mana));button.title=`${skillName(u.heroKind??'dain',i)} / ${skill.sourceName}（${rank||1}级）：${skill.description} ${numericSkillDetails(skill)} 冷却 ${skill.cooldown.toFixed(2)} 秒，消耗 ${skill.mana} 法力。左键确认，右键取消。`;if(recast)button.title='再次按 R 或点击后确认，免费返回突进前的位置；右键取消瞄准。';button.classList.toggle('recast',recast);button.classList.toggle('cooling',cd>0&&!recast);button.classList.toggle('no-mana',(u.mana??0)<skill.mana);$(`cooldown-${i}`).hidden=cd<=0&&rank>0;$(`cooldown-${i}`).classList.toggle('unlearned',rank===0);setText(`cooldown-${i}`,recast?`返回
${Math.max(0,(u.recastUntil??0)-state.time).toFixed(1)}`:rank===0?(u.level<skill.unlockLevel?`${skill.unlockLevel}级解锁`:'未学习'):cd>0?cd.toFixed(1):'');const canUpgrade=canUpgradeSkill(u,i as 0|1|2|3);$(`upgrade-${i}`).hidden=!canUpgrade;for(let r=0;r<skill.maxRank;r++)$(`rank-${i}-${r}`).classList.toggle('learned',r<rank);}
  for(const slot of ['heal','flash'] as const){const cd=u.summonerCooldowns?.[slot]??0;$<HTMLButtonElement>(`summoner-${slot}`).disabled=dead||cd>0;setText(`summoner-cd-${slot}`,cd>0?String(Math.ceil(cd)):'');}
  const potion=u.potionEffect,remaining=potion?.remaining??0,combatWait=Math.max(0,Math.ceil(5-(state.time-(u.lastCombatAt??-999))));$<HTMLButtonElement>('use-potion').disabled=dead||(u.potions??0)<=0||remaining>0;setText('potion-count',String(u.potions??0));setText('potion-timer',remaining>0?String(Math.ceil(remaining)):'');$('potion-timer').hidden=remaining<=0;$('use-potion').classList.toggle('recovering',remaining>0);$('use-potion').classList.toggle('in-combat',combatWait>0);$('use-potion').title=`恢复药水（1）：100 金币，8 秒内回复 50% 最大生命及法力。战斗中及战后 5 秒内仅回复 10%；完整药效期间再次战斗，剩余药效降至 20%。最多携带 3 瓶。${remaining>0?`药效剩余 ${Math.ceil(remaining)} 秒，当前${potion!.potency<1?'战斗减效':'完整药效'}。`:combatWait>0?`离战后完整药效还需 ${combatWait} 秒。`:'已脱战，当前可获得完整药效。'}`;
  for(let i=0;i<6;i++){const item=ITEMS.find(t=>t.id===u.items?.[i]),node=$(`inventory-${i}`),key=item?.id??'';if(node.dataset.item!==key){node.dataset.item=key;node.innerHTML=item?glyph(item.id):'';node.title=item?`${item.name}：${item.description}`:'空装备栏';}}
  $('hero-vitals')?.setAttribute('title',`${h.name} Lv.${u.level}，补刀 ${u.lastHits??0}，击杀／阵亡 ${u.kills??0}／${u.deaths??0}`);$('hud').querySelector('.hero-vitals')?.setAttribute('title',`${h.name} Lv.${u.level}，攻击 ${u.damage.toFixed(1)}，护甲 ${(u.armor??0).toFixed(1)}，魔抗 ${(u.mr??0).toFixed(1)}。${h.passive?.name??''}：${h.passive?.description??''}`);$('hud').querySelector('.equipment')?.setAttribute('title',(u.items??[]).map(id=>ITEMS.find(i=>i.id===id)?.name).join('、')||'尚未购买装备');
  updateCameraLabel(scene.following);if(mapVisible)drawMinimap();if(!$('shop').hidden)renderShop();
  if(state.status==='finished'){room.phase='finished';renderResult();}
}
function renderShop(){const u=myHero();if(!u)return;
  if(!shopBuilt){shopBuilt=true;$('shop').innerHTML=`<div class="panel-title"><h2>装备与补给</h2><button id="shop-close" aria-label="关闭商店">×</button></div><p id="shop-status" class="shop-status available"></p><div class="shop-items">${ITEMS.map(i=>`<button id="buy-${i.id}" data-buy="${i.id}" title="${html(i.description)}"><span class="item-icon">${glyph(i.id)}</span><span class="item-copy"><strong>${i.name}<b>${i.cost}</b></strong><small>${i.id==='potion'?'8 秒渐回生命与法力各 50%；战斗中药效 20%。':i.description}</small></span></button>`).join('')}</div><div class="shop-loadout" aria-label="已购买装备">${Array.from({length:6},(_,i)=>`<span id="shop-slot-${i}" title="空装备位"></span>`).join('')}</div><p class="shop-footnote">随时购买 · 六件装备 · 三瓶药水　<kbd>B</kbd> / <kbd>Esc</kbd> 收起</p>`;$('shop-close').onclick=()=>$('shop').hidden=true;document.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach(b=>b.onclick=()=>command({type:'buy',itemId:b.dataset.buy!}));}
  setText('shop-status',`${Math.floor(u.gold??0)} 金币 · 恢复药 ${u.potions??0} / 3`);for(const item of ITEMS)$<HTMLButtonElement>(`buy-${item.id}`).disabled=(u.gold??0)<item.cost||(item.id==='potion'?(u.potions??0)>=3:(u.items?.length??0)>=6);
  for(let i=0;i<6;i++){const node=$(`shop-slot-${i}`),item=ITEMS.find(item=>item.id===u.items?.[i]),id=item?.id??'';if(node.dataset.item!==id){node.dataset.item=id;node.innerHTML=item?glyph(item.id):'<span>·</span>';node.title=item?`${item.name}：${item.description}`:'空装备位';}}
}
function toggleShop(){if(!state)return;$('shop').hidden=!$('shop').hidden;if(!$('shop').hidden)renderShop();}
function renderResult(){if(!state)return;scene.active=false;$('result').hidden=false;const won=state.winner===me()?.team,key=`${won}:${room?.hostId===playerId}`;if(resultKey===key)return;resultKey=key;$('result').innerHTML=`<div class="result-emblem">${glyph(won?'focus':'shield')}</div><small>基地已被摧毁</small><h2>${won?'胜利':'败北'}</h2><p>${won?'这一条路，你走到了最后。':'重整兵线，下一局再来。'}</p><button id="rematch" class="primary wide">${room?.hostId===playerId?'返回房间，再来一局':'等待房主返回房间'}</button><button id="result-leave" class="text-button wide">离开房间</button>`;$('rematch').onclick=()=>send({type:'rematch'});($('rematch')as HTMLButtonElement).disabled=room?.hostId!==playerId;$('result-leave').onclick=leave;}
function drawMinimap(){
  if(!state)return;const canvas=$<HTMLCanvasElement>('minimap-canvas'),ctx=canvas.getContext('2d');if(!ctx)return;const w=canvas.width,h=canvas.height,sx=w/WORLD.width,sy=h/WORLD.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#18191c';ctx.fillRect(0,0,w,h);
  ctx.save();const viewer=myHero();if(viewer){ctx.beginPath();ctx.ellipse(viewer.x*sx,viewer.y*sy,RULES.visionRadius*sx,RULES.visionRadius*sy,0,0,Math.PI*2);ctx.clip();}
  ctx.fillStyle='#34373a';ctx.fillRect(WORLD.minX*sx,WORLD.minY*sy,(WORLD.maxX-WORLD.minX)*sx,(WORLD.maxY-WORLD.minY)*sy);
  ctx.fillStyle='#65666a';ctx.fillRect(WORLD.minX*sx,(WORLD.laneY-140)*sy,(WORLD.maxX-WORLD.minX)*sx,280*sy);
  ctx.fillStyle='#48535d';ctx.fillRect(TERRAIN.river.minX*sx,WORLD.minY*sy,(TERRAIN.river.maxX-TERRAIN.river.minX)*sx,(WORLD.maxY-WORLD.minY)*sy);
  ctx.fillStyle='#7a7c80';ctx.fillRect((TERRAIN.river.minX-10)*sx,TERRAIN.bridge.minY*sy,(TERRAIN.river.maxX-TERRAIN.river.minX+20)*sx,(TERRAIN.bridge.maxY-TERRAIN.bridge.minY)*sy);
  ctx.fillStyle='#555b55';for(const bush of TERRAIN.bushes)ctx.fillRect((bush.x-bush.width/2)*sx,(bush.y-bush.height/2)*sy,bush.width*sx,bush.height*sy);
  for(const u of state.units){if(u.hp<=0||!isUnitVisibleToTeam(state,u,me()?.team??0))continue;const x=u.x*sx,y=u.y*sy;ctx.fillStyle=u.team===me()?.team?'#b0bbc5':'#aa9690';ctx.strokeStyle='#1b1c20';ctx.lineWidth=2;ctx.beginPath();if(u.kind==='hero'){ctx.arc(x,y,u.team===me()?.team?5:4,0,Math.PI*2);}else if(u.kind==='tower'){ctx.moveTo(x,y-5);ctx.lineTo(x+4,y);ctx.lineTo(x,y+5);ctx.lineTo(x-4,y);ctx.closePath();}else if(u.kind==='base'){ctx.rect(x-5,y-5,10,10);}else{ctx.arc(x,y,1.5,0,Math.PI*2);}ctx.fill();ctx.stroke();}
  const bounds=scene.getCameraWorldBounds();if(bounds){ctx.strokeStyle='#9c9fa6';ctx.lineWidth=1;ctx.strokeRect(bounds.x*sx,bounds.y*sy,bounds.width*sx,bounds.height*sy);}ctx.restore();
}
$('minimap-canvas').onpointerdown=event=>{event.preventDefault();const canvas=$<HTMLCanvasElement>('minimap-canvas'),r=canvas.getBoundingClientRect();scene.focusWorld((event.clientX-r.left)/r.width*WORLD.width,(event.clientY-r.top)/r.height*WORLD.height);updateCameraLabel(false);drawMinimap();};
$('minimap-canvas').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();scene.centerHero();drawMinimap();}};
function updateCameraLabel(following:boolean){setText('camera-follow',following?'锁定镜头':'自由镜头');$('camera-follow').setAttribute('aria-pressed',String(following));}
$('camera-follow').onclick=()=>{updateCameraLabel(scene.toggleFollow());drawMinimap();};
function toggleMap(){mapVisible=!mapVisible;$('minimap').hidden=!mapVisible||!state;setText('map-toggle',mapVisible?'隐藏小地图　M':'显示小地图　M');if(mapVisible)drawMinimap();}
$('map-toggle').onclick=toggleMap;$('leave-match').onclick=()=>{closePopovers();leave();};
const popovers=['window-menu','scale-popup','opacity-popup'];
function closePopovers(except?:string){for(const id of popovers)if(id!==except)$(id).hidden=true;for(const [id,popup] of [['menu-button','window-menu'],['scale-button','scale-popup'],['opacity-button','opacity-popup']])$(id).setAttribute('aria-expanded',String(!$(popup).hidden));}
function togglePopover(id:string){const open=$(id).hidden;closePopovers();$(id).hidden=!open;closePopovers(id);}
$('menu-button').onclick=()=>togglePopover('window-menu');$('scale-button').onclick=()=>togglePopover('scale-popup');$('opacity-button').onclick=()=>togglePopover('opacity-popup');
document.addEventListener('pointerdown',event=>{if(!(event.target as HTMLElement).closest('.topbar,.window-menu,.layout-popup'))closePopovers();});
function applyLayout(layout:Partial<Layout>,native=true){
  if(layout.scale!==undefined){const scale=Math.min(1.2,Math.max(.5,layout.scale));$<HTMLInputElement>('scale').value=String(Math.round(scale*100));setText('scale-label',`${Math.round(scale*100)}%`);setText('scale-value',`${Math.round(scale*100)}%`);if(native&&window.desktop)window.desktop.scale(scale);else if(!window.desktop){app.style.transform=`scale(${scale})`;app.style.transformOrigin='top left';app.style.width=`${100/scale}vw`;app.style.height=`${100/scale}vh`;}}
  if(layout.opacity!==undefined){const opacity=Math.min(1,Math.max(.15,layout.opacity));$<HTMLInputElement>('opacity').value=String(Math.round(opacity*100));setText('opacity-label',`${Math.round(opacity*100)}%`);setText('opacity-value',`${Math.round(opacity*100)}%`);if(native&&window.desktop)window.desktop.opacity(opacity);else if(!window.desktop)app.style.opacity=String(opacity);}
}
$<HTMLInputElement>('scale').oninput=event=>applyLayout({scale:Number((event.target as HTMLInputElement).value)/100});$<HTMLInputElement>('opacity').oninput=event=>applyLayout({opacity:Number((event.target as HTMLInputElement).value)/100});window.desktop?.onLayout?.(layout=>applyLayout(layout,false));
let resizing=false,resizeOrigin:{x:number;y:number;scale:number}|null=null;
$('resize-corner').onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();resizing=true;$('resize-corner').setPointerCapture(event.pointerId);resizeOrigin={x:event.screenX,y:event.screenY,scale:Number($<HTMLInputElement>('scale').value)/100};window.desktop?.startResize(event.screenX,event.screenY);};
$('resize-corner').onpointermove=event=>{if(!resizing||!resizeOrigin)return;if(window.desktop)window.desktop.resize(event.screenX,event.screenY);else applyLayout({scale:resizeOrigin.scale-(event.screenX-resizeOrigin.x+event.screenY-resizeOrigin.y)/1500});};
function endResize(){if(!resizing)return;resizing=false;resizeOrigin=null;window.desktop?.endResize();}
$('resize-corner').onpointerup=endResize;$('resize-corner').onpointercancel=endResize;$('resize-corner').onlostpointercapture=endResize;
document.querySelectorAll<HTMLButtonElement>('[data-hero]').forEach(b=>b.onclick=()=>{hero=b.dataset.hero as HeroKind;heroDetail();if(room)send({type:'select',hero});});
$('create').onclick=()=>multiplayer({type:'create',name:($('name')as HTMLInputElement).value,password:($('password')as HTMLInputElement).value,hero});
$('join').onclick=()=>{const input=$<HTMLInputElement>('room-code'),code=input.value.normalize('NFKC').replace(/\s/g,'');if(!/^\d{6}$/.test(code)){toast('请输入房主当前显示的 6 位房间号。');return;}input.value=code;multiplayer({type:'join',name:($('name')as HTMLInputElement).value,password:($('password')as HTMLInputElement).value,hero,code});};
function beginPractice(){if(practicePending||room)return;practicePending='creating';const password=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');send({type:'create',name:($('name')as HTMLInputElement).value||'玩家',password,hero});}
$('practice').onclick=()=>{if(room)return;pendingRoomAction=null;if(!online){if(localServerUrl){practiceFallback=defaultServerUrl!==localServerUrl;startPracticeOnConnect=true;serverUrl=localServerUrl;$<HTMLInputElement>('server-url').value=serverUrl;manualLeave=true;toast('已切换本机练习，退出练习后自动恢复联机。');connect();}else toast('房间服务正在连接，请稍后重试。');return;}beginPractice();};
$('settings-button').onclick=()=>{closePopovers();$('settings').hidden=!$('settings').hidden;};$('settings-close').onclick=()=>$('settings').hidden=true;
($('server-url')as HTMLInputElement).value=serverUrl;
$('connect').onclick=()=>{const next=($('server-url')as HTMLInputElement).value.trim();if(room){toast('请先离开当前房间，再切换服务。');return;}pendingRoomAction=null;practiceFallback=false;startPracticeOnConnect=false;serverUrl=next;manualLeave=false;localStorage.setItem('lane.server',next);connect();};
let pinned=true;$('pin').onclick=()=>{pinned=!pinned;window.desktop?.pin(pinned);$('pin').textContent=pinned?'取消置顶':'置顶窗口';};$('hide').onclick=()=>{closePopovers();if(window.desktop)window.desktop.hide();else toast('浏览器预览不能隐藏桌面窗口。');};$('close').onclick=()=>{if(window.desktop)window.desktop.close();else toast('可以直接关闭当前浏览器标签页。');};
window.addEventListener('keydown',event=>{
  const key=event.key.toLowerCase();
  if(key==='escape'){$('shop').hidden=true;$('settings').hidden=true;closePopovers();scene.cancelAim();return;}
  if((event.target as HTMLElement).matches('input,textarea,select'))return;
  if(!state||room?.phase!=='playing'||event.repeat)return;
  if(key==='m'){event.preventDefault();toggleMap();return;}
  if(key==='b'){event.preventDefault();toggleShop();return;}
  if(!$('settings').hidden||!$('shop').hidden||popovers.some(id=>!$(id).hidden))return;
  if(key==='1'){event.preventDefault();command({type:'usePotion'});return;}
  if(key===' '){event.preventDefault();scene.centerHero();drawMinimap();return;}
  if(key==='y'){event.preventDefault();updateCameraLabel(scene.toggleFollow());return;}
  if(key==='a'){event.preventDefault();scene.cancelAim();scene.aimAttack=true;return;}
  if(key==='d'||key==='f'){event.preventDefault();scene.selectSummoner(key==='d'?'heal':'flash');return;}
  const slot=['q','w','e','r'].indexOf(key);
  if(slot>=0){event.preventDefault();if(event.ctrlKey)command({type:'upgrade',slot:slot as 0|1|2|3});else scene.selectSkill(slot);}
  if(key==='s')command({type:'stop'});
});
window.addEventListener('blur',()=>{scene.cancelAim();endResize();});
const rules=$('settings').querySelector('details p');if(rules)rules.textContent=`右键移动／攻击。Q/W/E/R 先显示范围，左键确认，右键或 Esc 取消；四名英雄的技能与属性来自同一开源版本，被动见头像提示。A 显示普攻范围，左键攻击或攻击移动。D 治疗、F 闪现也需左键确认。点击 + 或 Ctrl+技能键学习，普通技能最高 5 级，R 在 4 / 7 / 10 级可学习和升级，角色满级 10 级。空格回英雄，Y 锁镜头，中键／边缘移镜头，M 收小地图，B 商店，S 停止。商店随时购买；1 使用恢复药水，8 秒渐回 50% 生命和法力，战斗中／战后 5 秒内仅回 10%。先拆塔再破基地；死亡 ${RULES.respawnSeconds} 秒后复活。`;
if(rules)rules.textContent+=` 四英雄来源：Claude of Legends（MIT），固定版本数值；普通技能5级、R3级。视距为自己英雄周围 ${RULES.visionRadius}，圈外战场与单位隐藏，小地图同步；移镜头不能揭开视野。河水不能步行，跨岸自动绕中桥，位移可越河。两岸四片草丛内对敌方隐藏，无法被普攻或指向技能锁定；方向／范围技能仍可命中，受伤显形3秒。`;
heroDetail();
async function initializeClient(){
  if(window.desktop){try{const info=await window.desktop.info();applyLayout({scale:info.scale??1,opacity:info.opacity??1},false);localServerUrl=info.localUrl||location.origin;defaultServerUrl=info.defaultServerUrl||localServerUrl;
    const saved=localStorage.getItem('lane.server');let savedLocal=false;try{savedLocal=!!saved&&['localhost','127.0.0.1','0.0.0.0'].includes(new URL(saved).hostname);}catch{}
    serverUrl=info.diagnosticMode?defaultServerUrl:((saved&&!savedLocal)?saved:defaultServerUrl);
    $('local-address').textContent=defaultServerUrl!==localServerUrl?`默认线上：${defaultServerUrl}。双方使用同一地址与房间号即可联机。`:(info.addresses.length?`局域网朋友填写：${info.addresses.join(' 或 ')}`:'本机服务已启动。');
  }catch{toast('客户端连接设置读取失败，已启用本机服务。');}}
  $<HTMLInputElement>('server-url').value=serverUrl;connect();
}
void initializeClient();



