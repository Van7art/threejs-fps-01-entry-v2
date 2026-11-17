// HUD: every DOM readout the player sees. Reads match state once a frame
// and only touches the DOM when a value actually changed.
import { WEAPONS, BUY_LIST } from './weapons.js';
import { SITES } from './map.js';
import { playerFighter, playerSide } from './match.js';

function $(id) { return document.getElementById(id); }

export function makeHud() {
  const els = {
    score: $('pill-score'), round: $('pill-round'), time: $('pill-time'), plant: $('pill-plant'),
    hp: $('hp'), hpLabel: $('hp-label'), cash: $('cash'),
    ammo: $('ammo'), gun: $('gun'), util: $('util'),
    feed: $('feed'), banner: $('banner'), toast: $('toast'),
    buy: $('buy'), buyRows: $('buy-rows'), buyCash: $('buy-cash'),
    center: $('center'), startBtn: $('start-btn'),
  };
  const last = {};
  let toastUntil = 0;

  function set(el, key, text) {
    if (last[key] !== text) { last[key] = text; el.textContent = text; }
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    els,
    showToast(text, seconds) {
      els.toast.textContent = text;
      els.toast.style.display = 'block';
      toastUntil = performance.now() / 1000 + (seconds || 2.5);
    },
    showBanner(html) {
      els.banner.innerHTML = html;
      els.banner.style.display = 'block';
    },
    hideBanner() { els.banner.style.display = 'none'; },
    showCenter() { els.center.style.display = 'flex'; },
    hideCenter() { els.center.style.display = 'none'; },
    setBuyOpen(open, cash) {
      els.buy.style.display = open ? 'block' : 'none';
      if (open) {
        const p = window.__matchPlayer;
        let rows = '';
        rows += `<div class="row"><span>1 — Duster pistol (owned)</span><b>owned</b></div>`;
        for (const item of BUY_LIST) {
          rows += `<div class="row"><span>${item.label}</span><b>$${item.price}</b></div>`;
        }
        els.buyRows.innerHTML = rows;
        els.buyCash.textContent = `$${cash}`;
      }
    },
    update(m, nowSec) {
      const p = playerFighter(m);
      if (!p) return;
      set(els.score, 'score', `VIPERS ${m.scoreA} — ${m.scoreB} WARDENS`);
      set(els.round, 'round', `ROUND ${m.round} / 13`);
      const t = m.planted ? m.chargeT : (m.phase === 'freeze' ? m.phaseT : m.roundT);
      set(els.time, 'time', m.phase === 'freeze' ? `BUY ${fmtTime(t)}` : fmtTime(t));
      let plantText = '—';
      if (m.planted) plantText = `CHARGE ${SITES[m.plantSite].name} ${Math.ceil(m.chargeT)}s`;
      else if (m.chargeCarrier === p) plantText = 'YOU CARRY THE CHARGE';
      else if (m.chargeCarrier) plantText = `${m.chargeCarrier.name} carries the charge`;
      else if (m.chargeDropped) plantText = 'CHARGE DROPPED';
      set(els.plant, 'plant', plantText);
      set(els.hp, 'hp', String(Math.ceil(p.hp)));
      set(els.hpLabel, 'hpLabel', `HEALTH  •  ARMOR ${Math.ceil(p.armor)}`);
      set(els.cash, 'cash', `$${p.cash}`);
      const def = WEAPONS[p.weapon];
      set(els.ammo, 'ammo', p.reloading > 0 ? 'RELOADING…' : `${p.mag} / ${p.reserve}`);
      set(els.gun, 'gun', `${def.name}${p.ads ? '  •  ADS' : ''}`);
      set(els.util, 'util', `HE ×${p.he}   FLASH ×${p.flash}`);
      // kill feed
      let feedHtml = '';
      for (const item of m.feed.slice(0, 5)) {
        feedHtml += `<div>${item.text}</div>`;
      }
      if (last.feed !== feedHtml) { last.feed = feedHtml; els.feed.innerHTML = feedHtml; }
      // toast expiry
      if (nowSec > toastUntil && els.toast.style.display !== 'none') {
        els.toast.style.display = 'none';
      }
      // plant / defuse progress bar in the toast slot
      const prog = p.plantProgress > 0 ? p.plantProgress / 4 : (p.defuseProgress > 0 ? p.defuseProgress / 5 : 0);
      if (prog > 0) {
        const label = p.plantProgress > 0 ? 'PLANTING' : 'DEFUSING';
        const pct = Math.round(prog * 100);
        els.toast.textContent = `${label} ${pct}% — hold E`;
        els.toast.style.display = 'block';
      }
    },
  };
}
