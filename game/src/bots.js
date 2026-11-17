// Bot brains: waypoint walkers that pick a site, hold, rotate, plant, defuse,
// and shoot back in bursts. Each bot re-thinks on a staggered timer so the
// eight of them never all decide on the same tick.
import { NODES, nearestNode, findPath, SITES } from './map.js';
import { canSee, eyeY } from './actors.js';

const HOLD_SPOTS = {
  A: [16, -8, 22, -2, 11, -13],
  B: [16, 8, 22, 2, 11, 13],
};

export function assignBot(bot, rng, roundNo) {
  bot.site = rng.chance(0.5) ? 'A' : 'B';
  bot.mode = 'advance';
  bot.path = [];
  bot.pathIdx = 0;
  bot.targetId = -1;
  bot.burstLeft = 0;
  bot.burstWait = 0;
  bot.thinkAt = rng.range(0, 0.4);
  bot.holdUntil = 0;
  bot.investigateUntil = 0;
  bot.holdSpot = null;
}

// Pick a destination node id for the bot's current job.
function destinationNode(f, match) {
  const b = f.bot;
  if (match.planted) {
    // everyone converges on the planted site
    return match.plantSite === 'A' ? 24 : 25;
  }
  if (f.team === 'attack') {
    if (b.mode === 'plant' || b.mode === 'advance') return b.site === 'A' ? 24 : 25;
    return nearestNode(f.x, f.z);
  }
  // defenders: hold near their site, or rotate to the planted one
  if (b.mode === 'defuse') return match.plantSite === 'A' ? 24 : 25;
  if (b.mode === 'rotate') return b.site === 'A' ? 24 : 25;
  if (b.holdSpot) return b.holdSpot;
  return nearestNode(f.x, f.z);
}

export function updateBot(f, match, fighters, adj, rng, dt, now) {
  const b = f.bot;
  if (!f.alive) return { wishX: 0, wishZ: 0, jump: false, fire: false, plant: false, defuse: false };
  const out = { wishX: 0, wishZ: 0, jump: false, fire: false, plant: false, defuse: false };

  // --- periodic re-think -------------------------------------------------
  if (now >= b.thinkAt) {
    b.thinkAt = now + 0.35 + rng.range(0, 0.25);
    // choose a hold spot if defending and idle
    if (f.team === 'defend' && !match.planted && b.mode !== 'defuse') {
      const spots = HOLD_SPOTS[b.site];
      const idx = Math.floor(rng.next() * (spots.length / 2)) * 2;
      b.holdSpot = nearestNode(spots[idx], spots[idx + 1]);
      if (rng.chance(0.25)) b.site = b.site === 'A' ? 'B' : 'A';
    }
    // path to the current destination
    const dest = destinationNode(f, match);
    const cur = nearestNode(f.x, f.z);
    if (b.path.length === 0 || b.path[b.path.length - 1] !== dest || now > b.holdUntil + 6) {
      b.path = findPath(adj, cur, dest);
      b.pathIdx = 0;
    }
    // plant / defuse intent
    if (f.team === 'attack' && match.chargeCarrier === f && !match.planted) {
      const site = SITES[b.site];
      const d = Math.hypot(f.x - site.cx, f.z - site.cz);
      if (d < site.r) { b.mode = 'plant'; }
    }
    if (f.team === 'defend' && match.planted) {
      b.mode = 'defuse';
      b.site = match.plantSite;
    }
  }

  // --- acquire a target --------------------------------------------------
  let best = null, bestScore = Infinity;
  for (const other of fighters) {
    if (!other.alive || other.team === f.team) continue;
    const dx = other.x - f.x, dz = other.z - f.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 46) continue;
    if (!canSee(f, other)) continue;
    const score = dist + (other.isPlayer ? -2 : 0);
    if (score < bestScore) { bestScore = score; best = other; }
  }
  if (best) {
    b.targetId = best.id;
    const dx = best.x - f.x, dz = best.z - f.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    b.aimYaw = Math.atan2(-dx, -dz);
    const dy = (best.y + 1.15) - eyeY(f);
    b.aimPitch = Math.atan2(dy, dist);
    // aim error shrinks with stillness and grows with target speed
    const targetSpeed = Math.hypot(best.vx, best.vz);
    const err = 0.028 + dist * 0.0011 + targetSpeed * 0.006 + (f.moving ? 0.03 : 0);
    const yawErr = rng.gauss() * err;
    const pitchErr = rng.gauss() * err * 0.7;
    f.yaw += (b.aimYaw + yawErr - f.yaw) * Math.min(1, 9 * dt);
    f.pitch += (b.aimPitch + pitchErr - f.pitch) * Math.min(1, 9 * dt);
    // burst fire
    if (b.burstLeft <= 0) {
      if (b.burstWait <= 0) {
        b.burstLeft = 2 + Math.floor(rng.next() * 3);
        b.burstWait = rng.range(0.5, 1.4);
      } else {
        b.burstWait -= dt;
      }
    } else if (f.fireCooldown <= 0 && f.reloading <= 0) {
      out.fire = true;
      b.burstLeft -= 1;
      if (b.burstLeft <= 0) b.burstWait = rng.range(0.6, 1.5);
    }
  } else {
    b.targetId = -1;
    // scan: slow sweep while walking
    f.yaw += Math.sin(now * 0.5 + f.id) * 0.12 * dt;
  }

  // --- movement along the path -------------------------------------------
  const site = SITES[b.site];
  const atSite = Math.hypot(f.x - site.cx, f.z - site.cz) < site.r;
  if (b.mode === 'plant' && f.team === 'attack' && atSite && match.chargeCarrier === f && !match.planted) {
    out.plant = true;
    out.wishX = 0; out.wishZ = 0;
    return out;
  }
  if (b.mode === 'defuse' && f.team === 'defend' && match.planted) {
    const ps = SITES[match.plantSite];
    const d = Math.hypot(f.x - ps.cx, f.z - ps.cz);
    if (d < ps.r) {
      out.defuse = true;
      out.wishX = 0; out.wishZ = 0;
      return out;
    }
  }
  // investigate a heard gunshot
  if (now < b.investigateUntil && !best) {
    const dx = b.investigateX - f.x, dz = b.investigateZ - f.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.2) {
      out.wishX = dx / d; out.wishZ = dz / d;
      f.yaw += (Math.atan2(-dx, -dz) - f.yaw) * Math.min(1, 6 * dt);
      return out;
    }
  }
  if (b.path.length > 0 && b.pathIdx < b.path.length) {
    const node = NODES[b.path[b.pathIdx]];
    const dx = node[0] - f.x, dz = node[1] - f.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) {
      b.pathIdx += 1;
    } else {
      const speed = best ? 0.45 : 1; // strafe-slow while engaging
      out.wishX = (dx / d) * speed;
      out.wishZ = (dz / d) * speed;
      if (!best) {
        f.yaw += (Math.atan2(-dx, -dz) - f.yaw) * Math.min(1, 5 * dt);
      }
    }
  } else if (f.team === 'defend' && !match.planted) {
    // hold: face the likely approach lane
    const faceYaw = b.site === 'A' ? Math.PI * 0.75 : Math.PI * 0.25;
    f.yaw += (faceYaw - f.yaw) * Math.min(1, 2 * dt);
  }
  return out;
}

// A gunshot within earshot pulls nearby bots toward the noise until `until`.
export function hearShot(fighters, shooter, radius, until) {
  for (const f of fighters) {
    if (!f.alive || f.isPlayer || f === shooter || f.team === shooter.team) continue;
    const d = Math.hypot(f.x - shooter.x, f.z - shooter.z);
    if (d < radius) {
      f.bot.investigateX = shooter.x;
      f.bot.investigateZ = shooter.z;
      f.bot.investigateUntil = until;
    }
  }
}
