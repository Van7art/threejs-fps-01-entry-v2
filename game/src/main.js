// Sunscorch Yard — bootstrap and game loop.
//
// One fixed-step simulation (60 Hz) kept apart from rendering: the sim
// modules (sim.js, bots.js) advance the match, and this file only moves
// meshes, the camera and the HUD to match. Shooting uses analytic ray
// tests (sphere for heads, cylinder for bodies, slab test for walls), so
// hits never depend on a mesh's visibility flag.
//
// URL modes:
//   ?seed=N            match seed (default 1)
//   ?shot=start|play|end   staged scenes for screenshots (no pointer lock)
//   ?selftest=1         scripted checks; results land in #selftest and
//                      document.title, readable from a headless dump

import * as THREE from 'three';
import { makeRng } from './rng.js';
import { buildMap, SITES, SPAWNS, HOLD_SPOTS, WAYPOINTS } from './map.js';
import { makeFighter, makeViewModel, animateFighter, EYE_HEIGHT } from './entities.js';
import { createRenderer, createEffects } from './render.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createBot, updateBot } from './bots.js';
import {
  createMatch, createPlayer, startRound, updatePlayer, updateMatch,
  damageFighter, plantCharge, defuseCharge, aliveCount,
} from './sim.js';
import { WEAPONS } from './weapons.js';

const params = new URLSearchParams(window.location.search);
const SEED = Number(params.get('seed') || '1') || 1;
const SHOT = params.get('shot') || null;
const SELFTEST = params.get('selftest') === '1';

const rng = makeRng(SEED);
const audio = createAudio();
const { renderer, scene, camera } = createRenderer(document.getElementById('game'));
const mapData = buildMap(scene);
const effects = createEffects(scene);
const hud = createHud(document);

// --- Fighters ---------------------------------------------------------------
const player = createPlayer(SPAWNS.attackers[0]);
const bots = [];
for (let i = 0; i < 8; i++) {
  const team = i < 4 ? 'attackers' : 'defenders';
  const spawn = SPAWNS[team][(i % 4) + 1];
  const bot = createBot(`bot-${i}`, team, i % 4, spawn, rng);
  bot.group = makeFighter(team, bot.name);
  scene.add(bot.group);
  bots.push(bot);
}
const fighters = [player, ...bots];

const viewModel = makeViewModel();
camera.add(viewModel);
effects.flashMesh.position.set(0, 0, -0.7);
camera.add(effects.flashMesh);
scene.add(camera);

// --- World: the shared state the sim and the bots read ----------------------
const world = {
  rng,
  time: 0,
  colliders: mapData.colliders,
  circles: mapData.circles,
  sites: mapData.sites,
  spawns: mapData.spawns,
  fighters,
  bots,
  player,
  grenades: [],
  droppedCharge: null,
  noiseEvents: [],
  roundPhase: 'freeze',
  plantedSite: null,
  damageFighter(target, amount, head, attacker) {
    damageFighter(target, amount, head, attacker, world, match);
  },
  noise(x, z, radius) {
    world.noiseEvents.push({ x, z, radius });
  },
  onKill(attacker, victim, head) {
    hud.killfeed(attacker, victim, head);
  },
  onEvent(text) {
    hud.event(text);
  },
  hudFlash() {
    hud.damageFlash();
  },
  hudHitmarker(head) {
    hud.hitmarker(head);
  },
  dropCharge(x, z) {
    world.droppedCharge = { x, z };
  },
  plantCharge(bot) {
    plantCharge(match, bot, world);
  },
  defuseCharge(bot) {
    defuseCharge(match, bot, world);
  },
  nearestSite(x, z) {
    const da = Math.hypot(x - SITES.A.center[0], z - SITES.A.center[1]);
    const db = Math.hypot(x - SITES.B.center[0], z - SITES.B.center[1]);
    return da <= db ? SITES.A : SITES.B;
  },
  raycast(origin, dir, maxDist) {
    return raycastWorld(origin, dir, maxDist);
  },
  fx: null, // set below
};

// --- Ray tests --------------------------------------------------------------
// Ray vs axis-aligned box (slab method). Boxes are {minX,maxX,minZ,maxZ,h}.
function rayBox(origin, dir, box) {
  let tMin = 0;
  let tMax = Infinity;
  const axes = [
    [origin.x, dir.x, box.minX, box.maxX],
    [origin.y, dir.y, 0, box.h ?? 4],
    [origin.z, dir.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
  }
  return tMin;
}

// Ray vs vertical cylinder (body) and vs sphere (head).
function rayCylinder(origin, dir, cx, cz, r, y0, y1) {
  const ox = origin.x - cx;
  const oz = origin.z - cz;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0) return null;
  const y = origin.y + dir.y * t;
  if (y < y0 || y > y1) return null;
  return t;
}

function raySphere(origin, dir, cx, cy, cz, r) {
  const ox = origin.x - cx;
  const oy = origin.y - cy;
  const oz = origin.z - cz;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

function raycastWorld(origin, dir, maxDist) {
  let best = null;
  const consider = (t, fighter, head) => {
    if (t === null || t > maxDist) return;
    if (!best || t < best.dist) {
      best = {
        dist: t,
        fighter,
        head,
        point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      };
    }
  };
  // Walls and tanks first: a wall hit blocks everything behind it.
  let wallT = Infinity;
  for (const box of world.colliders) {
    const t = rayBox(origin, dir, box);
    if (t !== null && t < wallT) wallT = t;
  }
  for (const c of world.circles) {
    const t = rayCylinder(origin, dir, c.x, c.z, c.r, 0, 5);
    if (t !== null && t < wallT) wallT = t;
  }
  for (const f of fighters) {
    if (!f.alive || f.isPlayer) continue;
    const headT = raySphere(origin, dir, f.x, 1.58 + f.y, f.z, 0.26);
    consider(headT, f, true);
    const bodyT = rayCylinder(origin, dir, f.x, f.z, 0.36, 0.25 + f.y, 1.5 + f.y);
    consider(bodyT, f, false);
  }
  if (best && best.dist < wallT) return best;
  if (wallT <= maxDist) {
    return {
      dist: wallT,
      fighter: null,
      head: false,
      point: { x: origin.x + dir.x * wallT, y: origin.y + dir.y * wallT, z: origin.z + dir.z * wallT },
    };
  }
  return null;
}

// --- Effects ---------------------------------------------------------------
const fx = {
  tracer(x1, y1, z1, x2, y2, z2, team) {
    effects.tracer(x1, y1, z1, x2, y2, z2, team);
  },
  muzzle() {
    effects.muzzle();
  },
  explosion(x, z) {
    effects.explosion(x, z);
    audio.explosion();
  },
  flash(x, z) {
    audio.flash();
  },
  shot(x, z, kind, isPlayer) {
    const d = Math.hypot(x - player.x, z - player.z);
    if (isPlayer || d < 45) audio.shot(kind);
  },
  beep(x, z, kind) {
    const d = Math.hypot(x - player.x, z - player.z);
    if (d < 30) {
      if (kind === 'plant') audio.plantBeep();
      else audio.defuseBeep();
    }
  },
  hit(head) { audio.hit(head); },
  hurt() { audio.hurt(); },
  kill() { audio.kill(); },
  reload() { audio.reload(); },
  dryFire() { audio.dryFire(); },
  buy() { audio.buy(); },
  denied() { audio.denied(); },
  throwSound() { audio.throwSound(); },
  plant() { audio.plant(); },
  flashScreen(s) { hud.flashScreen(s); },
  roundStart() {
    audio.roundStart();
    hud.banner(`ROUND ${match.round}`, match.round > 6 ? 'Sides swapped — defend the yard' : 'Plant the charge or wipe the enemy team', 2.5);
  },
  roundWin() { audio.roundWin(); },
  roundLose() { audio.roundLose(); },
};
world.fx = fx;

// --- Input ------------------------------------------------------------------
const input = {
  forward: false, back: false, left: false, right: false,
  crouch: false, jump: false, fire: false, firePressed: false,
  reload: false, use: false, grenadeHE: false, grenadeFlash: false,
  buyKey: null, mouseDX: 0, mouseDY: 0,
};
const KEYMAP = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  ControlLeft: 'crouch', KeyC: 'crouch', Space: 'jump', KeyE: 'use',
  KeyR: 'reload',
};
const BUY_KEYS = { Digit1: 'duster', Digit2: 'sidewinder', Digit3: 'boomer', Digit4: 'longhorn', Digit5: 'rattler', Digit6: 'he', Digit7: 'flash' };
let buyOpen = false;
let locked = false;

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault();
  const field = KEYMAP[e.code];
  if (field) input[field] = true;
  if (e.code === 'KeyB' && match.phase === 'freeze') {
    buyOpen = !buyOpen;
    hud.showBuy(player, buyOpen);
  }
  if (buyOpen && match.phase === 'freeze' && BUY_KEYS[e.code]) {
    input.buyKey = BUY_KEYS[e.code];
  }
  if (e.code === 'Digit6' && !buyOpen) input.grenadeHE = true;
  if (e.code === 'Digit7' && !buyOpen) input.grenadeFlash = true;
});
window.addEventListener('keyup', (e) => {
  const field = KEYMAP[e.code];
  if (field) input[field] = false;
});
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  input.mouseDX += e.movementX || 0;
  input.mouseDY += e.movementY || 0;
});
document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  if (e.button === 0) {
    input.fire = true;
    input.firePressed = true;
  }
  if (e.button === 2) player.ads = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) player.ads = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && !SHOT && !SELFTEST && !match.matchOver && player.alive) {
    hud.showOverlay('Sunscorch Yard', 'Paused — click to jump back in.', 'Resume');
    paused = true;
  }
});
hud.refs.playButton.addEventListener('click', () => {
  audio.unlock();
  hud.hideOverlay();
  paused = false;
  renderer.domElement.requestPointerLock();
});
hud.refs.restartButton.addEventListener('click', () => {
  audio.unlock();
  hud.hideEnd();
  restartMatch();
});
hud.refs.buyItems.addEventListener('click', (e) => {
  const item = e.target.closest('[data-buy]');
  if (item) input.buyKey = item.dataset.buy;
});

// --- Match lifecycle --------------------------------------------------------
let match = createMatch(rng);
let paused = false;

function restartMatch() {
  match = createMatch(rng);
  world.time = 0;
  for (const bot of bots) {
    bot.money = 800;
    bot.lastRoundWon = undefined;
  }
  player.money = 800;
  player.kills = 0;
  player.deaths = 0;
  player.loadout = { primary: 'duster', owned: { duster: true }, ammo: { duster: { mag: WEAPONS.duster.mag, reserve: WEAPONS.duster.reserve } }, grenades: { he: 0, flash: 0 } };
  startRound(match, world);
}

startRound(match, world);

// --- Fixed-step loop --------------------------------------------------------
const STEP = 1 / 60;
let accumulator = 0;
let lastTime = performance.now();
let spectate = null;

function step(dt) {
  world.time += dt;
  world.noiseEvents = [];

  if (match.phase === 'end' && match.roundWinner) {
    // Banner once per round end.
    if (!match.bannerShown) {
      match.bannerShown = true;
      const won = match.roundWinner === player.team;
      hud.banner(won ? 'ROUND WON' : 'ROUND LOST', match.roundReason, 3.5);
    }
  } else {
    match.bannerShown = false;
  }

  updatePlayer(match, dt, input, world);
  for (const bot of bots) updateBot(bot, dt, world);
  updateMatch(match, dt, world);

  // Spectate a living teammate while dead.
  if (!player.alive && !spectate) {
    spectate = bots.find((b) => b.alive && b.team === player.team) || null;
  }
  if (player.alive) spectate = null;
  if (match.matchOver && !match.endShown) {
    match.endShown = true;
    const w = match.winner;
    hud.showEnd(
      w === 'draw' ? 'Draw' : w === player.team ? 'Victory' : 'Defeat',
      `Final score — Vipers ${match.score.attackers} : ${match.score.defenders} Wardens. You: ${player.kills} kills, ${player.deaths} deaths.`,
    );
    document.exitPointerLock?.();
  }

  // Consume one-frame inputs.
  input.mouseDX = 0;
  input.mouseDY = 0;
  input.firePressed = false;
  input.reload = false;
  input.jump = false;
  input.grenadeHE = false;
  input.grenadeFlash = false;
  input.buyKey = null;
}

function syncVisuals(dt) {
  // Camera follows the player, or the spectated teammate.
  const focus = player.alive ? player : spectate;
  if (focus) {
    const eyeY = focus.isPlayer ? (focus.crouched ? 1.15 : EYE_HEIGHT) + focus.y : EYE_HEIGHT;
    camera.position.set(focus.x, eyeY, focus.z);
    camera.rotation.y = focus.yaw;
    camera.rotation.x = focus.isPlayer ? focus.pitch - focus.recoil : focus.pitch || 0;
    camera.rotation.z = 0;
    const targetFov = focus.isPlayer && focus.ads ? 78 / (WEAPONS[focus.loadout.primary]?.zoom || 1) : 78;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  // View model bob and kick.
  const bob = Math.sin(player.walkPhase) * 0.012 * Math.min(1, player.speed / 5);
  viewModel.position.set(0.22, -0.2 + bob, -0.7 + player.recoil * 0.35);
  viewModel.rotation.x = player.recoil * 0.9;

  for (const bot of bots) {
    if (!bot.group) continue;
    bot.group.visible = bot.alive;
    if (!bot.alive) continue;
    bot.group.position.set(bot.x, 0, bot.z);
    bot.group.rotation.y = bot.yaw;
    animateFighter(bot.group, bot.walkPhase, bot.speed);
  }

  // Charge marker: on the carrier, dropped, or planted.
  const charge = effects.chargeMesh;
  if (match.bomb.planted) {
    const site = SITES[match.bomb.site];
    charge.visible = true;
    charge.position.set(site.center[0], 0.15, site.center[1]);
  } else if (match.carrier && match.carrier !== player) {
    charge.visible = true;
    charge.position.set(match.carrier.x, 1.3, match.carrier.z);
  } else if (world.droppedCharge) {
    charge.visible = true;
    charge.position.set(world.droppedCharge.x, 0.15, world.droppedCharge.z);
  } else {
    charge.visible = false;
  }

  effects.update(performance.now());
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  if (!paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      step(STEP);
      accumulator -= STEP;
      steps++;
    }
    if (steps === 5) accumulator = 0;
  }
  hud.update(match, player, dt);
  syncVisuals(dt);
  renderer.render(scene, camera);
}

// --- Shot modes (staged scenes for screenshots) ----------------------------
function applyShotMode() {
  hud.hideOverlay();
  // Staged shots are frozen moments: the sim stays paused so the player
  // keeps full health, the bots stay where they are put, and the banner
  // does not expire mid-capture. The frame is still a real render of the
  // game's own code.
  paused = true;
  if (SHOT === 'start') {
    // Wide view from the south-west wall across the yard at first light:
    // Site A to the left, the gantry over mid, the container lanes
    // ahead. Shot from clear ground so no teammate blocks the frame.
    player.x = -25;
    player.z = 6;
    player.yaw = -1.0;
    player.pitch = 0.02;
  } else if (SHOT === 'play') {
    // Mid-round: player in the open south lane, two defenders in sight
    // down the lane, the gantry and mid containers behind them.
    player.x = -14;
    player.z = 12;
    player.yaw = -0.98;
    player.pitch = 0;
    const d1 = bots.find((b) => b.team === 'defenders');
    if (d1) { d1.x = -2; d1.z = 5; d1.yaw = 2.1; }
    const d2 = bots.filter((b) => b.team === 'defenders')[1];
    if (d2) { d2.x = 4; d2.z = 2; d2.yaw = 2.0; }
    match.phase = 'live';
    match.timer = 74;
    world.roundPhase = 'live';
    hud.refs.banner.hidden = true;
  } else if (SHOT === 'end') {
    // Round end at the Tank Farm: the banner tells the story. Shot from
    // the south-west so both storage tanks and the hazard pad show.
    player.x = 6;
    player.z = 14;
    player.yaw = -1.37;
    player.pitch = 0.02;
    match.phase = 'end';
    match.phaseTime = 99;
    match.roundWinner = 'attackers';
    match.roundReason = 'Charge detonated';
    match.round = 8;
    match.score.attackers = 4;
    match.score.defenders = 3;
    match.bomb.planted = true;
    match.bomb.site = 'B';
    world.roundPhase = 'end';
    world.plantedSite = 'B';
    hud.banner('ROUND WON', 'Charge detonated — Site B is ours', 99);
  }
}

if (SHOT) {
  applyShotMode();
} else if (!SELFTEST) {
  hud.showOverlay('Sunscorch Yard', 'A day-time desert refinery, five against five. Plant the charge at the Pump House or the Tank Farm — or wipe the enemy team. First to 7 rounds takes the yard.', 'Click to play');
  paused = true;
}

// --- Self-test --------------------------------------------------------------
// Drives the real sim headlessly and checks the game's promises: rendering,
// bots, shooting, planting, buying, grenades, round flow, determinism and
// that the page loads nothing from the network.
async function selftest() {
  const out = [];
  const check = (name, ok) => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const box = document.getElementById('selftest');
  const show = () => {
    box.hidden = false;
    box.textContent = out.join('\n');
    document.title = out.some((l) => l.startsWith('FAIL')) ? 'SELFTEST FAIL' : 'SELFTEST PASS';
  };
  try {
    check('renderer created', !!renderer && !!renderer.domElement);
    check('scene has meshes', scene.children.length > 10);
    check('8 bots created', bots.length === 8);
    check('waypoints exist', Object.keys(WAYPOINTS).length > 10);
    hud.hideOverlay();
    paused = false;
    // Drive the sim headlessly: 10 seconds of freeze + live.
    for (let i = 0; i < 600; i++) step(STEP);
    check('match reached live phase', match.phase === 'live' || match.phase === 'planted');
    check('bots moved from spawn', bots.some((b) => Math.hypot(b.x - (b.team === 'attackers' ? -22 : 22), b.z - (b.team === 'attackers' ? 14 : -14)) > 2));
    // Shooting: put a bot in front of the player and fire until it drops.
    const target = bots.find((b) => b.team !== player.team && b.alive);
    target.x = player.x - Math.sin(player.yaw) * 6;
    target.z = player.z - Math.cos(player.yaw) * 6;
    target.health = 100;
    const before = target.health;
    player.loadout.ammo.duster.mag = 12;
    for (let i = 0; i < 40 && target.alive; i++) {
      input.firePressed = true;
      input.fire = true;
      step(STEP);
      input.fire = false;
    }
    check('player shots damage a bot', target.health < before);
    // Plant: blind the bots so nobody shoots the planter, give the player
    // the charge, stand on Site A, hold E.
    for (const b of bots) b.blindUntil = world.time + 60;
    match.carrier = player;
    player.x = SITES.A.center[0];
    player.z = SITES.A.center[1];
    player.alive = true;
    player.health = 100;
    for (let i = 0; i < 300; i++) {
      input.use = true;
      step(STEP);
    }
    input.use = false;
    check('charge plants on Site A', match.bomb.planted === true && match.bomb.site === 'A');
    // Buy: give the player money and buy the rifle with one key press.
    player.money = 5000;
    input.buyKey = 'longhorn';
    step(STEP);
    check('buy menu buys a weapon', !!player.loadout.owned.longhorn && player.money === 5000 - WEAPONS.longhorn.price);
    // Grenade: throw an HE, put a bot beside it, check the blast hurts.
    player.loadout.grenades.he = 1;
    input.grenadeHE = true;
    step(STEP);
    const thrown = world.grenades.length === 1;
    const victim = bots.find((b) => b.alive && b !== target);
    const g = world.grenades[0];
    if (g && victim) {
      g.fuse = 0.05;
      victim.x = g.x;
      victim.z = g.z;
      victim.health = 100;
      const victimBefore = victim.health;
      for (let i = 0; i < 10; i++) step(STEP);
      check('grenade throw and blast damage a bot', thrown && victim.health < victimBefore);
    } else {
      check('grenade throw and blast damage a bot', false);
    }
    // Round end: let the planted charge tick out, then wait for the next
    // round to start.
    match.bomb.timer = 0.2;
    for (let i = 0; i < 30 && match.phase !== 'end'; i++) step(STEP);
    const ended = match.phase === 'end' && match.score.attackers === 1;
    for (let i = 0; i < 320; i++) step(STEP);
    check('round ends and next round starts', ended && match.round === 2 && match.phase === 'freeze');
    // No network: every loaded resource is same-origin.
    const resources = performance.getEntriesByType('resource');
    check('no external network requests', resources.every((r) => r.name.startsWith(window.location.origin) || r.name.startsWith('data:') || r.name.startsWith('blob:')));
    // Determinism: two generators with the same seed agree.
    const ra = makeRng(1);
    const rb = makeRng(1);
    check('seeded rng is deterministic', ra.next() === rb.next() && ra.next() === rb.next() && ra.next() === rb.next());
    check('no NaN in player position', Number.isFinite(player.x) && Number.isFinite(player.z));
    void HOLD_SPOTS;
    void aliveCount;
  } catch (err) {
    out.push(`FAIL exception: ${err.message}`);
  }
  show();
}

if (SELFTEST) {
  hud.hideOverlay();
  paused = false;
  selftest();
}

requestAnimationFrame(frame);
