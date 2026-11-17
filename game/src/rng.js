// Seeded random stream used by the whole match so a seed replays the same yard.
// Mulberry32: small, fast, and deterministic across browsers.
export function makeStream(seed) {
  let s = (seed >>> 0) || 1;
  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range(lo, hi) { return lo + (hi - lo) * next(); },
    pick(list) { return list[Math.floor(next() * list.length) % list.length]; },
    int(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); },
    chance(p) { return next() < p; },
    // Box-Muller pair, cached second value so calls stay cheap.
    gauss() {
      const u = Math.max(next(), 1e-9);
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}

// Tiny hash of a string into a 32-bit seed, for named seeds.
export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
