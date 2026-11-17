// The bestiary. Each enemy is a plain recipe (hit points, radius, speed, behaviour) that the
// spawner and the simulation read; nothing here draws or mutates the world. Behaviours are named
// rather than coded here so the simulation keeps one switch over them.

import { PALETTE } from './config.js';

/**
 * Behaviour names, each handled once in world.js:
 *   chase    walks straight at the keeper
 *   drift    walks at the keeper with a slow sideways weave
 *   charge   winds up, then lunges in a straight line
 *   orbit    keeps its distance and spits sparks
 *   split    bursts into two smaller drifters when it dies
 *   warden   the wave boss: chases, stops to fire a ring of sparks, then charges
 */
export const BEHAVIOURS = ['chase', 'drift', 'charge', 'orbit', 'split', 'warden'];

export const ENEMIES = {
  wisp: {
    id: 'wisp',
    name: 'Ash Wisp',
    behaviour: 'chase',
    hp: 2,
    radius: 13,
    speed: 96,
    damage: 1,
    colour: '#c2ccdd',
    accent: PALETTE.bone,
    score: 12,
    motes: 1,
  },
  drifter: {
    id: 'drifter',
    name: 'Cinder Drifter',
    behaviour: 'drift',
    hp: 3,
    radius: 15,
    speed: 74,
    damage: 1,
    colour: '#8a6bd6',
    accent: PALETTE.ember,
    score: 14,
    motes: 1,
  },
  lunger: {
    id: 'lunger',
    name: 'Flare Lunger',
    behaviour: 'charge',
    hp: 4,
    radius: 16,
    speed: 66,
    damage: 2,
    colour: PALETTE.flame,
    accent: PALETTE.wick,
    score: 20,
    motes: 2,
  },
  spitter: {
    id: 'spitter',
    name: 'Rot Spitter',
    behaviour: 'orbit',
    hp: 3,
    radius: 15,
    speed: 88,
    damage: 1,
    colour: PALETTE.rot,
    accent: PALETTE.nightDeep,
    score: 22,
    motes: 2,
    spitCooldown: 2.1,
    spitSpeed: 250,
  },
  splitter: {
    id: 'splitter',
    name: 'Bloom Splitter',
    behaviour: 'split',
    hp: 5,
    radius: 21,
    speed: 58,
    damage: 1,
    colour: PALETTE.bloom,
    accent: PALETTE.bone,
    score: 26,
    motes: 2,
    children: 'shard',
  },
  shard: {
    id: 'shard',
    name: 'Shard',
    behaviour: 'drift',
    hp: 1,
    radius: 10,
    speed: 118,
    damage: 1,
    colour: PALETTE.bloom,
    accent: PALETTE.nightDeep,
    score: 6,
    motes: 1,
    noSummon: true,
  },
  warden: {
    id: 'warden',
    name: 'Warden of Embers',
    behaviour: 'warden',
    hp: 46,
    radius: 44,
    speed: 62,
    damage: 2,
    colour: PALETTE.ember,
    accent: PALETTE.flame,
    score: 400,
    motes: 10,
    boss: true,
    ringCooldown: 3.1,
    ringCount: 12,
    ringSpeed: 205,
    chargeCooldown: 5.4,
  },
};

/** The ten waves: which recipes may appear, how many spawn, and how tough they are. */
export const WAVES = [
  { index: 1, name: 'First Smoke', entries: ['wisp'], count: 11, hpScale: 1, speedScale: 1 },
  { index: 2, name: 'Rising Ash', entries: ['wisp', 'drifter'], count: 15, hpScale: 1.05, speedScale: 1.04 },
  { index: 3, name: 'Cinder Drift', entries: ['wisp', 'drifter', 'lunger'], count: 17, hpScale: 1.1, speedScale: 1.07 },
  { index: 4, name: 'Rot Garden', entries: ['drifter', 'spitter', 'wisp'], count: 19, hpScale: 1.18, speedScale: 1.1 },
  { index: 5, name: 'The First Warden', entries: ['warden', 'wisp'], count: 12, hpScale: 1, speedScale: 1.05, boss: true },
  { index: 6, name: 'Blooming Dark', entries: ['splitter', 'drifter', 'lunger'], count: 21, hpScale: 1.3, speedScale: 1.13 },
  { index: 7, name: 'Needle Rain', entries: ['spitter', 'lunger', 'wisp'], count: 23, hpScale: 1.38, speedScale: 1.16 },
  { index: 8, name: 'Split Sky', entries: ['splitter', 'spitter', 'drifter'], count: 25, hpScale: 1.46, speedScale: 1.2 },
  { index: 9, name: 'Last Light', entries: ['lunger', 'splitter', 'spitter', 'wisp'], count: 27, hpScale: 1.55, speedScale: 1.24 },
  { index: 10, name: 'The Ember Crown', entries: ['warden', 'splitter', 'spitter'], count: 16, hpScale: 1.5, speedScale: 1.28, boss: true },
];

/** The recipe a wave entry names, with the wave's scaling already applied. */
export function tuneEnemy(recipeId, wave) {
  const recipe = ENEMIES[recipeId];
  return {
    ...recipe,
    hp: Math.max(1, Math.round(recipe.hp * (wave.hpScale ?? 1))),
    speed: recipe.speed * (wave.speedScale ?? 1),
  };
}
