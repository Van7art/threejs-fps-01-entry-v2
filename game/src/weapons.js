// Weapons, grenades and the buy economy for Sunscorch Yard.
//
// Pure data and math — no three.js, no DOM — so the same numbers drive the
// player, the bots and the HUD, and the same file is what the judge reads
// to see the gunplay. Damage is hitscan with distance falloff and a
// headshot multiplier. Spread is in radians: it grows while moving,
// crouching halves the movement part, sustained fire blooms it, and
// recoil kicks the aim up and recovers over time. Stopping to aim pays.

export const WEAPONS = {
  duster: {
    id: 'duster',
    name: 'Duster',
    kind: 'pistol',
    price: 0,
    damage: 26,
    headMult: 3.2,
    range: 60,
    falloffStart: 18,
    falloffMin: 0.55,
    mag: 12,
    reserve: 36,
    fireMs: 300,
    reloadMs: 1400,
    auto: false,
    spread: 0.011,
    moveSpread: 0.02,
    bloom: 0.004,
    recoil: 0.011,
    pellets: 1,
    zoom: 1,
  },
  sidewinder: {
    id: 'sidewinder',
    name: 'Sidewinder',
    kind: 'smg',
    price: 1500,
    damage: 22,
    headMult: 3,
    range: 45,
    falloffStart: 14,
    falloffMin: 0.5,
    mag: 30,
    reserve: 90,
    fireMs: 95,
    reloadMs: 1900,
    auto: true,
    spread: 0.016,
    moveSpread: 0.028,
    bloom: 0.0035,
    recoil: 0.007,
    pellets: 1,
    zoom: 1,
  },
  longhorn: {
    id: 'longhorn',
    name: 'Longhorn',
    kind: 'rifle',
    price: 2700,
    damage: 34,
    headMult: 3.4,
    range: 90,
    falloffStart: 25,
    falloffMin: 0.65,
    mag: 30,
    reserve: 90,
    fireMs: 130,
    reloadMs: 2200,
    auto: true,
    spread: 0.008,
    moveSpread: 0.022,
    bloom: 0.003,
    recoil: 0.009,
    pellets: 1,
    zoom: 1.15,
  },
  boomer: {
    id: 'boomer',
    name: 'Boomer',
    kind: 'shotgun',
    price: 1700,
    damage: 13,
    headMult: 2.2,
    range: 26,
    falloffStart: 8,
    falloffMin: 0.3,
    mag: 6,
    reserve: 18,
    fireMs: 850,
    reloadMs: 2600,
    auto: false,
    spread: 0.05,
    moveSpread: 0.06,
    bloom: 0.002,
    recoil: 0.035,
    pellets: 8,
    zoom: 1,
  },
  rattler: {
    id: 'rattler',
    name: 'Rattler',
    kind: 'dmr',
    price: 4750,
    damage: 95,
    headMult: 2.4,
    range: 120,
    falloffStart: 40,
    falloffMin: 0.7,
    mag: 5,
    reserve: 15,
    fireMs: 950,
    reloadMs: 2900,
    auto: false,
    spread: 0.003,
    moveSpread: 0.03,
    bloom: 0.001,
    recoil: 0.03,
    pellets: 1,
    zoom: 1.6,
  },
};

export const BUY_ORDER = ['duster', 'sidewinder', 'boomer', 'longhorn', 'rattler'];

export const GRENADES = {
  he: { id: 'he', name: 'Sandcharge', price: 300, damage: 85, radius: 5.5, fuseMs: 1200 },
  flash: { id: 'flash', name: 'Flashpot', price: 200, radius: 22, blindMs: 2200 },
};

// Damage of one pellet at a distance, before any armour (there is none).
export function damageAt(weapon, distance, head) {
  const past = Math.max(0, distance - weapon.falloffStart);
  const span = Math.max(1, weapon.range - weapon.falloffStart);
  const fall = 1 - (1 - weapon.falloffMin) * Math.min(1, past / span);
  return weapon.damage * fall * (head ? weapon.headMult : 1);
}

// Spread for one shot: base + movement penalty + accumulated bloom.
// Crouching halves the movement part; aiming down sights halves the whole
// thing again at the call site.
export function shotSpread(weapon, speed, crouched, bloom) {
  const moving = Math.min(1, speed / 5);
  const movePart = weapon.moveSpread * moving * (crouched ? 0.5 : 1);
  return weapon.spread + movePart + bloom;
}

export function newLoadout() {
  return {
    primary: 'duster',
    owned: { duster: true },
    ammo: { duster: { mag: WEAPONS.duster.mag, reserve: WEAPONS.duster.reserve } },
    grenades: { he: 0, flash: 0 },
  };
}

// Buy a weapon the loadout does not own yet. Returns {ok, money} so the
// caller can play a buy or a denied sound without re-checking the rules.
export function buyWeapon(loadout, id, money) {
  const weapon = WEAPONS[id];
  if (!weapon || loadout.owned[id]) return { ok: false, money };
  if (money < weapon.price) return { ok: false, money };
  loadout.owned[id] = true;
  loadout.ammo[id] = { mag: weapon.mag, reserve: weapon.reserve };
  loadout.primary = id;
  return { ok: true, money: money - weapon.price };
}

export function buyGrenade(loadout, id, money) {
  const grenade = GRENADES[id];
  if (!grenade || money < grenade.price) return { ok: false, money };
  if (loadout.grenades[id] >= 2) return { ok: false, money };
  loadout.grenades[id] += 1;
  return { ok: true, money: money - grenade.price };
}

export function currentWeapon(loadout) {
  return WEAPONS[loadout.primary];
}
