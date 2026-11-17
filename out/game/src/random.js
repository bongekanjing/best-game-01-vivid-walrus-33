// A small, seedable random source. Every random draw in Wickfall comes from here, never from
// Math.random, so a seed always produces the same waves, the same boon offers and the same run.

/** mulberry32: 32 bits of state, one multiply-xor-shift round per draw, plenty for a game. */
export function createRandom(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** A float in [min, max). */
    range: (min, max) => min + next() * (max - min),
    /** An integer in [min, max]. */
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    /** True with probability p. */
    chance: (p) => next() < p,
    /** One element of a non-empty array. */
    pick: (items) => items[Math.floor(next() * items.length)],
    /** A shuffle that leaves the input alone. */
    shuffle(items) {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const swap = copy[i];
        copy[i] = copy[j];
        copy[j] = swap;
      }
      return copy;
    },
    /** A unit vector, used for spawn rings and stray sparks. */
    direction() {
      const angle = next() * Math.PI * 2;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    },
  };
}
