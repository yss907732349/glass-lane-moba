export type Team = 0 | 1;
export type HeroKind = 'dain' | 'fenn' | 'ashvyn' | 'sylra';
export type SkillSlot = 0 | 1 | 2 | 3;
export type Point = { x: number; y: number };
export type Command =
  | ({ type: 'move' } & Point)
  | ({ type: 'attackMove' } & Point)
  | { type: 'attack'; targetId: string }
  | ({ type: 'skill'; slot: SkillSlot; targetId?: string } & Point)
  | { type: 'upgrade'; slot: SkillSlot }
  | ({ type: 'summoner'; slot: 'heal' | 'flash' } & Point)
  | { type: 'buy'; itemId: string }
  | { type: 'usePotion' }
  | { type: 'stop' };
export interface Unit extends Point {
  id: string; kind: 'hero' | 'melee' | 'ranged' | 'tower' | 'base';
  team: Team; name: string; hp: number; maxHp: number; damage: number;
  range: number; speed: number; attackCd: number; attackTimer: number;
  targetId: string | null; moveTarget: Point | null; heroKind?: HeroKind;
  gold?: number; lastHits?: number; kills?: number; deaths?: number;
  items?: string[]; cooldowns?: number[]; mana?: number; maxMana?: number;
  respawnAt?: number; shield?: number; bot?: boolean; slowUntil?: number;
  buffUntil?: number; aggroUntil?: number; projectile?: boolean;
  orderedTargetId?: string | null;
  attackMoveTarget?: Point | null;
  summonerCooldowns?: { heal: number; flash: number };
  level: number; xp: number; skillPoints: number; skillRanks: number[];
  potions: number; lastCombatAt: number;
  potionEffect?: { remaining: number; hpPerSecond: number; manaPerSecond: number; potency: number };
  brushId?: string | null; revealedUntil?: number;
  armor?: number; mr?: number; ap?: number; radius?: number; hpRegen?: number; manaRegen?: number;
  armorPen?: number; mrPen?: number; armorPenPct?: number; mrPenPct?: number;
  passiveStacks?: number; statuses?: CombatStatus[]; recentDamagers?: {id:string;at:number}[];
  activeDash?: any; pendingSpell?: any; pendingAttack?: {targetId:string;resolveAt:number;start:Point};
  recastArmed?: {slot:SkillSlot;until:number;origin:Point};
  recastSlot?: SkillSlot; recastUntil?: number;
}
export interface CombatStatus { kind:string; until:number; pct?:number; [key:string]:any }
export interface Effect extends Point {
  id: string; kind: 'attack' | 'slash' | 'bolt' | 'nova' | 'dash' | 'shield' | 'heal' | 'gold' | 'death';
  team: Team; toX?: number; toY?: number; radius?: number; text?: string;
  start: number; end: number;
  sourceId?: string;
  abilityId?: string;
}
export interface MatchState {
  time: number; status: 'playing' | 'finished'; winner: Team | null;
  teamKills?: [number, number];
  units: Unit[]; effects: Effect[]; wave: number; nextWave: number;
  log: string[]; sequence: number;
  projectiles: Projectile[];
}
export interface Projectile extends Point {
  id: string; kind: 'bolt' | 'nova'; team: Team; ownerId: string;
  startX: number; startY: number; dirX: number; dirY: number;
  speed: number; range: number; radius: number; damage: number;
  slowSeconds?: number; activateAt?: number; hitIds: string[];
  effects?: any[]; power?: {ad:number;ap:number;scale:number}; chain?: any;
  homingTargetId?: string; pierce?: boolean; via?: 'attack'|'ability'|'other';
  zone?: any; abilityId?: string; splash?: any;
  createdAt?: number; expiresAt?: number; tickEvery?: number; detonateAt?: number;
}
export interface SkillData { name: string; key: string; description: string; cooldown: number; mana: number; range: number; targeting: 'unit' | 'direction' | 'ground' | 'self' | 'ally'; maxRank: number; unlockLevel: number; sourceName?: string; geometry?: {kind:string;radius?:number;width?:number;halfAngle?:number;windup?:number;dashSpeed?:number}; spec?:any; powerScale?:number; }
export interface SummonerData { name: string; key: string; description: string; cooldown: number; range: number; }
export interface HeroData { id: HeroKind; name: string; role: string; description: string; hp: number; mana: number; damage: number; range: number; speed: number; attackCd: number; skills: SkillData[]; sourceName?:string; passive?:{name:string;description:string}; growth?:any; }
export interface ItemData { id: string; name: string; cost: number; description: string; icon: string; kind?: 'consumable'; damage?: number; hp?: number; speed?: number; haste?: number; mana?: number; ap?:number; armor?:number; mr?:number; attackSpeedPct?:number; sourceItemId?:string; }
