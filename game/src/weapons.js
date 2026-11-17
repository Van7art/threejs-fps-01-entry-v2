// Weapon catalogue and the shared ballistics math.
// Every gun is hitscan: one ray, distance falloff, headshot multiplier, and a
// spread cone that grows while moving, firing, or firing from the hip.
export const WEAPONS = {
  duster: {
    key: 'duster', name: 'Duster', slot: 1, kind: 'pistol', price: 0,
    damage: 34, headMult: 3.0, range: 42, falloffStart: 14, falloffEnd: 42,
    fireInterval: 0.16, auto: false, mag: 12, reserve: 36, reloadTime: 1.5,
    spreadBase: 0.011, spreadMove: 0.02, spreadAir: 0.035, spreadShot: 0.012,
    spreadMax: 0.075, recoil: 0.011, recoilRecover: 0.09, zoom: 1.25,
    tracer: 0xffd27a, sound: 'pistol',
  },
  sidewinder: {
    key: 'sidewinder', name: 'Sidewinder', slot: 2, kind: 'smg', price: 1500,
    damage: 26, headMult: 2.6, range: 38, falloffStart: 11, falloffEnd: 38,
    fireInterval: 0.085, auto: true, mag: 30, reserve: 90, reloadTime: 1.9,
    spreadBase: 0.016, spreadMove: 0.024, spreadAir: 0.04, spreadShot: 0.01,
    spreadMax: 0.09, recoil: 0.008, recoilRecover: 0.11, zoom: 1.3,
    tracer: 0xffe08a, sound: 'smg',
  },
  boomer: {
    key: 'boomer', name: 'Boomer', slot: 3, kind: 'shotgun', price: 1700,
    damage: 13, headMult: 2.0, range: 26, falloffStart: 7, falloffEnd: 26,
    pellets: 8, fireInterval: 0.85, auto: false, mag: 6, reserve: 24, reloadTime: 2.6,
    spreadBase: 0.05, spreadMove: 0.02, spreadAir: 0.04, spreadShot: 0.02,
    spreadMax: 0.12, recoil: 0.045, recoilRecover: 0.05, zoom: 1.15,
    tracer: 0xffb36a, sound: 'shotgun',
  },
  longhorn: {
    key: 'longhorn', name: 'Longhorn', slot: 4, kind: 'rifle', price: 2700,
    damage: 33, headMult: 3.2, range: 60, falloffStart: 18, falloffEnd: 60,
    fireInterval: 0.1, auto: true, mag: 25, reserve: 75, reloadTime: 2.2,
    spreadBase: 0.009, spreadMove: 0.022, spreadAir: 0.038, spreadShot: 0.009,
    spreadMax: 0.08, recoil: 0.013, recoilRecover: 0.1, zoom: 1.6,
    tracer: 0xfff0a0, sound: 'rifle',
  },
  rattler: {
    key: 'rattler', name: 'Rattler', slot: 5, kind: 'dmr', price: 3100,
    damage: 62, headMult: 3.4, range: 80, falloffStart: 24, falloffEnd: 80,
    fireInterval: 0.42, auto: false, mag: 10, reserve: 30, reloadTime: 2.5,
    spreadBase: 0.004, spreadMove: 0.02, spreadAir: 0.035, spreadShot: 0.008,
    spreadMax: 0.06, recoil: 0.026, recoilRecover: 0.07, zoom: 2.1,
    tracer: 0xd8f0ff, sound: 'dmr',
  },
};

export const THROWABLES = {
  sandcharge: { key: 'sandcharge', name: 'Sandcharge HE', slot: 6, price: 300, radius: 6.5, damage: 95, fuse: 1.6 },
  flashpot: { key: 'flashpot', name: 'Flashpot', slot: 7, price: 200, radius: 11, fuse: 1.4 },
};

export const BUY_LIST = [
  { key: 'sidewinder', label: 'Sidewinder SMG', price: 1500 },
  { key: 'boomer', label: 'Boomer Shotgun', price: 1700 },
  { key: 'longhorn', label: 'Longhorn Rifle', price: 2700 },
  { key: 'rattler', label: 'Rattler DMR', price: 3100 },
  { key: 'sandcharge', label: 'Sandcharge HE grenade', price: 300 },
  { key: 'flashpot', label: 'Flashpot flash grenade', price: 200 },
  { key: 'armor', label: 'Kevlar vest (+50 armor)', price: 650 },
];

// Damage after distance falloff: full until falloffStart, then linear down to
// 45% at falloffEnd and beyond.
export function falloffDamage(def, dist) {
  if (dist <= def.falloffStart) return def.damage;
  const t = Math.min(1, (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart));
  return def.damage * (1 - 0.55 * t);
}

// Current spread angle (radians) for a shooter in a given state.
export function currentSpread(def, moving, airborne, ads, bloom) {
  let s = def.spreadBase + bloom;
  if (moving) s += def.spreadMove;
  if (airborne) s += def.spreadAir;
  if (ads) s *= 0.55;
  return Math.min(s, def.spreadMax);
}

// Ray vs sphere, used for head and body hit tests. Returns the ray distance
// or -1 when the ray misses. Writes nothing; all temporaries are caller's.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

// Ray vs axis-aligned box (slab test). Returns distance or -1.
export function rayBox(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let tmin = 0, tmax = 1e9;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [minX, minY, minZ], mx = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let a = (mn[i] - o[i]) / d[i];
      let b = (mx[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > tmin) tmin = a;
      if (b < tmax) tmax = b;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}
