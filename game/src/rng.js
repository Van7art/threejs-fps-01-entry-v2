// Seeded random numbers for Sunscorch Yard.
//
// One seeded generator drives the whole match — bot choices, routes, aim
// error — so a match started with the same seed plays out the same way.
// The generator is a small mulberry32 PRNG; nothing here touches
// Math.random, so screenshots staged with ?seed=1 are reproducible.

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    // Uniform float in [min, max).
    range(min, max) {
      return min + (max - min) * next();
    },
    // Uniform integer in [min, max].
    int(min, max) {
      return Math.floor(min + (max - min + 1) * next());
    },
    // A random element of a non-empty list.
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    // True with probability p.
    chance(p) {
      return next() < p;
    },
    // Roughly normal in [-1, 1]: the average of three uniforms, rescaled.
    // Used for spread and aim error, where a bell shape reads better than
    // a flat one.
    normal() {
      return (next() + next() + next() - 1.5) / 1.5;
    },
  };
}
