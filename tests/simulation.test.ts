import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, bushAt, createMatch, displacementEndpoint, getHero, isPointInTeamVision, isUnitTargetableBy, isUnitVisibleToTeam, isWater, stepMatch } from '../src/shared/simulation.ts';
import { HEROES, ITEMS, RULES, SOURCE_HEROES, SUMMONERS, TERRAIN, WORLD, xpForNextLevel } from '../src/shared/data.ts';
import type { HeroKind, MatchState, Team, Unit } from '../src/shared/types.ts';

const lane=WORLD.laneY;
const close=(actual:number,expected:number,label='value')=>assert.ok(Math.abs(actual-expected)<1e-7,`${label}: expected ${expected}, got ${actual}`);
function advance(s:MatchState,seconds:number){for(let i=0;i<Math.round(seconds*20);i++)stepMatch(s,.05);}
function until(s:MatchState,predicate:()=>boolean,seconds=3){for(let i=0;i<Math.round(seconds*20)&&!predicate();i++)stepMatch(s,.05);assert.ok(predicate(),'expected gameplay condition within bounded simulation time');}
function place(u:Unit,x:number,y=lane){u.x=x;u.y=y;}
function quiet(u:Unit){u.hpRegen=0;u.manaRegen=0;u.attackTimer=999;u.targetId=null;u.orderedTargetId=null;u.moveTarget=null;u.attackMoveTarget=null;u.pendingAttack=undefined;}
function fixture(choices:[HeroKind,HeroKind]=['sylra','dain'],structures=false){const s=createMatch(choices);s.nextWave=Infinity;if(!structures)s.units=s.units.filter(u=>u.kind==='hero');for(const u of s.units)quiet(u);return s;}
function troop(s:MatchState,id:string,team:Team,x:number,y=lane):Unit{const model=getHero(s,team);const u:Unit={...model,id,team,kind:'melee',heroKind:undefined,name:id,x,y,hp:300,maxHp:300,armor:0,mr:0,radius:20,damage:0,range:43,speed:0,attackCd:1,attackTimer:999,targetId:null,orderedTargetId:null,moveTarget:null,attackMoveTarget:null,statuses:[],recentDamagers:[],items:[],skillRanks:[],passiveStacks:0,pendingAttack:undefined,pendingSpell:undefined,activeDash:undefined};s.units.push(u);return u;}
function buy(s:MatchState,team:Team,itemId:string){const result=applyCommand(s,team,{type:'buy',itemId});assert.equal(result.ok,true,result.error);quiet(getHero(s,team));}
function attack(s:MatchState,team:Team,target:Unit){const hero=getHero(s,team);hero.attackTimer=0;assert.equal(applyCommand(s,team,{type:'attack',targetId:target.id}).ok,true);}

test('single lane starts with one tower and base per team, waves and passive income',()=>{
 const s=createMatch();assert.equal(s.units.filter(u=>u.kind==='hero').length,2);assert.equal(s.units.filter(u=>u.kind==='tower').length,2);assert.equal(s.units.filter(u=>u.kind==='base').length,2);
 for(const team of [0,1] as Team[]){assert.equal(getHero(s,team).x,WORLD.spawnX[team]);assert.equal(getHero(s,team).gold,RULES.startingGold);}
 const tower=s.units.find(u=>u.kind==='tower')!,edge=Math.max(lane-WORLD.minY,WORLD.maxY-lane);assert.ok(edge<tower.range);assert.ok(2*Math.sqrt(tower.range**2-edge**2)>SUMMONERS.flash.range,'one flash cannot bypass the entire tower range');
 advance(s,3.1);assert.equal(s.wave,1);assert.equal(s.units.filter(u=>u.kind==='melee').length,6);assert.equal(s.units.filter(u=>u.kind==='ranged').length,2);assert.ok(s.units.filter(u=>u.kind==='melee').every(u=>Math.abs(u.y-lane)<=18));close(getHero(s,0).gold!,RULES.startingGold+3.1*RULES.passiveGoldPerSecond);
});

test('protected base refuses attacks, source spells spare structures, exposed base takes autoattacks',()=>{
 const s=fixture(['sylra','dain'],true),hero=getHero(s,0),enemy=getHero(s,1),base=s.units.find(u=>u.id==='base-1')!;place(hero,base.x+90);place(enemy,1500);
 assert.equal(applyCommand(s,0,{type:'attack',targetId:base.id}).ok,false);hero.skillRanks[0]=1;assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:base.x,y:base.y}).ok,true);advance(s,1);assert.equal(base.hp,base.maxHp);
 s.units.find(u=>u.id==='tower-1')!.hp=0;hero.cooldowns![0]=0;assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:base.x,y:base.y}).ok,true);advance(s,1);assert.equal(base.hp,base.maxHp,'source abilities do not damage structures even after protection ends');
 attack(s,0,base);until(s,()=>base.hp<base.maxHp);
});

test('only the hero final blow grants last-hit gold',()=>{
 const s=fixture(),hero=getHero(s,0);place(hero,1800);place(getHero(s,1),4000);const victim=troop(s,'last-hit',1,1900);victim.hp=1;const gold=hero.gold!;attack(s,0,victim);until(s,()=>victim.hp===0);
 assert.equal(hero.lastHits,1);close(hero.gold!-gold,38+s.time*RULES.passiveGoldPerSecond);assert.equal(s.units.some(u=>u.id===victim.id),false);
});

test('allied troop kills grant nearby XP but no shared last-hit gold',()=>{
 const s=fixture(),hero=getHero(s,0);place(hero,1800);const ally=troop(s,'ally',0,1900),victim=troop(s,'victim',1,1930);ally.damage=999;ally.attackTimer=0;victim.hp=1;
 const gold=hero.gold!;until(s,()=>victim.hp===0);assert.equal(hero.lastHits,0);assert.equal(hero.xp,42);close(hero.gold!-gold,s.time*RULES.passiveGoldPerSecond);
});

test('equipment uses catalog prices and source stats, with six slots at any location or while dead',()=>{
 const s=fixture(['dain','sylra']),hero=getHero(s,0),sword=ITEMS.find(i=>i.id==='sword')!;place(hero,2000);const damage=hero.damage;
 buy(s,0,'sword');assert.equal(hero.gold,RULES.startingGold-sword.cost);assert.equal(hero.damage,damage+sword.damage!);assert.equal(applyCommand(s,0,{type:'buy',itemId:'sword'}).ok,false);
 hero.gold=9999;hero.hp=0;hero.respawnAt=Infinity;for(let i=0;i<5;i++)buy(s,0,'heart');assert.equal(hero.items!.length,6);const gold=hero.gold;assert.equal(applyCommand(s,0,{type:'buy',itemId:'heart'}).ok,false);assert.equal(hero.gold,gold);assert.equal(applyCommand(s,0,{type:'buy',itemId:'missing'}).ok,false);
});

test('casts enforce learned ranks, mana and cooldown; invalid coordinates never mutate orders',()=>{
 const s=fixture(),hero=getHero(s,0);place(hero,1800);hero.skillRanks[0]=1;const data=HEROES.sylra.skills[0],mana=hero.mana!;
 assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:2000,y:lane}).ok,true);close(hero.mana!,mana-data.mana);assert.equal(hero.cooldowns![0],data.cooldown);assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:2000,y:lane}).ok,false);
 hero.cooldowns![0]=0;hero.mana=0;assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:2000,y:lane}).ok,false);
 assert.equal(applyCommand(s,0,{type:'move',x:Infinity,y:NaN}).ok,false);assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:NaN,y:lane}).ok,false);assert.equal(hero.moveTarget,null);
 assert.equal(applyCommand(s,0,{type:'move',x:999999,y:-999999}).ok,true);advance(s,2);assert.ok(Number.isFinite(hero.x)&&hero.x<=WORLD.maxX&&hero.y>=WORLD.minY);
});

test('kill rewards and equipment persist through a timed full-health respawn',()=>{
 const s=fixture(),a=getHero(s,0),b=getHero(s,1);buy(s,1,'sword');place(a,1800);place(b,1900);b.hp=1;const gold=a.gold!;attack(s,0,b);until(s,()=>b.hp===0);const deathAt=s.time;
 assert.equal(b.deaths,1);assert.equal(a.kills,1);close(a.gold!-gold,220+s.time*RULES.passiveGoldPerSecond);assert.equal(applyCommand(s,1,{type:'move',x:2000,y:lane}).ok,false);
 quiet(a);place(a,WORLD.spawnX[0]);advance(s,RULES.respawnSeconds-.1);assert.equal(b.hp,0);until(s,()=>b.hp>0,.3);assert.ok(s.time>=deathAt+RULES.respawnSeconds);assert.equal(b.x,WORLD.spawnX[1]);assert.equal(b.y,lane);assert.equal(b.hp,b.maxHp);assert.equal(b.mana,b.maxMana);assert.deepEqual(b.items,['sword']);
});

test('tower fires at allied troops first and retaliates when a source skill hits its defending hero',()=>{
 const s=fixture(['sylra','dain'],true),a=getHero(s,0),b=getHero(s,1),tower=s.units.find(u=>u.id==='tower-1')!;place(a,tower.x-200);place(b,tower.x-60);const minion=troop(s,'frontline',0,tower.x-90);minion.hp=minion.maxHp=10000;tower.attackTimer=0;
 stepMatch(s,.05);assert.equal(tower.targetId,minion.id);a.skillRanks[0]=1;assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:b.x,y:b.y}).ok,true);until(s,()=>tower.targetId===a.id,1);assert.ok(b.hp<b.maxHp);
});

test('destroying an exposed base ends and freezes the match',()=>{
 const s=fixture(['sylra','dain'],true),hero=getHero(s,0),base=s.units.find(u=>u.id==='base-1')!;place(hero,base.x+90);place(getHero(s,1),1500);s.units.find(u=>u.id==='tower-1')!.hp=0;base.hp=1;attack(s,0,base);until(s,()=>s.status==='finished');
 assert.equal(s.winner,0);const time=s.time,gold=hero.gold;advance(s,3);assert.equal(s.time,time);assert.equal(hero.gold,gold);assert.equal(applyCommand(s,0,{type:'move',x:1800,y:lane}).ok,false);
});

test('bot follows waves to a complete finite match without unbounded troops',()=>{
 const s=createMatch(['dain','sylra'],[1]);advance(s,1200);assert.equal(s.status,'finished');assert.equal(s.winner,1);assert.ok(s.units.every(u=>Number.isFinite(u.hp)&&Number.isFinite(u.x)&&Number.isFinite(u.y)));assert.ok(s.units.length<150);assert.ok(s.wave>5);
});

test('idle heroes do not chase escaped enemies while explicit movement permits kiting',()=>{
 const s=fixture(),hero=getHero(s,0),enemy=getHero(s,1);place(hero,1800);place(enemy,2000);stepMatch(s,.05);assert.equal(hero.targetId,enemy.id);enemy.x=2300;const x=hero.x;stepMatch(s,.05);assert.equal(hero.x,x);assert.equal(hero.targetId,null);
 assert.equal(applyCommand(s,0,{type:'attack',targetId:enemy.id}).ok,true);stepMatch(s,.05);assert.ok(hero.x>x);assert.equal(applyCommand(s,0,{type:'move',x:1700,y:WORLD.minY}).ok,true);advance(s,3);assert.equal(hero.y,WORLD.minY);assert.equal(hero.targetId,null);
});

test('summoners have independent no-mana cooldowns retained across death',()=>{
 const s=fixture(),hero=getHero(s,0);place(hero,1800);hero.hp=100;hero.mana=0;hero.cooldowns=[5,6,7,8];
 assert.equal(applyCommand(s,0,{type:'summoner',slot:'heal',x:hero.x,y:lane}).ok,true);assert.ok(hero.hp>100);assert.equal(hero.summonerCooldowns!.heal,SUMMONERS.heal.cooldown);
 assert.equal(applyCommand(s,0,{type:'summoner',slot:'flash',x:2200,y:lane}).ok,true);close(hero.x,1800+SUMMONERS.flash.range);assert.equal(hero.summonerCooldowns!.flash,SUMMONERS.flash.cooldown);assert.deepEqual(hero.cooldowns,[5,6,7,8]);assert.equal(hero.mana,0);
 assert.equal(applyCommand(s,0,{type:'summoner',slot:'heal',x:hero.x,y:lane}).ok,false);hero.hp=0;hero.respawnAt=s.time+RULES.respawnSeconds;advance(s,RULES.respawnSeconds+.1);assert.ok(hero.hp>0);assert.ok(hero.summonerCooldowns!.heal>SUMMONERS.heal.cooldown-RULES.respawnSeconds-1);assert.ok(hero.summonerCooldowns!.flash>SUMMONERS.flash.cooldown-RULES.respawnSeconds-1);
});

test('skill points spend once, basic ranks cap at five, and R gates at four seven and ten',()=>{
 const s=createMatch(),hero=getHero(s,0);assert.equal(hero.level,1);assert.equal(hero.skillPoints,1);assert.deepEqual(hero.skillRanks,[0,0,0,0]);const mana=hero.mana;
 assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:hero.x+100,y:lane}).ok,false);assert.equal(hero.mana,mana);assert.equal(applyCommand(s,0,{type:'upgrade',slot:3}).ok,false);assert.equal(hero.skillPoints,1);assert.equal(applyCommand(s,0,{type:'upgrade',slot:0}).ok,true);assert.equal(hero.skillPoints,0);assert.equal(applyCommand(s,0,{type:'upgrade',slot:1}).ok,false);
 hero.skillPoints=20;for(const level of [4,7,10]){hero.level=level;assert.equal(applyCommand(s,0,{type:'upgrade',slot:3}).ok,true);assert.equal(applyCommand(s,0,{type:'upgrade',slot:3}).ok,false);}while(hero.skillRanks[0]<5)assert.equal(applyCommand(s,0,{type:'upgrade',slot:0}).ok,true);assert.equal(applyCommand(s,0,{type:'upgrade',slot:0}).ok,false);
});

test('nearby XP levels a hero with source growth and stops at ten without granting last-hit gold',()=>{
 const s=fixture(['dain','sylra']),hero=getHero(s,0);place(hero,1800);const ally=troop(s,'xp-ally',0,1900);ally.damage=999;const initialHp=hero.maxHp,initialDamage=hero.damage,initialGold=hero.gold!;
 for(let i=0;i<90;i++){const victim=troop(s,`xp-${i}`,1,1930);victim.hp=1;ally.attackTimer=0;ally.targetId=victim.id;until(s,()=>victim.hp===0,.5);if(i===2){assert.equal(hero.level,2);assert.equal(hero.xp,6);assert.equal(hero.skillPoints,2);assert.equal(hero.maxHp,initialHp+SOURCE_HEROES.dain.growth.hp);assert.equal(hero.damage,initialDamage+SOURCE_HEROES.dain.growth.ad);}}
 assert.equal(hero.lastHits,0);close(hero.gold!-initialGold,s.time*RULES.passiveGoldPerSecond);assert.equal(hero.level,10);assert.equal(hero.xp,0);assert.equal(hero.skillPoints,10);assert.equal(hero.maxHp,initialHp+9*SOURCE_HEROES.dain.growth.hp);assert.equal(xpForNextLevel(2),165);
});

test('attack move kills an encountered enemy then resumes its ground destination',()=>{
 const s=fixture(),hero=getHero(s,0),enemy=getHero(s,1);place(hero,1800);place(enemy,2150);enemy.hp=1;hero.attackTimer=0;assert.equal(applyCommand(s,0,{type:'attackMove',x:2800,y:lane}).ok,true);stepMatch(s,.05);assert.equal(hero.targetId,enemy.id);
 until(s,()=>enemy.hp===0);advance(s,1);assert.equal(hero.kills,1);assert.ok(hero.x>1800,'after the kill the hero resumes moving along its ground order');assert.equal(hero.attackMoveTarget?.x,2800);
});

test('right click movement cancels attack move and retreats without starting an attack',()=>{
 const s=fixture(),hero=getHero(s,0),enemy=getHero(s,1);place(hero,1800);place(enemy,2000);applyCommand(s,0,{type:'attackMove',x:2700,y:lane});stepMatch(s,.05);assert.equal(hero.targetId,enemy.id);const hp=enemy.hp;
 hero.attackTimer=0;applyCommand(s,0,{type:'move',x:1400,y:WORLD.minY});advance(s,1);assert.equal(hero.attackMoveTarget,null);assert.equal(hero.targetId,null);assert.ok(hero.x<1800);assert.ok(hero.y<lane);assert.equal(enemy.hp,hp);
});

test('source natural regeneration is uniform at the base and in the lane, with no fountain bonus',()=>{
 const s=fixture(['dain','dain']),a=getHero(s,0),b=getHero(s,1),source=SOURCE_HEROES.dain.base;for(const u of [a,b]){u.hp=100;u.mana=0;u.hpRegen=source.hpRegen;u.manaRegen=source.manaRegen;}place(b,3000);advance(s,1);
 close(a.hp,100+source.hpRegen);close(b.hp,a.hp);close(a.mana!,source.manaRegen);close(b.mana!,a.mana!);
});

test('full potion restores both resources gradually over eight seconds independent of natural regeneration',()=>{
 const s=fixture(),hero=getHero(s,0);buy(s,0,'potion');hero.hp=100;hero.mana=0;assert.equal(applyCommand(s,0,{type:'usePotion'}).ok,true);assert.equal(hero.hp,100);assert.equal(hero.mana,0);assert.equal(hero.potionEffect!.potency,1);
 advance(s,4);close(hero.hp,100+hero.maxHp*.25);close(hero.mana!,hero.maxMana!*.25);advance(s,4);close(hero.hp,100+hero.maxHp*.5);close(hero.mana!,hero.maxMana!*.5);assert.equal(hero.potionEffect,undefined);
});

test('combat potion retains twenty percent potency after the combat window expires',()=>{
 const s=fixture(),hero=getHero(s,0);buy(s,0,'potion');place(hero,1800);hero.hp=100;hero.mana=0;hero.lastCombatAt=s.time;assert.equal(applyCommand(s,0,{type:'usePotion'}).ok,true);assert.equal(hero.potionEffect!.potency,.2);
 advance(s,8);close(hero.hp,100+hero.maxHp*.1);close(hero.mana!,hero.maxMana!*.1);assert.equal(hero.potionEffect,undefined);
});

test('a shield absorbed attack reduces only remaining full potion ticks to combat potency',()=>{
 const s=fixture(),hero=getHero(s,0),enemy=getHero(s,1);buy(s,0,'potion');place(hero,1800);place(enemy,1900);hero.hp=100;hero.mana=0;enemy.statuses=[{kind:'shield',until:30,remaining:1000}];assert.equal(applyCommand(s,0,{type:'usePotion'}).ok,true);advance(s,1);assert.equal(hero.potionEffect!.potency,1);
 const enemyHp=enemy.hp;attack(s,0,enemy);until(s,()=>hero.potionEffect?.potency===.2);assert.equal(enemy.hp,enemyHp);assert.ok(enemy.shield!<1000);assert.equal(hero.lastCombatAt,s.time);assert.equal(enemy.lastCombatAt,s.time);quiet(hero);const hp=hero.hp,mana=hero.mana!;advance(s,1);close(hero.hp-hp,hero.maxHp*.5/8*.2);close(hero.mana!-mana,hero.maxMana!*.5/8*.2);
});

test('potion stocks are separate from six equipment slots and invalid use never consumes stock',()=>{
 const s=fixture(),hero=getHero(s,0);hero.gold=9999;for(let i=0;i<6;i++)buy(s,0,'sword');for(let i=0;i<3;i++)buy(s,0,'potion');assert.equal(hero.items!.length,6);assert.equal(hero.potions,3);const gold=hero.gold;
 assert.equal(applyCommand(s,0,{type:'buy',itemId:'potion'}).ok,false);assert.equal(hero.gold,gold);assert.equal(applyCommand(s,0,{type:'usePotion'}).ok,false);assert.equal(hero.potions,3);hero.hp=0;assert.equal(applyCommand(s,0,{type:'usePotion'}).ok,false);assert.equal(hero.potions,3);
 hero.hp=hero.maxHp;hero.mana!-=100;hero.lastCombatAt=s.time-RULES.potionCombatWindow;assert.equal(applyCommand(s,0,{type:'usePotion'}).ok,true);assert.equal(hero.potionEffect!.potency,1);assert.equal(hero.potions,2);assert.equal(applyCommand(s,0,{type:'usePotion'}).ok,false);assert.equal(hero.potions,2);
});

test('death clears potion effects without refunding stock and shop remains available while dead',()=>{
 const s=fixture(['dain','sylra']),hero=getHero(s,0),enemy=getHero(s,1);buy(s,0,'potion');place(hero,1800);place(enemy,1900);hero.hp=1;assert.equal(applyCommand(s,0,{type:'usePotion'}).ok,true);attack(s,1,hero);until(s,()=>hero.hp===0);assert.equal(hero.potionEffect,undefined);assert.equal(hero.potions,0);buy(s,0,'potion');assert.equal(hero.potions,1);
});

test('ordinary movement crosses the narrow bridge in both directions without walking on water',()=>{
 const s=fixture(),hero=getHero(s,0);place(hero,2520,835);for(const goal of [{x:2180,y:835},{x:2520,y:835}]){applyCommand(s,0,{type:'move',...goal});let crossed=false;for(let i=0;i<220;i++){stepMatch(s,.05);assert.equal(isWater(hero),false);if(hero.x>TERRAIN.river.minX&&hero.x<TERRAIN.river.maxX){crossed=true;assert.ok(hero.y>=TERRAIN.bridge.minY&&hero.y<=TERRAIN.bridge.maxY);}}assert.ok(crossed);assert.ok(Math.hypot(hero.x-goal.x,hero.y-goal.y)<1);}
});

test('chase and attack move route through the bridge while autonomous troops keep crossing',()=>{
 for(const type of ['attackMove','attack'] as const){const s=fixture(['dain','sylra']),hero=getHero(s,0),enemy=getHero(s,1);place(hero,2520,1165);place(enemy,2050,1080);enemy.hp=enemy.maxHp=10000;assert.equal(applyCommand(s,0,type==='attack'?{type:'attack',targetId:enemy.id}:{type:'attackMove',x:2050,y:1080}).ok,true);for(let i=0;i<150;i++){stepMatch(s,.05);assert.equal(isWater(hero),false);}assert.ok(hero.x<TERRAIN.river.minX);}
 const s=createMatch();advance(s,40);assert.ok(s.units.some(u=>(u.kind==='melee'||u.kind==='ranged')&&Math.abs(u.x-WORLD.width/2)<300));assert.ok(s.units.every(u=>!isWater(u)));
});

test('displacements cross water only with legal dry endpoints and cannot gain distance',()=>{
 const from={x:2300,y:835};for(const range of [210,230,340]){const p=displacementEndpoint(from,{x:2700,y:835},range);assert.ok(p.x>=TERRAIN.river.maxX);assert.equal(isWater(p),false);assert.ok(Math.hypot(p.x-from.x,p.y-from.y)<=range+1e-8);}const stop=displacementEndpoint({x:2200,y:835},{x:2600,y:835},210);assert.ok(Math.abs(stop.x-TERRAIN.river.minX)<1e-6);assert.equal(isWater(stop),false);assert.equal(displacementEndpoint({x:2300,y:lane},{x:2400,y:lane},210).x,2400);
 const s=fixture(),hero=getHero(s,0);place(hero,from.x,from.y);assert.equal(applyCommand(s,0,{type:'summoner',slot:'flash',x:2700,y:835}).ok,true);assert.ok(hero.x>=TERRAIN.river.maxX);assert.equal(isWater(hero),false);
});

test('bush heroes stay hidden even in the same bush and guessed targeted attacks fail',()=>{
 const s=fixture(),hero=getHero(s,0),enemy=getHero(s,1);place(hero,2180,835);place(enemy,2200,835);stepMatch(s,.05);assert.equal(hero.brushId,TERRAIN.bushes[0].id);assert.equal(bushAt(hero)?.id,hero.brushId);assert.equal(isUnitVisibleToTeam(s,hero,0),true);assert.equal(isUnitVisibleToTeam(s,hero,1),false);assert.equal(isUnitVisibleToTeam(s,enemy,0),false);assert.equal(applyCommand(s,0,{type:'attack',targetId:enemy.id}).ok,false);applyCommand(s,0,{type:'attackMove',x:hero.x,y:hero.y});stepMatch(s,.05);assert.equal(hero.targetId,null);
});

test('blind area shield hits reveal the victim for three seconds without revealing the caster',()=>{
 const s=fixture(['dain','sylra']),hero=getHero(s,0),enemy=getHero(s,1);place(hero,2180,835);place(enemy,2200,835);hero.statuses=[{kind:'shield',until:30,remaining:1000}];enemy.skillRanks[1]=1;const hp=hero.hp;assert.equal(applyCommand(s,1,{type:'skill',slot:1,x:hero.x,y:hero.y}).ok,true);until(s,()=>isUnitVisibleToTeam(s,hero,1));assert.equal(hero.hp,hp);assert.ok(hero.shield!<1000);assert.equal(isUnitVisibleToTeam(s,enemy,0),false);assert.ok(hero.revealedUntil!>s.time+2.9);
 s.projectiles=[];hero.statuses=hero.statuses?.filter(st=>st.kind!=='dot');advance(s,3.1);assert.equal(isUnitVisibleToTeam(s,hero,1),false);place(hero,2050,835);assert.equal(isUnitVisibleToTeam(s,hero,1),true);
});

test('directional source projectiles can hit and reveal an unseen hero without a target lock',()=>{
 const s=fixture(),hero=getHero(s,0),enemy=getHero(s,1);place(hero,2100,835);place(enemy,2180,835);hero.skillRanks[0]=1;assert.equal(isUnitVisibleToTeam(s,enemy,0),false);assert.equal(applyCommand(s,0,{type:'skill',slot:0,x:enemy.x,y:enemy.y}).ok,true);until(s,()=>enemy.hp<enemy.maxHp,1);assert.equal(isUnitVisibleToTeam(s,enemy,0),true);
});

test('circular vision includes its exact edge, rejects distant guesses and moves back on respawn',()=>{
 const s=fixture(),hero=getHero(s,0),enemy=getHero(s,1);place(hero,1800);place(enemy,1800+RULES.visionRadius);assert.equal(isPointInTeamVision(s,enemy,0),true);assert.equal(isUnitVisibleToTeam(s,enemy,0),true);enemy.x+=.01;assert.equal(isPointInTeamVision(s,enemy,0),false);assert.equal(isUnitVisibleToTeam(s,enemy,0),false);assert.equal(applyCommand(s,0,{type:'attack',targetId:enemy.id}).ok,false);const ally=troop(s,'distant-ally',0,4000);assert.equal(isUnitVisibleToTeam(s,ally,0),false);
 hero.hp=0;hero.respawnAt=s.time+RULES.respawnSeconds;assert.equal(isPointInTeamVision(s,{x:1800+RULES.visionRadius,y:lane},0),true);advance(s,RULES.respawnSeconds+.1);assert.equal(hero.x,WORLD.spawnX[0]);assert.equal(isPointInTeamVision(s,{x:1800,y:lane},0),false);
});

test('troops and towers fight autonomously outside both heroes vision',()=>{
 const s=fixture(['dain','sylra'],true),blue=troop(s,'blue',0,2800),red=troop(s,'red',1,2840);blue.damage=red.damage=20;blue.attackTimer=red.attackTimer=0;assert.equal(isUnitVisibleToTeam(s,blue,1),false);assert.equal(isUnitVisibleToTeam(s,red,0),false);assert.equal(isUnitTargetableBy(s,red,blue),true);until(s,()=>blue.hp<blue.maxHp&&red.hp<red.maxHp);
 const tower=s.units.find(u=>u.id==='tower-1')!;place(blue,tower.x-80);blue.pendingAttack=undefined;blue.targetId=null;blue.attackTimer=999;tower.attackTimer=0;const hp=blue.hp;assert.equal(isUnitVisibleToTeam(s,blue,1),false);assert.equal(isUnitTargetableBy(s,blue,tower),true);until(s,()=>blue.hp<hp);assert.equal(tower.targetId,blue.id);
});

test('damage reveal never grants global sight outside the observer circle',()=>{
 const s=fixture(),hero=getHero(s,0),enemy=getHero(s,1);place(hero,1770,835);place(enemy,2620,835);assert.equal(isPointInTeamVision(s,enemy,0),true);assert.equal(isUnitVisibleToTeam(s,enemy,0),false);enemy.revealedUntil=s.time+3;assert.equal(isUnitVisibleToTeam(s,enemy,0),true);assert.equal(applyCommand(s,0,{type:'summoner',slot:'flash',x:hero.x-400,y:hero.y}).ok,true);assert.equal(isPointInTeamVision(s,enemy,0),false);assert.equal(isUnitVisibleToTeam(s,enemy,0),false);
});

