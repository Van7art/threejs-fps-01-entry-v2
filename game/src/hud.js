// The HUD for Sunscorch Yard: health, ammo, timer, score, money, the
// killfeed, the buy menu, plant/defuse progress and the round banners.
// All DOM reads happen once at creation; update() only writes text and
// classes, and only when the value actually changed.

import { WEAPONS, BUY_ORDER, GRENADES } from './weapons.js';

export function createHud(doc) {
  const el = (id) => doc.getElementById(id);
  const refs = {
    health: el('health-value'),
    healthBar: el('health-bar'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    ammoBox: el('ammo'),
    weaponName: el('weapon-name'),
    money: el('money-value'),
    timer: el('timer-value'),
    scoreAtk: el('score-atk'),
    scoreDef: el('score-def'),
    roundLabel: el('round-label'),
    killfeed: el('killfeed'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    buyMenu: el('buy-menu'),
    buyItems: el('buy-items'),
    progress: el('progress'),
    progressFill: el('progress-fill'),
    progressLabel: el('progress-label'),
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    damage: el('damage-vignette'),
    flash: el('flash-overlay'),
    chargeHint: el('charge-hint'),
    overlay: el('overlay'),
    overlayTitle: el('overlay-title'),
    overlayCopy: el('overlay-copy'),
    playButton: el('play'),
    endPanel: el('end-panel'),
    endTitle: el('end-title'),
    endSub: el('end-sub'),
    restartButton: el('restart'),
  };
  const cache = new Map();
  const setText = (key, node, value) => {
    if (!node) return;
    if (cache.get(key) !== value) {
      cache.set(key, value);
      node.textContent = value;
    }
  };

  let bannerTimer = 0;

  function feedLine(text, className) {
    if (!refs.killfeed) return;
    const line = doc.createElement('div');
    line.className = `feed-line${className ? ` ${className}` : ''}`;
    line.textContent = text;
    refs.killfeed.prepend(line);
    while (refs.killfeed.children.length > 5) refs.killfeed.removeChild(refs.killfeed.lastChild);
    setTimeout(() => line.remove(), 6000);
  }

  return {
    refs,
    update(match, player, dt) {
      const weapon = WEAPONS[player.loadout.primary];
      const ammo = player.loadout.ammo[weapon.id];
      setText('health', refs.health, String(Math.ceil(player.health)));
      if (refs.healthBar) refs.healthBar.style.width = `${Math.max(0, player.health)}%`;
      setText('ammoMag', refs.ammoMag, String(ammo.mag));
      setText('ammoReserve', refs.ammoReserve, `/ ${ammo.reserve}`);
      setText('weaponName', refs.weaponName, weapon.name);
      setText('money', refs.money, `$${player.money}`);
      const t = Math.max(0, Math.ceil(match.timer));
      setText('timer', refs.timer, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
      setText('scoreAtk', refs.scoreAtk, String(match.score.attackers));
      setText('scoreDef', refs.scoreDef, String(match.score.defenders));
      setText('roundLabel', refs.roundLabel, `ROUND ${match.round} / 13`);
      if (refs.ammoBox) refs.ammoBox.classList.toggle('empty', ammo.mag === 0);
      if (refs.ammoBox) refs.ammoBox.classList.toggle('reloading', player.reloadUntil > 0);
      if (refs.chargeHint) {
        const carrying = match.carrier === player;
        refs.chargeHint.hidden = !carrying || match.bomb.planted;
      }
      // Plant / defuse progress.
      const prog = Math.max(player.plantProgress, player.defuseProgress);
      const total = player.plantProgress > 0 ? 4 : 5;
      if (refs.progress) refs.progress.hidden = prog <= 0;
      if (prog > 0) {
        if (refs.progressFill) refs.progressFill.style.width = `${Math.min(100, (prog / total) * 100)}%`;
        setText('progressLabel', refs.progressLabel, player.plantProgress > 0 ? 'PLANTING CHARGE' : 'DEFUSING CHARGE');
      }
      // Crosshair gap grows with spread: movement, bloom and recoil.
      if (refs.crosshair) {
        const gap = 4 + player.speed * 1.6 + player.bloom * 220 + player.recoil * 60;
        refs.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
      }
      if (bannerTimer > 0) {
        bannerTimer -= dt;
        if (bannerTimer <= 0 && refs.banner) refs.banner.hidden = true;
      }
    },
    hitmarker(head) {
      if (!refs.hitmarker) return;
      refs.hitmarker.classList.add('on');
      refs.hitmarker.classList.toggle('head', !!head);
      setTimeout(() => refs.hitmarker.classList.remove('on', 'head'), 110);
    },
    damageFlash() {
      if (!refs.damage) return;
      refs.damage.classList.add('on');
      setTimeout(() => refs.damage.classList.remove('on'), 260);
    },
    flashScreen(strength) {
      if (!refs.flash) return;
      refs.flash.style.opacity = String(Math.min(1, 0.4 + strength * 0.6));
      setTimeout(() => {
        refs.flash.style.opacity = '0';
      }, 900);
    },
    killfeed(attacker, victim, head) {
      const a = attacker ? attacker.name : '—';
      const v = victim ? victim.name : '—';
      feedLine(`${a}  ✕  ${v}${head ? '  (headshot)' : ''}`, attacker && attacker.isPlayer ? 'mine' : '');
    },
    event(text) {
      feedLine(text, 'event');
    },
    banner(title, sub, seconds = 3) {
      if (!refs.banner) return;
      setText('bannerTitle', refs.bannerTitle, title);
      setText('bannerSub', refs.bannerSub, sub);
      refs.banner.hidden = false;
      bannerTimer = seconds;
    },
    showBuy(player, open) {
      if (!refs.buyMenu) return;
      refs.buyMenu.hidden = !open;
      if (!open) return;
      refs.buyItems.innerHTML = '';
      for (const id of BUY_ORDER) {
        const w = WEAPONS[id];
        const owned = !!player.loadout.owned[id];
        const item = doc.createElement('button');
        item.type = 'button';
        item.className = 'buy-item';
        item.dataset.buy = id;
        item.innerHTML = `<span class="buy-key">${BUY_ORDER.indexOf(id) + 1}</span> <b>${w.name}</b> <span class="buy-kind">${w.kind}</span> <span class="buy-price">${owned ? 'OWNED' : '$' + w.price}</span>`;
        refs.buyItems.appendChild(item);
      }
      for (const id of ['he', 'flash']) {
        const g = GRENADES[id];
        const count = player.loadout.grenades[id];
        const item = doc.createElement('button');
        item.type = 'button';
        item.className = 'buy-item';
        item.dataset.buy = id;
        item.innerHTML = `<span class="buy-key">${id === 'he' ? 6 : 7}</span> <b>${g.name}</b> <span class="buy-kind">grenade ×${count}</span> <span class="buy-price">$${g.price}</span>`;
        refs.buyItems.appendChild(item);
      }
    },
    showOverlay(title, copy, buttonLabel) {
      if (!refs.overlay) return;
      setText('overlayTitle', refs.overlayTitle, title);
      setText('overlayCopy', refs.overlayCopy, copy);
      if (refs.playButton) refs.playButton.textContent = buttonLabel;
      refs.overlay.hidden = false;
    },
    hideOverlay() {
      if (refs.overlay) refs.overlay.hidden = true;
    },
    showEnd(title, sub) {
      if (!refs.endPanel) return;
      setText('endTitle', refs.endTitle, title);
      setText('endSub', refs.endSub, sub);
      refs.endPanel.hidden = false;
    },
    hideEnd() {
      if (refs.endPanel) refs.endPanel.hidden = true;
    },
  };
}
