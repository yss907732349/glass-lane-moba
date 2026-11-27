import type { HeroData, HeroKind, ItemData, SkillData, SummonerData, Unit } from './types.ts';
import { HERO_IDS, SOURCE_HEROES, SOURCE_UNIT } from './source-heroes.ts';
export { HERO_IDS, SOURCE_HEROES, SOURCE_UNIT } from './source-heroes.ts';
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
const LABELS: Record<HeroKind, [string,string,string]> = {dain:['戴恩 · 炎拳','战士','普攻积热，穿身突进；跳向友军护盾反爆。'],fenn:['芬恩 · 迅刃','刺客','猎杀落单目标，隐身入场，大招可返回原点。'],ashvyn:['阿什文 · 夜弓','射手','第三箭双击，位移加速射击，远箭禁锢。'],sylra:['希尔拉 · 荆棘','法师','弹体连锁与三层荆棘，领域禁锢并护盾反爆。']};
const KEYS = ['Q','W','E','R'] as const;
export const HEROES = Object.fromEntries(HERO_IDS.map(id=>{const source=SOURCE_HEROES[id],label=LABELS[id];return[id,{id,name:label[0],sourceName:source.name,role:label[1],description:label[2],hp:source.base.hp,mana:source.base.mana,damage:source.base.ad,range:source.base.attackRange*SOURCE_UNIT,speed:source.base.moveSpeed*SOURCE_UNIT,attackCd:1/source.base.attackSpeed,growth:source.growth,passive:source.passive,skills:KEYS.map((key,slot)=>{const a=source.abilities[key],spec=a.spec;return{name:a.name,sourceName:a.name,key,description:abilityDescription(id,key),cooldown:a.cooldown,mana:a.manaCost,range:a.castRange*SOURCE_UNIT,maxRank:slot===3?3:5,unlockLevel:slot===3?4:1,targeting:spec.toAlly?'ally':spec.kind==='self_or_ally'?(spec.searchRadius?'ally':'self'):spec.kind==='zone'?'ground':'direction',geometry:{kind:spec.kind,radius:(spec.radius??spec.landRadius??0)*SOURCE_UNIT,width:(spec.radius??0)*2*SOURCE_UNIT,halfAngle:spec.halfAngle,windup:a.windup??0,dashSpeed:(spec.speed??0)*SOURCE_UNIT}};})}];})) as Record<HeroKind,HeroData>;
function abilityDescription(id:HeroKind,key:string){const texts:Record<string,string>={dainQ:'穿身冲拳，命中英雄返还一半剩余冷却；击杀英雄重置。',dainW:'跳向附近友方英雄或小兵；落地灼烧敌人，获得可被击破引爆的护盾。',dainE:'强化下一次普攻并溅射，额外积累一层热量。',dainR:'延迟陨击，中心伤害、眩晕、灼烧，外圈伤害与减速。',fennQ:'突进至鼠标落点，落地对周围敌人造成物理伤害。',fennW:'飞行双牙命中首个敌人；附近没有友军的孤立目标额外受伤。',fennE:'隐身2.5秒并加速25%；攻击或施法解除技能隐身。',fennR:'蓄势后穿越敌方英雄，途中无法选中；4秒内再次释放返回原点。',ashvynQ:'短暂拉弓后发出60度锥形齐射。',ashvynW:'向鼠标位移，攻速提高40%持续2.5秒，准备第三箭回响。',ashvynE:'箭矢飞行超过6源单位命中则禁锢，近距离命中减速。',ashvynR:'持续箭雨每0.5秒造成伤害减速，区域内敌人显形。',sylraQ:'飞行荆棘命中首个敌人，连锁至附近另一目标并施加印记。',sylraW:'持续荆棘领域，首次进入附印记，每0.5秒伤害减速。',sylraE:'给自己或瞄准的友方单位护盾，护盾破裂或到期爆发荆棘印记。',sylraR:'延迟大范围荆棘伤害与禁锢；第三级留下持续荆棘领域。'};return texts[id+key]??'';}
export function skillForRank(hero:HeroKind|HeroData,slot:number,rank:number):SkillData {const id=typeof hero==='string'?hero:hero.id,source=SOURCE_HEROES[id],a=source.abilities[KEYS[slot]],base=HEROES[id].skills[slot];let spec=a.spec;for(const override of a.atRank??[])if(rank>=override.rank)spec=override.spec;return{...base,cooldown:a.cooldown*(1-.06*(Math.max(1,rank)-1)),mana:a.manaCost,spec,powerScale:1+.55*(Math.max(1,rank)-1)};}
export function canUpgradeSkill(u:Unit,slot:number){if(!u.heroKind||!Number.isInteger(slot)||slot<0||slot>3||u.skillPoints<=0)return false;const rank=u.skillRanks[slot]??0,max=slot===3?3:5,required=slot===3?[4,7,10][rank]??99:1;return rank<max&&u.level>=required;}
export const SUMMONERS: Record<'heal' | 'flash', SummonerData> = {
  heal: { name: '治疗', key: 'D', description: '立即恢复自身 260 生命，不消耗法力。', cooldown: 90, range: 0 },
  flash: { name: '闪现', key: 'F', description: '向鼠标方向闪现，最多 340 距离，不消耗法力。', cooldown: 120, range: 340 },
};
export const ITEMS: ItemData[] = [
  { id: 'potion', name: '双生恢复药水', cost: 100, icon: '♧', kind: 'consumable', description: '8 秒内逐渐恢复 50% 最大生命和法力；战斗中效力降至 20%，最多携带 3 瓶，按 1 使用。' },
  { id:'sword',name:'铁刃',sourceItemId:'iron_blade',cost:350,icon:'⚔',description:'攻击力 +10',damage:10 },
  { id:'heart',name:'生命宝石',sourceItemId:'heart_gem',cost:400,icon:'◆',description:'最大生命 +150',hp:150 },
  { id:'boots',name:'旅者鞋',sourceItemId:'traveler_soles',cost:300,icon:'➤',description:'移动速度 +12.5',speed:12.5 },
  { id:'focus',name:'火花杖',sourceItemId:'spark_rod',cost:435,icon:'✦',description:'法术强度 +20',ap:20 },
  { id:'bow',name:'迅捷之牙',sourceItemId:'swift_fang',cost:300,icon:'⌁',description:'攻击速度 +12%',attackSpeedPct:.12 },
  { id:'guard',name:'护甲片',sourceItemId:'guard_plate',cost:300,icon:'⬡',description:'护甲 +15',armor:15 },
];
export const RULES = { waveInterval: 15, respawnSeconds: 9, passiveGoldPerSecond: 3, startingGold: 500, towerRange: 300, potionDuration: 8, potionCombatWindow: 5, potionStockLimit: 3, visionRadius: 900 };
export const xpForNextLevel = (level: number) => 120 + (level - 1) * 45;
