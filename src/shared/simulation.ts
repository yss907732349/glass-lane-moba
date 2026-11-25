import { HEROES, ITEMS, RULES, SUMMONERS, TERRAIN, WORLD, xpForNextLevel } from './data.ts';
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
  if (unit.team === viewerTeam || unit.kind !== 'hero' || (unit.revealedUntil ?? -999) > s.time) return true;
  return !bushAt(unit);
}
export function isUnitVisibleToTeam(s: MatchState, unit: Unit, viewerTeam: Team) {
  if (unit.kind === 'hero' && unit.team === viewerTeam) return true;
  return isPointInTeamVision(s, unit, viewerTeam) && isUnitUnconcealed(s, unit, viewerTeam);
}
/** Creeps/towers fight locally even when their owner hero cannot see that part of the map. */
export function isUnitTargetableBy(s: MatchState, target: Unit, observer: Unit) {
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

export function createMatch(choices: [HeroKind, HeroKind] = ['knight', 'mage'], bots: Team[] = []): MatchState {
  const s: MatchState = { time: 0, status: 'playing', winner: null, units: [], effects: [], projectiles: [], wave: 0, nextWave: 3, log: ['战场已开启。摧毁防御塔后，攻击敌方基地。'], sequence: 0 };
  for (const team of [0, 1] as Team[]) {
    const heroKind = choices[team] === 'mage' ? 'mage' : 'knight';
    const data = HEROES[heroKind];
    s.units.push({ id: `hero-${team}`, kind: 'hero', team, name: data.name, heroKind, x: spawnX(team), y: WORLD.laneY,
      hp: data.hp, maxHp: data.hp, damage: data.damage, range: data.range, speed: data.speed, attackCd: data.attackCd,
      attackTimer: 0, targetId: null, moveTarget: null, gold: RULES.startingGold, lastHits: 0, kills: 0, deaths: 0,
      items: [], cooldowns: [0, 0, 0, 0], level: 1, xp: 0, skillPoints: 1, skillRanks: [0, 0, 0, 0], potions: 0, lastCombatAt: -999, brushId: null, revealedUntil: -999, summonerCooldowns: { heal: 0, flash: 0 }, mana: data.mana, maxMana: data.mana, respawnAt: 0, shield: 0, bot: bots.includes(team) });
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
    hero.maxHp += 80; if (living(hero)) hero.hp += 80;
    hero.maxMana! += 25; hero.mana! += 25; hero.damage += 5;
    effect(s, 'heal', hero.team, hero, { text: `升级 ${hero.level}` }, 1.1);
  }
  if (hero.level === 10) hero.xp = 0;
}
function hurt(s: MatchState, attacker: Unit, target: Unit, amount: number) {
  if (s.status !== 'playing' || !living(target) || target.team === attacker.team || protectedBase(s, target)) return;
  if (amount > 0) for (const u of [attacker, target]) if (u.kind === 'hero') {
    u.lastCombatAt = s.time;
    if (u.potionEffect) u.potionEffect.potency = .2;
  }
  if (amount > 0 && target.kind === 'hero') target.revealedUntil = s.time + 3;
  const absorbed = Math.min(target.shield ?? 0, amount);
  target.shield = (target.shield ?? 0) - absorbed;
  target.hp = Math.max(0, target.hp - Math.max(0, amount - absorbed));
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
    target.deaths!++; target.respawnAt = s.time + RULES.respawnSeconds;
    target.moveTarget = null; target.targetId = null; target.orderedTargetId = null; target.attackMoveTarget = null; target.shield = 0;
    delete target.potionEffect;
    const killer = attacker.kind === 'hero' ? attacker : getHero(s, attacker.team);
    if (attacker.kind === 'hero') { killer.kills!++; killer.gold! += 220; }
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

function cast(s: MatchState, hero: Unit, slot: SkillSlot, point: Point, targetId?: string): { ok: boolean; error?: string } {
  const data = HEROES[hero.heroKind!].skills[slot];
  const rank = hero.skillRanks[slot];
  if (!rank) return { ok: false, error: '请先学习这个技能' };
  if (hero.cooldowns![slot] > 0) return { ok: false, error: '技能还在冷却' };
  if (hero.mana! < data.mana) return { ok: false, error: '法力不足' };
  const lockedTarget = targetId ? s.units.find(u => u.id === targetId) : undefined;
  if (data.targeting === 'unit') {
    if (!lockedTarget || !living(lockedTarget) || lockedTarget.team === hero.team || !combatant(lockedTarget) || !isUnitVisibleToTeam(s, lockedTarget, hero.team)) return { ok: false, error: '请将鼠标指向可见的敌方英雄或小兵' };
    if (distance(hero, lockedTarget) > data.range) return { ok: false, error: '目标超出技能距离' };
  }
  hero.mana! -= data.mana;
  hero.cooldowns![slot] = slot === 3 ? (hero.heroKind === 'knight' ? (rank === 1 ? 65 : 50) : (rank === 1 ? 70 : 55)) : data.cooldown * (1 - .1 * (rank - 1));
  const d = distance(hero, point);
  const dx = d < .01 ? (hero.team === 0 ? 1 : -1) : (point.x - hero.x) / d;
  const dy = d < .01 ? 0 : (point.y - hero.y) / d;
  const itemScale = 1 + hero.items!.filter(id => id === 'focus').length * .2;
  const scale = itemScale * (1 + .25 * (rank - 1));
  const enemies = s.units.filter(u => u.team !== hero.team && living(u));
  if (slot === 3) {
    if (hero.heroKind === 'knight') {
      const target = lockedTarget!, from = { x: hero.x, y: hero.y }, td = distance(hero, target);
      const stop = Math.min(65, td), ux = td > .01 ? (target.x - hero.x) / td : 1, uy = td > .01 ? (target.y - hero.y) / td : 0;
      const p = displacementEndpoint(hero, { x: target.x - ux * stop, y: target.y - uy * stop }, data.range);
      hero.x = p.x; hero.y = p.y; hero.moveTarget = null; hero.attackMoveTarget = null; hero.targetId = target.id; hero.orderedTargetId = target.id;
      effect(s, 'dash', hero.team, from, { toX: p.x, toY: p.y, radius: 100, sourceId: hero.id }, .55);
      effect(s, 'slash', hero.team, hero, { toX: target.x, toY: target.y, radius: 140 }, .6);
      hurt(s, hero, target, ((rank === 1 ? 260 : 380) + (target.maxHp - target.hp) * .15) * itemScale);
    } else {
      const p = position({ x: hero.x + dx * Math.min(d, 850), y: hero.y + dy * Math.min(d, 850) });
      s.projectiles.push({ id: `ultimate-${++s.sequence}`, kind: 'nova', ownerId: hero.id, team: hero.team,
        x: p.x, y: p.y, startX: p.x, startY: p.y, dirX: 0, dirY: 0, speed: 0, range: 0,
        radius: 260, damage: (rank === 1 ? 300 : 440) * itemScale, activateAt: s.time + 1, hitIds: [] });
      effect(s, 'nova', hero.team, p, { radius: 260, text: '预警' }, 1);
    }
    return { ok: true };
  }
  if (hero.heroKind === 'knight') {
    if (slot === 0) {
      effect(s, 'slash', hero.team, hero, { toX: lockedTarget!.x, toY: lockedTarget!.y, radius: 170 });
      hurt(s, hero, lockedTarget!, 145 * scale);
    } else if (slot === 1) {
      hero.shield = 230 + (rank - 1) * 60 + (hero.items!.includes('guard') ? 70 : 0); hero.buffUntil = s.time + 4;
      effect(s, 'shield', hero.team, hero, { radius: 55 }, .65);
    } else {
      const from = { x: hero.x, y: hero.y };
      const p = displacementEndpoint(hero, point, 230);
      hero.x = p.x; hero.y = p.y; hero.moveTarget = null; hero.attackMoveTarget = null; hero.targetId = null; hero.orderedTargetId = null;
      effect(s, 'dash', hero.team, from, { toX: p.x, toY: p.y, radius: 100, sourceId: hero.id });
      for (const u of enemies) if (distance(hero, u) < 110) hurt(s, hero, u, 100 * scale);
    }
  } else if (slot === 0) {
    s.projectiles.push({ id: `projectile-${++s.sequence}`, kind: 'bolt', ownerId: hero.id, team: hero.team,
      x: hero.x, y: hero.y, startX: hero.x, startY: hero.y, dirX: dx, dirY: dy,
      speed: 700, range: 650, radius: 30, damage: 125 * scale, hitIds: [] });
  } else if (slot === 1) {
    const p = position({ x: hero.x + dx * Math.min(d, 600), y: hero.y + dy * Math.min(d, 600) });
    s.projectiles.push({ id: `hazard-${++s.sequence}`, kind: 'nova', ownerId: hero.id, team: hero.team,
      x: p.x, y: p.y, startX: p.x, startY: p.y, dirX: 0, dirY: 0, speed: 0, range: 0,
      radius: 135, damage: 100 * scale, activateAt: s.time + .65, slowSeconds: 2, hitIds: [] });
    effect(s, 'nova', hero.team, p, { radius: 135, text: '预警' }, .65);
  } else {
    const from = { x: hero.x, y: hero.y };
    const p = displacementEndpoint(hero, point, 210);
    const healing = 80 + (rank - 1) * 30;
    hero.x = p.x; hero.y = p.y; hero.moveTarget = null; hero.attackMoveTarget = null; hero.targetId = null; hero.orderedTargetId = null; hero.hp = Math.min(hero.maxHp, hero.hp + healing);
    effect(s, 'dash', hero.team, from, { toX: p.x, toY: p.y, sourceId: hero.id }, .6);
    effect(s, 'heal', hero.team, hero, { text: `+${healing}` }, .8);
  }
  return { ok: true };
}

export function applyCommand(s: MatchState, team: Team, command: Command): { ok: boolean; error?: string } {
  if (team !== 0 && team !== 1) return { ok: false, error: '队伍无效' };
  if (s.status !== 'playing') return { ok: false, error: '对局已经结束' };
  const hero = getHero(s, team);
  if (!command || typeof command !== 'object') return { ok: false, error: '操作无效' };
  if (command.type === 'upgrade') {
    if (![0, 1, 2, 3].includes(command.slot)) return { ok: false, error: '技能无效' };
    if (hero.skillPoints <= 0) return { ok: false, error: '没有可用技能点' };
    const data = HEROES[hero.heroKind!].skills[command.slot], rank = hero.skillRanks[command.slot];
    if (rank >= data.maxRank) return { ok: false, error: '技能已达最高等级' };
    const requiredLevel = command.slot === 3 && rank === 1 ? 8 : data.unlockLevel;
    if (hero.level < requiredLevel) return { ok: false, error: `${requiredLevel} 级才能升级此技能` };
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
    hero.damage += item.damage ?? 0; hero.maxHp += item.hp ?? 0;
    if (living(hero)) hero.hp = Math.min(hero.maxHp, hero.hp + (item.hp ?? 0));
    hero.speed += item.speed ?? 0; hero.maxMana! += item.mana ?? 0;
    hero.mana! = Math.min(hero.maxMana!, hero.mana! + (item.mana ?? 0));
    hero.attackCd = Math.max(.3, hero.attackCd * (1 - (item.haste ?? 0)));
    return { ok: true };
  }
  if (!living(hero)) return { ok: false, error: '正在等待复活' };
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
      effect(s, 'dash', team, from, { toX: p.x, toY: p.y, sourceId: hero.id }, .55);
    }
    hero.summonerCooldowns[command.slot] = SUMMONERS[command.slot].cooldown;
    return { ok: true };
  }
  if (command.type === 'stop') { hero.moveTarget = null; hero.attackMoveTarget = null; hero.targetId = null; hero.orderedTargetId = null; return { ok: true }; }
  if (command.type === 'attack') {
    const target = s.units.find(u => u.id === command.targetId);
    if (!target || !living(target) || target.team === team || !isUnitVisibleToTeam(s, target, team)) return { ok: false, error: '请选择可见的敌方目标' };
    if (protectedBase(s, target)) return { ok: false, error: '先摧毁敌方防御塔' };
    hero.targetId = target.id; hero.orderedTargetId = target.id; hero.moveTarget = null; hero.attackMoveTarget = null; return { ok: true };
  }
  if (command.type === 'move' || command.type === 'attackMove' || command.type === 'skill') {
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return { ok: false, error: '目标位置无效' };
    if (command.type === 'move') { hero.moveTarget = walkingDestination(hero, command); hero.attackMoveTarget = null; hero.targetId = null; hero.orderedTargetId = null; return { ok: true }; }
    if (command.type === 'attackMove') { hero.attackMoveTarget = walkingDestination(hero, command); hero.moveTarget = null; hero.targetId = null; hero.orderedTargetId = null; return { ok: true }; }
    if (![0, 1, 2, 3].includes(command.slot)) return { ok: false, error: '技能无效' };
    return cast(s, hero, command.slot, position(command), command.targetId);
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
  const step = Math.min(d - stopDistance, u.speed * (u.slowUntil && u.slowUntil > time ? .5 : 1) * dt);
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
  const scanRange = u.kind === 'hero' ? u.range : 310;
  const nearby = enemies.filter(v => distance(u, v) <= scanRange);
  // Troops fight enemy troops before heroes and structures, keeping waves readable.
  if (u.kind !== 'hero') return closest(u, nearby.filter(v => v.kind === 'melee' || v.kind === 'ranged')) ?? closest(u, nearby);
  return closest(u, nearby);
}
function botThink(s: MatchState, hero: Unit) {
  if (!living(hero)) return;
  while (hero.skillPoints > 0) {
    const ultimateReady = hero.skillRanks[3] < 2 && hero.level >= (hero.skillRanks[3] === 0 ? 4 : 8);
    const slot: SkillSlot | undefined = ultimateReady ? 3 : hero.skillRanks[0] < 3 ? 0 : hero.skillRanks[1] < 3 ? 1 : hero.skillRanks[2] < 3 ? 2 : undefined;
    if (slot === undefined || !applyCommand(s, hero.team, { type: 'upgrade', slot }).ok) break;
  }
  const opponent = getHero(s, hero.team === 0 ? 1 : 0);
  const opponentVisible = isUnitVisibleToTeam(s, opponent, hero.team);
  if (hero.hp < hero.maxHp * .55 && !hero.summonerCooldowns?.heal) {
    applyCommand(s, hero.team, { type: 'summoner', slot: 'heal', x: hero.x, y: hero.y });
  }
  if (hero.hp < hero.maxHp * .65 && !hero.potionEffect) {
    if (!hero.potions && hero.gold! >= 100) applyCommand(s, hero.team, { type: 'buy', itemId: 'potion' });
    if (hero.potions) applyCommand(s, hero.team, { type: 'usePotion' });
  }
  if (hero.hp < hero.maxHp * .25) {
    applyCommand(s, hero.team, { type: 'move', x: spawnX(hero.team), y: WORLD.laneY });
    if (hero.heroKind === 'knight') applyCommand(s, hero.team, { type: 'skill', slot: 1, x: hero.x, y: hero.y });
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
  if (opponentVisible && living(opponent) && distance(hero, opponent) < (hero.heroKind === 'mage' ? 430 : 160)) {
    applyCommand(s, hero.team, { type: 'skill', slot: 0, x: opponent.x, y: opponent.y, targetId: opponent.id });
    applyCommand(s, hero.team, { type: 'skill', slot: 1, x: opponent.x, y: opponent.y });
  }
  if (opponentVisible && hero.heroKind === 'knight' && living(opponent) && distance(hero, opponent) > 130 && distance(hero, opponent) < 330) {
    applyCommand(s, hero.team, { type: 'skill', slot: 2, x: opponent.x, y: opponent.y });
  }
  if (opponentVisible && hero.skillRanks[3] > 0 && living(opponent) && distance(hero, opponent) < HEROES[hero.heroKind!].skills[3].range) {
    applyCommand(s, hero.team, { type: 'skill', slot: 3, x: opponent.x, y: opponent.y, targetId: opponent.id });
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
    hero.mana = Math.min(hero.maxMana!, hero.mana! + 7 * dt);
    if (hero.potionEffect) {
      const active = hero.potionEffect, tick = Math.min(dt, active.remaining);
      hero.hp = Math.min(hero.maxHp, hero.hp + active.hpPerSecond * active.potency * tick);
      hero.mana = Math.min(hero.maxMana!, hero.mana! + active.manaPerSecond * active.potency * tick);
      active.remaining = Math.max(0, active.remaining - tick);
      if (active.remaining <= 1e-8) delete hero.potionEffect;
    }
    if (hero.buffUntil && s.time > hero.buffUntil) hero.shield = 0;
    if (hero.bot && Math.floor(oldTime / .6) !== Math.floor(s.time / .6)) botThink(s, hero);
  }
  for (const u of s.units) {
    if (!living(u) || u.kind === 'base' || s.status !== 'playing') continue;
    u.attackTimer = Math.max(0, u.attackTimer - dt);
    let target = u.targetId ? s.units.find(v => v.id === u.targetId && v.team !== u.team && living(v) && !protectedBase(s, v) && isUnitTargetableBy(s, v, u)) : undefined;
    if (u.kind === 'tower') target = acquire(s, u);
    else if (u.kind !== 'hero') {
      if (!target || distance(u, target) > 340) target = acquire(s, u);
    } else if (u.moveTarget) {
      moveToward(u, u.moveTarget, dt, 0, s.time);
      if (distance(u, u.moveTarget) < 1) u.moveTarget = null;
      continue;
    } else if (u.attackMoveTarget) {
      if (target && distance(u, target) > u.range + 120) target = undefined;
      if (!target) {
        const nearby = s.units.filter(v => v.team !== u.team && living(v) && !protectedBase(s, v) && distance(u, v) <= u.range + 90 && isUnitVisibleToTeam(s, v, u.team));
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
      if (target && !u.orderedTargetId && distance(u, target) > u.range + 1) target = undefined;
      if (!target) target = acquire(s, u);
    }
    u.targetId = target?.id ?? null;
    if (target) {
      const effectiveRange = u.range + (target.kind === 'tower' ? 30 : target.kind === 'base' ? 45 : 0);
      if (distance(u, target) <= effectiveRange + 1) {
        if (u.attackTimer <= 0) {
          u.attackTimer = u.attackCd;
          effect(s, 'attack', u.team, u, { toX: target.x, toY: target.y, radius: u.range > 100 ? 4 : 18 }, .24);
          hurt(s, u, target, u.damage);
        }
      } else if (mobile(u)) moveToward(u, target, dt, effectiveRange, s.time);
    } else if (u.kind === 'melee' || u.kind === 'ranged') {
      moveToward(u, { x: WORLD.baseX[u.team === 0 ? 1 : 0], y: WORLD.laneY + (Number(u.id.slice(-1)) % 2 ? 18 : -18) }, dt, 0, s.time);
    }
  }
  updateProjectiles(s, dt);
  for (const hero of s.units.filter(u => u.kind === 'hero')) hero.brushId = bushAt(hero)?.id ?? null;
  // Only dead troops are removed; dead heroes and structures remain for respawn/rubble views.
  s.units = s.units.filter(u => living(u) || u.kind === 'hero' || u.kind === 'tower' || u.kind === 'base');
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  const t = squared === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / squared, 0, 1);
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
}
function updateProjectiles(s: MatchState, dt: number) {
  if (s.status !== 'playing') return;
  s.projectiles = s.projectiles.filter(p => {
    const owner = s.units.find(u => u.id === p.ownerId);
    if (!owner || s.status !== 'playing') return false;
    const enemies = s.units.filter(u => u.team !== p.team && living(u));
    if (p.kind === 'nova') {
      if (s.time + 1e-8 < p.activateAt!) return true;
      effect(s, 'nova', p.team, p, { radius: p.radius, text: '爆发' }, .35);
      for (const u of enemies) if (distance(u, p) <= p.radius) {
        const protectedTarget = protectedBase(s, u);
        hurt(s, owner, u, p.damage);
        if (!protectedTarget && p.slowSeconds) u.slowUntil = Math.max(u.slowUntil ?? 0, s.time + p.slowSeconds);
      }
      return false;
    }
    const from = { x: p.x, y: p.y }, traveled = Math.hypot(p.x - p.startX, p.y - p.startY);
    const length = Math.min(p.speed * dt, Math.max(0, p.range - traveled));
    p.x += p.dirX * length; p.y += p.dirY * length;
    for (const u of enemies) {
      if (p.hitIds.includes(u.id)) continue;
      const bodyRadius = mobile(u) ? 20 : 45;
      if (distanceToSegment(u, from, p) <= p.radius + bodyRadius) {
        p.hitIds.push(u.id); hurt(s, owner, u, p.damage);
      }
    }
    return traveled + length + 1e-8 < p.range;
  });
}
