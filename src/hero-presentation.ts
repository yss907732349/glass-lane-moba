import type { HeroKind, SkillData } from './shared/types.ts';

/** Presentation only. Combat numbers and ability specs come from the pinned upstream. */
export const HERO_PRESENTATION:Record<HeroKind,{name:string;role:string;summary:string;icons:string[]}>={
  dain:{name:'戴恩',role:'战士 · 热量连招',summary:'普攻积攒热量，穿身拳击与强化普攻衔接，跃向友军支援。',icons:['dash','shield','sword','nova']},
  fenn:{name:'芬恩',role:'刺客 · 进退收割',summary:'寻找落单和低血目标，烟幕隐身，大招突进后可再次施放返回。',icons:['dash','slash','focus','bolt']},
  ashvyn:{name:'阿什文',role:'射手 · 风筝追击',summary:'第三次普攻追加射击，翻身拉开距离，远程箭矢禁锢敌人。',icons:['bow','dash','bolt','nova']},
  sylra:{name:'希尔拉',role:'法师 · 荆棘控场',summary:'荆棘积攒三层印记触发禁锢，用持续区域与爆裂护盾控制战线。',icons:['bolt','nova','shield','focus']},
};

const SKILL_NAMES:Record<HeroKind,string[]>={dain:['炎拳突进','烬火守卫','焰拳连击','天火陨落'],fenn:['突刺','双牙','烟幕','影刃连袭'],ashvyn:['暗影齐射','猎手跃步','钉身箭','蚀月箭雨'],sylra:['荆棘箭','荆棘领域','青藤之壳','蔓生']};
export const skillName=(hero:HeroKind,slot:number)=>SKILL_NAMES[hero][slot];

/** Describes actual resolved source numbers; it never supplies combat values. */
export function numericSkillDetails(skill:SkillData){
  const lines=new Set<string>(),scale=skill.powerScale??1,number=(n:number)=>String(Math.round(n*100)/100);
  const amount=(effect:any)=>`${number((effect.base??effect.perSecond??0)*scale)}${effect.adRatio?` + ${number(effect.adRatio)} AD`:''}${effect.apRatio?` + ${number(effect.apRatio)} AP`:''}`;
  function visit(value:any){
    if(!value||typeof value!=='object')return;
    if(value.kind==='damage')lines.add(`${value.dtype==='physical'?'物理':'魔法'}伤害 ${amount(value)}`);
    if(value.kind==='shield')lines.add(`护盾 ${amount(value)}，${value.duration} 秒`);
    if(value.kind==='dot')lines.add(`持续伤害 ${amount(value)}/秒，${value.duration} 秒`);
    if(value.kind==='slow')lines.add(`减速 ${number(value.pct*100)}%，${value.duration} 秒`);
    if(value.kind==='stun'||value.kind==='root')lines.add(`${value.kind==='stun'?'眩晕':'禁锢'} ${value.duration} 秒`);
    for(const child of Object.values(value))if(child&&typeof child==='object'){if(Array.isArray(child))child.forEach(visit);else visit(child);}
  }
  visit(skill.spec);return [...lines].join('；');
}
