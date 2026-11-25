import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, bushAt, createMatch as createRawMatch, displacementEndpoint, getHero, isPointInTeamVision, isUnitTargetableBy, isUnitVisibleToTeam, isWater, stepMatch } from '../src/shared/simulation.ts';
import { RULES, SUMMONERS, TERRAIN, WORLD, xpForNextLevel } from '../src/shared/data.ts';
import type { MatchState, Unit } from '../src/shared/types.ts';

const center = WORLD.width / 2, lane = WORLD.laneY;
function createMatch(...args: Parameters<typeof createRawMatch>) {
  const s = createRawMatch(...args);
  for (const u of s.units.filter(u => u.kind === 'hero')) u.skillRanks = [1, 1, 1, 0];
  return s;
}
function advance(s: MatchState, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 20); i++) stepMatch(s, .05);
}
function place(u: Unit, x: number, y = lane) { u.x = x; u.y = y; }

test('large world has one tower/base per team, straight waves and passive income', () => {
  const s = createMatch();
  assert.equal(s.units.filter(u => u.kind === 'hero').length, 2);
  assert.equal(s.units.filter(u => u.kind === 'tower').length, 2);
  assert.equal(s.units.filter(u => u.kind === 'base').length, 2);
  assert.equal(getHero(s, 0).x, WORLD.spawnX[0]);
  assert.equal(getHero(s, 1).x, WORLD.spawnX[1]);
  assert.ok(WORLD.towerX[1] - WORLD.towerX[0] > 2000);
  const tower = s.units.find(u => u.kind === 'tower')!;
  const furthestEdge = Math.max(WORLD.laneY - WORLD.minY, WORLD.maxY - WORLD.laneY);
  assert.ok(furthestEdge < tower.range, 'tower range covers the entire traversable width');
  assert.ok(2 * Math.sqrt(tower.range ** 2 - furthestEdge ** 2) > SUMMONERS.flash.range, 'edge route cannot skip the entire tower range with one flash');
  advance(s, 3.1);
  assert.equal(s.wave, 1);
  assert.equal(s.units.filter(u => u.kind === 'melee').length, 6);
  assert.equal(s.units.filter(u => u.kind === 'ranged').length, 2);
  assert.ok(s.units.filter(u => u.kind === 'melee').every(u => Math.abs(u.y - lane) <= 18));
  assert.ok(getHero(s, 0).gold! > 509);
});

test('base shield prevents direct attacks and projectiles until tower destroyed', () => {
  const s = createMatch(['mage', 'knight']); const hero = getHero(s, 0);
  const base = s.units.find(u => u.id === 'base-1')!; place(hero, base.x - 150);
  assert.equal(applyCommand(s, 0, { type: 'attack', targetId: base.id }).ok, false);
  applyCommand(s, 0, { type: 'skill', slot: 0, x: base.x, y: base.y }); advance(s, .3);
  assert.equal(base.hp, base.maxHp);
  s.units.find(u => u.id === 'tower-1')!.hp = 0; hero.cooldowns![0] = 0;
  applyCommand(s, 0, { type: 'skill', slot: 0, x: base.x, y: base.y }); advance(s, .3);
  assert.ok(base.hp < base.maxHp);
});

test('hero final blow grants last-hit gold', () => {
  const s = createMatch(['mage', 'knight']); advance(s, 3.1);
  const hero = getHero(s, 0); place(hero, center);
  const victim = s.units.find(u => u.team === 1 && u.kind === 'melee')!; place(victim, center + 100); victim.hp = 10;
  const before = hero.gold!;
  applyCommand(s, 0, { type: 'attack', targetId: victim.id }); stepMatch(s, .05);
  assert.equal(hero.lastHits, 1); assert.ok(hero.gold! >= before + 38);
});

test('equipment is server priced and limited to six slots while purchasing anywhere', () => {
  const s = createMatch(); const hero = getHero(s, 0);
  assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'sword' }).ok, true);
  assert.equal(hero.gold, 200); assert.equal(hero.damage, 90);
  assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'sword' }).ok, false);
  hero.gold = 9999; place(hero, center);
  assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'heart' }).ok, true);
  assert.equal(hero.items!.length, 2);
  for (let i = 0; i < 4; i++) assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'heart' }).ok, true);
  assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'heart' }).ok, false);
});

test('mana/cooldowns enforce casts and invalid positions cannot corrupt the wider world', () => {
  const s = createMatch(); const hero = getHero(s, 0), mana = hero.mana!;
  assert.equal(applyCommand(s, 0, { type: 'skill', slot: 1, x: hero.x, y: lane }).ok, true);
  assert.ok(hero.shield! > 0); assert.ok(hero.mana! < mana);
  assert.equal(applyCommand(s, 0, { type: 'skill', slot: 1, x: hero.x, y: lane }).ok, false);
  assert.equal(applyCommand(s, 0, { type: 'move', x: Infinity, y: NaN }).ok, false);
  applyCommand(s, 0, { type: 'move', x: 999999, y: -999999 }); advance(s, 5);
  assert.ok(Number.isFinite(hero.x) && hero.x <= WORLD.maxX && hero.y >= WORLD.minY);
  assert.equal(hero.shield, 0);
});

test('hero kill rewards and purchased equipment survive timed respawn at new spawn', () => {
  const s = createMatch(['mage', 'knight']); const attacker = getHero(s, 0), victim = getHero(s, 1);
  applyCommand(s, 1, { type: 'buy', itemId: 'sword' });
  place(attacker, center); place(victim, center + 100); victim.hp = 5;
  const before = attacker.gold!;
  applyCommand(s, 0, { type: 'attack', targetId: victim.id }); stepMatch(s, .05);
  assert.equal(victim.hp, 0); assert.equal(victim.deaths, 1); assert.equal(attacker.kills, 1); assert.ok(attacker.gold! >= before + 220);
  assert.equal(applyCommand(s, 1, { type: 'move', x: center, y: lane }).ok, false);
  place(attacker, WORLD.spawnX[0]); attacker.targetId = null; attacker.orderedTargetId = null; advance(s, 9.1);
  assert.ok(victim.hp > 0); assert.equal(victim.x, WORLD.spawnX[1]); assert.equal(victim.y, lane);
  assert.deepEqual(victim.items, ['sword']);
});

test('tower prioritizes troops then retaliates against skill damage on defending hero', () => {
  const s = createMatch(['mage', 'knight']); advance(s, 3.1);
  const attacker = getHero(s, 0), defender = getHero(s, 1), tower = s.units.find(u => u.id === 'tower-1')!;
  const minion = s.units.find(u => u.team === 0 && u.kind === 'melee')!;
  place(minion, tower.x - 90); place(attacker, tower.x - 160); place(defender, tower.x - 30); attacker.attackTimer = 5;
  stepMatch(s, .05); assert.equal(tower.targetId, minion.id);
  applyCommand(s, 0, { type: 'skill', slot: 0, x: defender.x, y: defender.y }); advance(s, .25);
  assert.equal(tower.targetId, attacker.id);
});

test('destroying exposed base ends match and freezes simulation', () => {
  const s = createMatch(['mage', 'knight']); const hero = getHero(s, 0); place(hero, WORLD.baseX[1] - 100);
  s.units.find(u => u.id === 'tower-1')!.hp = 0; s.units.find(u => u.id === 'base-1')!.hp = 5;
  applyCommand(s, 0, { type: 'attack', targetId: 'base-1' }); stepMatch(s, .05);
  assert.equal(s.status, 'finished'); assert.equal(s.winner, 0);
  const time = s.time; advance(s, 3); assert.equal(s.time, time);
  assert.equal(applyCommand(s, 0, { type: 'move', x: center, y: lane }).ok, false);
});

test('bot follows waves and completes a larger-map game against an unattended player', () => {
  const s = createRawMatch(['knight', 'mage'], [1]); advance(s, 900);
  assert.equal(s.status, 'finished'); assert.equal(s.winner, 1);
  assert.ok(s.units.every(u => Number.isFinite(u.hp) && Number.isFinite(u.x) && Number.isFinite(u.y)));
  assert.ok(s.units.length < 150); assert.ok(s.wave > 5);
});

test('ground movement ignores enemies and allows lateral kiting within the tower-covered lane; idle does not chase', () => {
  const s = createMatch(['mage', 'knight']); const hero = getHero(s, 0), enemy = getHero(s, 1);
  place(hero, center); place(enemy, center + 200); enemy.attackTimer = 100;
  stepMatch(s, .05); assert.equal(hero.targetId, enemy.id);
  enemy.x = center + 400; const origin = hero.x;
  stepMatch(s, .05); assert.equal(hero.x, origin); assert.equal(hero.targetId, null);
  applyCommand(s, 0, { type: 'attack', targetId: enemy.id }); stepMatch(s, .05); assert.ok(hero.x > origin);
  applyCommand(s, 0, { type: 'move', x: center, y: lane - 450 }); advance(s, 3);
  assert.equal(hero.y, WORLD.minY); assert.equal(hero.targetId, null);
});

test('targeted slash refuses missing, allied, structure and distant targets without cost', () => {
  const s = createMatch(); const hero = getHero(s, 0), enemy = getHero(s, 1); place(hero, center); place(enemy, center + 300);
  const mana = hero.mana!;
  for (const targetId of [undefined, hero.id, 'tower-1', enemy.id, 'missing']) {
    assert.equal(applyCommand(s, 0, { type: 'skill', slot: 0, targetId, x: enemy.x, y: enemy.y }).ok, false);
    assert.equal(hero.mana, mana); assert.equal(hero.cooldowns![0], 0);
  }
  place(enemy, center + 100);
  assert.equal(applyCommand(s, 0, { type: 'skill', slot: 0, targetId: enemy.id, x: enemy.x, y: enemy.y }).ok, true);
  assert.equal(enemy.hp, enemy.maxHp - 145);
});

test('star projectile travels over time, pierces once per unit, and can be dodged', () => {
  const s = createMatch(['mage', 'knight']); const mage = getHero(s, 0), enemy = getHero(s, 1); place(mage, center); place(enemy, center + 400);
  mage.attackTimer = 100; enemy.attackTimer = 100;
  applyCommand(s, 0, { type: 'skill', slot: 0, x: enemy.x, y: enemy.y });
  assert.equal(enemy.hp, enemy.maxHp); assert.equal(s.projectiles.length, 1);
  advance(s, .2); assert.equal(enemy.hp, enemy.maxHp); assert.ok(s.projectiles[0].x > mage.x);
  advance(s, .4); assert.equal(enemy.hp, enemy.maxHp - 125);
  advance(s, .5); assert.equal(enemy.hp, enemy.maxHp - 125); assert.equal(s.projectiles.length, 0);
  const dodge = createMatch(['mage', 'knight']), caster = getHero(dodge, 0), runner = getHero(dodge, 1);
  place(caster, center); place(runner, center + 400); caster.attackTimer = 100; runner.attackTimer = 100;
  applyCommand(dodge, 0, { type: 'skill', slot: 0, x: runner.x, y: runner.y });
  applyCommand(dodge, 1, { type: 'move', x: runner.x, y: lane + 400 }); advance(dodge, 1);
  assert.equal(runner.hp, runner.maxHp);
});

test('nova has a dodge window, impacts after delay and slows only targets still inside', () => {
  const s = createMatch(['mage', 'knight']); const mage = getHero(s, 0), enemy = getHero(s, 1); place(mage, center); place(enemy, center + 400);
  mage.attackTimer = 100; enemy.attackTimer = 100;
  applyCommand(s, 0, { type: 'skill', slot: 1, x: enemy.x, y: enemy.y }); advance(s, .6);
  assert.equal(enemy.hp, enemy.maxHp); assert.equal(s.projectiles[0].kind, 'nova');
  advance(s, .1); assert.equal(enemy.hp, enemy.maxHp - 100); assert.ok(enemy.slowUntil! > s.time);
  const dodge = createMatch(['mage', 'knight']), caster = getHero(dodge, 0), runner = getHero(dodge, 1);
  place(caster, center); place(runner, center + 400); runner.attackTimer = 100; caster.attackTimer = 100;
  applyCommand(dodge, 0, { type: 'skill', slot: 1, x: runner.x, y: runner.y });
  applyCommand(dodge, 1, { type: 'summoner', slot: 'flash', x: runner.x, y: lane + 400 }); advance(dodge, .7);
  assert.equal(runner.hp, runner.maxHp); assert.equal(runner.slowUntil, undefined);
});

test('shield, charge and hero blink keep distinct combat and mobility effects', () => {
  const s = createMatch(['knight', 'mage']); const knight = getHero(s, 0), mage = getHero(s, 1); place(knight, center); place(mage, center + 120);
  applyCommand(s, 0, { type: 'skill', slot: 1, x: knight.x, y: lane }); assert.equal(knight.shield, 230);
  applyCommand(s, 0, { type: 'skill', slot: 2, x: mage.x, y: lane }); assert.equal(knight.x, center + 120); assert.equal(mage.hp, mage.maxHp - 100);
  const before = mage.hp;
  applyCommand(s, 1, { type: 'skill', slot: 2, x: center + 600, y: lane }); assert.equal(mage.x, center + 330); assert.equal(mage.hp, before + 80);
});

test('D heal and F flash have independent no-mana cooldowns that persist across respawn', () => {
  const s = createMatch(); const hero = getHero(s, 0); place(hero, center); hero.hp = 400; hero.mana = 0; hero.cooldowns = [5, 6, 7, 8];
  applyCommand(s, 0, { type: 'summoner', slot: 'heal', x: hero.x, y: lane }); assert.equal(hero.hp, 660); assert.equal(hero.summonerCooldowns!.heal, 90);
  applyCommand(s, 0, { type: 'summoner', slot: 'flash', x: center + 600, y: lane }); assert.equal(hero.x, center + 340); assert.equal(hero.summonerCooldowns!.flash, 120);
  assert.deepEqual(hero.cooldowns, [5, 6, 7, 8]); assert.equal(hero.mana, 0);
  assert.equal(applyCommand(s, 0, { type: 'summoner', slot: 'heal', x: hero.x, y: lane }).ok, false);
  hero.hp = 0; hero.respawnAt = s.time + 9; advance(s, 9.1);
  assert.ok(hero.hp > 0); assert.ok(hero.summonerCooldowns!.heal > 80); assert.ok(hero.summonerCooldowns!.flash > 110);
});

test('initial skill point, unlearned refusal, upgrade caps and R level gates are authoritative', () => {
  const s = createRawMatch(); const hero = getHero(s, 0);
  assert.equal(hero.level, 1); assert.equal(hero.skillPoints, 1); assert.deepEqual(hero.skillRanks, [0, 0, 0, 0]);
  const mana = hero.mana!;
  assert.equal(applyCommand(s, 0, { type: 'skill', slot: 1, x: hero.x, y: lane }).ok, false); assert.equal(hero.mana, mana);
  assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 3 }).ok, false); assert.equal(hero.skillPoints, 1);
  assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 0 }).ok, true); assert.equal(hero.skillRanks[0], 1); assert.equal(hero.skillPoints, 0);
  assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 1 }).ok, false);
  hero.skillPoints = 10; hero.level = 3;
  assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 3 }).ok, false);
  hero.level = 4; assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 3 }).ok, true);
  assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 3 }).ok, false);
  hero.level = 8; assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 3 }).ok, true);
  assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 3 }).ok, false);
  applyCommand(s, 0, { type: 'upgrade', slot: 0 }); applyCommand(s, 0, { type: 'upgrade', slot: 0 });
  assert.equal(hero.skillRanks[0], 3); assert.equal(applyCommand(s, 0, { type: 'upgrade', slot: 0 }).ok, false);
});

test('nearby troop kills grant XP without last-hit gold, levels add points, maximum level is 10', () => {
  const s = createRawMatch(); advance(s, 3.1);
  const hero = getHero(s, 0); place(hero, center);
  const ally = s.units.find(u => u.team === 0 && u.kind === 'melee')!; place(ally, center + 380); ally.damage = 99999;
  const template = s.units.find(u => u.team === 1 && u.kind === 'melee')!;
  const initialGold = hero.gold!, initialHp = hero.maxHp, initialDamage = hero.damage;
  for (let i = 0; i < 3; i++) {
    const victim = { ...template, id: `xp-victim-${i}`, x: center + 400, y: lane, hp: 1, targetId: null };
    s.units.push(victim); ally.targetId = victim.id; ally.attackTimer = 0; stepMatch(s, .05);
  }
  assert.equal(hero.lastHits, 0); assert.ok(hero.gold! < initialGold + 1);
  assert.equal(hero.level, 2); assert.equal(hero.xp, 6); assert.equal(hero.skillPoints, 2);
  assert.equal(hero.maxHp, initialHp + 80); assert.equal(hero.damage, initialDamage + 5); assert.equal(xpForNextLevel(2), 165);
  for (let i = 3; i < 90; i++) {
    const victim = { ...template, id: `xp-victim-${i}`, x: center + 400, y: lane, hp: 1, targetId: null };
    s.units.push(victim); ally.targetId = victim.id; ally.attackTimer = 0; stepMatch(s, .05);
  }
  assert.equal(hero.level, 10); assert.equal(hero.xp, 0); assert.equal(hero.skillPoints, 10);
  assert.equal(hero.maxHp, initialHp + 9 * 80); assert.equal(hero.lastHits, 0);
});

test('ranked normals scale and knight ultimate leaps with missing-health execution damage', () => {
  const s = createMatch(['knight', 'mage']); const knight = getHero(s, 0), mage = getHero(s, 1);
  place(knight, center); place(mage, center + 100); knight.skillRanks[0] = 3;
  applyCommand(s, 0, { type: 'skill', slot: 0, targetId: mage.id, x: mage.x, y: lane });
  assert.equal(mage.hp, mage.maxHp - 217.5); assert.ok(Math.abs(knight.cooldowns![0] - 4.8) < 1e-8);
  knight.skillRanks[3] = 1; knight.level = 4; place(mage, center + 400); const before = mage.hp;
  applyCommand(s, 0, { type: 'skill', slot: 3, targetId: mage.id, x: mage.x, y: lane });
  assert.equal(knight.x, mage.x - 65); assert.equal(mage.hp, before - 260 - (mage.maxHp - before) * .15); assert.equal(knight.cooldowns![3], 65);
});

test('mage ultimate gives a one-second warning before large area damage and can be dodged', () => {
  const s = createMatch(['mage', 'knight']); const mage = getHero(s, 0), enemy = getHero(s, 1); place(mage, center); place(enemy, center + 600);
  mage.skillRanks[3] = 1; mage.level = 4; mage.attackTimer = 100; enemy.attackTimer = 100;
  applyCommand(s, 0, { type: 'skill', slot: 3, x: enemy.x, y: lane }); advance(s, .9);
  assert.equal(enemy.hp, enemy.maxHp); assert.equal(s.projectiles[0].radius, 260);
  advance(s, .15); assert.equal(enemy.hp, enemy.maxHp - 300);
  const dodge = createMatch(['mage', 'knight']), caster = getHero(dodge, 0), runner = getHero(dodge, 1);
  place(caster, center); place(runner, center + 600); caster.skillRanks[3] = 2; caster.level = 8; caster.attackTimer = 100; runner.attackTimer = 100;
  applyCommand(dodge, 0, { type: 'skill', slot: 3, x: runner.x, y: lane });
  applyCommand(dodge, 1, { type: 'summoner', slot: 'flash', x: runner.x + 400, y: lane }); advance(dodge, 1.1);
  assert.equal(runner.hp, runner.maxHp); assert.equal(caster.cooldowns![3] < 55, true);
});

test('attack-move engages a nearby enemy and resumes its ground goal after the kill', () => {
  const s = createMatch(['mage', 'knight']); s.nextWave = Infinity;
  const hero = getHero(s, 0), enemy = getHero(s, 1); place(hero, center); place(enemy, center + 350); enemy.hp = 5; enemy.attackTimer = 100;
  assert.equal(applyCommand(s, 0, { type: 'attackMove', x: center + 800, y: lane }).ok, true);
  stepMatch(s, .05); assert.equal(hero.targetId, enemy.id); assert.ok(hero.x > center);
  advance(s, 3); assert.equal(enemy.hp, 0); assert.equal(hero.kills, 1);
  assert.ok(hero.x > center + 350); assert.equal(hero.attackMoveTarget?.x, center + 800);
});

test('right-click movement cancels attack-move and escapes nearby enemies without firing', () => {
  const s = createMatch(['mage', 'knight']); s.nextWave = Infinity;
  const hero = getHero(s, 0), enemy = getHero(s, 1); place(hero, center); place(enemy, center + 200); hero.attackTimer = 10; enemy.attackTimer = 100;
  applyCommand(s, 0, { type: 'attackMove', x: center + 800, y: lane }); stepMatch(s, .05);
  assert.equal(hero.targetId, enemy.id);
  hero.attackTimer = 0; const hp = enemy.hp;
  applyCommand(s, 0, { type: 'move', x: center - 400, y: lane - 300 }); advance(s, 1);
  assert.equal(hero.attackMoveTarget, null); assert.equal(hero.targetId, null);
  assert.ok(hero.x < center); assert.ok(hero.y < lane); assert.equal(enemy.hp, hp);
});

test('potion restores both health and mana gradually for eight seconds without a fountain bonus', () => {
  const s = createRawMatch(); s.nextWave = Infinity; const hero = getHero(s, 0);
  hero.hp = 100; hero.mana = 0;
  advance(s, 1); assert.equal(hero.hp, 100); assert.ok(Math.abs(hero.mana! - 7) < 1e-8);
  hero.mana = 0;
  applyCommand(s, 0, { type: 'buy', itemId: 'potion' });
  assert.equal(applyCommand(s, 0, { type: 'usePotion' }).ok, true);
  assert.equal(hero.hp, 100); assert.equal(hero.mana, 0); assert.equal(hero.potionEffect!.potency, 1);
  advance(s, 4); assert.ok(Math.abs(hero.hp - (100 + hero.maxHp * .25)) < 1e-8); assert.ok(Math.abs(hero.mana! - (hero.maxMana! * .25 + 28)) < 1e-8);
  advance(s, 4); assert.ok(Math.abs(hero.hp - (100 + hero.maxHp * .5)) < 1e-8); assert.ok(Math.abs(hero.mana! - (hero.maxMana! * .5 + 56)) < 1e-8);
  assert.equal(hero.potionEffect, undefined);
});

test('combat potion gives twenty percent potency and never improves after combat expires', () => {
  const s = createRawMatch(); s.nextWave = Infinity; const hero = getHero(s, 0); place(hero, center);
  hero.hp = 100; hero.mana = 0; hero.lastCombatAt = s.time;
  applyCommand(s, 0, { type: 'buy', itemId: 'potion' }); applyCommand(s, 0, { type: 'usePotion' });
  assert.equal(hero.potionEffect!.potency, .2);
  advance(s, 8); assert.ok(Math.abs(hero.hp - (100 + hero.maxHp * .1)) < 1e-8); assert.ok(Math.abs(hero.mana! - (hero.maxMana! * .1 + 56)) < 1e-8);
  assert.equal(hero.potionEffect, undefined);
});

test('fresh combat reduces only remaining full-potion ticks, even when shields absorb the hit', () => {
  const s = createRawMatch(['mage', 'knight']); s.nextWave = Infinity;
  const hero = getHero(s, 0), enemy = getHero(s, 1); place(hero, center); place(enemy, center + 200);
  hero.hp = 100; hero.mana = 0; hero.attackTimer = 100; enemy.attackTimer = 100; enemy.shield = 1000;
  applyCommand(s, 0, { type: 'buy', itemId: 'potion' }); applyCommand(s, 0, { type: 'usePotion' }); advance(s, 1);
  assert.equal(hero.potionEffect!.potency, 1);
  const enemyHp = enemy.hp; hero.attackTimer = 0;
  applyCommand(s, 0, { type: 'attack', targetId: enemy.id }); stepMatch(s, .05);
  assert.equal(enemy.hp, enemyHp); assert.equal(hero.lastCombatAt, s.time); assert.equal(enemy.lastCombatAt, s.time); assert.equal(hero.potionEffect!.potency, .2);
  const hp = hero.hp, mana = hero.mana!;
  advance(s, 1); assert.ok(Math.abs(hero.hp - hp - hero.maxHp * .5 / 8 * .2) < 1e-8); assert.ok(Math.abs(hero.mana! - mana - (hero.maxMana! * .5 / 8 * .2 + 7)) < 1e-8);
});

test('potion stock is separate from full equipment, capped at three, and invalid uses consume nothing', () => {
  const s = createRawMatch(); s.nextWave = Infinity; const hero = getHero(s, 0); place(hero, center); hero.gold = 9999;
  for (let i = 0; i < 6; i++) assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'sword' }).ok, true);
  for (let i = 0; i < 3; i++) assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'potion' }).ok, true);
  assert.equal(hero.items!.length, 6); assert.equal(hero.potions, 3);
  const gold = hero.gold!; assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'potion' }).ok, false); assert.equal(hero.gold, gold);
  assert.equal(applyCommand(s, 0, { type: 'usePotion' }).ok, false); assert.equal(hero.potions, 3);
  hero.hp = 0; assert.equal(applyCommand(s, 0, { type: 'usePotion' }).ok, false); assert.equal(hero.potions, 3);
  hero.hp = hero.maxHp; hero.mana! -= 100; hero.lastCombatAt = -5;
  assert.equal(applyCommand(s, 0, { type: 'usePotion' }).ok, true); assert.equal(hero.potionEffect!.potency, 1); assert.equal(hero.potions, 2);
  assert.equal(applyCommand(s, 0, { type: 'usePotion' }).ok, false); assert.equal(hero.potions, 2);
  hero.hp = 0; hero.respawnAt = s.time + 9; delete hero.potionEffect;
  assert.equal(applyCommand(s, 0, { type: 'buy', itemId: 'potion' }).ok, true); assert.equal(hero.potions, 3);
});

test('death clears an active potion without refunding its consumed stock', () => {
  const s = createRawMatch(['knight', 'mage']); s.nextWave = Infinity;
  const hero = getHero(s, 0), enemy = getHero(s, 1); place(hero, center); place(enemy, center + 200);
  hero.hp = 1; hero.attackTimer = 100; enemy.attackTimer = 0;
  applyCommand(s, 0, { type: 'buy', itemId: 'potion' }); applyCommand(s, 0, { type: 'usePotion' });
  applyCommand(s, 1, { type: 'attack', targetId: hero.id }); stepMatch(s, .05);
  assert.equal(hero.hp, 0); assert.equal(hero.potionEffect, undefined); assert.equal(hero.potions, 0);
});

test('ordinary movement routes diagonal orders across the narrow bridge in both directions without entering water', () => {
  const s = createMatch(['mage', 'knight']); s.nextWave = Infinity; const hero = getHero(s, 0); place(hero, 2520, 835);
  for (const goal of [{ x: 2180, y: 835 }, { x: 2520, y: 835 }]) {
    applyCommand(s, 0, { type: 'move', ...goal }); let crossedBridge = false;
    for (let i = 0; i < 220; i++) {
      stepMatch(s, .05); assert.equal(isWater(hero), false);
      if (hero.x > TERRAIN.river.minX && hero.x < TERRAIN.river.maxX) {
        crossedBridge = true; assert.ok(hero.y >= TERRAIN.bridge.minY && hero.y <= TERRAIN.bridge.maxY);
      }
    }
    assert.ok(crossedBridge); assert.ok(Math.hypot(hero.x - goal.x, hero.y - goal.y) < 1);
  }
});

test('attack-move and chasing route through the bridge, while troops keep the center lane passable', () => {
  for (const kind of ['attackMove', 'attack'] as const) {
    const s = createMatch(['knight', 'mage']); s.nextWave = Infinity; const hero = getHero(s, 0), enemy = getHero(s, 1);
    place(hero, 2520, 1165); place(enemy, 2180, 1080); enemy.attackTimer = 100;
    applyCommand(s, 0, kind === 'attack' ? { type: 'attack', targetId: enemy.id } : { type: 'attackMove', x: 2180, y: 1080 });
    for (let i = 0; i < 150; i++) { stepMatch(s, .05); assert.equal(isWater(hero), false); }
    assert.ok(hero.x < TERRAIN.river.minX);
  }
  const s = createRawMatch(); advance(s, 40);
  assert.ok(s.units.some(u => (u.kind === 'melee' || u.kind === 'ranged') && Math.abs(u.x - WORLD.width / 2) < 300));
  assert.ok(s.units.every(u => !isWater(u)));
});

test('displacements cross the water when long enough, but cannot land inside it or gain extra distance', () => {
  const from = { x: 2300, y: 835 };
  for (const range of [210, 230, 340]) {
    const p = displacementEndpoint(from, { x: 2700, y: 835 }, range);
    assert.ok(p.x >= TERRAIN.river.maxX); assert.equal(isWater(p), false); assert.ok(Math.hypot(p.x - from.x, p.y - from.y) <= range + 1e-8);
  }
  const stopped = displacementEndpoint({ x: 2200, y: 835 }, { x: 2600, y: 835 }, 210);
  assert.ok(Math.abs(stopped.x - TERRAIN.river.minX) < 1e-6); assert.equal(isWater(stopped), false);
  const bridge = displacementEndpoint({ x: 2300, y: WORLD.laneY }, { x: 2400, y: WORLD.laneY }, 210);
  assert.equal(bridge.x, 2400); assert.equal(isWater(bridge), false);
  const s = createMatch(['mage', 'knight']); s.nextWave = Infinity; const hero = getHero(s, 0); place(hero, from.x, from.y);
  applyCommand(s, 0, { type: 'skill', slot: 2, x: 2700, y: 835 }); assert.ok(hero.x >= TERRAIN.river.maxX); assert.equal(isWater(hero), false);
});

test('bush heroes remain hidden even from an enemy in the same bush, so targeted attacks and skills cannot lock them', () => {
  const s = createMatch(['knight', 'mage']); s.nextWave = Infinity; const hero = getHero(s, 0), enemy = getHero(s, 1);
  place(hero, 2180, 835); place(enemy, 2200, 835); hero.attackTimer = 100; enemy.attackTimer = 100;
  stepMatch(s, .05); assert.equal(hero.brushId, TERRAIN.bushes[0].id); assert.equal(bushAt(hero)?.id, hero.brushId);
  assert.equal(isUnitVisibleToTeam(s, hero, 0), true); assert.equal(isUnitVisibleToTeam(s, hero, 1), false);
  assert.equal(isUnitVisibleToTeam(s, enemy, 0), false);
  assert.equal(applyCommand(s, 0, { type: 'attack', targetId: enemy.id }).ok, false);
  const mana = hero.mana!;
  assert.equal(applyCommand(s, 0, { type: 'skill', slot: 0, targetId: enemy.id, x: enemy.x, y: enemy.y }).ok, false);
  assert.equal(hero.mana, mana); assert.equal(hero.cooldowns![0], 0);
  applyCommand(s, 0, { type: 'attackMove', x: hero.x, y: hero.y }); stepMatch(s, .05); assert.equal(hero.targetId, null);
});

test('blind area damage including shield hits reveals its victim for three seconds but does not reveal the caster', () => {
  const s = createMatch(['knight', 'mage']); s.nextWave = Infinity; const hero = getHero(s, 0), enemy = getHero(s, 1);
  place(hero, 2180, 835); place(enemy, 2200, 835); hero.attackTimer = 100; enemy.attackTimer = 100; hero.shield = 1000;
  const hp = hero.hp;
  applyCommand(s, 1, { type: 'skill', slot: 1, x: hero.x, y: hero.y }); advance(s, .7);
  assert.equal(hero.hp, hp); assert.ok(hero.shield! < 1000); assert.equal(isUnitVisibleToTeam(s, hero, 1), true);
  assert.equal(isUnitVisibleToTeam(s, enemy, 0), false); assert.ok(hero.revealedUntil! >= s.time + 2.8);
  advance(s, 3.1); assert.equal(isUnitVisibleToTeam(s, hero, 1), false);
  place(hero, 2050, 835); assert.equal(isUnitVisibleToTeam(s, hero, 1), true);
});

test('a directional projectile can hit an unseen hero in a bush and reveal it', () => {
  const s = createMatch(['mage', 'knight']); s.nextWave = Infinity; const hero = getHero(s, 0), enemy = getHero(s, 1);
  place(hero, 2100, 835); place(enemy, 2180, 835); hero.attackTimer = 100; enemy.attackTimer = 100;
  assert.equal(isUnitVisibleToTeam(s, enemy, 0), false);
  applyCommand(s, 0, { type: 'skill', slot: 0, x: enemy.x, y: enemy.y }); advance(s, .2);
  assert.equal(enemy.hp, enemy.maxHp - 125); assert.equal(isUnitVisibleToTeam(s, enemy, 0), true);
});

test('circular vision includes its exact edge and rejects distant attack guesses, including allied troops outside view', () => {
  const s = createRawMatch(); advance(s, 3.1); const hero = getHero(s, 0), enemy = getHero(s, 1); place(hero, center); place(enemy, center + RULES.visionRadius);
  assert.equal(isPointInTeamVision(s, enemy, 0), true); assert.equal(isUnitVisibleToTeam(s, enemy, 0), true);
  enemy.x += .01; assert.equal(isPointInTeamVision(s, enemy, 0), false); assert.equal(isUnitVisibleToTeam(s, enemy, 0), false);
  assert.equal(applyCommand(s, 0, { type: 'attack', targetId: enemy.id }).ok, false);
  const alliedTroop = s.units.find(u => u.kind === 'melee' && u.team === 0)!;
  assert.equal(isUnitVisibleToTeam(s, alliedTroop, 0), false); assert.equal(isUnitVisibleToTeam(s, hero, 0), true);
  hero.hp = 0; hero.respawnAt = s.time + 9;
  assert.equal(isPointInTeamVision(s, { x: center + RULES.visionRadius, y: lane }, 0), true);
  advance(s, 9.1);
  assert.equal(hero.x, WORLD.spawnX[0]); assert.equal(isPointInTeamVision(s, { x: center, y: lane }, 0), false);
});

test('distant minions and towers keep fighting autonomously outside both players circular view', () => {
  const s = createRawMatch(); advance(s, 3.1);
  const blue = s.units.find(u => u.team === 0 && u.kind === 'melee')!, red = s.units.find(u => u.team === 1 && u.kind === 'melee')!;
  place(blue, 2800); place(red, 2840);
  assert.equal(isUnitVisibleToTeam(s, blue, 1), false); assert.equal(isUnitVisibleToTeam(s, red, 0), false);
  assert.equal(isUnitTargetableBy(s, red, blue), true);
  stepMatch(s, .05); assert.ok(blue.hp < blue.maxHp); assert.ok(red.hp < red.maxHp);
  const tower = s.units.find(u => u.id === 'tower-1')!; place(blue, tower.x - 80); blue.targetId = null; tower.attackTimer = 0;
  const hp = blue.hp;
  assert.equal(isUnitVisibleToTeam(s, blue, 1), false); assert.equal(isUnitTargetableBy(s, blue, tower), true);
  stepMatch(s, .05); assert.equal(tower.targetId, blue.id); assert.ok(blue.hp < hp);
});

test('damage reveals a bush target locally without granting sight beyond the hero vision circle', () => {
  const s = createMatch(['mage', 'knight']); s.nextWave = Infinity;
  const hero = getHero(s, 0), enemy = getHero(s, 1); place(hero, 1770, 835); place(enemy, 2620, 835); hero.skillRanks[3] = 1; hero.level = 4;
  assert.equal(isPointInTeamVision(s, enemy, 0), true); assert.equal(isUnitVisibleToTeam(s, enemy, 0), false);
  applyCommand(s, 0, { type: 'skill', slot: 3, x: enemy.x, y: enemy.y });
  applyCommand(s, 0, { type: 'summoner', slot: 'flash', x: hero.x - 400, y: hero.y }); advance(s, 1.1);
  assert.equal(enemy.hp, enemy.maxHp - 300); assert.ok(enemy.revealedUntil! > s.time);
  assert.equal(isPointInTeamVision(s, enemy, 0), false); assert.equal(isUnitVisibleToTeam(s, enemy, 0), false);
});
