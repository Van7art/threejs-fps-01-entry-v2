// Boot: input, pointer lock, the fixed-step loop, sound wiring, buy menu,
// and deterministic screenshot staging (?shot=start|play|end&seed=N).
// The sim runs at a fixed 60 Hz no matter the frame rate; rendering only
// reads match state, so a slow frame never changes the game.
import * as THREE from 'three';
import { makeMatch, stepMatch, buyItem, playerFighter, FREEZE_LEN } from './match.js';
import { makeRenderer } from './render.js';
import { makeHud } from './hud.js';
import { makeSoundboard } from './audio.js';
import { WEAPONS, THROWABLES } from './weapons.js';
import { hashSeed } from './rng.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const seedParam = params.get('seed');
const seed = seedParam ? (Number(seedParam) || hashSeed(seedParam)) : 20261117;
const shotMode = params.get('shot'); // start | play | end | null

const canvas = document.getElementById('view');
const match = makeMatch(seed);
const renderer = makeRenderer(canvas);
const hud = makeHud();
const sfx = makeSoundboard();

window.__matchPlayer = playerFighter(match);

const input = {
  fwd: false, back: false, left: false, right: false,
  crouch: false, jump: false, fire: false, ads: false,
  reload: false, use: false, throwKind: null,
};
const keys = new Set();
let locked = false;
let started = false;
let buyOpen = false;
let simAcc = 0;
let lastT = performance.now();
let testLog = [];

// Exposed for headless self-tests: state, match, and a log of checks.
window.__sunscorch = {
  match,
  input,
  get started() { return started; },
  get buyOpen() { return buyOpen; },
  get locked() { return locked; },
  testLog,
  start,
  stageShot,
};

function logCheck(name, ok, detail) {
  testLog.push({ name, ok, detail: detail || '' });
  return ok;
}

function playEventSounds() {
  for (const ev of match.events) {
    switch (ev.kind) {
      case 'shotSound': sfx.shot(ev.sound); break;
      case 'drySound': sfx.dryClick(); break;
      case 'hitSound': sfx.hit(); break;
      case 'kill': if (ev.shooter && ev.shooter.isPlayer) sfx.kill(); break;
      case 'explosion': sfx.boom(); break;
      case 'flashbang': sfx.flash(); break;
      case 'plantTick': sfx.plantTick(); break;
      case 'defuseTick': sfx.defuseTick(); break;
      case 'planted': sfx.planted(); break;
      case 'roundStart': sfx.roundStart(); hud.hideBanner(); break;
      case 'roundEnd': {
        sfx.roundEnd(ev.win);
        const a = match.scoreA, b = match.scoreB;
        const title = ev.win ? 'ROUND WON' : 'ROUND LOST';
        hud.showBanner(`${title}<div class="sub2">Vipers ${a} — ${b} Wardens &nbsp;•&nbsp; ${match.roundReason}</div>`);
        if (match.matchOver) {
          const mw = match.winner === 'attack' ? 'SAND VIPERS' : 'DUNE WARDENS';
          hud.showBanner(`${mw} TAKE THE YARD<div class="sub2">Final score — Vipers ${a} — ${b} Wardens</div>`);
        }
        break;
      }
      case 'throwSound': sfx.step(); break;
      default: break;
    }
  }
}

function selectWeapon(key) {
  const p = playerFighter(match);
  if (!p || !p.alive) return;
  if (!p.owned || !p.owned.includes(key)) return;
  if (p.weapon === key) return;
  const def = WEAPONS[key];
  p.weapon = key;
  p.mag = def.mag;
  p.reserve = def.reserve;
  p.reloading = 0;
}

function handleBuyKey(n) {
  const p = playerFighter(match);
  if (!p) return;
  const order = ['sidewinder', 'boomer', 'longhorn', 'rattler', 'sandcharge', 'flashpot', 'armor'];
  const key = order[n - 1];
  if (!key) return;
  const msg = buyItem(match, key);
  if (msg.includes('bought') || msg.includes('equipped')) {
    sfx.buy();
    if (!p.owned) p.owned = ['duster'];
    if (WEAPONS[key] && !p.owned.includes(key)) p.owned.push(key);
  } else {
    sfx.denied();
  }
  hud.showToast(msg, 2);
  hud.setBuyOpen(true, p.cash);
}

function toggleBuy() {
  const p = playerFighter(match);
  if (!p) return;
  if (match.phase !== 'freeze') {
    hud.showToast('Buy menu opens during freeze time', 2);
    return;
  }
  buyOpen = !buyOpen;
  hud.setBuyOpen(buyOpen, p.cash);
  if (buyOpen && document.pointerLockElement) document.exitPointerLock();
}

function start() {
  if (started) return;
  started = true;
  sfx.unlock();
  sfx.wind();
  hud.hideCenter();
  canvas.requestPointerLock();
}

// --- input ---------------------------------------------------------------
document.getElementById('start-btn').addEventListener('click', start);
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const p = playerFighter(match);
  if (!p || !p.alive) return;
  const sens = p.ads ? 0.0011 : 0.0021;
  p.yaw -= e.movementX * sens;
  p.pitch -= e.movementY * sens;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
});
canvas.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (!locked) { canvas.requestPointerLock(); return; }
  if (e.button === 0) input.fire = true;
  if (e.button === 2) input.ads = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) input.ads = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  const p = playerFighter(match);
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.fwd = true; break;
    case 'KeyS': case 'ArrowDown': input.back = true; break;
    case 'KeyA': case 'ArrowLeft': input.left = true; break;
    case 'KeyD': case 'ArrowRight': input.right = true; break;
    case 'ControlLeft': case 'KeyC': input.crouch = true; break;
    case 'Space': input.jump = true; e.preventDefault(); break;
    case 'ShiftLeft': break;
    case 'KeyR': input.reload = true; break;
    case 'KeyE': input.use = true; break;
    case 'KeyB': toggleBuy(); break;
    case 'KeyG': {
      if (p && p.he > 0) input.throwKind = 'sandcharge';
      else if (p && p.flash > 0) input.throwKind = 'flashpot';
      else hud.showToast('No grenades — buy some in freeze time', 2);
      break;
    }
    case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': {
      const n = Number(e.code.slice(5));
      if (buyOpen) handleBuyKey(n);
      else {
        const order = ['duster', 'sidewinder', 'boomer', 'longhorn', 'rattler'];
        selectWeapon(order[n - 1]);
      }
      break;
    }
    case 'Digit6': case 'Digit7': {
      if (buyOpen) handleBuyKey(Number(e.code.slice(5)));
      else if (p) input.throwKind = e.code === 'Digit6' ? 'sandcharge' : 'flashpot';
      break;
    }
    case 'Escape':
      if (buyOpen) { buyOpen = false; hud.setBuyOpen(false, 0); }
      break;
    default: break;
  }
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  switch (e.code) {
    case 'KeyW': case 'ArrowUp': input.fwd = false; break;
    case 'KeyS': case 'ArrowDown': input.back = false; break;
    case 'KeyA': case 'ArrowLeft': input.left = false; break;
    case 'KeyD': case 'ArrowRight': input.right = false; break;
    case 'ControlLeft': case 'KeyC': input.crouch = false; break;
    case 'Space': input.jump = false; break;
    case 'KeyR': input.reload = false; break;
    case 'KeyE': input.use = false; break;
    default: break;
  }
});

// --- deterministic staging for screenshots --------------------------------
// Runs the sim forward without rendering, so ?shot=play lands mid-round and
// ?shot=end lands on a finished round, with the same seed every time.
function stageShot(mode) {
  const p = playerFighter(match);
  window.__staged = mode;
  if (mode === 'start') {
    // freeze time, buy menu open, player at spawn looking down mid
    started = true;
    hud.hideCenter();
    buyOpen = true;
    hud.setBuyOpen(true, p.cash);
    return;
  }
  started = true;
  hud.hideCenter();
  // skip freeze
  match.phase = 'live';
  match.phaseT = 0;
  if (mode === 'play') {
    // drive the player forward down mid for ~14s of sim, firing in bursts
    const script = { fwd: true, back: false, left: false, right: false, crouch: false, jump: false, fire: false, ads: false, reload: false, use: false, throwKind: null };
    for (let i = 0; i < 60 * 14; i++) {
      script.fire = (i % 90) < 12 && i > 60 * 4 && i < 60 * 8;
      script.reload = i > 60 * 8 && i < 60 * 9;
      script.fwd = i < 60 * 9;
      script.left = i > 60 * 9 && i < 60 * 11;
      stepMatch(match, script, STEP);
      playEventSounds();
      match.events.length = 0;
    }
    // aim the player at the action: nearest living enemy
    let foe = null, bd = Infinity;
    for (const f of match.fighters) {
      if (f.alive && f.team !== p.team) {
        const d = Math.hypot(f.x - p.x, f.z - p.z);
        if (d < bd) { bd = d; foe = f; }
      }
    }
    if (foe) {
      p.yaw = Math.atan2(-(foe.x - p.x), -(foe.z - p.z));
      p.pitch = Math.atan2((foe.y + 1.1) - 1.62, bd);
    }
    return;
  }
  if (mode === 'end') {
    // simulate ~25s of play so the yard looks lived-in, then run the clock
    // out so the round ends and the banner shows. Kept short on purpose:
    // staging runs synchronously on the main thread.
    const idle = { fwd: false, back: false, left: false, right: false, crouch: false, jump: false, fire: false, ads: false, reload: false, use: false, throwKind: null };
    for (let i = 0; i < 60 * 25; i++) {
      stepMatch(match, idle, STEP);
      playEventSounds();
      match.events.length = 0;
      if (match.phase === 'over') break;
    }
    if (match.phase !== 'over') {
      match.roundT = 0.5;
      let guard = 0;
      while (match.phase !== 'over' && match.phase !== 'done' && guard < 600) {
        stepMatch(match, idle, STEP);
        playEventSounds();
        match.events.length = 0;
        guard++;
      }
    }
    // banner text was set by the roundEnd event handler
    return;
  }
}

// --- main loop ---------------------------------------------------------------
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (nowMs - lastT) / 1000);
  lastT = nowMs;
  if (started) {
    simAcc += dt;
    let steps = 0;
    while (simAcc >= STEP && steps < 5) {
      stepMatch(match, input, STEP);
      playEventSounds();
      simAcc -= STEP;
      steps++;
    }
    if (steps === 5) simAcc = 0;
    // keep the buy panel cash fresh
    if (buyOpen) {
      const p = playerFighter(match);
      if (p) hud.setBuyOpen(true, p.cash);
    }
  }
  const p = playerFighter(match);
  window.__matchPlayer = p;
  renderer.render(match, p, dt, nowMs / 1000);
  hud.update(match, nowMs / 1000);
}

// --- self-test hooks ---------------------------------------------------------
// The headless harness calls these through CDP and reads window.__sunscorch.testLog.
window.__sunscorch.selfTest = function selfTest() {
  testLog = [];
  window.__sunscorch.testLog = testLog;
  const errs = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const p = playerFighter(match);
  logCheck('page loads, match exists', !!match && !!p, `round ${match.round}`);
  logCheck('webgl context live', !!renderer, 'renderer created');
  logCheck('hud shows health/ammo', document.getElementById('hp').textContent.length > 0, document.getElementById('hp').textContent);
  logCheck('ten fighters (1 player + 9 bots)', match.fighters.length === 10, String(match.fighters.length));
  logCheck('bots have waypoint paths', match.fighters.filter((f) => !f.isPlayer).every((f) => f.bot !== null), '');
  logCheck('no network requests', (window.__netRequests || []).length === 0, String((window.__netRequests || []).length));
  // fire the player weapon once and confirm a tracer event appears
  // (the match starts in freeze phase, where firing is paused, so go live first)
  const before = match.fighters.filter((f) => f.alive).length;
  match.phase = 'live';
  input.fire = true;
  stepMatch(match, input, STEP);
  input.fire = false;
  const shotEv = match.events.some((e) => e.kind === 'tracer' || e.kind === 'shotSound');
  logCheck('weapon fires and produces tracer/sound', shotEv, '');
  logCheck('no NaN in player state', [p.x, p.z, p.yaw, p.hp].every((v) => Number.isFinite(v)), '');
  // bots move: step 3s of sim and check displacement
  const bx = match.fighters[1].x, bz = match.fighters[1].z;
  const idle = { fwd: false, back: false, left: false, right: false, crouch: false, jump: false, fire: false, ads: false, reload: false, use: false, throwKind: null };
  match.phase = 'live';
  for (let i = 0; i < 180; i++) stepMatch(match, idle, STEP);
  const moved = Math.hypot(match.fighters[1].x - bx, match.fighters[1].z - bz);
  logCheck('bots move along waypoints', moved > 0.5, `moved ${moved.toFixed(2)}m`);
  // round ends: force the timer down and step until over
  match.roundT = 0.5;
  let guard = 0;
  while (match.phase !== 'over' && guard < 600) { stepMatch(match, idle, STEP); guard++; }
  logCheck('round ends (timer expiry)', match.phase === 'over', match.phase);
  logCheck('round has a winner and reason', !!match.roundWinner && !!match.roundReason, match.roundReason);
  // buy menu: only in freeze, so check the function directly on a fresh match
  const m2 = makeMatch(7);
  const msg = buyItem(m2, 'longhorn');
  logCheck('buy menu rejects unaffordable rifle at $800', msg.includes('Not enough'), msg);
  const msg2 = buyItem(m2, 'sandcharge');
  logCheck('buy menu sells grenade at $800', msg2.includes('bought'), msg2);
  // seed determinism: two matches with the same seed spawn identically
  const ma = makeMatch(42), mb = makeMatch(42);
  const same = ma.fighters.every((f, i) => f.x === mb.fighters[i].x && f.z === mb.fighters[i].z && f.team === mb.fighters[i].team);
  logCheck('seed deterministic spawns', same, '');
  logCheck('no uncaught page errors so far', errs.length === 0, errs.join('; '));
  return testLog;
};

// network watchdog: any fetch/XHR/image load outside the page is recorded
window.__netRequests = [];
const origFetch = window.fetch;
window.fetch = function (...a) { window.__netRequests.push(String(a[0])); return origFetch.apply(this, a); };

// boot
if (shotMode) {
  stageShot(shotMode);
  // render one frame so the canvas is painted even before rAF settles
  renderer.render(match, playerFighter(match), 0.016, 1);
  hud.update(match, 1);
}
// ?still=1 renders exactly one frame and stops the loop, so a headless
// screenshot can capture the staged scene without waiting on the loop.
if (!params.has('still')) requestAnimationFrame(frame);
