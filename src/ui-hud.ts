import { HEROES, SUMMONERS } from './shared/data.ts';
import type { Unit } from './shared/types.ts';

/** The HUD has two reading rows: survival above, deliberate actions below. */
export function hudMarkup(u: Unit, glyph: (kind: string) => string) {
  const hero = HEROES[u.heroKind ?? 'knight'];
  const icons = u.heroKind === 'knight' ? ['sword', 'shield', 'dash', 'slash'] : ['bolt', 'nova', 'dash', 'focus'];
  const targeting = { unit: '选择敌方单位', direction: '选择方向', ground: '选择地面位置', self: '对自身释放' };
  return `
    <div class="status-strip hero-vitals">
      <div class="hero-badge" title="${hero.name}"><img src="/assets/heroes/${u.heroKind}.png" alt="${hero.name}"><span id="hero-level">Lv.1</span></div>
      <div class="vital-stack">
        <div class="vital health"><i id="health-fill"></i><span id="health-label"></span></div>
        <div class="vital mana"><i id="mana-fill"></i><span id="mana-label"></span></div>
      </div>
      <em id="respawn-label"></em><div id="skill-points" class="skill-points"></div><div id="combat-score" class="combat-score" hidden></div>
    </div>
    <div class="hud-bottom">
      <button id="attack-aim" class="attack-aim" title="A：显示普攻范围，左键攻击／攻击移动，右键取消"><kbd>A</kbd><span>攻击</span></button>
      <div class="ability-deck abilities">
        ${hero.skills.map((s, i) => `<div class="ability-wrap">
          <button id="upgrade-${i}" class="skill-upgrade" data-upgrade="${i}" aria-label="升级 ${s.name}" title="学习／升级 ${s.key} ${s.name}，或 Ctrl+${s.key}" hidden>+</button>
          <button id="ability-${i}" class="ability" data-skill="${i}" title="${s.name}：${s.description} ${targeting[s.targeting ?? 'direction']}；左键确认，右键取消。冷却 ${s.cooldown} 秒，消耗 ${s.mana} 法力。">
            <kbd>${s.key}</kbd><span class="skill-glyph">${glyph(icons[i])}</span><span id="cooldown-${i}" class="skill-cooldown" hidden></span><strong>${s.name}</strong><small>${s.mana}</small>
          </button>
          <span class="skill-ranks">${Array.from({ length: s.maxRank }, (_, rank) => `<i id="rank-${i}-${rank}"></i>`).join('')}</span>
        </div>`).join('')}
      </div>
      <div class="utility-deck summoners">
        <button id="summoner-heal" class="summoner" title="${SUMMONERS.heal.description} 冷却 ${SUMMONERS.heal.cooldown} 秒"><kbd>D</kbd>${glyph('heal')}<span id="summoner-cd-heal"></span><small>治疗</small></button>
        <button id="summoner-flash" class="summoner" title="${SUMMONERS.flash.description} 冷却 ${SUMMONERS.flash.cooldown} 秒"><kbd>F</kbd>${glyph('bolt')}<span id="summoner-cd-flash"></span><small>闪现</small></button>
        <button id="use-potion" class="potion-button"><kbd>1</kbd>${glyph('potion')}<span id="potion-count">0</span><span id="potion-timer" hidden></span></button>
      </div>
      <div class="hud-actions equipment">
        <div class="inventory" hidden>${Array.from({ length: 6 }, (_, i) => `<span id="inventory-${i}"></span>`).join('')}</div>
        <div class="economy"><strong><span id="gold-value">0</span><small>金</small></strong><button id="shop-toggle"><kbd>B</kbd> 商店</button></div>
      </div>
    </div>
    <div class="xp-track" id="xp-track"><i id="xp-fill"></i></div>`;
}
