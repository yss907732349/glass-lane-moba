import type { HeroData, HeroKind, ItemData, SummonerData } from './types.ts';
export const WORLD = {
  width: 4800, height: 2000, laneY: 1000,
  minX: 80, maxX: 4720, minY: 780, maxY: 1220,
  spawnX: [350, 4450] as const,
  baseX: [200, 4600] as const,
  towerX: [1250, 3550] as const,
};
export const TERRAIN = {
  river: { minX: 2320, maxX: 2480 },
  bridge: { minY: 955, maxY: 1045 },
  bushes: [
    { id: 'brush-blue-upper', x: 2180, y: 835, width: 150, height: 100 },
    { id: 'brush-blue-lower', x: 2180, y: 1165, width: 150, height: 100 },
    { id: 'brush-red-upper', x: 2620, y: 835, width: 150, height: 100 },
    { id: 'brush-red-lower', x: 2620, y: 1165, width: 150, height: 100 },
  ],
};
export const HEROES: Record<HeroKind, HeroData> = {
  knight: { id: 'knight', name: '铁卫', role: '近战 · 突进', description: '冲入兵线，以护盾扛住伤害，旋斩收割。', hp: 1050, mana: 320, damage: 68, range: 88, speed: 180, attackCd: .95,
    skills: [
      { name: '破阵斩', key: 'Q', description: '锁定鼠标下 170 距离内的敌方英雄或小兵，造成 145/181/218 伤害。', cooldown: 6, mana: 35, range: 170, targeting: 'unit', maxRank: 3, unlockLevel: 1 },
      { name: '铁壁', key: 'W', description: '获得 230/290/350 护盾，持续 4 秒。', cooldown: 12, mana: 45, range: 0, targeting: 'self', maxRank: 3, unlockLevel: 1 },
      { name: '冲锋', key: 'E', description: '向鼠标突进 230 距离，终点造成 100/125/150 范围伤害。', cooldown: 9, mana: 40, range: 230, targeting: 'direction', maxRank: 3, unlockLevel: 1 },
      { name: '天陨裁决', key: 'R', description: '锁定 450 距离内敌人跃击，造成 260/380 加目标已损生命 15% 的伤害；4 级解锁。', cooldown: 65, mana: 100, range: 450, targeting: 'unit', maxRank: 2, unlockLevel: 4 },
    ] },
  mage: { id: 'mage', name: '星术师', role: '远程 · 控场', description: '远距离消耗，用寒星减速敌人，闪烁拉开距离。', hp: 760, mana: 420, damage: 48, range: 290, speed: 175, attackCd: 1.1,
    skills: [
      { name: '星矢', key: 'Q', description: '向鼠标发射可躲避的穿透星矢，飞行 650 距离，命中造成 125/156/188 伤害。', cooldown: 5, mana: 35, range: 650, targeting: 'direction', maxRank: 3, unlockLevel: 1 },
      { name: '霜环', key: 'W', description: '在鼠标位置预警，0.65 秒后爆发，造成 100/125/150 伤害并减速 2 秒。', cooldown: 9, mana: 55, range: 600, targeting: 'ground', maxRank: 3, unlockLevel: 1 },
      { name: '闪烁', key: 'E', description: '向鼠标闪现 210 距离，恢复 80/110/140 生命。', cooldown: 12, mana: 50, range: 210, targeting: 'direction', maxRank: 3, unlockLevel: 1 },
      { name: '星界崩落', key: 'R', description: '850 距离内召唤星陨，预警 1 秒后半径 260 范围造成 300/440 伤害；4 级解锁。', cooldown: 70, mana: 120, range: 850, targeting: 'ground', maxRank: 2, unlockLevel: 4 },
    ] },
};
export const SUMMONERS: Record<'heal' | 'flash', SummonerData> = {
  heal: { name: '治疗', key: 'D', description: '立即恢复自身 260 生命，不消耗法力。', cooldown: 90, range: 0 },
  flash: { name: '闪现', key: 'F', description: '向鼠标方向闪现，最多 340 距离，不消耗法力。', cooldown: 120, range: 340 },
};
export const ITEMS: ItemData[] = [
  { id: 'potion', name: '双生恢复药水', cost: 100, icon: '♧', kind: 'consumable', description: '8 秒内逐渐恢复 50% 最大生命和法力；战斗中效力降至 20%，最多携带 3 瓶，按 1 使用。' },
  { id: 'sword', name: '精钢长剑', cost: 300, icon: '⚔', description: '攻击力 +22', damage: 22 },
  { id: 'heart', name: '红晶护符', cost: 350, icon: '◆', description: '最大生命 +240，购买时恢复 240 生命', hp: 240 },
  { id: 'boots', name: '疾行战靴', cost: 250, icon: '➤', description: '移动速度 +35', speed: 35 },
  { id: 'focus', name: '回响法器', cost: 450, icon: '✦', description: '攻击力 +30，最大法力 +100，技能伤害 +20%', damage: 30, mana: 100 },
  { id: 'bow', name: '迅捷短弓', cost: 400, icon: '⌁', description: '攻击力 +12，攻击间隔减少 18%', damage: 12, haste: .18 },
  { id: 'guard', name: '守望重铠', cost: 650, icon: '⬡', description: '最大生命 +400，攻击力 +15', hp: 400, damage: 15 },
];
export const RULES = { waveInterval: 15, respawnSeconds: 9, passiveGoldPerSecond: 3, startingGold: 500, towerRange: 300, potionDuration: 8, potionCombatWindow: 5, potionStockLimit: 3, visionRadius: 900 };
export const xpForNextLevel = (level: number) => 120 + (level - 1) * 45;
