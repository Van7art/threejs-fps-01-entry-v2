// The match: rounds, phases, economy, plant/defuse, win checks, kill feed.
// One plain object holds all match state; the sim steps it at a fixed 60 Hz
// and the renderer only reads from it.
import { WEAPONS, THROWABLES, falloffDamage } from './weapons.js';
import { SITES, SPAWNS, buildGraph } from './map.js';
import { makeStream } from './rng.js';
import {
  makeFighter, giveWeapon, stepMove, startReload, tryFire, resolvePellet,
  hurt, throwGrenade, stepGrenade, eyeY,
} from './actors.js';
import { updateBot, assignBot, hearShot } from './bots.js';

export const ROUND_LEN = 100;
export const FREEZE_LEN = 6;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;
export const CHARGE_TIMER = 35;
export const WIN_ROUNDS = 7;
export const MAX_ROUNDS = 13;
export const KILL_CASH = 300;
export const WIN_CASH = 3250;
export const LOSS_CASH = 1900;
export const PLANT_CASH = 300;

const BOT_NAMES = ['Cactus', 'Dusty', 'Mirage', 'Sirocco', 'Gila', 'Ember', 'Coyote', 'Zephyr'];

export function makeMatch(seed) {
  const m = {
    seed,
    rng: makeStream(seed),
    adj: buildGraph(),
    round: 1,
    scoreA: 0, // Sand Vipers (attack first half)
    scoreB: 0, // Dune Wardens
    phase: 'freeze', // freeze | live | over
    phaseT: 0, // seconds left in this phase
    roundT: ROUND_LEN,
    chargeT: 0,
    planted: false,
    plantSite: null,
    plantX: 0, plantZ: 0,
    planter: null,
    chargeCarrier: null,
    chargeDropped: null, // {x,z} when the carrier died
    lossStreakA: 0, lossStreakB: 0,
    fighters: [],
    grenades: [],
    feed: [], // {text, t}
    events: [], // transient sim events for sound/tracer/HUD: {kind, ...}
    time: 0, // total match seconds
    winner: null, // 'attack' | 'defend' | null
    matchOver: false,
    roundWinner: null,
    roundReason: '',
    playerTeam: 'attack',
    swapAt: 6, // sides swap after round 6
  };
  spawnRound(m);
  return m;
}

export function playerSide(m) {
  return m.round <= m.swapAt ? 'attack' : 'defend';
}

export function playerFighter(m) {
  return m.fighters.find((f) => f.isPlayer);
}

function spawnRound(m) {
  const rng = m.rng;
  m.fighters = [];
  const pSide = playerSide(m);
  const player = makeFighter(pSide, 'You', true, 0, 0);
  // player keeps cash across rounds; fresh spawn position
  const pSpawn = pSide === 'attack' ? SPAWNS.attack[2] : SPAWNS.defend[2];
  player.x = pSpawn[0]; player.z = pSpawn[1];
  player.yaw = pSide === 'attack' ? -Math.PI / 2 : Math.PI / 2;
  player.cash = m.carryCash !== undefined ? m.carryCash : 800;
  player.armor = m.carryArmor || 0;
  if (m.carryWeapon) giveWeapon(player, m.carryWeapon);
  m.fighters.push(player);
  // 4 bot teammates + 5 opponents
  const mateTeam = pSide;
  const foeTeam = pSide === 'attack' ? 'defend' : 'attack';
  const mateSpawns = mateTeam === 'attack' ? SPAWNS.attack : SPAWNS.defend;
  const foeSpawns = foeTeam === 'attack' ? SPAWNS.attack : SPAWNS.defend;
  let nameIdx = 0;
  const botGuns = ['longhorn', 'longhorn', 'sidewinder', 'boomer', 'rattler', 'sidewinder', 'longhorn', 'boomer', 'duster'];
  for (let i = 0; i < 4; i++) {
    const s = mateSpawns[i === 2 ? 3 : i];
    const bot = makeFighter(mateTeam, BOT_NAMES[nameIdx % BOT_NAMES.length], false, s[0], s[1]);
    giveWeapon(bot, botGuns[nameIdx % botGuns.length]);
    if (rng.chance(0.35)) bot.he = 1;
    nameIdx++;
    assignBot(bot.bot, rng, m.round);
    m.fighters.push(bot);
  }
  for (let i = 0; i < 5; i++) {
    const s = foeSpawns[i];
    const bot = makeFighter(foeTeam, BOT_NAMES[nameIdx % BOT_NAMES.length], false, s[0], s[1]);
    giveWeapon(bot, botGuns[nameIdx % botGuns.length]);
    if (rng.chance(0.35)) bot.he = 1;
    nameIdx++;
    assignBot(bot.bot, rng, m.round);
    m.fighters.push(bot);
  }
  // charge carrier: the player 40% of the time, else a random attacker
  const attackers = m.fighters.filter((f) => f.team === 'attack');
  const playerAttacker = attackers.find((f) => f.isPlayer);
  m.chargeCarrier = (playerAttacker && rng.chance(0.4))
    ? playerAttacker
    : attackers[Math.floor(rng.next() * attackers.length)];
  m.chargeDropped = null;
  m.planted = false;
  m.plantSite = null;
  m.chargeT = 0;
  m.phase = 'freeze';
  m.phaseT = FREEZE_LEN;
  m.roundT = ROUND_LEN;
  m.roundWinner = null;
  m.roundReason = '';
  m.winner = null;
  pushFeed(m, `Round ${m.round} — ${pSide === 'attack' ? 'attack: plant the charge' : 'defend: hold the sites'}`);
}

function pushFeed(m, text) {
  m.feed.unshift({ text, t: m.time });
  if (m.feed.length > 6) m.feed.pop();
}

function aliveCount(m, team) {
  let n = 0;
  for (const f of m.fighters) if (f.alive && f.team === team) n++;
  return n;
}

function endRound(m, winner, reason) {
  if (m.phase === 'over') return;
  m.phase = 'over';
  m.phaseT = 4.5;
  m.roundWinner = winner;
  m.roundReason = reason;
  const playerWon = winner === playerSide(m);
  if (winner === 'attack') { m.scoreA += 1; m.lossStreakB += 1; m.lossStreakA = 0; }
  else { m.scoreB += 1; m.lossStreakA += 1; m.lossStreakB = 0; }
  // economy
  for (const f of m.fighters) {
    const won = f.team === winner;
    let gain = won ? WIN_CASH : LOSS_CASH;
    if (!won) {
      const streak = f.team === 'attack' ? m.lossStreakA : m.lossStreakB;
      gain += Math.min(streak - 1, 3) * 500;
    }
    if (f === m.planter) gain += PLANT_CASH;
    f.cash += gain;
  }
  m.planter = null;
  pushFeed(m, `${winner === 'attack' ? 'Sand Vipers' : 'Dune Wardens'} take round ${m.round} — ${reason}`);
  m.events.push({ kind: 'roundEnd', winner, win: playerWon });
  if (m.scoreA >= WIN_ROUNDS || m.scoreB >= WIN_ROUNDS || m.round >= MAX_ROUNDS) {
    m.matchOver = true;
    m.winner = m.scoreA > m.scoreB ? 'attack' : 'defend';
  }
}

function nextRound(m) {
  const p = playerFighter(m);
  m.carryCash = p ? p.cash : 800;
  m.carryArmor = p ? p.armor : 0;
  m.carryWeapon = p ? p.weapon : 'duster';
  m.round += 1;
  if (m.round > MAX_ROUNDS) { m.matchOver = true; return; }
  spawnRound(m);
  m.events.push({ kind: 'roundStart', round: m.round });
}

// Resolve a full trigger pull: pellets, tracers, damage, kill feed, cash.
function applyShot(m, shot) {
  const f = shot.shooter;
  const def = shot.def;
  let hitAny = false;
  for (const dir of shot.dirs) {
    const res = resolvePellet(f, dir, m.fighters, def.range);
    const endX = f.x + dir[0] * (res ? res.dist : def.range);
    const endY = eyeY(f) + dir[1] * (res ? res.dist : def.range);
    const endZ = f.z + dir[2] * (res ? res.dist : def.range);
    m.events.push({ kind: 'tracer', x0: f.x, y0: eyeY(f), z0: f.z, x1: endX, y1: endY, z1: endZ, color: def.tracer });
    if (res && res.victim) {
      let dmg = falloffDamage(def, res.dist);
      if (res.head) dmg *= def.headMult;
      dmg = Math.round(dmg);
      const died = hurt(res.victim, dmg, m.time);
      hitAny = true;
      m.events.push({ kind: 'hitmark', shooter: f, victim: res.victim, head: res.head, died });
      if (died) {
        f.kills += 1;
        f.cash += KILL_CASH;
        pushFeed(m, `${f.name} ▸ ${res.victim.name}${res.head ? ' (headshot)' : ''}`);
        m.events.push({ kind: 'kill', shooter: f, victim: res.victim });
        // charge drops when the carrier dies
        if (m.chargeCarrier === res.victim && !m.planted) {
          m.chargeDropped = { x: res.victim.x, z: res.victim.z };
          m.chargeCarrier = null;
          pushFeed(m, 'The charge is on the ground — pick it up');
        }
      }
    } else if (res) {
      m.events.push({ kind: 'impact', x: endX, y: endY, z: endZ });
    }
  }
  if (hitAny && f.isPlayer) m.events.push({ kind: 'hitSound', shooter: f });
  m.events.push({ kind: 'shotSound', shooter: f, sound: def.sound });
  hearShot(m.fighters, f, 26, m.time + 6);
}

function detonate(m, g) {
  if (g.kind === 'sandcharge') {
    m.events.push({ kind: 'explosion', x: g.x, y: g.y, z: g.z, radius: g.def.radius });
    for (const f of m.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - g.x, f.z - g.z, (f.y + 0.9) - g.y);
      if (d < g.def.radius) {
        const dmg = Math.round(g.def.damage * (1 - (d / g.def.radius) * 0.7));
        const died = hurt(f, dmg, m.time);
        if (died) {
          g.owner.kills += 1;
          g.owner.cash += KILL_CASH;
          pushFeed(m, `${g.owner.name} ▸ ${f.name} (Sandcharge)`);
          m.events.push({ kind: 'kill', shooter: g.owner, victim: f });
          if (m.chargeCarrier === f && !m.planted) {
            m.chargeDropped = { x: f.x, z: f.z };
            m.chargeCarrier = null;
          }
        }
      }
    }
  } else {
    // flash: blind everyone looking roughly toward it within radius
    m.events.push({ kind: 'flashbang', x: g.x, y: g.y, z: g.z, radius: g.def.radius });
    for (const f of m.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - g.x, f.z - g.z);
      if (d < g.def.radius) {
        const dx = g.x - f.x, dz = g.z - f.z;
        const facing = (-Math.sin(f.yaw) * dx + -Math.cos(f.yaw) * dz) / (d || 1);
        const blind = facing > -0.2 ? 2.6 - d * 0.15 : 0.8;
        f.flashTime = Math.max(f.flashTime, blind);
      }
    }
  }
}

// One fixed step (dt = 1/60). `input` is the local player's control state.
export function stepMatch(m, input, dt) {
  m.time += dt;
  const p = playerFighter(m);
  if (m.phase === 'over') {
    m.phaseT -= dt;
    // let the world settle, then advance
    if (m.phaseT <= 0) {
      if (m.matchOver) { m.phase = 'done'; }
      else nextRound(m);
    }
    return;
  }
  if (m.phase === 'freeze') {
    m.phaseT -= dt;
    if (m.phaseT <= 0) {
      m.phase = 'live';
      m.events.push({ kind: 'roundStart', round: m.round });
    }
    return;
  }
  // live phase
  m.roundT -= dt;
  if (m.planted) {
    m.chargeT -= dt;
    if (m.chargeT <= 0) {
      endRound(m, 'attack', 'charge detonated');
      return;
    }
  }
  if (m.roundT <= 0) {
    if (m.planted) { /* charge timer decides */ }
    else endRound(m, 'defend', 'time expired');
    return;
  }

  // --- player movement + actions ---------------------------------------
  if (p && p.alive) {
    const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
    let wx = 0, wz = 0;
    if (input.fwd) { wx += -s; wz += -c; }
    if (input.back) { wx += s; wz += c; }
    if (input.left) { wx += -c; wz += s; }
    if (input.right) { wx += c; wz += -s; }
    const wl = Math.hypot(wx, wz) || 1;
    p.crouch = !!input.crouch;
    p.ads = !!input.ads && !p.crouch;
    stepMove(p, wx / wl * (input.fwd || input.back || input.left || input.right ? 1 : 0), wz / wl * (input.fwd || input.back || input.left || input.right ? 1 : 0), !!input.jump, dt);
    if (input.reload) startReload(p);
    if (input.fire) {
      const shot = tryFire(p, m.time, m.rng);
      if (shot) {
        if (shot.dry) m.events.push({ kind: 'drySound', shooter: p });
        else applyShot(m, shot);
      }
    }
    if (input.throwKind) {
      const g = throwGrenade(p, input.throwKind, m.time);
      if (g) { m.grenades.push(g); m.events.push({ kind: 'throwSound', shooter: p }); }
      input.throwKind = null;
    }
    // plant / defuse hold
    if (input.use) {
      if (!m.planted && m.chargeCarrier === p) {
        const site = nearestSite(p.x, p.z);
        if (site) {
          p.plantProgress += dt;
          if (Math.floor(p.plantProgress * 4) !== Math.floor((p.plantProgress - dt) * 4)) {
            m.events.push({ kind: 'plantTick' });
          }
          if (p.plantProgress >= PLANT_TIME) {
            m.planted = true;
            m.plantSite = site.key;
            m.plantX = site.cx; m.plantZ = site.cz;
            m.chargeT = CHARGE_TIMER;
            m.planter = p;
            p.plantProgress = 0;
            pushFeed(m, `Charge planted at ${site.name} — ${CHARGE_TIMER}s`);
            m.events.push({ kind: 'planted' });
          }
        } else p.plantProgress = 0;
      } else if (m.planted && p.team === 'defend') {
        const site = SITES[m.plantSite];
        const d = Math.hypot(p.x - site.cx, p.z - site.cz);
        if (d < site.r) {
          p.defuseProgress += dt;
          if (Math.floor(p.defuseProgress * 4) !== Math.floor((p.defuseProgress - dt) * 4)) {
            m.events.push({ kind: 'defuseTick' });
          }
          if (p.defuseProgress >= DEFUSE_TIME) {
            p.defuseProgress = 0;
            endRound(m, 'defend', 'charge defused');
            return;
          }
        } else p.defuseProgress = 0;
      }
    } else {
      p.plantProgress = 0;
      p.defuseProgress = 0;
    }
    // pick up a dropped charge
    if (m.chargeDropped && p.team === 'attack') {
      const d = Math.hypot(p.x - m.chargeDropped.x, p.z - m.chargeDropped.z);
      if (d < 1.4) {
        m.chargeCarrier = p;
        m.chargeDropped = null;
        pushFeed(m, 'You picked up the charge');
      }
    }
  }

  // --- bots ---------------------------------------------------------------
  for (const f of m.fighters) {
    if (f.isPlayer || !f.alive) continue;
    const act = updateBot(f, m, m.fighters, m.adj, m.rng, dt, m.time);
    stepMove(f, act.wishX, act.wishZ, act.jump, dt);
    if (act.fire) {
      const shot = tryFire(f, m.time, m.rng);
      if (shot && !shot.dry) applyShot(m, shot);
    }
    if (act.plant && m.chargeCarrier === f && !m.planted) {
      f.plantProgress += dt;
      if (f.plantProgress >= PLANT_TIME) {
        m.planted = true;
        m.plantSite = f.bot.site;
        m.plantX = SITES[f.bot.site].cx; m.plantZ = SITES[f.bot.site].cz;
        m.chargeT = CHARGE_TIMER;
        m.planter = f;
        f.plantProgress = 0;
        pushFeed(m, `Charge planted at ${SITES[f.bot.site].name} — ${CHARGE_TIMER}s`);
        m.events.push({ kind: 'planted' });
      }
    } else f.plantProgress = 0;
    if (act.defuse && m.planted) {
      f.defuseProgress += dt;
      if (f.defuseProgress >= DEFUSE_TIME) {
        f.defuseProgress = 0;
        endRound(m, 'defend', 'charge defused');
        return;
      }
    } else f.defuseProgress = 0;
    // bot grenade: occasionally toss one at a visible enemy
    if (f.bot.targetId > 0 && f.he > 0 && m.rng.chance(0.0006)) {
      const g = throwGrenade(f, 'sandcharge', m.time);
      if (g) m.grenades.push(g);
    }
    // pick up dropped charge
    if (m.chargeDropped && f.team === 'attack') {
      const d = Math.hypot(f.x - m.chargeDropped.x, f.z - m.chargeDropped.z);
      if (d < 1.4) {
        m.chargeCarrier = f;
        m.chargeDropped = null;
        pushFeed(m, `${f.name} picked up the charge`);
      }
    }
  }

  // --- grenades -----------------------------------------------------------
  for (let i = m.grenades.length - 1; i >= 0; i--) {
    if (stepGrenade(m.grenades[i], dt)) {
      detonate(m, m.grenades[i]);
      m.grenades.splice(i, 1);
    }
  }

  // --- round end by elimination -------------------------------------------
  const aAlive = aliveCount(m, 'attack');
  const bAlive = aliveCount(m, 'defend');
  if (aAlive === 0 && bAlive === 0) endRound(m, 'defend', 'both teams down');
  else if (aAlive === 0) endRound(m, 'defend', 'Vipers eliminated');
  else if (bAlive === 0) {
    if (m.planted) endRound(m, 'defend', 'charge defused by elimination');
    else endRound(m, 'attack', 'Wardens eliminated');
  }
}

function nearestSite(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (Math.hypot(x - s.cx, z - s.cz) < s.r) return { key, ...s };
  }
  return null;
}

// Buying during freeze time. Returns a message for the HUD.
export function buyItem(m, key) {
  const p = playerFighter(m);
  if (!p || m.phase !== 'freeze') return 'Buy menu is only open during freeze time';
  if (key === 'armor') {
    if (p.armor >= 100) return 'Armor already full';
    if (p.cash < 650) return 'Not enough cash for kevlar';
    p.cash -= 650;
    p.armor = 100;
    return 'Kevlar vest equipped';
  }
  if (key === 'sandcharge' || key === 'flashpot') {
    const def = THROWABLES[key];
    if (p.cash < def.price) return `Not enough cash for ${def.name}`;
    p.cash -= def.price;
    if (key === 'sandcharge') p.he += 1; else p.flash += 1;
    return `${def.name} bought`;
  }
  const def = WEAPONS[key];
  if (!def) return 'Unknown item';
  if (p.weapon === key) return `Already carrying the ${def.name}`;
  if (p.cash < def.price) return `Not enough cash for the ${def.name}`;
  p.cash -= def.price;
  giveWeapon(p, key);
  return `${def.name} bought`;
}
