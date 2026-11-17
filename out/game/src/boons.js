// The boon deck. Between waves the keeper picks one of three cards; each card changes a number
// the simulation already reads, so a boon is data, never a special case in the fight. Every boon
// names the stat it moves, how much, and the words the card shows.

export const BOONS = [
  {
    id: 'quickwick',
    name: 'Quick Wick',
    blurb: 'The spark thrower fires a fifth faster.',
    detail: 'Fire rate +22%',
    stat: 'cooldown',
    factor: 0.78,
    tone: 'flame',
  },
  {
    id: 'hotcoal',
    name: 'Hot Coal',
    blurb: 'Each spark burns deeper.',
    detail: 'Damage +35%',
    stat: 'damage',
    factor: 1.35,
    tone: 'ember',
  },
  {
    id: 'farflick',
    name: 'Far Flick',
    blurb: 'Sparks travel further before dying out.',
    detail: 'Range +30%',
    stat: 'life',
    factor: 1.3,
    tone: 'wick',
  },
  {
    id: 'twinflame',
    name: 'Twin Flame',
    blurb: 'One spark becomes two, fanned apart.',
    detail: 'Shots +1',
    stat: 'shots',
    factor: 1,
    step: 1,
    max: 5,
    tone: 'flame',
  },
  {
    id: 'pierce',
    name: 'Sunskewer',
    blurb: 'Sparks punch through one more body.',
    detail: 'Pierce +1',
    stat: 'pierce',
    factor: 1,
    step: 1,
    max: 3,
    tone: 'bloom',
  },
  {
    id: 'bigspark',
    name: 'Heavy Spark',
    blurb: 'Sparks are fatter and hit more easily.',
    detail: 'Spark size +30%',
    stat: 'radius',
    factor: 1.3,
    tone: 'ember',
  },
  {
    id: 'swiftmoth',
    name: 'Swift Moth',
    blurb: 'The keeper moves quicker on the wing.',
    detail: 'Move speed +12%',
    stat: 'speed',
    factor: 1.12,
    tone: 'moth',
  },
  {
    id: 'longdash',
    name: 'Long Dash',
    blurb: 'The dash reaches further and recharges sooner.',
    detail: 'Dash -25% cooldown',
    stat: 'dashCooldown',
    factor: 0.75,
    tone: 'moth',
  },
  {
    id: 'emberheart',
    name: 'Ember Heart',
    blurb: 'One more heart to lose before the flame goes out.',
    detail: 'Max HP +1',
    stat: 'maxHp',
    factor: 1,
    step: 1,
    max: 6,
    heal: true,
    tone: 'blood',
  },
  {
    id: 'brightbloom',
    name: 'Bright Bloom',
    blurb: 'The bloom burns wider and fills with fewer motes.',
    detail: 'Bloom +1 size',
    stat: 'bloom',
    factor: 1.18,
    tone: 'bloom',
  },
  {
    id: 'magnet',
    name: 'Moth Hunger',
    blurb: 'Motes come to the keeper from further away.',
    detail: 'Mote pull +55%',
    stat: 'magnet',
    factor: 1.55,
    tone: 'moth',
  },
  {
    id: 'steadyhand',
    name: 'Steady Hand',
    blurb: 'Sparks fly almost dead straight.',
    detail: 'Spread -60%',
    stat: 'spread',
    factor: 0.4,
    tone: 'wick',
  },
];

const BY_ID = new Map(BOONS.map((boon) => [boon.id, boon]));

export function boonById(id) {
  return BY_ID.get(id) ?? null;
}

/** The stats a fresh run starts with, as a plain object the run copies and boons rewrite. */
export function baseStats() {
  return {
    cooldown: 1,
    damage: 1,
    life: 1,
    shots: 0,
    pierce: 0,
    radius: 1,
    speed: 1,
    dashCooldown: 1,
    maxHp: 0,
    bloom: 1,
    magnet: 1,
    spread: 1,
  };
}

/** Boons as they apply to one run: how many times each has been taken. */
export function countBoons(taken) {
  const counts = new Map();
  for (const id of taken) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

/** Whether a boon may be offered again: capped stats stop at their max. */
function boonAvailable(boon, taken) {
  if (!boon.max) return true;
  const times = taken.filter((id) => id === boon.id).length;
  return times < boon.max;
}

/**
 * Draw three distinct boons from the deck. `random` is the run's own source, so the offer is part
 * of the run's record and a seed replays it exactly.
 */
export function drawBoons(random, taken, count = 3) {
  const pool = BOONS.filter((boon) => boonAvailable(boon, taken));
  const shuffled = random.shuffle(pool);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
