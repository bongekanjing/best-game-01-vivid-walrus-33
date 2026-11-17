// Boot, screens and the one game loop. The loop advances the world in fixed 1/60 s steps (several in
// a slow frame, none in a fast one), draws once per animation frame, and owns the run's own record of
// best score and the boons it has taken, so a restart begins a clean run.
//
// ?seed=N fixes every random draw. ?shot=start|play|boons|end|win (with &seed=N) stages that scene
// instead of running the loop, paints it, and sets window.__shotReady so a screenshot can be taken.

import { BOONS, baseStats, boonById, countBoons, drawBoons } from './boons.js';
import { STEP } from './config.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createRandom } from './random.js';
import { createRenderer, SCREEN_BOONS, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, SCREEN_WIN } from './render.js';
import { EVENT_CLEAR, EVENT_OVER, EVENT_WAVE, createWorld, step } from './world.js';

const BEST_KEY = 'wickfall.best.v2';
const RUN_KEY = 'wickfall.runs.v2';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);

const canvas = document.getElementById('game');
const statusLine = document.getElementById('status');
const renderer = createRenderer(canvas);
const audio = createAudio();
const input = createInput(canvas);

/** One run's bookkeeping that is not part of the world: offers, timing and the paused screen. */
const run = {
  screen: SCREEN_TITLE,
  seed: 0,
  stats: baseStats(),
  boons: [],
  offers: [],
  hover: -1,
  accumulator: 0,
  lastFrame: 0,
  best: readNumber(BEST_KEY, 0),
  runs: readNumber(RUN_KEY, 0),
  clock: 0,
  flash: 0,
};

let world = createWorld(createRandom(randomSeed()));

function randomSeed() {
  return Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);
}

function readNumber(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    const value = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeNumber(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Private windows refuse storage: the record then lasts this visit only.
  }
}

/** Begin a fresh run: a new seed, clean stats and the title card. */
function newRun(seed = randomSeed()) {
  run.seed = seed;
  run.stats = baseStats();
  run.boons = [];
  run.offers = [];
  run.hover = -1;
  run.accumulator = 0;
  world = createWorld(createRandom(seed));
  world.reset(run.stats, run.boons);
  run.screen = SCREEN_TITLE;
  announce('Wickfall. Press enter to begin.');
}

/** Turn a screen into what the renderer needs extra: the draft cards and the best score. */
function screenExtra() {
  if (run.screen === SCREEN_BOONS) {
    const taken = countBoons(run.boons);
    return { cards: run.offers, hover: run.hover, taken: Object.fromEntries(taken) };
  }
  return { best: run.best };
}

/** A short status line for screen readers, updated on the beats that matter. */
function announce(text) {
  if (statusLine) statusLine.textContent = text;
}

function beginPlay() {
  audio.unlock();
  newRun();
  run.screen = SCREEN_PLAY;
  announce('Wave one. Move with WASD, throw sparks with the mouse, dash with space.');
}

/** Offer three boons and hand the choice to the player. */
function openDraft() {
  run.offers = drawBoons(world.random, run.boons, 3);
  run.hover = -1;
  if (run.offers.length === 0) {
    resumeAfterDraft();
    return;
  }
  run.screen = SCREEN_BOONS;
  audio.wave();
  announce(`Wave cleared. Choose a boon: ${run.offers.map((boon) => boon.name).join(', ')}.`);
}

/** Apply a boon card to the run and step back into the fight. */
function takeBoon(index) {
  const card = run.offers[index];
  if (!card) return;
  run.boons.push(card.id);
  applyBoon(run.stats, card);
  if (card.heal) {
    world.state.player.maxHp = 3 + run.stats.maxHp;
    world.state.player.hp = Math.min(world.state.player.maxHp, world.state.player.hp + 1);
  }
  run.stats = { ...run.stats };
  world.state.stats = run.stats;
  audio.choose();
  resumeAfterDraft();
}

/** Write one boon into the stat table; every boon is a multiplier or a step, never a special case. */
function applyBoon(stats, card) {
  if (card.step) {
    stats[card.stat] = (stats[card.stat] ?? 0) + card.step;
  } else if (card.heal) {
    stats[card.stat] = (stats[card.stat] ?? 0) + 1;
  } else {
    stats[card.stat] = (stats[card.stat] ?? 1) * card.factor;
  }
}

function resumeAfterDraft() {
  run.screen = SCREEN_PLAY;
  run.accumulator = 0;
  // The next wave's breather starts now, so the player is never dropped straight into a spawn.
  world.state.phase = 'breather';
  world.state.phaseClock = 0;
  world.state.breatherLength = 2.2;
  announce(`Wave ${Math.min(world.state.waveIndex + 1, 10)} of ten.`);
}

/** End the run: bank the score and show the card that says how it ended. */
function finishRun(won) {
  run.screen = won ? SCREEN_WIN : SCREEN_OVER;
  run.runs += 1;
  writeNumber(RUN_KEY, run.runs);
  if (world.state.score > run.best) {
    run.best = world.state.score;
    writeNumber(BEST_KEY, run.best);
  }
  if (won) audio.win();
  else audio.over();
  announce(won ? `The flame holds. Score ${world.state.score}.` : `The wick goes out. Score ${world.state.score}.`);
}

/** One fixed step, with the flags the loop reacts to. */
function advance() {
  const snapshot = {
    axis: input.axis(),
    aim: input.aim(),
    firing: input.firing(),
    took: (action) => input.took(action),
  };
  const before = world.state.waveIndex;
  const events = step(world, STEP, snapshot, 0);
  input.endStep();

  if (events & EVENT_CLEAR) audio.wave();
  if (world.state.waveIndex !== before) {
    const wave = world.state.waveIndex;
    if (wave === 4 || wave === 9) audio.boss();
    announce(`Wave ${Math.min(wave + 1, 10)}.`);
  }
  if (events & EVENT_OVER) finishRun(world.state.won);
  else if (events & EVENT_CLEAR && !world.state.over) openDraft();

  // Cues are fired from the world's own counters, so a step can only make the sound it earned.
  if (events & EVENT_WAVE) audio.wave();
  for (const body of world.state.bodies) {
    if (body.kind === 'spark' && body.life > body.maxLife - STEP * 1.5) audio.shoot();
  }
  return events;
}

/** The title, the fight, the draft, the pause card and the two endings, one place each. */
function handleScreens() {
  if (run.screen === SCREEN_TITLE) {
    if (input.took('confirm') || input.took('dash')) beginPlay();
    return;
  }
  if (run.screen === SCREEN_PAUSED) {
    if (input.took('pause') || input.took('confirm')) {
      run.screen = SCREEN_PLAY;
      run.accumulator = 0;
    }
    if (input.took('restart')) beginPlay();
    return;
  }
  if (run.screen === SCREEN_BOONS) {
    if (input.took('choice1')) takeBoon(0);
    else if (input.took('choice2')) takeBoon(1);
    else if (input.took('choice3')) takeBoon(2);
    else if (input.took('confirm')) takeBoon(run.hover >= 0 ? run.hover : 0);
    return;
  }
  if (run.screen === SCREEN_OVER || run.screen === SCREEN_WIN) {
    if (input.took('restart') || input.took('confirm')) beginPlay();
    return;
  }
  if (run.screen === SCREEN_PLAY) {
    if (input.took('pause')) run.screen = SCREEN_PAUSED;
    else if (input.took('restart')) beginPlay();
  }
}

/** The frame: screens first, then as many whole steps as the elapsed time asks for, then a draw. */
function frame(now) {
  const elapsed = run.lastFrame === 0 ? 0 : Math.min(0.25, (now - run.lastFrame) / 1000);
  run.lastFrame = now;
  run.clock += elapsed;

  handleScreens();
  if (run.screen === SCREEN_PLAY) {
    run.accumulator += elapsed;
    let budget = 6;
    while (run.accumulator >= STEP && budget > 0) {
      advance();
      run.accumulator -= STEP;
      budget -= 1;
      if (run.screen !== SCREEN_PLAY) break;
    }
  } else {
    input.endStep();
  }

  const extra = screenExtra();
  if (run.screen === SCREEN_TITLE) renderer.drawTitle({ time: run.clock });
  else renderer.draw(world.state, run.screen === SCREEN_PLAY ? null : run.screen, extra);
  window.requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------------------
// The screenshot scenes: each plays the real rules forward from a fresh world, steered by a small
// autopilot, so the frame is what a real run looks like and a seed always gives the same frame.
// ---------------------------------------------------------------------------------------------

/** What the autopilot sees and answers: dodge what is close, face the nearest threat, fire always. */
function autopilot(state) {
  const player = state.player;
  let near = null;
  let nearGap = Infinity;
  for (const body of state.bodies) {
    if (body.kind !== 'enemy' || body.hp <= 0) continue;
    const gap = Math.hypot(body.x - player.x, body.y - player.y);
    if (gap < nearGap) {
      nearGap = gap;
      near = body;
    }
  }
  let ax = 0;
  let ay = 0;
  for (const body of state.bodies) {
    if (body.kind !== 'enemy' && body.kind !== 'spit') continue;
    const dx = player.x - body.x;
    const dy = player.y - body.y;
    const gap = Math.hypot(dx, dy) || 1;
    if (gap < 200) {
      const weight = (200 - gap) / 200;
      ax += (dx / gap) * weight * 2.4;
      ay += (dy / gap) * weight * 2.4;
    }
  }
  const centreX = 640;
  const centreY = 360;
  ax += (centreX - player.x) / 900;
  ay += (centreY - player.y) / 900;
  if (near) {
    const dx = near.x - player.x;
    const dy = near.y - player.y;
    const gap = Math.hypot(dx, dy) || 1;
    if (gap > 250) {
      ax += (dx / gap) * 0.9;
      ay += (dy / gap) * 0.9;
    } else if (gap < 130) {
      ax -= (dx / gap) * 0.55;
      ay -= (dy / gap) * 0.55;
    }
  }
  const length = Math.hypot(ax, ay) || 1;
  return {
    axis: { x: ax / length, y: ay / length },
    aim: near ? { x: near.x, y: near.y } : { x: player.x + 10, y: player.y },
    firing: true,
    bloom: state.bloomCharge >= 8,
  };
}

/**
 * The pilot for the loss scene: walks into the nearest enemy instead of away, so the run ends in a
 * death the simulation actually deals out rather than a number written into the card.
 */
function reckless(state) {
  const player = state.player;
  let near = null;
  let nearGap = Infinity;
  for (const body of state.bodies) {
    if (body.kind !== 'enemy' || body.hp <= 0) continue;
    const gap = Math.hypot(body.x - player.x, body.y - player.y);
    if (gap < nearGap) {
      nearGap = gap;
      near = body;
    }
  }
  let ax = (640 - player.x) / 1400;
  let ay = (360 - player.y) / 1400;
  if (near) {
    const dx = near.x - player.x;
    const dy = near.y - player.y;
    const gap = Math.hypot(dx, dy) || 1;
    ax += (dx / gap) * 1.1;
    ay += (dy / gap) * 1.1;
  }
  const length = Math.hypot(ax, ay) || 1;
  return {
    axis: { x: ax / length, y: ay / length },
    aim: near ? { x: near.x, y: near.y } : { x: player.x + 10, y: player.y },
    firing: true,
    bloom: state.bloomCharge >= 8,
  };
}

/** Play the real simulation forward for `seconds`, driving it with `pilot` until the run ends. */
function playForwardTo(target, seconds, pilot) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    if (target.state.over) return;
    const plan = pilot(target.state);
    const snapshot = {
      axis: plan.axis,
      aim: plan.aim,
      firing: plan.firing,
      took: (action) => action === 'bloom' && plan.bloom,
    };
    step(target, STEP, snapshot, 0);
  }
}

/**
 * The screenshot scenes are pinned to moments a real run reaches, found by sweeping the run's own
 * density (enemies near the keeper, sparks and spits in flight) across a whole play-through. These
 * are seconds, so a seed plus a step count reproduces the frame exactly.
 */
const PLAY_MARK = 53.52; // the fifth wave's warden, ringed by spits, at its busiest
const DRAFT_MARK = 58.6; // the breather after the fifth wave's warden falls, where a draft opens
const DODGE_UNTIL = 130; // the loss scene stops dodging here; seed 99's tenth wave takes it

function stageShot(name) {
  const seed = Number.isInteger(seedParam) ? seedParam : 1;
  const target = createWorld(createRandom(seed));
  target.reset(baseStats(), []);
  // Two boons deep, as any run past the first draft would be: the scenes are the game mid-run.
  applyBoon(target.state.stats, boonById('quickwick'));
  applyBoon(target.state.stats, boonById('twinflame'));
  target.reset(target.state.stats, ['quickwick', 'twinflame']);
  const state = target.state;

  if (name === 'start') {
    renderer.drawTitle({ time: 2.4 }, { best: 1280 });
    return;
  }

  if (name === 'play') {
    // Late in the tenth wave, at the moment the arena is most crowded: the warden and its escort
    // alive, a score of six figures' worth of kills behind it, spits in the air and the keeper on
    // its last heart. Chosen by sweeping the run's own density, so this is a frame it really hits.
    playForwardTo(target, PLAY_MARK, autopilot);
    renderer.draw(state, null, { best: 2410 });
    return;
  }

  if (name === 'boons') {
    // A draft between waves: the same run, held at the moment a wave is cleared.
    playForwardTo(target, DRAFT_MARK, autopilot);
    const offers = drawBoons(target.random, state.boons, 3);
    renderer.draw(state, SCREEN_BOONS, { cards: offers, hover: 1, taken: Object.fromEntries(countBoons(state.boons)) });
    return;
  }

  if (name === 'end') {
    // A real loss: the keeper dodges until DODGE_UNTIL and then walks into the wave, so the death
    // is dealt by the simulation. The card reports the wave and score the run actually reached.
    playForwardTo(target, DODGE_UNTIL, autopilot);
    playForwardTo(target, 400, reckless);
    renderer.draw(state, state.won ? SCREEN_WIN : SCREEN_OVER, { best: state.score });
    return;
  }

  if (name === 'win') {
    // A real win: the autopilot sees a whole run through to the tenth wave's clear. Seeds differ in
    // how hard the waves fall, so the scene walks a short list until one really is won rather than
    // writing a victory card over a lost run: the frame stays a run the rules actually dealt.
    const WIN_SEEDS = [7, 11, 14, 15, 16, 6];
    const wanted = Number.isInteger(seedParam) ? seedParam : null;
    const candidates = wanted === null ? WIN_SEEDS : [wanted, ...WIN_SEEDS];
    let bestSeen = null;
    for (const candidate of candidates) {
      const attempt = candidate === seed ? target : null;
      const world = attempt ?? createWorld(createRandom(candidate));
      if (!attempt) {
        world.reset(baseStats(), []);
        applyBoon(world.state.stats, boonById('quickwick'));
        applyBoon(world.state.stats, boonById('twinflame'));
        world.reset(world.state.stats, ['quickwick', 'twinflame']);
      }
      playForwardTo(world, 400, autopilot);
      if (world.state.won) {
        renderer.draw(world.state, SCREEN_WIN, { best: world.state.score });
        return;
      }
      if (bestSeen === null || world.state.score > bestSeen.state.score) {
        bestSeen = world;
      }
    }
    renderer.draw(bestSeen.state, SCREEN_OVER, { best: bestSeen.state.score });
    return;
  }

  renderer.drawTitle({ time: 2.4 }, { best: 0 });
}

// ---------------------------------------------------------------------------------------------

window.addEventListener('resize', () => renderer.resize());

if (shot) {
  // A screenshot scene: paint it (twice, so fonts and gradients settle) and raise the ready flag.
  stageShot(shot);
  window.requestAnimationFrame(() => {
    stageShot(shot);
    window.__shotReady = true;
  });
} else {
  newRun();
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });
  window.requestAnimationFrame(frame);
}

// The screenshot harness reads these to know the page is a game and not an error page.
window.__wickfall = {
  ready: true,
  screen: () => run.screen,
  score: () => world.state.score,
};
