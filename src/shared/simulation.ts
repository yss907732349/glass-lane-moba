import { HEROES, ITEMS, RULES, SUMMONERS, TERRAIN, WORLD, xpForNextLevel, SOURCE_HEROES, SOURCE_UNIT, HERO_IDS, canUpgradeSkill, skillForRank } from './data.ts';
import { attackCadence, bodyRadius, breakSkillStealth, castSourceSkill, hasStatus, mitigateSourceDamage, onSourceTakedown, speedMultiplier, stepSourceCombat } from './source-combat.ts';
import type { Command, Effect, HeroKind, MatchState, Point, SkillSlot, Team, Unit } from './types.ts';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const position = (p: Point): Point => ({ x: clamp(p.x, WORLD.minX, WORLD.maxX), y: clamp(p.y, WORLD.minY, WORLD.maxY) });
const spawnX = (team: Team) => WORLD.spawnX[team];
const living = (u: Unit) => u.hp > 0;
const mobile = (u: Unit) => u.kind === 'hero' || u.kind === 'melee' || u.kind === 'ranged';
const combatant = (u: Unit) => u.kind === 'hero' || u.kind === 'melee' || u.kind === 'ranged';
const enemyTower = (s: MatchState, team: Team) => s.units.find(u => u.kind === 'tower' && u.team !== team && living(u));
export const getHero = (s: MatchState, team: Team): Unit => s.units.find(u => u.kind === 'hero' && u.team === team)!;
export const bushAt = (p: Point) => TERRAIN.bushes.find(b => Math.abs(p.x - b.x) <= b.width / 2 && Math.abs(p.y - b.y) <= b.height / 2);
export const isWater = (p: Point) => p.x > TERRAIN.river.minX && p.x < TERRAIN.river.maxX && (p.y < TERRAIN.bridge.minY || p.y > TERRAIN.bridge.maxY);
export function isPointInTeamVision(s: MatchState, point: Point, viewerTeam: Team) {
  const hero = s.units.find(u => u.kind === 'hero' && u.team === viewerTeam);
  return !!hero && distance(hero, point) <= RULES.visionRadius;
}
function isUnitUnconcealed(s: MatchState, unit: Unit, viewerTeam: Team) {
  if (unit.team === viewerTeam || unit.kind !== 'hero' || hasStatus(unit,'revealed',s.time)) return true;
  if (hasStatus(unit,'stealth',s.time)) return false;
  if((unit.revealedUntil??-999)>s.time)return true;
  return !bushAt(unit);
}
export function isUnitVisibleToTeam(s: MatchState, unit: Unit, viewerTeam: Team) {
  if (unit.kind === 'hero' && unit.team === viewerTeam) return true;
  return isPointInTeamVision(s, unit, viewerTeam) && isUnitUnconcealed(s, unit, viewerTeam);
}
/** Creeps/towers fight locally even when their owner hero cannot see that part of the map. */
export function isUnitTargetableBy(s: MatchState, target: Unit, observer: Unit) {
  if(hasStatus(target,'untargetable',s.time))return false;
  return observer.kind === 'hero' ? isUnitVisibleToTeam(s, target, observer.team) : isUnitUnconcealed(s, target, observer.team);
}
function segmentHitsWater(a: Point, b: Point) {
  const dx = b.x - a.x;
  if (Math.abs(dx) < 1e-9) return a.x > TERRAIN.river.minX && a.x < TERRAIN.river.maxX &&
    (Math.min(a.y, b.y) < TERRAIN.bridge.minY || Math.max(a.y, b.y) > TERRAIN.bridge.maxY);
  const t0 = (TERRAIN.river.minX - a.x) / dx, t1 = (TERRAIN.river.maxX - a.x) / dx;
  const enter = Math.max(0, Math.min(t0, t1)), exit = Math.min(1, Math.max(t0, t1));
  if (enter >= exit - 1e-9) return false;
  const y0 = a.y + (b.y - a.y) * enter, y1 = a.y + (b.y - a.y) * exit;
  return Math.min(y0, y1) < TERRAIN.bridge.minY || Math.max(y0, y1) > TERRAIN.bridge.maxY;
}
/** A displacement may cross water, but an endpoint inside it retreats along the same ray to dry land. */
export function displacementEndpoint(from: Point, target: Point, maxRange: number): Point {
  const bounded = position(target), d = distance(from, bounded), scale = d > maxRange ? maxRange / d : 1;
  const endpoint = position({ x: from.x + (bounded.x - from.x) * scale, y: from.y + (bounded.y - from.y) * scale });
  if (!isWater(endpoint)) return endpoint;
  let low = 0, high = 1;
  // Starting on dry land and ending in a river rectangle gives one final water interval.
  for (let i = 0; i < 40; i++) {
    const t = (low + high) / 2, p = { x: from.x + (endpoint.x - from.x) * t, y: from.y + (endpoint.y - from.y) * t };
    if (isWater(p)) high = t; else low = t;
  }
  return { x: from.x + (endpoint.x - from.x) * low, y: from.y + (endpoint.y - from.y) * low };
}
function walkingDestination(from: Point, target: Point): Point {
  const p = position(target);
  if (!isWater(p)) return p;
  const left = p.x - TERRAIN.river.minX, right = TERRAIN.river.maxX - p.x;
  return { x: left < right || (left === right && from.x <= TERRAIN.river.minX) ? TERRAIN.river.minX : TERRAIN.river.maxX, y: p.y };
}

export function createMatch(choices: [HeroKind, HeroKind] = ['dain', 'sylra'], bots: Team[] = []): MatchState {
  const s: MatchState = { time: 0, status: 'playing', winner: null, units: [], effects: [], projectiles: [], wave: 0, nextWave: 3, log: ['战场已开启。摧毁防御塔后，攻击敌方基地。'], sequence: 0 };
  for (const team of [0, 1] as Team[]) {
    const heroKind = HERO_IDS.includes(choices[team]) ? choices[team] : 'dain';
    const data = HEROES[heroKind];
    s.units.push({ id: `hero-${team}`, kind: 'hero', team, name: data.name, heroKind, x: spawnX(team), y: WORLD.laneY,
      hp: data.hp, maxHp: data.hp, damage: data.damage, range: data.range, speed: data.speed, attackCd: data.attackCd,
      attackTimer: 0, targetId: null, moveTarget: null, gold: RULES.startingGold, lastHits: 0, kills: 0, deaths: 0,
      items: [], cooldowns: [0, 0, 0, 0], level: 1, xp: 0, skillPoints: 1, skillRanks: [0, 0, 0, 0], potions: 0, lastCombatAt: -999, brushId: null, revealedUntil: -999, summonerCooldowns: { heal: 0, flash: 0 }, mana: data.mana, maxMana: data.mana, respawnAt: 0, shield: 0, bot: bots.includes(team), armor:SOURCE_HEROES[heroKind].base.armor,mr:SOURCE_HEROES[heroKind].base.mr,ap:0,radius:SOURCE_HEROES[heroKind].base.radius*SOURCE_UNIT,hpRegen:SOURCE_HEROES[heroKind].base.hpRegen,manaRegen:SOURCE_HEROES[heroKind].base.manaRegen,passiveStacks:0,statuses:[],recentDamagers:[] });
    s.units.push({ id: `tower-${team}`, kind: 'tower', team, name: '防御塔', x: WORLD.towerX[team], y: WORLD.laneY,
      hp: 1750, maxHp: 1750, damage: 100, range: RULES.towerRange, speed: 0, attackCd: 1.1, attackTimer: 0, targetId: null, moveTarget: null, level: 0, xp: 0, skillPoints: 0, skillRanks: [], potions: 0, lastCombatAt: -999 });
    s.units.push({ id: `base-${team}`, kind: 'base', team, name: '基地', x: WORLD.baseX[team], y: WORLD.laneY,
      hp: 2200, maxHp: 2200, damage: 0, range: 0, speed: 0, attackCd: 1, attackTimer: 0, targetId: null, moveTarget: null, level: 0, xp: 0, skillPoints: 0, skillRanks: [], potions: 0, lastCombatAt: -999 });
  }
  return s;
}

function effect(s: MatchState, kind: Effect['kind'], team: Team, p: Point, extra: Partial<Effect> = {}, life = .45) {
  const sourceId = 'id' in p && typeof p.id === 'string' ? p.id : undefined;
  s.effects.push({ id: `fx-${++s.sequence}`, kind, team, x: p.x, y: p.y, start: s.time, end: s.time + life, ...(sourceId ? { sourceId } : {}), ...extra });
}
function log(s: MatchState, text: string) { s.log.push(text); s.log = s.log.slice(-8); }
function protectedBase(s: MatchState, target: Unit) {
  return target.kind === 'base' && s.units.some(u => u.kind === 'tower' && u.team === target.team && living(u));
}
function grantXp(s: MatchState, hero: Unit, amount: number) {
  if (hero.level >= 10) return;
  hero.xp += amount;
  while (hero.level < 10 && hero.xp >= xpForNextLevel(hero.level)) {
    hero.xp -= xpForNextLevel(hero.level); hero.level++; hero.skillPoints++;
    recalcSourceHero(hero);
    effect(s, 'heal', hero.team, hero, { text: `升级 ${hero.level}` }, 1.1);
  }
  if (hero.level === 10) hero.xp = 0;
}
function hurt(s: MatchState, attacker: Unit, target: Unit, amount: number, dtype='physical', via='other') {
  if (s.status !== 'playing' || !living(target) || target.team === attacker.team || protectedBase(s, target) || hasStatus(target,'untargetable',s.time)) return;
  if (amount > 0) for (const u of [attacker, target]) if (u.kind === 'hero') {
    u.lastCombatAt = s.time;
    if (u.potionEffect) u.potionEffect.potency = .2;
  }
  if (amount > 0 && target.kind === 'hero') target.revealedUntil = s.time + 3;
  const actual = mitigateSourceDamage(s,attacker,target,amount,dtype,via,combatHooks);
  if(actual>0&&attacker.kind==='hero'&&target.kind==='hero') {target.recentDamagers??=[];const record=target.recentDamagers.find(r=>r.id===attacker.id);if(record)record.at=s.time;else target.recentDamagers.push({id:attacker.id,at:s.time});}
  target.hp = Math.max(0,target.hp-actual);
  if (attacker.kind === 'hero' && target.kind === 'hero') {
    const tower = s.units.find(u => u.kind === 'tower' && u.team === target.team && living(u));
    if (tower && distance(tower, attacker) <= tower.range) { tower.targetId = attacker.id; tower.aggroUntil = s.time + 3; }
  }
  if (target.hp > 0) return;
  if (target.kind === 'hero' || target.kind === 'melee' || target.kind === 'ranged') {
    const learner = getHero(s, target.team === 0 ? 1 : 0);
    if (living(learner) && distance(learner, target) <= 900) grantXp(s, learner, target.kind === 'hero' ? 250 : target.kind === 'melee' ? 42 : 58);
  }
  effect(s, 'death', target.team, target, { radius: target.kind === 'hero' ? 60 : 30 }, .8);
  if (target.kind === 'hero') {
    onSourceTakedown(s,target);
    target.statuses=[];target.activeDash=undefined;target.pendingSpell=undefined;target.pendingAttack=undefined;target.recastArmed=undefined;
    target.deaths!++; target.respawnAt = s.time + RULES.respawnSeconds;
    target.moveTarget = null; target.targetId = null; target.orderedTargetId = null; target.attackMoveTarget = null; target.shield = 0;
    delete target.potionEffect;
    const recent=target.recentDamagers?.filter(r=>s.time-r.at<=10).sort((a,b)=>b.at-a.at)[0];
    const killer=attacker.kind==='hero'?attacker:recent?s.units.find(u=>u.id===recent.id):undefined;
    if(killer?.kind==='hero'){killer.kills!++;killer.gold!+=220;}
    log(s, `${target.team === 0 ? '蓝方' : '红方'}${target.name}阵亡，${RULES.respawnSeconds} 秒后复活。`);
  } else if (target.kind === 'melee' || target.kind === 'ranged') {
    if (attacker.kind === 'hero') {
      const gold = target.kind === 'melee' ? 38 : 52;
      attacker.gold! += gold; attacker.lastHits!++;
      effect(s, 'gold', attacker.team, target, { text: `+${gold}` }, .9);
    }
  } else if (target.kind === 'tower') {
    const hero = getHero(s, attacker.team); hero.gold! += 300;
    log(s, `${target.team === 0 ? '蓝方' : '红方'}防御塔被摧毁！基地护盾已解除。`);
  } else if (target.kind === 'base') {
    s.status = 'finished'; s.winner = attacker.team;
    log(s, `${attacker.team === 0 ? '蓝方' : '红方'}摧毁基地，获得胜利！`);
  }
}

const combatHooks = { hurt, effect, endpoint: displacementEndpoint, visible: isUnitVisibleToTeam };
export function recalcSourceHero(hero:Unit){if(!hero.heroKind)return;const source=SOURCE_HEROES[hero.heroKind],items=hero.items!.map(id=>ITEMS.find(i=>i.id===id)).filter(Boolean);const sum=(key:string)=>items.reduce((n,i)=>n+((i as any)[key]??0),0),level=hero.level-1;
  const hp=source.base.hp+source.growth.hp*level+sum('hp'),mana=source.base.mana+source.growth.mana*level+sum('mana');if(living(hero))hero.hp=Math.min(hp,hero.hp+Math.max(0,hp-hero.maxHp));hero.mana=Math.min(mana,hero.mana!+Math.max(0,mana-hero.maxMana!));hero.maxHp=hp;hero.maxMana=mana;
  hero.damage=source.base.ad+source.growth.ad*level+sum('damage');hero.ap=sum('ap');hero.armor=source.base.armor+source.growth.armor*level+sum('armor');hero.mr=source.base.mr+source.growth.mr*level+sum('mr');hero.speed=source.base.moveSpeed*SOURCE_UNIT+sum('speed');hero.attackCd=1/(source.base.attackSpeed*(1+sum('attackSpeedPct')));
}
export function applyCommand(s: MatchState, team: Team, command: Command): { ok: boolean; error?: string } {
  if (team !== 0 && team !== 1) return { ok: false, error: '队伍无效' };
  if (s.status !== 'playing') return { ok: false, error: '对局已经结束' };
  const hero = getHero(s, team);
  if (!command || typeof command !== 'object') return { ok: false, error: '操作无效' };
  if (command.type === 'upgrade') {
    if (![0, 1, 2, 3].includes(command.slot)) return { ok: false, error: '技能无效' };
    if (!canUpgradeSkill(hero,command.slot)) return {ok:false,error:'技能点、等级或技能上限不满足'};
    hero.skillPoints--; hero.skillRanks[command.slot]++;
    return { ok: true };
  }
  if (command.type === 'buy') {
    const item = ITEMS.find(i => i.id === command.itemId);
    if (!item) return { ok: false, error: '装备不存在' };
    if (item.kind === 'consumable' && hero.potions >= RULES.potionStockLimit) return { ok: false, error: '最多携带三瓶药水' };
    if (item.kind !== 'consumable' && hero.items!.length >= 6) return { ok: false, error: '六个装备栏已满' };
    if (hero.gold! < item.cost) return { ok: false, error: '金币不足' };
    hero.gold! -= item.cost;
    if (item.kind === 'consumable') { hero.potions++; return { ok: true }; }
    hero.items!.push(item.id);
    recalcSourceHero(hero);
    return { ok: true };
  }
  if (!living(hero)) return { ok: false, error: '正在等待复活' };
  if(hasStatus(hero,'stun',s.time)&&command.type!=='stop')return{ok:false,error:'眩晕期间无法行动'};
  if (command.type === 'usePotion') {
    if (hero.potions <= 0) return { ok: false, error: '没有恢复药水，请打开商店购买' };
    if (hero.potionEffect) return { ok: false, error: '药水效果仍在持续' };
    if (hero.hp >= hero.maxHp && hero.mana! >= hero.maxMana!) return { ok: false, error: '生命和法力已经全满' };
    hero.potions--;
    hero.potionEffect = { remaining: RULES.potionDuration, hpPerSecond: hero.maxHp * .5 / RULES.potionDuration,
      manaPerSecond: hero.maxMana! * .5 / RULES.potionDuration, potency: s.time - hero.lastCombatAt >= RULES.potionCombatWindow ? 1 : .2 };
    effect(s, 'heal', team, hero, { text: hero.potionEffect.potency === 1 ? '恢复药水' : '战斗药水 20%' }, .9);
    return { ok: true };
  }
  if (command.type === 'summoner') {
    if(command.slot==='flash'&&hasStatus(hero,'root',s.time))return{ok:false,error:'禁锢期间无法位移'};
    if (command.slot !== 'heal' && command.slot !== 'flash') return { ok: false, error: '召唤师技能无效' };
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return { ok: false, error: '目标位置无效' };
    hero.summonerCooldowns ??= { heal: 0, flash: 0 };
    if (hero.summonerCooldowns[command.slot] > 0) return { ok: false, error: '召唤师技能还在冷却' };
    if (command.slot === 'heal') {
      const restored = Math.min(260, hero.maxHp - hero.hp);
      hero.hp += restored;
      effect(s, 'heal', team, hero, { text: `+${Math.round(restored)}` }, .9);
    } else {
      const from = { x: hero.x, y: hero.y }, p = displacementEndpoint(hero, command, SUMMONERS.flash.range);
      hero.x = p.x; hero.y = p.y; hero.moveTarget = null; hero.attackMoveTarget = null; hero.targetId = null; hero.orderedTargetId = null;
      if(hero.pendingSpell?.slot===hero.recastArmed?.slot)hero.recastArmed=undefined;
      hero.activeDash=undefined;hero.pendingSpell=undefined;hero.pendingAttack=undefined;
      effect(s, 'dash', team, from, { toX: p.x, toY: p.y, sourceId: hero.id }, .55);
    }
    hero.summonerCooldowns[command.slot] = SUMMONERS[command.slot].cooldown;
    return { ok: true };
  }
  if (command.type === 'stop') { hero.pendingAttack=undefined; hero.moveTarget = null; hero.attackMoveTarget = null; hero.targetId = null; hero.orderedTargetId = null; return { ok: true }; }
  if (command.type === 'attack') {
    const target = s.units.find(u => u.id === command.targetId);
    if (!target || !living(target) || target.team === team || !isUnitTargetableBy(s, target, hero)) return { ok: false, error: '请选择可见且可选中的敌方目标' };
    if (protectedBase(s, target)) return { ok: false, error: '先摧毁敌方防御塔' };
    hero.targetId = target.id; hero.orderedTargetId = target.id; hero.moveTarget = null; hero.attackMoveTarget = null; return { ok: true };
  }
  if (command.type === 'move' || command.type === 'attackMove' || command.type === 'skill') {
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return { ok: false, error: '目标位置无效' };
    if (command.type === 'move') { hero.pendingAttack=undefined;hero.attackTimer=0;hero.moveTarget = walkingDestination(hero, command); hero.attackMoveTarget = null; hero.targetId = null; hero.orderedTargetId = null; return { ok: true }; }
    if (command.type === 'attackMove') { hero.pendingAttack=undefined;hero.attackTimer=0;hero.attackMoveTarget = walkingDestination(hero, command); hero.moveTarget = null; hero.targetId = null; hero.orderedTargetId = null; return { ok: true }; }
    if (![0, 1, 2, 3].includes(command.slot)) return { ok: false, error: '技能无效' };
    return castSourceSkill(s,hero,command.slot,position(command),combatHooks);
  }
  return { ok: false, error: '操作无效' };
}

function spawnWave(s: MatchState) {
  s.wave++;
  for (const team of [0, 1] as Team[]) {
    for (let i = 0; i < 4; i++) {
      const ranged = i === 3;
      const grow = Math.min(20, s.wave - 1);
      s.units.push({ id: `minion-${team}-${s.wave}-${i}`, kind: ranged ? 'ranged' : 'melee', team,
        name: ranged ? '远程兵' : '近战兵', x: spawnX(team) + (team === 0 ? 80 : -80) + (team === 0 ? -1 : 1) * Math.floor(i / 2) * 34,
        y: WORLD.laneY - 18 + (i % 2) * 36, hp: (ranged ? 210 : 300) + grow * 12, maxHp: (ranged ? 210 : 300) + grow * 12,
        damage: (ranged ? 23 : 19) + grow, range: ranged ? 205 : 43, speed: ranged ? 64 : 70,
        attackCd: ranged ? 1.35 : 1, attackTimer: 0, targetId: null, moveTarget: null, projectile: ranged,
        level: 1 + grow, xp: 0, skillPoints: 0, skillRanks: [], potions: 0, lastCombatAt: -999 });
    }
  }
}
function moveToward(u: Unit, p: Point, dt: number, stopDistance = 0, time = 0) {
  if(hasStatus(u,'root',time)||hasStatus(u,'stun',time)||u.activeDash||u.pendingAttack||u.pendingSpell)return;
  let waypoint = walkingDestination(u, p);
  if (segmentHitsWater(u, waypoint)) {
    // Approach the bridge on the current bank, cross its center, then resume the original order.
    if (u.x <= TERRAIN.river.minX) waypoint = Math.abs(u.y - WORLD.laneY) < 2
      ? { x: TERRAIN.river.maxX + 24, y: WORLD.laneY } : { x: TERRAIN.river.minX - 24, y: WORLD.laneY };
    else if (u.x >= TERRAIN.river.maxX) waypoint = Math.abs(u.y - WORLD.laneY) < 2
      ? { x: TERRAIN.river.minX - 24, y: WORLD.laneY } : { x: TERRAIN.river.maxX + 24, y: WORLD.laneY };
    else waypoint = { x: waypoint.x < u.x ? TERRAIN.river.minX - 24 : TERRAIN.river.maxX + 24, y: WORLD.laneY };
    if (distance(u, waypoint) < 2) waypoint = { x: p.x < u.x ? TERRAIN.river.minX - 24 : TERRAIN.river.maxX + 24, y: WORLD.laneY };
    stopDistance = 0;
  }
  const d = distance(u, waypoint);
  if (d <= stopDistance + .01) return;
  const step = Math.min(d - stopDistance, u.speed * speedMultiplier(u,time) * dt);
  let next = position({ x: u.x + (waypoint.x - u.x) / d * step, y: u.y + (waypoint.y - u.y) / d * step });
  if (segmentHitsWater(u, next)) {
    let low = 0, high = 1;
    for (let i = 0; i < 35; i++) {
      const t = (low + high) / 2, q = { x: u.x + (next.x - u.x) * t, y: u.y + (next.y - u.y) * t };
      if (segmentHitsWater(u, q)) high = t; else low = t;
    }
    next = { x: u.x + (next.x - u.x) * low, y: u.y + (next.y - u.y) * low };
  }
  u.x = next.x; u.y = next.y;
  if (u.kind === 'hero') u.brushId = bushAt(u)?.id ?? null;
}
function closest(u: Unit, candidates: Unit[]) { return candidates.sort((a, b) => distance(u, a) - distance(u, b))[0]; }
function acquire(s: MatchState, u: Unit): Unit | undefined {
  const enemies = s.units.filter(v => v.team !== u.team && living(v) && !protectedBase(s, v) && isUnitTargetableBy(s, v, u));
  if (u.kind === 'tower') {
    const current = s.units.find(v => v.id === u.targetId && living(v) && distance(u, v) <= u.range && isUnitTargetableBy(s, v, u));
    if (current && (current.kind !== 'hero' || (u.aggroUntil ?? 0) > s.time)) return current;
    const inRange = enemies.filter(v => combatant(v) && distance(u, v) <= u.range);
    return closest(u, inRange.filter(v => v.kind !== 'hero')) ?? closest(u, inRange);
  }
  if (u.kind === 'base') return;
  const nearby = enemies.filter(v => distance(u, v) <= (u.kind==='hero'?u.range+bodyRadius(u)+bodyRadius(v):310));
  // Troops fight enemy troops before heroes and structures, keeping waves readable.
  if (u.kind !== 'hero') return closest(u, nearby.filter(v => v.kind === 'melee' || v.kind === 'ranged')) ?? closest(u, nearby);
  return closest(u, nearby);
}
function botThink(s: MatchState, hero: Unit) {
  if (!living(hero)) return;
  while(hero.skillPoints>0){const unlearned=([0,1,2] as SkillSlot[]).filter(slot=>!hero.skillRanks[slot]);const slot=([3,...unlearned,0,1,2] as SkillSlot[]).find(slot=>canUpgradeSkill(hero,slot));if(slot===undefined)break;applyCommand(s,hero.team,{type:'upgrade',slot});}
  const opponent = getHero(s, hero.team === 0 ? 1 : 0);
  const opponentVisible = isUnitVisibleToTeam(s, opponent, hero.team);
  if(hero.recastArmed&&hero.recastArmed.until>s.time&&(hero.hp<hero.maxHp*.45||!living(opponent))){applyCommand(s,hero.team,{type:'skill',slot:hero.recastArmed.slot,x:hero.x,y:hero.y});return;}
  if (hero.hp < hero.maxHp * .55 && !hero.summonerCooldowns?.heal) {
    applyCommand(s, hero.team, { type: 'summoner', slot: 'heal', x: hero.x, y: hero.y });
  }
  if (hero.hp < hero.maxHp * .65 && !hero.potionEffect) {
    if (!hero.potions && hero.gold! >= 100) applyCommand(s, hero.team, { type: 'buy', itemId: 'potion' });
    if (hero.potions) applyCommand(s, hero.team, { type: 'usePotion' });
  }
  if (hero.hp < hero.maxHp * .25) {
    applyCommand(s, hero.team, { type: 'move', x: spawnX(hero.team), y: WORLD.laneY });
    if (hero.heroKind === 'fenn') applyCommand(s, hero.team, { type: 'skill', slot: 2, x: hero.x, y: hero.y });
    return;
  }
  if (hero.gold! >= 300 && hero.items!.length < 6) {
    applyCommand(s, hero.team, { type: 'buy', itemId: hero.items!.length % 2 ? 'heart' : 'sword' });
  }
  const enemies = s.units.filter(u => u.team !== hero.team && living(u) && !protectedBase(s, u) && isUnitVisibleToTeam(s, u, hero.team));
  const killable = closest(hero, enemies.filter(u => (u.kind === 'melee' || u.kind === 'ranged') && u.hp <= hero.damage && distance(u, hero) < 330));
  const nearbyTarget = killable ?? closest(hero, enemies.filter(u => combatant(u) && distance(u, hero) < 390));
  const target = nearbyTarget ?? enemyTower(s, hero.team) ?? s.units.find(u => u.kind === 'base' && u.team !== hero.team && living(u));
  if (!target) return;
  const tower = enemyTower(s, hero.team);
  const alliesUnderTower = tower && s.units.some(u => u.team === hero.team && u.kind !== 'hero' && combatant(u) && living(u) && distance(u, tower) < tower.range - 25);
  if (tower && distance(hero, tower) < tower.range + 65 && !alliesUnderTower) {
    applyCommand(s, hero.team, { type: 'move', x: tower.x + (hero.team === 0 ? -360 : 360), y: WORLD.laneY + 20 });
    return;
  }
  if (!nearbyTarget && tower && !alliesUnderTower) {
    const front = s.units.filter(u => u.team === hero.team && living(u) && (u.kind === 'melee' || u.kind === 'ranged'))
      .sort((a, b) => hero.team === 0 ? b.x - a.x : a.x - b.x)[0];
    const direction = hero.team === 0 ? 1 : -1;
    const rallyX = front ? front.x - direction * 110 : WORLD.towerX[hero.team] - direction * 80;
    applyCommand(s, hero.team, { type: 'move', x: rallyX, y: WORLD.laneY + 65 });
    return;
  }
  if (isUnitVisibleToTeam(s, target, hero.team)) applyCommand(s, hero.team, { type: 'attack', targetId: target.id });
  else applyCommand(s, hero.team, { type: 'move', x: target.x, y: target.y });
  if(opponentVisible&&living(opponent)&&!hero.activeDash&&!hero.pendingSpell){
    for(const slot of [3,2,1,0] as SkillSlot[]){
      if(!hero.skillRanks[slot]||hero.cooldowns![slot]>0||hero.recastArmed?.slot===slot)continue;
      const skill=skillForRank(hero.heroKind!,slot,hero.skillRanks[slot]),spec=skill.spec;
      let aim:Point=opponent;const gap=distance(hero,opponent);
      if(spec.toAlly){const ally=closest(opponent,s.units.filter(u=>u.team===hero.team&&u.id!==hero.id&&living(u)&&combatant(u)&&distance(u,hero)<=skill.range+bodyRadius(u)&&distance(u,opponent)<(spec.landRadius??0)*SOURCE_UNIT+bodyRadius(opponent)));if(!ally)continue;aim=ally;
      }else if(spec.kind==='self_or_ally'){
        if(spec.effects.some((e:any)=>e.kind==='stealth')&&hero.hp>hero.maxHp*.65)continue;
        if(gap>Math.max(hero.range+100,350))continue;aim=hero;
      }else if(spec.kind==='dash'&&spec.selfEffects?.some((e:any)=>e.kind==='buff'&&e.asPct)){
        const direction=gap<hero.range*.7?-1:1,d=Math.max(.01,gap);aim={x:hero.x+(opponent.x-hero.x)/d*skill.range*direction,y:hero.y+(opponent.y-hero.y)/d*skill.range*direction};
      }else if(gap>skill.range+bodyRadius(opponent))continue;
      if(applyCommand(s,hero.team,{type:'skill',slot,x:aim.x,y:aim.y}).ok)break;
    }
  }
}

/** Advance a fixed authoritative tick. Caller should normally pass 1/20 second. */
export function stepMatch(s: MatchState, dt: number) {
  if (s.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
  dt = Math.min(dt, .25);
  const oldTime = s.time; s.time += dt;
  s.effects = s.effects.filter(f => f.end > s.time);
  if (s.time >= s.nextWave) { spawnWave(s); s.nextWave += RULES.waveInterval; }
  for (const hero of s.units.filter(u => u.kind === 'hero')) {
    hero.brushId = bushAt(hero)?.id ?? null;
    hero.gold! += RULES.passiveGoldPerSecond * dt;
    hero.cooldowns = hero.cooldowns!.map(cd => Math.max(0, cd - dt));
    hero.summonerCooldowns ??= { heal: 0, flash: 0 };
    hero.summonerCooldowns.heal = Math.max(0, hero.summonerCooldowns.heal - dt);
    hero.summonerCooldowns.flash = Math.max(0, hero.summonerCooldowns.flash - dt);
    if (!living(hero)) {
      if (s.time >= hero.respawnAt!) {
        hero.hp = hero.maxHp; hero.mana = hero.maxMana; hero.x = spawnX(hero.team); hero.y = WORLD.laneY;
        hero.respawnAt = 0; hero.attackTimer = 0; hero.targetId = null; hero.orderedTargetId = null; hero.moveTarget = null; hero.attackMoveTarget = null;
        effect(s, 'heal', hero.team, hero, { text: '复活' }, 1);
      }
      continue;
    }
    hero.mana = Math.min(hero.maxMana!, hero.mana! + (hero.manaRegen??0) * dt);
    hero.hp = Math.min(hero.maxHp,hero.hp+(hero.hpRegen??0)*dt);
    if (hero.potionEffect) {
      const active = hero.potionEffect, tick = Math.min(dt, active.remaining);
      hero.hp = Math.min(hero.maxHp, hero.hp + active.hpPerSecond * active.potency * tick);
      hero.mana = Math.min(hero.maxMana!, hero.mana! + active.manaPerSecond * active.potency * tick);
      active.remaining = Math.max(0, active.remaining - tick);
      if (active.remaining <= 1e-8) delete hero.potionEffect;
    }

    if (hero.bot && Math.floor(oldTime / .6) !== Math.floor(s.time / .6)) botThink(s, hero);
  }
  stepSourceCombat(s,dt,combatHooks);
  for (const u of s.units) {
    if (!living(u) || u.kind === 'base' || s.status !== 'playing') continue;
    u.attackTimer = Math.max(0, u.attackTimer - dt);
    if(u.activeDash||u.pendingSpell||u.pendingAttack||hasStatus(u,'stun',s.time))continue;
    let target = u.targetId ? s.units.find(v => v.id === u.targetId && v.team !== u.team && living(v) && !protectedBase(s, v) && isUnitTargetableBy(s, v, u)) : undefined;
    if (u.kind === 'tower') target = acquire(s, u);
    else if (u.kind !== 'hero') {
      if (!target || distance(u, target) > 340) target = acquire(s, u);
    } else if (u.moveTarget) {
      moveToward(u, u.moveTarget, dt, 0, s.time);
      if (distance(u, u.moveTarget) < 1) u.moveTarget = null;
      continue;
    } else if (u.attackMoveTarget) {
      if (target && distance(u, target) > u.range + bodyRadius(u)+bodyRadius(target) + 120) target = undefined;
      if (!target) {
        const nearby = s.units.filter(v => v.team !== u.team && living(v) && !protectedBase(s, v) && distance(u, v) <= u.range + bodyRadius(u)+bodyRadius(v) + 90 && isUnitVisibleToTeam(s, v, u.team));
        target = closest(u, nearby.filter(combatant)) ?? closest(u, nearby);
      }
      if (!target) {
        u.targetId = null;
        moveToward(u, u.attackMoveTarget, dt, 0, s.time);
        if (distance(u, u.attackMoveTarget) < 1) u.attackMoveTarget = null;
        continue;
      }
    } else {
      if (u.orderedTargetId && target?.id !== u.orderedTargetId) u.orderedTargetId = null;
      if (target && !u.orderedTargetId && distance(u, target) > u.range + bodyRadius(u)+bodyRadius(target) + 1) target = undefined;
      if (!target) target = acquire(s, u);
    }
    u.targetId = target?.id ?? null;
    if (target) {
      const effectiveRange = u.range + bodyRadius(u)+bodyRadius(target);
      if (distance(u, target) <= effectiveRange + 1) {
        if (u.attackTimer <= 0) {
          const cadence=attackCadence(u,s.time);u.attackTimer=1/cadence;breakSkillStealth(u);u.pendingAttack={targetId:target.id,resolveAt:s.time+Math.min(u.kind==='hero'?.35:.15,(u.kind==='hero'?.3:.15)/Math.max(.1,cadence)),start:{x:u.x,y:u.y}};
          effect(s, 'attack', u.team, u, { toX: target.x, toY: target.y, radius: u.range > 100 ? 4 : 18 }, .24);

        }
      } else if (mobile(u)) moveToward(u, target, dt, effectiveRange, s.time);
    } else if (u.kind === 'melee' || u.kind === 'ranged') {
      moveToward(u, { x: WORLD.baseX[u.team === 0 ? 1 : 0], y: WORLD.laneY + (Number(u.id.slice(-1)) % 2 ? 18 : -18) }, dt, 0, s.time);
    }
  }

  for (const hero of s.units.filter(u => u.kind === 'hero')) hero.brushId = bushAt(hero)?.id ?? null;
  // Only dead troops are removed; dead heroes and structures remain for respawn/rubble views.
  s.units = s.units.filter(u => living(u) || u.kind === 'hero' || u.kind === 'tower' || u.kind === 'base');
}

