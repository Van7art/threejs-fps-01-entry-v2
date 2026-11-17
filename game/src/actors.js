// Fighters: the local player and the eight bots share one entity shape.
// Movement is acceleration based with crouch, jump and per-frame collision;
// shooting is resolved here against hit spheres so the renderer stays dumb.
import { WEAPONS, THROWABLES, falloffDamage, currentSpread, raySphere, rayBox } from './weapons.js';
import { collideCircle, inHazard, SOLIDS, sightBlocked } from './map.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
export const BODY_R = 0.42;

let nextId = 1;

export function makeFighter(team, name, isPlayer, x, z) {
  return {
    id: nextId++,
    team, name, isPlayer,
    x, z, y: 0, vx: 0, vz: 0, vy: 0,
    yaw: team === 'attack' ? -Math.PI / 2 : Math.PI / 2, // face the other side
    pitch: 0,
    hp: 100, armor: 0, alive: true,
    crouch: false, airborne: false, onGround: true,
    weapon: 'duster', mag: WEAPONS.duster.mag, reserve: WEAPONS.duster.reserve,
    reloading: 0, fireCooldown: 0, bloom: 0, recoilPitch: 0,
    ads: false, moving: false,
    cash: 800, kills: 0, deaths: 0,
    owned: isPlayer ? ['duster'] : [],
    he: 0, flash: 0,
    flashTime: 0, // seconds of blindness remaining
    plantProgress: 0, defuseProgress: 0,
    lastShotAt: -99, lastHurtAt: -99,
    // bot brain state lives here so the sim owns it all
    bot: isPlayer ? null : {
      mode: 'advance', node: -1, path: [], pathIdx: 0,
      holdUntil: 0, targetId: -1, aimYaw: 0, aimPitch: 0,
      burstLeft: 0, burstWait: 0, thinkAt: 0, site: 'A',
      investigateX: 0, investigateZ: 0, investigateUntil: 0,
    },
  };
}

export function giveWeapon(f, key) {
  const def = WEAPONS[key];
  if (!def) return false;
  f.weapon = key;
  f.mag = def.mag;
  f.reserve = def.reserve;
  f.reloading = 0;
  f.fireCooldown = 0;
  f.bloom = 0;
  return true;
}

export function walkSpeed(f) {
  let s = f.crouch ? 2.1 : 4.4;
  if (f.ads) s *= 0.55;
  if (inHazard(f.x, f.z)) s *= 0.8;
  return s;
}

// Integrate one fixed step of movement from a wish direction (world XZ,
// already normalised) plus jump request. No allocations.
export function stepMove(f, wishX, wishZ, wantJump, dt) {
  if (!f.alive) return;
  const target = walkSpeed(f);
  const accel = f.onGround ? 34 : 10;
  const wvx = wishX * target, wvz = wishZ * target;
  f.vx += (wvx - f.vx) * Math.min(1, accel * dt / target * 4.4);
  f.vz += (wvz - f.vz) * Math.min(1, accel * dt / target * 4.4);
  // clamp horizontal speed
  const sp = Math.hypot(f.vx, f.vz);
  if (sp > target * 1.15) {
    const k = target * 1.15 / sp;
    f.vx *= k; f.vz *= k;
  }
  const nx = f.x + f.vx * dt;
  const nz = f.z + f.vz * dt;
  const res = collideCircle(nx, nz, BODY_R);
  f.x = res.x; f.z = res.z;
  if (res.hit) { f.vx *= 0.4; f.vz *= 0.4; }
  f.moving = sp > 0.6;
  // vertical: simple gravity + ground at y=0
  if (wantJump && f.onGround) { f.vy = 5.2; f.onGround = false; }
  if (!f.onGround) {
    f.vy -= 14.5 * dt;
    f.y += f.vy * dt;
    if (f.y <= 0) { f.y = 0; f.vy = 0; f.onGround = true; }
  }
  f.airborne = !f.onGround;
  // recoil and bloom recover
  f.recoilPitch *= Math.max(0, 1 - 6 * dt);
  f.bloom = Math.max(0, f.bloom - WEAPONS[f.weapon].recoilRecover * 4 * dt * 10 * 0.1);
  if (f.fireCooldown > 0) f.fireCooldown -= dt;
  if (f.reloading > 0) {
    f.reloading -= dt;
    if (f.reloading <= 0) {
      const def = WEAPONS[f.weapon];
      const need = def.mag - f.mag;
      const take = Math.min(need, f.reserve);
      f.mag += take;
      f.reserve -= take;
      f.reloading = 0;
    }
  }
  if (f.flashTime > 0) f.flashTime -= dt;
}

export function startReload(f) {
  const def = WEAPONS[f.weapon];
  if (f.reloading > 0 || f.mag >= def.mag || f.reserve <= 0) return false;
  f.reloading = def.reloadTime;
  return true;
}

export function eyeY(f) {
  return f.y + (f.crouch ? EYE_CROUCH : EYE_STAND);
}

// One hitscan trigger pull. Returns a shot record the caller turns into
// tracers, sounds and damage, or null when nothing fired.
export function tryFire(f, now, rng) {
  const def = WEAPONS[f.weapon];
  if (!f.alive || f.reloading > 0 || f.fireCooldown > 0) return null;
  if (f.mag <= 0) return { dry: true, shooter: f };
  f.fireCooldown = def.fireInterval;
  f.mag -= 1;
  f.bloom = Math.min(def.spreadMax, f.bloom + def.spreadShot);
  f.recoilPitch += def.recoil;
  f.lastShotAt = now;
  const spread = currentSpread(def, f.moving, f.airborne, f.ads, f.bloom);
  const pellets = def.pellets || 1;
  const dirs = [];
  for (let p = 0; p < pellets; p++) {
    const a = rng.gauss() * spread;
    const b = rng.gauss() * spread;
    // yaw/pitch offset around the aim direction
    const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
    const cp = Math.cos(f.pitch), sp = Math.sin(f.pitch);
    // forward vector
    let dx = -sy * cp, dy = sp, dz = -cy * cp;
    // right + up perturbation
    const rx = cy, rz = -sy;
    dx += rx * a + (-sy * sp) * b;
    dy += cp * b;
    dz += rz * a + (-cy * sp) * b;
    const il = 1 / Math.hypot(dx, dy, dz);
    dirs.push([dx * il, dy * il, dz * il]);
  }
  return { dry: false, shooter: f, def, dirs, now };
}

// Resolve one pellet ray against every living enemy and the map.
// Returns {victim, head, dist} or {dist} for a wall hit, or null beyond range.
export function resolvePellet(shooter, dir, fighters, maxDist) {
  const ox = shooter.x, oy = eyeY(shooter), oz = shooter.z;
  let bestDist = maxDist;
  let bestVictim = null, bestHead = false;
  for (const other of fighters) {
    if (!other.alive || other === shooter || other.team === shooter.team) continue;
    const headY = other.y + 1.52;
    const bodyY = other.y + 0.85;
    const th = raySphere(ox, oy, oz, dir[0], dir[1], dir[2], other.x, headY, other.z, 0.26);
    if (th > 0 && th < bestDist) { bestDist = th; bestVictim = other; bestHead = true; }
    const tb = raySphere(ox, oy, oz, dir[0], dir[1], dir[2], other.x, bodyY, other.z, 0.5);
    if (tb > 0 && tb < bestDist) { bestDist = tb; bestVictim = other; bestHead = false; }
  }
  // map boxes cut the ray short
  for (const s of SOLIDS) {
    const t = rayBox(ox, oy, oz, dir[0], dir[1], dir[2],
      s[0] - s[2], 0, s[1] - s[3], s[0] + s[2], s[4], s[1] + s[3]);
    if (t > 0 && t < bestDist) { bestDist = t; bestVictim = null; bestHead = false; }
  }
  if (bestDist >= maxDist) return null;
  return { victim: bestVictim, head: bestHead, dist: bestDist };
}

// Apply damage with armor soaking 50%. Returns true when the target died.
export function hurt(target, raw, now) {
  if (!target.alive) return false;
  let remaining = raw;
  if (target.armor > 0) {
    const soaked = Math.min(target.armor, raw * 0.5);
    target.armor -= soaked;
    remaining = raw - soaked;
  }
  target.hp -= remaining;
  target.lastHurtAt = now;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths += 1;
    return true;
  }
  return false;
}

// Grenade flight + fuse, shared by player and bots. The projectile is a
// plain object the match steps; detonation is resolved by the caller.
export function throwGrenade(f, kind, now) {
  if (kind === 'sandcharge' && f.he <= 0) return null;
  if (kind === 'flashpot' && f.flash <= 0) return null;
  if (kind === 'sandcharge') f.he -= 1; else f.flash -= 1;
  const def = THROWABLES[kind];
  const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
  const cp = Math.cos(f.pitch);
  return {
    kind, owner: f, x: f.x, y: eyeY(f), z: f.z,
    vx: -sy * cp * 13, vy: Math.sin(f.pitch) * 13 + 3.4, vz: -cy * cp * 13,
    fuse: def.fuse, def, thrownAt: now,
  };
}

export function stepGrenade(g, dt) {
  g.vy -= 13 * dt;
  let nx = g.x + g.vx * dt;
  let nz = g.z + g.vz * dt;
  let ny = g.y + g.vy * dt;
  const res = collideCircle(nx, nz, 0.18);
  if (res.hit) { g.vx *= -0.35; g.vz *= -0.35; nx = res.x; nz = res.z; }
  if (ny < 0.18) { ny = 0.18; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.7; g.vz *= 0.7; }
  g.x = nx; g.y = ny; g.z = nz;
  g.fuse -= dt;
  return g.fuse <= 0;
}

// Can A see B's chest? Cheap segment test against the solids.
export function canSee(a, b) {
  return !sightBlocked(a.x, eyeY(a), a.z, b.x, b.y + 1.1, b.z);
}
