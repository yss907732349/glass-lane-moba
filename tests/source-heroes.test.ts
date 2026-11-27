import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HERO_IDS, SOURCE_HEROES, SOURCE_UNIT } from '../src/shared/source-heroes.ts';
import { canUpgradeSkill, HEROES, ITEMS, skillForRank } from '../src/shared/data.ts';
import type { HeroKind, Unit } from '../src/shared/types.ts';
import { applyCommand, createMatch, getHero, isUnitVisibleToTeam, recalcSourceHero, stepMatch } from '../src/shared/simulation.ts';
import { attackCadence, hasStatus, speedMultiplier } from '../src/shared/source-combat.ts';
import type { MatchState, Point, SkillSlot } from '../src/shared/types.ts';

// Independent fixtures extracted from the unmodified pinned upstream TS AST,
// never from src/shared/source-heroes.ts. No imported upstream code is executed.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/source-heroes-34fe718.json', import.meta.url), 'utf8'));
const keys = ['Q', 'W', 'E', 'R'] as const;
const close = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`);

test('four full kits, base stats and per-level growth match the pinned MIT source', () => {
  assert.equal(fixture.commit, '34fe718427d2726c92ed9063e694640e6d870013');
  assert.deepEqual(HERO_IDS, ['dain', 'fenn', 'ashvyn', 'sylra']);
  for (const id of HERO_IDS) assert.deepEqual(SOURCE_HEROES[id], fixture.heroes[id], `${id}: preserve the entire source definition, including conditional effects and rank overrides`);
});

test('world conversion preserves source distances, move speed and attack cadence for every hero', () => {
  assert.equal(SOURCE_UNIT, 50);
  for (const id of HERO_IDS) {
    const original = fixture.heroes[id], adapted = HEROES[id];
    assert.equal(adapted.hp, original.base.hp);
    assert.equal(adapted.mana, original.base.mana);
    assert.equal(adapted.damage, original.base.ad);
    close(adapted.range, original.base.attackRange * 50, `${id} attack range`);
    close(adapted.speed, original.base.moveSpeed * 50, `${id} move speed`);
    close(adapted.attackCd, 1 / original.base.attackSpeed, `${id} attack cadence`);
    for (let slot = 0; slot < 4; slot++) close(adapted.skills[slot].range, original.abilities[keys[slot]].castRange * 50, `${id} ${keys[slot]} range`);
  }
});

test('all 16 abilities keep source costs, exact rank multipliers and cooldowns', () => {
  for (const id of HERO_IDS) for (let slot = 0; slot < 4; slot++) {
    const original = fixture.heroes[id].abilities[keys[slot]], max = slot === 3 ? 3 : 5;
    for (let rank = 1; rank <= max; rank++) {
      const skill = skillForRank(id, slot, rank);
      assert.equal(skill.mana, original.manaCost, `${id} ${keys[slot]} rank ${rank}: fixed mana`);
      close(skill.cooldown, original.cooldown * (1 - .06 * (rank - 1)), `${id} ${keys[slot]} rank ${rank} cooldown`);
      close(skill.powerScale!, 1 + .55 * (rank - 1), `${id} ${keys[slot]} rank ${rank} base amount multiplier`);
      let expected = original.spec;
      for (const override of original.atRank ?? []) if (rank >= override.rank) expected = override.spec;
      assert.deepEqual(skill.spec, expected, `${id} ${keys[slot]} rank ${rank}: damage types, AD/AP ratios, status durations and geometry`);
    }
  }
});

test('ten-level adaptation preserves five basic ranks and unlocks R only at 4/7/10', () => {
  for (const id of HERO_IDS) for (let level = 1; level <= 10; level++) {
    const unit = { heroKind: id as HeroKind, level, skillPoints: 1, skillRanks: [0, 0, 0, 0] } as Unit;
    for (let slot = 0; slot < 3; slot++) {
      for (let rank = 0; rank <= 5; rank++) {
        unit.skillRanks[slot] = rank;
        assert.equal(canUpgradeSkill(unit, slot), rank < 5, `${id} basic ${slot} rank ${rank} at level ${level}`);
      }
      unit.skillRanks[slot] = 0;
    }
    for (let rank = 0; rank <= 3; rank++) {
      unit.skillRanks[3] = rank;
      assert.equal(canUpgradeSkill(unit, 3), rank < 3 && level >= [4, 7, 10][rank], `${id} R rank ${rank} at level ${level}`);
    }
    unit.skillPoints = 0;
    assert.equal(canUpgradeSkill(unit, 0), false, 'upgrades must spend an available skill point');
  }
});

test('Sylra R rank 3 alone leaves the original lingering bramble field', () => {
  assert.equal(skillForRank('sylra', 3, 1).spec.leaveZone, undefined);
  assert.equal(skillForRank('sylra', 3, 2).spec.leaveZone, undefined);
  assert.deepEqual(skillForRank('sylra', 3, 3).spec.leaveZone, fixture.heroes.sylra.abilities.R.atRank[0].spec.leaveZone);
});

test('six shop aliases preserve pinned component prices and effective combat stats', () => {
  const mapping: Record<string, string> = { sword: 'iron_blade', heart: 'heart_gem', boots: 'traveler_soles', focus: 'spark_rod', bow: 'swift_fang', guard: 'guard_plate' };
  for (const [localId, sourceId] of Object.entries(mapping)) {
    const local = ITEMS.find(i => i.id === localId)!, original = fixture.items[sourceId];
    assert.equal(local.sourceItemId, sourceId); assert.equal(local.cost, original.cost);
    const s = createMatch(['dain', 'sylra']), hero = getHero(s, 0); hero.gold = 9999;
    assert.ok(applyCommand(s, 0, { type: 'buy', itemId: localId }).ok);
    close(hero.damage, 62 + (original.stats.ad ?? 0), `${localId} AD`);
    close(hero.maxHp, 620 + (original.stats.hp ?? 0), `${localId} HP`);
    close(hero.ap!, original.stats.ap ?? 0, `${localId} AP`);
    close(hero.armor!, 28 + (original.stats.armor ?? 0), `${localId} armor`);
    close(hero.speed, (3.75 + (original.stats.moveSpeed ?? 0)) * 50, `${localId} move speed`);
    close(1 / hero.attackCd, .68 * (1 + (original.stats.attackSpeedPct ?? 0)), `${localId} attack speed`);
  }
});

function duel(id: HeroKind) {
  const state = createMatch([id, 'sylra']);
  state.units = state.units.filter(u => u.kind === 'hero');
  state.nextWave = Number.POSITIVE_INFINITY;
  const caster = getHero(state, 0), enemy = getHero(state, 1);
  Object.assign(caster, { x: 1500, y: 1000, level: 4, skillRanks: [1, 1, 1, 1], hpRegen: 0, manaRegen: 0, attackTimer: 999 });
  Object.assign(enemy, { x: 1800, y: 1000, hp: 10000, maxHp: 10000, armor: 0, mr: 0, hpRegen: 0, manaRegen: 0, attackTimer: 999 });
  return { state, caster, enemy };
}
function advance(state: MatchState, seconds: number) { for (let i = 0; i < Math.round(seconds * 20); i++) stepMatch(state, .05); }
function cast(state: MatchState, slot: SkillSlot, aim: Point) {
  const result = applyCommand(state, 0, { type: 'skill', slot, x: aim.x, y: aim.y });
  assert.equal(result.ok, true, result.error);
}
function minion(state: MatchState, model: Unit, id: string, team: 0 | 1, x: number, y = 1000) {
  const u: Unit = { ...model, id, team, kind: 'melee', heroKind: undefined, name: id, x, y, hp: 10000, maxHp: 10000, radius: 20, damage: 0, range: 0, speed: 0, attackTimer: 999, targetId: null, orderedTargetId: null, moveTarget: null, statuses: [], passiveStacks: 0, shield: 0 };
  state.units.push(u); return u;
}

test('source stat growth reaches actual combat units at levels 1 through 10', () => {
  for (const id of HERO_IDS) {
    const { caster } = duel(id), source = fixture.heroes[id];
    for (let level = 1; level <= 10; level++) {
      caster.level = level; recalcSourceHero(caster);
      close(caster.maxHp, source.base.hp + source.growth.hp * (level - 1), `${id} level ${level} hp`);
      close(caster.maxMana!, source.base.mana + source.growth.mana * (level - 1), `${id} level ${level} mana`);
      close(caster.damage, source.base.ad + source.growth.ad * (level - 1), `${id} level ${level} AD`);
      close(caster.armor!, source.base.armor + source.growth.armor * (level - 1), `${id} level ${level} armor`);
      close(caster.mr!, source.base.mr + source.growth.mr * (level - 1), `${id} level ${level} MR`);
    }
  }
});

test('Dain Q travels, damages crossed enemies and refunds cooldown only for champions', () => {
  const { state, caster, enemy } = duel('dain'); enemy.x = 1675;
  const troop = minion(state, enemy, 'crossed-troop', 1, 1600);
  cast(state, 0, { x: 1850, y: 1000 });
  assert.equal(caster.x, 1500, 'the dash must travel, not teleport');
  advance(state, .45);
  close(caster.x, 1850, 'dash endpoint');
  close(10000 - enemy.hp, 95 + .7 * 62, 'champion pass-through damage');
  close(10000 - troop.hp, 95 + .7 * 62, 'troop pass-through damage');
  assert.ok(caster.cooldowns![0] < 2, 'champion hit refunds half remaining cooldown');
  const onlyTroops = duel('dain'); onlyTroops.enemy.x = 2200;
  minion(onlyTroops.state, onlyTroops.enemy, 'nonrefund-troop', 1, 1650);
  cast(onlyTroops.state, 0, { x: 1850, y: 1000 }); advance(onlyTroops.state, .45);
  close(onlyTroops.caster.cooldowns![0], 4 - .45, 'troop hit must not refund cooldown');
});

test('Dain W refuses an empty jump, can rescue a friendly troop, burns and shields on landing', () => {
  const { state, caster, enemy } = duel('dain');
  const mana = caster.mana;
  assert.equal(applyCommand(state, 0, { type: 'skill', slot: 1, x: 1700, y: 1000 }).ok, false);
  assert.equal(caster.mana, mana); assert.equal(caster.cooldowns![1], 0);
  minion(state, caster, 'rescue-ally', 0, 1700); enemy.x = 1740;
  cast(state, 1, { x: 1700, y: 1000 }); advance(state, .3);
  assert.ok(caster.x > 1600 && caster.x < 1700, 'lands beside the ally');
  close(caster.shield!, 90, 'rank one guard shield');
  assert.ok(10000 - enemy.hp >= 40, 'landing damage is real');
  assert.ok(hasStatus(enemy, 'dot', state.time), 'landing applies the three second burn');
});

test('Dain E empowers one real attack, splashes and banks Heat', () => {
  const { state, caster, enemy } = duel('dain'); enemy.x = 1570;
  const splash = minion(state, enemy, 'splash-target', 1, 1630);
  cast(state, 2, caster); assert.equal(caster.passiveStacks, 1);
  caster.attackTimer = 0;
  assert.equal(applyCommand(state, 0, { type: 'attack', targetId: enemy.id }).ok, true);
  advance(state, .4); applyCommand(state, 0, { type: 'stop' });
  close(10000 - enemy.hp, 62 + 60 + .4 * 62, 'attack plus empowered magic hit');
  close(10000 - splash.hp, 45 + .3 * 62, 'empowered splash');
  assert.equal(hasStatus(caster, 'empower', state.time), false, 'empower is consumed once');
  assert.equal(caster.passiveStacks, 2);
});

test('Dain R telegraphs its fuse and distinguishes stun center from slowed rim', () => {
  const { state, enemy } = duel('dain'); enemy.x = 1720;
  const rim = minion(state, enemy, 'comet-rim', 1, 1940);
  cast(state, 3, enemy); advance(state, 1.2);
  assert.equal(enemy.hp, 10000, 'no impact before the 1.3 second fuse');
  advance(state, .15);
  assert.ok(10000 - enemy.hp >= 250 + .8 * 62);
  assert.ok(hasStatus(enemy, 'stun', state.time)); assert.ok(hasStatus(enemy, 'dot', state.time));
  close(10000 - rim.hp, 150 + .5 * 62, 'rim damage');
  assert.ok(hasStatus(rim, 'slow', state.time)); assert.equal(hasStatus(rim, 'stun', state.time), false);
});

test('Fenn Q has a traveling landing hit and W retains both fangs plus isolated champion bonus', () => {
  const q = duel('fenn'); q.enemy.x = 1770;
  cast(q.state, 0, q.enemy); advance(q.state, .35);
  close(10000 - q.enemy.hp, 79 + 1.52 * 64, 'lunge landing hit');
  const w = duel('fenn');
  minion(w.state, w.enemy, 'nearby-enemy-troop', 1, 1800, 1100);
  cast(w.state, 1, w.enemy); advance(w.state, .3);
  close(10000 - w.enemy.hp, 2 * (40 + .66 * 64) + 32 + .53 * 64, 'two fangs and isolated bonus; minions do not remove isolation');
});

test('Fenn E hides and speeds him; R has a windup, untargetable travel and free return recast', () => {
  const e = duel('fenn');
  cast(e.state, 2, e.caster);
  assert.ok(hasStatus(e.caster, 'stealth', e.state.time));
  close(speedMultiplier(e.caster, e.state.time), 1.25, 'smoke movement bonus');
  assert.equal(isUnitVisibleToTeam(e.state, e.caster, 1), false);
  const r = duel('fenn'); r.enemy.x = 1680;
  const mana = r.caster.mana!;
  cast(r.state, 3, { x: 1800, y: 1000 }); advance(r.state, .3);
  assert.equal(r.caster.x, 1500, 'R must respect its .35 second windup');
  advance(r.state, .15); assert.ok(hasStatus(r.caster, 'untargetable', r.state.time));
  advance(r.state, .45);
  close(10000 - r.enemy.hp, 228 + 1.9 * 64, 'R passed champion damage');
  const cooldown = r.caster.cooldowns![3];
  cast(r.state, 3, r.caster);
  close(r.caster.x, 1500, 'R returns to committed origin');
  close(r.caster.mana!, mana - 85, 'R recast is free');
  close(r.caster.cooldowns![3], cooldown, 'R recast does not restart cooldown');
});

test('Ashvyn Q is a telegraphed cone and W grants attack speed and readies Twinshot', () => {
  const q = duel('ashvyn'); q.enemy.x = 1750;
  const outside = minion(q.state, q.enemy, 'outside-cone', 1, 1550, 1200);
  cast(q.state, 0, q.enemy); advance(q.state, .2); assert.equal(q.enemy.hp, 10000);
  advance(q.state, .1);
  close(10000 - q.enemy.hp, 62 + 1.33 * 58, 'cone hit damage');
  assert.equal(outside.hp, 10000, 'off-angle enemy must not be hit');
  const w = duel('ashvyn'); cast(w.state, 1, { x: 1700, y: 1000 }); advance(w.state, .3);
  close(w.caster.x, 1700, 'W dash endpoint'); assert.equal(w.caster.passiveStacks, 2);
  close(attackCadence(w.caster, w.state.time), .75 * 1.4, 'W attack speed bonus');
  w.enemy.x = 1790;
  w.caster.attackTimer = 0;
  applyCommand(w.state, 0, { type: 'attack', targetId: w.enemy.id }); advance(w.state, .5);
  close(10000 - w.enemy.hp, 58 * 1.5, 'W primes the next half-damage echo');
});

test('Ashvyn E roots long shots but only slows short shots', () => {
  for (const [distance, kind] of [[170, 'slow'], [400, 'root']] as const) {
    const { state, caster, enemy } = duel('ashvyn'); enemy.x = caster.x + distance;
    cast(state, 2, enemy); advance(state, .4);
    close(10000 - enemy.hp, 53 + .95 * 58, `${kind} arrow damage`);
    assert.ok(hasStatus(enemy, kind, state.time), `the ${distance}px shot applies ${kind}`);
    assert.equal(hasStatus(enemy, kind === 'root' ? 'slow' : 'root', state.time), false);
  }
});

test('Ashvyn R deals repeated ticks and reveals stealth inside its zone', () => {
  const { state, enemy } = duel('ashvyn'); enemy.statuses = [{ kind: 'stealth', until: 20 }];
  cast(state, 3, enemy); advance(state, .6);
  close(10000 - enemy.hp, 48 + .66 * 58, 'one zone tick');
  assert.ok(hasStatus(enemy, 'slow', state.time)); assert.ok(isUnitVisibleToTeam(state, enemy, 0), 'Eclipse reveals a hidden target');
  advance(state, .5);
  close(10000 - enemy.hp, 2 * (48 + .66 * 58), 'second repeated tick');
});

test('Sylra Q chains once and its third source mark roots and deals bonus magic damage', () => {
  const { state, caster, enemy } = duel('sylra'); enemy.x = 1750; caster.ap = 40;
  const chained = minion(state, enemy, 'chain-target', 1, 1830, 1100);
  for (let hit = 0; hit < 3; hit++) { caster.cooldowns![0] = 0; cast(state, 0, enemy); advance(state, .3); }
  close(10000 - enemy.hp, 3 * (70 + 1.23 * 40) + 35 + .57 * 40, 'direct hits and third-mark burst');
  close(10000 - chained.hp, 3 * (49 + .86 * 40) + 35 + .57 * 40, 'one chain per bolt and source-specific third mark');
  assert.ok(hasStatus(enemy, 'root', state.time)); assert.ok(hasStatus(chained, 'root', state.time));
});

test('Sylra W marks on entry once and ticks magic damage plus slow', () => {
  const { state, enemy } = duel('sylra'); cast(state, 1, enemy); advance(state, .6);
  close(10000 - enemy.hp, 18, 'one field tick');
  assert.equal(enemy.statuses!.find(s => s.kind === 'mark')?.stacks, 1);
  assert.ok(hasStatus(enemy, 'slow', state.time));
  advance(state, .5); close(10000 - enemy.hp, 36, 'second field tick');
  assert.equal(enemy.statuses!.find(s => s.kind === 'mark')?.stacks, 1, 'ticks do not reapply the entry mark');
});

test('Sylra E shields self or a friendly troop and bursts when it expires', () => {
  const { state, caster, enemy } = duel('sylra'); enemy.x = 1580; caster.ap = 20;
  cast(state, 2, caster); close(caster.shield!, 70 + .6 * 20, 'AP-scaled shield');
  advance(state, 2.6);
  close(10000 - enemy.hp, 55 + .45 * 20, 'natural expiry burst');
  assert.ok(hasStatus(enemy, 'mark', state.time)); assert.equal(caster.shield, 0);
  const ally = duel('sylra'); const troop = minion(ally.state, ally.caster, 'shield-ally', 0, 1700);
  cast(ally.state, 2, troop); close(troop.shield!, 70, 'friendly troop shield adaptation'); assert.equal(ally.caster.shield, 0);
});

test('Sylra R respects delayed detonation and only rank three leaves ticking brambles', () => {
  for (const rank of [1, 3]) {
    const { state, caster, enemy } = duel('sylra'); caster.skillRanks[3] = rank;
    cast(state, 3, enemy); advance(state, 1.2); assert.equal(enemy.hp, 10000);
    advance(state, .1);
    close(10000 - enemy.hp, 158 * (1 + .55 * (rank - 1)), 'rank-scaled detonation');
    assert.ok(hasStatus(enemy, 'root', state.time));
    advance(state, .6);
    close(10000 - enemy.hp, rank === 3 ? (158 + 20) * 2.1 : 158, 'rank-three lingering tick only');
  }
});

test('rank five live damage scales the source base amount and leaves AD/AP ratios unscaled', () => {
  const dain = duel('dain'); dain.caster.skillRanks[0] = 5; dain.enemy.x = 1650;
  cast(dain.state, 0, { x: 1850, y: 1000 }); advance(dain.state, .45);
  close(10000 - dain.enemy.hp, 95 * 3.2 + .7 * 62, 'Dain Q rank five');
  const fenn = duel('fenn'); fenn.caster.skillRanks[1] = 5;
  cast(fenn.state, 1, fenn.enemy); advance(fenn.state, .3);
  close(10000 - fenn.enemy.hp, (40 + 40 + 32) * 3.2 + (.66 + .66 + .53) * 64, 'Fenn isolated W rank five');
  const ashvyn = duel('ashvyn'); ashvyn.caster.skillRanks[0] = 5; ashvyn.enemy.x = 1750;
  cast(ashvyn.state, 0, ashvyn.enemy); advance(ashvyn.state, .35);
  close(10000 - ashvyn.enemy.hp, 62 * 3.2 + 1.33 * 58, 'Ashvyn Q rank five');
  const sylra = duel('sylra'); sylra.caster.skillRanks[0] = 5; sylra.caster.ap = 50;
  cast(sylra.state, 0, sylra.enemy); advance(sylra.state, .3);
  close(10000 - sylra.enemy.hp, 70 * 3.2 + 1.23 * 50, 'Sylra AP Q rank five');
});

test('physical armor and magic resistance independently reduce Dain empowered attack components', () => {
  const { state, caster, enemy } = duel('dain'); enemy.x = 1570; enemy.armor = 50; enemy.mr = 100;
  cast(state, 2, caster); caster.attackTimer = 0;
  applyCommand(state, 0, { type: 'attack', targetId: enemy.id }); advance(state, .4);
  close(10000 - enemy.hp, 62 * 100 / 150 + (60 + .4 * 62) * 100 / 200, 'separate damage type mitigation');
});

test('Dain full Heat boosts the next ability once and Fenn executes below the 35 percent threshold', () => {
  const dain = duel('dain'); dain.caster.passiveStacks = 4; dain.enemy.x = 1650;
  cast(dain.state, 0, { x: 1850, y: 1000 }); advance(dain.state, .45);
  close(10000 - dain.enemy.hp, (95 + .7 * 62) * 1.25, 'Heat bonus'); assert.equal(dain.caster.passiveStacks, 0);
  const fenn = duel('fenn'); fenn.enemy.hp = 3000;
  cast(fenn.state, 1, fenn.enemy); advance(fenn.state, .3);
  close(3000 - fenn.enemy.hp, (2 * (40 + .66 * 64) + 32 + .53 * 64) * 1.15, 'Opportunist bonus');
});

test('Sylra E also bursts when enemy damage breaks the shield before expiry', () => {
  const { state, caster, enemy } = duel('sylra'); enemy.x = 1580; enemy.skillRanks[0] = 1; enemy.ap = 50;
  cast(state, 2, caster); assert.equal(caster.shield, 70);
  assert.ok(applyCommand(state, 1, { type: 'skill', slot: 0, x: caster.x, y: caster.y }).ok);
  advance(state, .2);
  assert.equal(caster.shield, 0); close(10000 - enemy.hp, 55, 'early-break burst');
  assert.ok(hasStatus(enemy, 'mark', state.time));
});
