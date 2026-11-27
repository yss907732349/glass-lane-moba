// MIT adaptation of claude-of-legends combat primitives at the pinned commit in source-heroes.ts.
import { HEROES, skillForRank, SOURCE_HEROES, SOURCE_UNIT } from './data.ts';
import type { CombatStatus, Effect, MatchState, Point, Projectile, SkillSlot, Unit } from './types.ts';

type Power={ad:number;ap:number;scale:number};
export interface CombatHooks {
  hurt:(s:MatchState,a:Unit,t:Unit,amount:number,dtype?:string,via?:string)=>void;
  effect:(s:MatchState,kind:Effect['kind'],team:0|1,p:Point,extra?:Partial<Effect>,life?:number)=>void;
  endpoint:(from:Point,to:Point,range:number)=>Point;
  visible:(s:MatchState,u:Unit,team:0|1)=>boolean;
}
const U=SOURCE_UNIT,dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y),alive=(u:Unit)=>u.hp>0;
const statuses=(u:Unit)=>(u.statuses??=[]);
export const hasStatus=(u:Unit,kind:string,time:number)=>statuses(u).some(st=>st.kind===kind&&st.until>time);
export const bodyRadius=(u:Unit)=>u.radius??(u.kind==='hero'?30:u.kind==='tower'||u.kind==='base'?45:20);
const enemies=(s:MatchState,u:Unit,p:Point,r:number)=>s.units.filter(t=>t.team!==u.team&&alive(t)&&dist(t,p)<=r+bodyRadius(t));
const powerOf=(u:Unit,rank:number):Power=>({ad:u.damage,ap:u.ap??0,scale:1+.55*(rank-1)});
function add(u:Unit,st:CombatStatus){statuses(u).push(st);}
export function breakSkillStealth(u:Unit){u.statuses=statuses(u).filter(st=>st.kind!=='stealth');}
export function speedMultiplier(u:Unit,time:number){const active=statuses(u).filter(st=>st.until>time),slow=Math.max(0,...active.filter(st=>st.kind==='slow').map(st=>st.pct??0));return(1-slow)*(1+active.filter(st=>st.kind==='buff').reduce((n,st)=>n+(st.msPct??0),0));}
export function attackCadence(u:Unit,time:number){return (1/u.attackCd)*(1+statuses(u).filter(st=>st.kind==='buff'&&st.until>time).reduce((n,st)=>n+(st.asPct??0),0));}

export function applySourceEffects(s:MatchState,source:Unit,target:Unit,specs:any[],power:Power,h:CombatHooks,via='ability',ctx:{center?:Point;distance?:number}={}) {
  if((target.kind==='tower'||target.kind==='base')&&via==='ability')return;
  for(const spec of specs){
    if(!alive(target)&&spec.kind!=='conditional'&&spec.kind!=='cooldownRefund')continue;
    switch(spec.kind){
      case 'damage':h.hurt(s,source,target,spec.base*power.scale+(spec.adRatio??0)*power.ad+(spec.apRatio??0)*power.ap+(spec.maxHpPct??0)*target.maxHp,spec.dtype,via);break;
      case 'slow':case 'root':case 'stun':case 'stealth':case 'untargetable':add(target,{kind:spec.kind,until:s.time+spec.duration,pct:spec.pct});break;
      case 'buff':add(target,{...spec,until:s.time+spec.duration});break;
      case 'shield':add(target,{kind:'shield',until:s.time+spec.duration,remaining:spec.base*power.scale+(spec.apRatio??0)*power.ap,burst:spec.burst,sourceId:source.id,power});syncShield(target,s.time);h.effect(s,'shield',target.team,target,{radius:bodyRadius(target)+20});break;
      case 'dot':add(target,{kind:'dot',until:s.time+spec.duration,perSecond:spec.perSecond*power.scale+(spec.adRatio??0)*power.ad+(spec.apRatio??0)*power.ap,sourceId:source.id,dtype:spec.dtype});break;
      case 'empower':add(target,{...spec,until:s.time+spec.duration,power});break;
      case 'mark':{let mark=statuses(target).find(st=>st.kind==='mark'&&st.sourceId===source.id&&st.until>s.time);if(!mark){mark={kind:'mark',until:s.time+spec.duration,sourceId:source.id,stacks:0};add(target,mark);}mark.until=s.time+spec.duration;mark.stacks++;if(mark.stacks>=spec.stacksToTrigger){target.statuses=statuses(target).filter(st=>st!==mark);applySourceEffects(s,source,target,spec.onTrigger,power,h,via,ctx);}break;}
      case 'cooldownRefund':{const slot=['Q','W','E','R'].indexOf(spec.key);if(source.cooldowns)source.cooldowns[slot]*=1-spec.pctOfRemaining;break;}
      case 'conditional':{const w=spec.when;const pass=w.kind==='targetIsChampion'?target.kind==='hero':w.kind==='targetDying'?target.hp<=0:w.kind==='withinCenter'?!!ctx.center&&dist(target,ctx.center)<=w.radius*U+bodyRadius(target):w.kind==='distanceAtLeast'?(ctx.distance??0)>=w.distance*U:w.kind==='targetIsolated'?!s.units.some(t=>t.id!==target.id&&t.kind==='hero'&&t.team===target.team&&alive(t)&&dist(t,target)<=w.radius*U):false;applySourceEffects(s,source,target,pass?spec.effects:spec.otherwise??[],power,h,via,ctx);break;}
    }
  }
}
function syncShield(u:Unit,time:number){u.shield=statuses(u).filter(st=>st.kind==='shield'&&st.until>time).reduce((n,st)=>n+(st.remaining??0),0);}
function burst(s:MatchState,holder:Unit,st:CombatStatus,reason:'onBreak'|'onExpire',h:CombatHooks){const source=s.units.find(u=>u.id===st.sourceId),spec=st.burst;if(!source||!spec?.[reason]?.length)return;h.effect(s,'nova',source.team,holder,{radius:spec.radius*U,sourceId:source.id,abilityId:`${source.heroKind}_E`},.4);for(const t of enemies(s,source,holder,spec.radius*U))applySourceEffects(s,source,t,spec[reason],st.power,h,'ability',{center:holder});}
export function mitigateSourceDamage(s:MatchState,source:Unit,target:Unit,amount:number,dtype:string,via:string,h:CombatHooks){
  if(hasStatus(target,'untargetable',s.time))return 0;
  if(source.heroKind==='fenn'&&target.hp/target.maxHp<.35)amount*=1.15;
  if(source.heroKind==='dain'&&via==='ability'&&(source.passiveStacks??0)>=4){source.passiveStacks=0;amount*=1.25;}
  const resistance=dtype==='physical'?(target.armor??0):dtype==='magic'?(target.mr??0):0;
  const flat=dtype==='physical'?(source.armorPen??0):(source.mrPen??0),pct=dtype==='physical'?(source.armorPenPct??0):(source.mrPenPct??0);
  amount*=dtype==='true'?1:100/(100+Math.max(0,resistance*(1-pct)-flat));
  let remaining=amount;
  const depleted:CombatStatus[]=[];
  for(const st of statuses(target)){if(st.kind!=='shield'||st.until<=s.time)continue;const take=Math.min(remaining,st.remaining);st.remaining-=take;remaining-=take;if(st.remaining<=1e-8)depleted.push(st);if(remaining<=0)break;}
  target.statuses=statuses(target).filter(st=>!depleted.includes(st));syncShield(target,s.time);
  for(const st of depleted)burst(s,target,st,'onBreak',h);
  return remaining;
}
export function onSourceTakedown(s:MatchState,target:Unit){if(target.kind!=='hero')return;for(const u of s.units){const recent=target.recentDamagers?.find(r=>r.id===u.id);if(!recent||!u.cooldowns)continue;if((u.heroKind==='dain'&&s.time-recent.at<=.6)||(u.heroKind==='fenn'&&s.time-recent.at<=2))u.cooldowns[0]=0;}}

function allyNear(s:MatchState,caster:Unit,aim:Point,range:number,search:number,jump:boolean){let best:Unit|undefined,bestD=jump?Infinity:Math.min(search,dist(caster,aim));for(const u of s.units){if(u.id===caster.id||u.team!==caster.team||!alive(u)||(u.kind!=='hero'&&u.kind!=='melee'&&u.kind!=='ranged'))continue;if(jump&&dist(caster,u)-bodyRadius(u)>range)continue;const d=dist(u,aim)-(jump?bodyRadius(u):0);if(d<=search&&d<bestD){bestD=d;best=u;}}return best;}
function cancelOrders(u:Unit){u.moveTarget=null;u.attackMoveTarget=null;u.targetId=null;u.orderedTargetId=null;u.pendingAttack=undefined;}
function putZone(s:MatchState,hero:Unit,at:Point,spec:any,power:Power,abilityId:string){const expiresAt=s.time+Math.max(spec.duration,(spec.detonateDelay??0)+.05);s.projectiles.push({id:`zone-${++s.sequence}`,kind:'nova',team:hero.team,ownerId:hero.id,x:at.x,y:at.y,startX:at.x,startY:at.y,dirX:0,dirY:0,speed:0,range:0,radius:spec.radius*U,damage:0,activateAt:s.time+(spec.detonateDelay??0),createdAt:s.time,expiresAt,tickEvery:spec.tickEvery??.5,...(spec.detonateDelay!==undefined?{detonateAt:s.time+spec.detonateDelay}:{}),hitIds:[],power,abilityId,zone:{spec,until:expiresAt,nextTick:s.time+(spec.tickEvery??.5),detonated:false,entered:[]}});}
function execute(s:MatchState,hero:Unit,slot:SkillSlot,aim:Point,h:CombatHooks){const rank=hero.skillRanks[slot],skill=skillForRank(hero.heroKind!,slot,rank),spec=skill.spec,power=powerOf(hero,rank),abilityId=`${hero.heroKind}_${skill.key}`;
  if(spec.kind==='dash'){
    let goal=aim;if(spec.toAlly){const ally=allyNear(s,hero,aim,spec.range*U,spec.toAlly.searchRadius*U,true);if(!ally)return false;const d=dist(hero,ally),stop=Math.max(0,d-bodyRadius(hero)-bodyRadius(ally)-.15*U);goal=d<.01?{x:hero.x,y:hero.y}:{x:hero.x+(ally.x-hero.x)/d*stop,y:hero.y+(ally.y-hero.y)/d*stop};}
    const end=h.endpoint(hero,goal,spec.range*U),d=dist(hero,end);cancelOrders(hero);
    hero.activeDash={from:{x:hero.x,y:hero.y},end,speed:spec.speed*U,remaining:d,traveled:0,power,spec,hitIds:[],abilityId};
    if(spec.untargetableDuringTravel)add(hero,{kind:'untargetable',until:s.time+d/(spec.speed*U)+.05});
  }else if(spec.kind==='skillshot'){
    const d=dist(hero,aim),dx=d>.01?(aim.x-hero.x)/d:hero.team===0?1:-1,dy=d>.01?(aim.y-hero.y)/d:0;
    s.projectiles.push({id:`shot-${++s.sequence}`,kind:'bolt',team:hero.team,ownerId:hero.id,x:hero.x,y:hero.y,startX:hero.x,startY:hero.y,dirX:dx,dirY:dy,speed:spec.speed*U,range:spec.range*U,radius:spec.radius*U,damage:0,hitIds:[],effects:spec.onHit,power,chain:spec.chain,pierce:spec.pierce??false,abilityId});
  }else if(spec.kind==='zone'){const d=dist(hero,aim),t=d>skill.range?skill.range/d:1;putZone(s,hero,{x:hero.x+(aim.x-hero.x)*t,y:hero.y+(aim.y-hero.y)*t},spec,power,abilityId);
  }else if(spec.kind==='cone'){let dx=aim.x-hero.x,dy=aim.y-hero.y,len=Math.hypot(dx,dy);if(len<.01){dx=1;dy=0;len=1;}for(const target of enemies(s,hero,hero,spec.range*U)){const tx=target.x-hero.x,ty=target.y-hero.y;if(dx*tx+dy*ty>=Math.cos(spec.halfAngle)*len*Math.hypot(tx,ty))applySourceEffects(s,hero,target,spec.onHit,power,h);}
    h.effect(s,'slash',hero.team,hero,{toX:aim.x,toY:aim.y,radius:spec.range*U,abilityId},.35);
  }else if(spec.kind==='self_or_ally'){const ally=allyNear(s,hero,aim,skill.range,spec.searchRadius*U,false);applySourceEffects(s,hero,ally??hero,spec.effects,power,h);}
  return true;
}
export function castSourceSkill(s:MatchState,hero:Unit,slot:SkillSlot,aim:Point,h:CombatHooks):{ok:boolean;error?:string}{
  if(hasStatus(hero,'stun',s.time))return{ok:false,error:'当前无法施法'};
  if(hero.recastArmed?.slot===slot&&hero.recastArmed.until>s.time){if(hasStatus(hero,'root',s.time))return{ok:false,error:'禁锢期间无法位移'};const from={x:hero.x,y:hero.y},end=h.endpoint(hero,hero.recastArmed.origin,Infinity);hero.x=end.x;hero.y=end.y;hero.recastArmed=undefined;hero.activeDash=undefined;hero.pendingSpell=undefined;cancelOrders(hero);breakSkillStealth(hero);h.effect(s,'dash',hero.team,from,{toX:end.x,toY:end.y,sourceId:hero.id,abilityId:`${hero.heroKind}_R`},.5);return{ok:true};}
  const rank=hero.skillRanks[slot];if(!rank)return{ok:false,error:'请先学习这个技能'};
  const skill=skillForRank(hero.heroKind!,slot,rank),spec=skill.spec;
  if(hero.cooldowns![slot]>0)return{ok:false,error:'技能还在冷却'};
  if(hero.mana!<skill.mana)return{ok:false,error:'法力不足'};
  if(spec.kind==='dash'&&hasStatus(hero,'root',s.time))return{ok:false,error:'禁锢期间无法位移'};
  if(spec.toAlly&&!allyNear(s,hero,aim,skill.range,spec.toAlly.searchRadius*U,true))return{ok:false,error:'请瞄准范围内的友方英雄或小兵'};
  hero.cooldowns![slot]=skill.cooldown;hero.mana!-=skill.mana;breakSkillStealth(hero);
  if(hero.heroKind==='dain'&&slot===2)hero.passiveStacks=Math.min(4,(hero.passiveStacks??0)+1);
  if(hero.heroKind==='ashvyn'&&slot===1)hero.passiveStacks=2;
  const original=SOURCE_HEROES[hero.heroKind!].abilities[skill.key];
  if(original.recast)hero.recastArmed={slot,until:s.time+original.recast.window,origin:{x:hero.x,y:hero.y}};
  if(original.windup){hero.pendingSpell={slot,aim:{...aim},resolveAt:s.time+original.windup};cancelOrders(hero);}else execute(s,hero,slot,aim,h);
  return{ok:true};
}

function onAttackHit(s:MatchState,a:Unit,t:Unit,h:CombatHooks){if(a.heroKind==='dain')a.passiveStacks=Math.min(4,(a.passiveStacks??0)+1);if(a.heroKind==='ashvyn'){a.passiveStacks=(a.passiveStacks??0)+1;if(a.passiveStacks>=3){a.passiveStacks=0;h.hurt(s,a,t,a.damage*.5,'physical','other');}}}
export function resolveSourceAttack(s:MatchState,a:Unit,t:Unit,h:CombatHooks){
  const empower=statuses(a).find(st=>st.kind==='empower'&&st.until>s.time);if(empower)a.statuses=statuses(a).filter(st=>st!==empower);
  if(a.range>2*U){const d=dist(a,t);s.projectiles.push({id:`auto-${++s.sequence}`,kind:'bolt',team:a.team,ownerId:a.id,x:a.x,y:a.y,startX:a.x,startY:a.y,dirX:d?(t.x-a.x)/d:1,dirY:d?(t.y-a.y)/d:0,speed:30*U,range:1000000,radius:.35*U,damage:0,hitIds:[],homingTargetId:t.id,effects:[{kind:'damage',base:0,adRatio:1,dtype:'physical'},...(empower?.bonus??[])],power:empower?.power??{ad:a.damage,ap:a.ap??0,scale:1},via:'attack',splash:empower?{radius:empower.splashRadius*U,effects:empower.splash,power:empower.power}:undefined,abilityId:`${a.heroKind??a.kind}_A`});
  }else{h.hurt(s,a,t,a.damage,'physical','attack');if(empower){const currentPower={ad:a.damage,ap:a.ap??0,scale:empower.power.scale};applySourceEffects(s,a,t,empower.bonus,currentPower,h,'attack');for(const other of enemies(s,a,t,(empower.splashRadius??0)*U))if(other.id!==t.id)applySourceEffects(s,a,other,empower.splash??[],currentPower,h,'attack');}onAttackHit(s,a,t,h);}
}
function segmentDistance(p:Point,a:Point,b:Point){const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;return dist(p,{x:a.x+dx*t,y:a.y+dy*t});}
export function stepSourceCombat(s:MatchState,dt:number,h:CombatHooks){
  for(const u of s.units){
    if(!alive(u)){u.activeDash=undefined;u.pendingSpell=undefined;u.pendingAttack=undefined;u.statuses=[];u.shield=0;continue;}
    const expired=statuses(u).filter(st=>st.until<=s.time);u.statuses=statuses(u).filter(st=>st.until>s.time);for(const st of expired)if(st.kind==='shield')burst(s,u,st,'onExpire',h);syncShield(u,s.time);
    for(const st of [...statuses(u)])if(st.kind==='dot'){const owner=s.units.find(t=>t.id===st.sourceId);if(owner)h.hurt(s,owner,u,st.perSecond*dt,st.dtype,'other');}
    if(!alive(u))continue;
    if(u.recastArmed&&u.recastArmed.until<=s.time)u.recastArmed=undefined;
    if(u.pendingSpell){if(hasStatus(u,'stun',s.time)){u.pendingSpell=undefined;u.recastArmed=undefined;}else if(s.time>=u.pendingSpell.resolveAt){const p=u.pendingSpell;u.pendingSpell=undefined;execute(s,u,p.slot,p.aim,h);}}
    if(u.activeDash){const dash=u.activeDash,from={x:u.x,y:u.y},d=dist(u,dash.end),length=Math.min(d,dash.speed*dt);if(d>.001){u.x+=(dash.end.x-u.x)/d*length;u.y+=(dash.end.y-u.y)/d*length;}dash.traveled+=length;dash.remaining=Math.max(0,d-length);
      for(const t of s.units.filter(t=>t.team!==u.team&&alive(t)&&!dash.hitIds.includes(t.id)))if(segmentDistance(t,from,u)<=.9*U+bodyRadius(t)){dash.hitIds.push(t.id);applySourceEffects(s,u,t,dash.spec.passThrough??[],dash.power,h,'ability',{center:u,distance:dash.traveled});}
      h.effect(s,'dash',u.team,from,{toX:u.x,toY:u.y,sourceId:u.id,abilityId:dash.abilityId},.16);
      if(dash.remaining<.01){u.activeDash=undefined;for(const t of enemies(s,u,u,(dash.spec.landRadius??0)*U))applySourceEffects(s,u,t,dash.spec.onLand??[],dash.power,h,'ability',{center:u,distance:dash.traveled});applySourceEffects(s,u,u,dash.spec.selfEffects??[],dash.power,h);}
    }
    if(u.pendingAttack){const pending=u.pendingAttack,target=s.units.find(t=>t.id===pending.targetId);const invalid=!target||!alive(target)||hasStatus(u,'stun',s.time)||hasStatus(target,'stealth',s.time)||hasStatus(target,'untargetable',s.time)||dist(u,pending.start)>.8*U;
      if(invalid){u.pendingAttack=undefined;u.attackTimer=0;}else if(s.time>=pending.resolveAt){u.pendingAttack=undefined;if(dist(u,target)<=u.range+bodyRadius(u)+bodyRadius(target)+2*U)resolveSourceAttack(s,u,target,h);}}
  }
  const spawned:Projectile[]=[];
  s.projectiles=s.projectiles.filter(p=>{
    if(!p.power)return false;const source=s.units.find(u=>u.id===p.ownerId);if(!source)return false;
    if(p.zone){const z=p.zone,sp=z.spec;const targets=enemies(s,source,p,p.radius);
      if(sp.reveal)for(const t of targets){let reveal=statuses(t).find(st=>st.kind==='revealed');if(!reveal){reveal={kind:'revealed',until:s.time+.1};add(t,reveal);}reveal.until=s.time+.1;}
      for(const t of targets)if(!z.entered.includes(t.id)){z.entered.push(t.id);applySourceEffects(s,source,t,sp.onEnter??[],p.power,h,'ability',{center:p});}
      if(s.time>=z.nextTick){z.nextTick+=sp.tickEvery??.5;for(const t of targets)applySourceEffects(s,source,t,sp.onTick??[],p.power,h,'ability',{center:p});}
      if(!z.detonated&&sp.detonateDelay!==undefined&&s.time+1e-8>=p.activateAt!){z.detonated=true;for(const t of targets)applySourceEffects(s,source,t,sp.onDetonate??[],p.power,h,'ability',{center:p});h.effect(s,'nova',source.team,p,{radius:p.radius,sourceId:source.id,abilityId:p.abilityId,text:'爆发'},.4);if(sp.leaveZone){const prior=s.projectiles.length;putZone(s,source,p,{...sp.leaveZone,tickEvery:.5},p.power,p.abilityId??'');spawned.push(...s.projectiles.splice(prior));}return false;}
      return s.time+1e-8<z.until;
    }
    const from={x:p.x,y:p.y},homing=p.homingTargetId?s.units.find(u=>u.id===p.homingTargetId):undefined;
    if(p.homingTargetId&&(!homing||!alive(homing)))return false;
    if(homing){const d=dist(p,homing);p.dirX=d?(homing.x-p.x)/d:0;p.dirY=d?(homing.y-p.y)/d:0;}
    const traveled=dist(p,{x:p.startX,y:p.startY}),length=homing?Math.min(p.speed*dt,dist(p,homing)):Math.min(p.speed*dt,Math.max(0,p.range-traveled));p.x+=p.dirX*length;p.y+=p.dirY*length;
    const targets=(homing?[homing]:s.units.filter(u=>u.team!==p.team&&alive(u)&&(p.via==='attack'||(u.kind!=='tower'&&u.kind!=='base')))).filter(t=>!p.hitIds.includes(t.id)&&segmentDistance(t,from,p)<=p.radius+bodyRadius(t)).sort((a,b)=>dist(from,a)-dist(from,b));
    for(const t of targets){p.hitIds.push(t.id);applySourceEffects(s,source,t,p.effects??[],p.power,h,p.via??'ability',{center:p,distance:dist(t,{x:p.startX,y:p.startY})});
      if(p.via==='attack'){if(alive(source))onAttackHit(s,source,t,h);if(p.splash)for(const other of enemies(s,source,t,p.splash.radius))if(other.id!==t.id)applySourceEffects(s,source,other,p.splash.effects,p.splash.power,h,'attack');}
      if(p.chain){const other=enemies(s,source,t,p.chain.radius*U).filter(u=>u.id!==t.id&&dist(u,t)<=p.chain.radius*U&&u.kind!=='tower'&&u.kind!=='base'&&!hasStatus(u,'stealth',s.time)&&!hasStatus(u,'untargetable',s.time)).sort((a,b)=>dist(a,t)-dist(b,t))[0];if(other){p.x=t.x;p.y=t.y;p.homingTargetId=other.id;p.effects=p.chain.onHit;p.chain=undefined;return true;}}
      if(!p.pierce)return false;
    }
    return !!homing||traveled+length<p.range;
  });s.projectiles.push(...spawned);
}
