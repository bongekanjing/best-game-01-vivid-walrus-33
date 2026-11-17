// Every tunable number in Wickfall lives here, so the feel of the game can be adjusted in one
// place instead of being hunted through the simulation. Distances are logical pixels of the
// fixed 1280x720 field; every time below is in seconds.

/** The logical field: positions, radii and speeds are all measured in it. */
export const VIEW = { width: 1280, height: 720 };

/** The arena the fight happens inside, inset from the view so the frame reads as a stage. */
export const ARENA = { x: 46, y: 46, width: VIEW.width - 92, height: VIEW.height - 92 };

/** Fixed simulation step. The loop only ever advances whole steps, so a run is reproducible. */
export const STEP = 1 / 60;

/** One warm accent on a cold ground: the whole art direction in a dozen colours. */
export const PALETTE = {
  nightDeep: '#05070f',
  night: '#0a0f1e',
  dusk: '#131b31',
  ridge: '#1d2942',
  ember: '#ffb54a',
  flame: '#ff7a3d',
  wick: '#ffe6a8',
  bone: '#e9eff9',
  ash: '#8b96ad',
  moth: '#7de2d1',
  mothDeep: '#2f8f86',
  blood: '#ff4d6d',
  bloom: '#c8a2ff',
  rot: '#9ad46b',
};

/** The player, a wickkeeper carrying the last flame. */
export const PLAYER = {
  radius: 16,
  speed: 258,
  accel: 2600,
  friction: 13,
  maxHp: 3,
  invuln: 1.15,
  dashSpeed: 760,
  dashTime: 0.16,
  dashCooldown: 1.5,
  dashIframes: 0.24,
  hitPush: 250,
  contactGrace: 0.45,
};

/** The starting spark thrower. Boons multiply these numbers. */
export const WEAPON = {
  cooldown: 0.15,
  damage: 1,
  speed: 720,
  life: 0.72,
  radius: 6,
  spread: 0.05,
  muzzle: 17,
  pierce: 0,
  shots: 1,
};

/** Bloom: the pulse that burns the ring around the keeper once the meter fills. */
export const BLOOM = {
  chargeNeeded: 8,
  radius: 238,
  damage: 4,
  push: 540,
  duration: 0.45,
  cooldown: 0.6,
};

/** Motes are the fuel: they drift to the keeper and fill the bloom meter. */
export const MOTE = {
  radius: 7,
  magnet: 155,
  pull: 940,
  life: 15,
  drift: 30,
  value: 2,
};

/** Ten waves, a warden at the fifth and the tenth, with a short breather between them. */
export const WAVE = {
  total: 10,
  firstDelay: 1.3,
  breather: 2.0,
  spawnGap: 0.22,
  bossWaves: [5, 10],
};

/** Scoring: everything the keeper does is worth something, so the HUD always moves. */
export const SCORE = {
  perKill: 12,
  perWave: 90,
  bossKill: 400,
  survivalPerSecond: 1,
  comboWindow: 2.6,
  comboStep: 0.12,
  comboMax: 3,
};
