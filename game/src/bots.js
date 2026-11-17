// Bot brains for Sunscorch Yard. Bots walk the map's waypoint graph, hold
// positions, push the sites, plant and defuse the charge, and shoot back.
// They see through line of sight, hear gunfire, and miss more the further
// away and the faster their target moves — so stopping to aim pays, for
// them as well as for the player.
//
// A bot is a plain record; this module owns its decisions, while sim.js
// owns movement, damage and the round. The `world` argument carries the
// shared state both modules read: colliders, fighters, the round phase,
// the seeded rng, the clock, and the effects (tracer, sound) a shot needs.

import { WEAPONS, damageAt } from './weapons.js';
import { findPath, nearestWaypoint, hasLineOfSight, resolveCollision, HOLD_SPOTS, WAYPOINTS } from './map.js';
import { BODY_RADIUS, EYE_HEIGHT } from './entities.js';

const BOT_NAMES = {
  attackers: ['Dune', 'Sirocco', 'Ember', 'Coyote', 'Mirage'],
  defenders: ['Basalt', 'Cactus', 'Oasis', 'Flint', 'Zephyr'],
};

export function createBot(id, team, index, spawn, rng) {
  const names = BOT_NAMES[team];
  return {
    id,
    team,
    name: names[index % names.length],
    isPlayer: false,
    alive: true,
    health: 100,
    x: spawn[0],
    z: spawn[1],
    yaw: team === 'attackers' ? Math.PI * 0.25 : -Math.PI * 0.75,
    speed: 0,
    crouched: false,
    path: [],
    pathIndex: 0,
    state: team === 'attackers' ? 'push' : 'hold',
    holdSpot: null,
    target: null,
    lastSeen: null,
    heardAt: null,
    heardUntil: 0,
    role: 'rifle',
    hasCharge: false,
    walkPhase: rng.range(0, Math.PI * 2),
    burstLeft: 0,
    nextShotAt: 0,
    nextBurstAt: 0,
    fireCooldown: 0,
    reloadUntil: 0,
    blindUntil: 0,
    plantProgress: 0,
    defuseProgress: 0,
    weapon: 'longhorn',
    mag: WEAPONS.longhorn.mag,
    reserve: WEAPONS.longhorn.reserve,
    money: 800,
    strafeDir: 1,
    strafeUntil: 0,
    group: null,
  };
}

// Give every bot its opening job when a round starts. Bots run the same
// economy as the player in miniature: they keep last round's winnings and
// buy the best rifle they can afford, falling back to the SMG, the shotgun
// or the free pistol.
export function assignRoundJobs(bots, round, rng) {
  const attackers = bots.filter((b) => b.team === 'attackers' && b.alive);
  const defenders = bots.filter((b) => b.team === 'defenders' && b.alive);
  for (const bot of bots) {
    if (!bot.alive) continue;
    const won = bot.lastRoundWon;
    bot.money = (bot.money || 800) + (won === undefined ? 0 : won ? 3250 : 1900);
    bot.lastRoundWon = undefined;
    const pick = bot.money >= WEAPONS.rattler.price && rng.chance(0.25) ? 'rattler'
      : bot.money >= WEAPONS.longhorn.price ? 'longhorn'
      : bot.money >= WEAPONS.boomer.price && rng.chance(0.3) ? 'boomer'
      : bot.money >= WEAPONS.sidewinder.price ? 'sidewinder' : 'duster';
    if (pick !== bot.weapon) {
      bot.money -= WEAPONS[pick].price;
      bot.weapon = pick;
    }
    bot.mag = WEAPONS[pick].mag;
    bot.reserve = WEAPONS[pick].reserve;
  }
  // One attacker carries the charge, so the round always has a planter
  // even if the player camps the spawn.
  const carrier = rng.pick(attackers);
  if (carrier) carrier.hasCharge = true;
  const site = rng.chance(0.5) ? 'A' : 'B';
  for (const bot of attackers) {
    bot.targetSite = bot.hasCharge ? site : rng.chance(0.6) ? site : site === 'A' ? 'B' : 'A';
    bot.state = 'push';
    bot.path = [];
    bot.pathIndex = 0;
    bot.plantProgress = 0;
  }
  for (let i = 0; i < defenders.length; i++) {
    const spot = HOLD_SPOTS[i % HOLD_SPOTS.length];
    defenders[i].holdSpot = spot;
    defenders[i].state = 'hold';
    defenders[i].path = [];
    defenders[i].pathIndex = 0;
    defenders[i].defuseProgress = 0;
  }
}

// Every living enemy this bot can see, nearest first.
function visibleEnemies(bot, fighters, world) {
  const out = [];
  for (const other of fighters) {
    if (other === bot || !other.alive || other.team === bot.team) continue;
    const dx = other.x - bot.x;
    const dz = other.z - bot.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 48) continue;
    if (!hasLineOfSight(bot.x, bot.z, other.x, other.z, world.colliders, world.circles)) continue;
    out.push({ enemy: other, dist });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

// One bot shot at a visible target. Aim error grows with distance and
// with the target's speed; crouching targets are harder to hit. This is a
// hit chance, not a raycast: the bot's bullets are tracers to a point near
// the target, so a miss still reads as a miss on screen.
function botShoot(bot, target, dist, world) {
  const weapon = WEAPONS[bot.weapon];
  const now = world.time;
  if (now < bot.nextShotAt || now < bot.reloadUntil) return;
  if (bot.mag <= 0) {
    bot.reloadUntil = now + weapon.reloadMs / 1000;
    bot.mag = weapon.mag;
    return;
  }
  const targetSpeed = target.speed || 0;
  let chance = 0.62 - dist * 0.008 - targetSpeed * 0.05;
  if (target.crouched) chance -= 0.08;
  if (bot.blindUntil > now) chance = 0;
  const hit = world.rng.chance(Math.max(0.05, chance));
  const head = hit && world.rng.chance(0.12);
  const damage = hit ? damageAt(weapon, dist, head) : 0;
  const spread = 0.25 + dist * 0.01;
  const missX = target.x + world.rng.normal() * spread * 2;
  const missZ = target.z + world.rng.normal() * spread * 2;
  const end = hit ? { x: target.x, y: EYE_HEIGHT - 0.25, z: target.z } : { x: missX, y: 1.2, z: missZ };
  world.fx.tracer(bot.x, EYE_HEIGHT - 0.15, bot.z, end.x, end.y, end.z, bot.team);
  world.fx.shot(bot.x, bot.z, weapon.kind);
  bot.mag -= 1;
  bot.nextShotAt = now + weapon.fireMs / 1000;
  bot.burstLeft -= 1;
  if (hit) world.damageFighter(target, damage, head, bot);
  world.noise(bot.x, bot.z, 26);
}

// Walk toward the next waypoint on the bot's path. Returns true when the
// path is finished.
function walkAlongPath(bot, dt, world, speed) {
  if (bot.pathIndex >= bot.path.length) return true;
  const [tx, tz] = bot.path[bot.pathIndex];
  const dx = tx - bot.x;
  const dz = tz - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.6) {
    bot.pathIndex += 1;
    return bot.pathIndex >= bot.path.length;
  }
  const step = Math.min(dist, speed * dt);
  const nx = bot.x + (dx / dist) * step;
  const nz = bot.z + (dz / dist) * step;
  const [rx, rz] = resolveCollision(nx, nz, BODY_RADIUS, world.colliders, world.circles);
  bot.speed = speed;
  bot.x = rx;
  bot.z = rz;
  bot.yaw = Math.atan2(dx, dz);
  bot.walkPhase += dt * speed * 2.2;
  return false;
}

function routeTo(bot, waypointId, world) {
  const from = nearestWaypoint(bot.x, bot.z);
  const path = findPath(from, waypointId);
  bot.path = path;
  bot.pathIndex = 0;
}

export function updateBot(bot, dt, world) {
  if (!bot.alive) return;
  const now = world.time;
  const blind = bot.blindUntil > now;

  // --- Perception: nearest visible enemy, or the last heard gunfire.
  const seen = blind ? [] : visibleEnemies(bot, world.fighters, world);
  if (seen.length > 0) {
    bot.target = seen[0].enemy;
    bot.lastSeen = { x: seen[0].enemy.x, z: seen[0].enemy.z, at: now };
  } else if (bot.lastSeen && now - bot.lastSeen.at > 4) {
    bot.target = null;
  }

  // --- Combat: burst fire at the target, strafing while engaged.
  if (bot.target && bot.target.alive && !blind) {
    const t = bot.target;
    const dx = t.x - bot.x;
    const dz = t.z - bot.z;
    const dist = Math.hypot(dx, dz);
    bot.yaw = Math.atan2(dx, dz);
    if (now > bot.strafeUntil) {
      bot.strafeDir = world.rng.chance(0.5) ? 1 : -1;
      bot.strafeUntil = now + world.rng.range(0.5, 1.2);
    }
    const strafe = bot.strafeDir * 1.4 * dt;
    const px = -Math.sin(bot.yaw + Math.PI / 2) * strafe;
    const pz = -Math.cos(bot.yaw + Math.PI / 2) * strafe;
    const [rx, rz] = resolveCollision(bot.x + px, bot.z + pz, BODY_RADIUS, world.colliders, world.circles);
    bot.x = rx;
    bot.z = rz;
    bot.speed = 1.4;
    if (bot.burstLeft <= 0 && now >= bot.nextBurstAt) {
      bot.burstLeft = 2 + Math.floor(world.rng.next() * 3);
      bot.nextBurstAt = now + world.rng.range(0.9, 1.8);
    }
    if (bot.burstLeft > 0) botShoot(bot, t, dist, world);
  } else {
    bot.speed = 0;
    bot.burstLeft = 0;
  }

  // --- Objective movement, when not fighting.
  if (!bot.target) {
    if (bot.team === 'attackers') {
      if (world.roundPhase === 'planted') {
        // Hold near the planted site.
        if (bot.state !== 'guard') {
          bot.state = 'guard';
          routeTo(bot, world.plantedSite === 'A' ? 'siteA' : 'siteB', world);
        }
        walkAlongPath(bot, dt, world, 3.4);
      } else if (bot.hasCharge && bot.state === 'push') {
        const siteWp = bot.targetSite === 'A' ? 'siteA' : 'siteB';
        if (bot.path.length === 0) routeTo(bot, siteWp, world);
        const arrived = walkAlongPath(bot, dt, world, 3.6);
        if (arrived) {
          bot.state = 'plant';
          bot.plantProgress = 0;
        }
      } else if (bot.state === 'plant') {
        // Planting: stand still on the site for 4 seconds.
        const site = world.sites[bot.targetSite];
        const inSite = Math.hypot(bot.x - site.center[0], bot.z - site.center[1]) <= site.radius;
        if (inSite) {
          bot.plantProgress += dt;
          if (Math.floor(bot.plantProgress * 2) !== Math.floor((bot.plantProgress - dt) * 2)) world.fx.beep(bot.x, bot.z, 'plant');
          if (bot.plantProgress >= 4) {
            bot.state = 'guard';
            world.plantCharge(bot);
          }
        } else {
          routeTo(bot, bot.targetSite === 'A' ? 'siteA' : 'siteB', world);
          bot.state = 'push';
        }
      } else {
        if (bot.path.length === 0) {
          const siteWp = bot.targetSite === 'A' ? 'siteA' : 'siteB';
          routeTo(bot, siteWp, world);
        }
        walkAlongPath(bot, dt, world, 3.4);
      }
    } else {
      // Defenders.
      if (world.roundPhase === 'planted') {
        if (bot.state !== 'retake') {
          bot.state = 'retake';
          routeTo(bot, world.plantedSite === 'A' ? 'siteA' : 'siteB', world);
        }
        const site = world.sites[world.plantedSite];
        const inSite = Math.hypot(bot.x - site.center[0], bot.z - site.center[1]) <= site.radius;
        const arrived = walkAlongPath(bot, dt, world, 4.2);
        if ((arrived || inSite) && !blind) {
          const enemiesNear = visibleEnemies(bot, world.fighters, world).length;
          if (enemiesNear === 0) {
            bot.defuseProgress += dt;
            if (Math.floor(bot.defuseProgress * 2) !== Math.floor((bot.defuseProgress - dt) * 2)) world.fx.beep(bot.x, bot.z, 'defuse');
            if (bot.defuseProgress >= 5) world.defuseCharge(bot);
          } else {
            bot.defuseProgress = 0;
          }
        }
      } else if (bot.state === 'hold' && bot.holdSpot) {
        const [hx, hz] = WAYPOINTS[bot.holdSpot.at];
        const d = Math.hypot(hx - bot.x, hz - bot.z);
        if (d > 1.2) {
          if (bot.path.length === 0) routeTo(bot, bot.holdSpot.at, world);
          walkAlongPath(bot, dt, world, 3.2);
        } else {
          // Hold: slow scan across the lane.
          bot.yaw = bot.holdSpot.yaw + Math.sin(now * 0.4 + bot.walkPhase) * 0.5;
          bot.speed = 0;
        }
      } else if (bot.heardAt && now < bot.heardUntil) {
        // Investigate a heard shot: walk to the nearest waypoint, then stop.
        if (bot.path.length === 0) {
          const wp = nearestWaypoint(bot.heardAt.x, bot.heardAt.z);
          routeTo(bot, wp, world);
        }
        const done = walkAlongPath(bot, dt, world, 3.8);
        if (done) {
          bot.heardAt = null;
          bot.path = [];
          bot.state = 'hold';
        }
      }
    }
  }

  // Hearing: a noise event pulls idle defenders toward it.
  if (world.noiseEvents) {
    for (const n of world.noiseEvents) {
      if (bot.team !== 'defenders' || bot.target) continue;
      const d = Math.hypot(n.x - bot.x, n.z - bot.z);
      if (d < 26 && bot.state === 'hold') {
        bot.heardAt = { x: n.x, z: n.z };
        bot.heardUntil = now + 5;
        bot.path = [];
      }
    }
  }
}
