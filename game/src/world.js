// The world: the keeper, the bestiary, the sparks and the motes, all advanced by fixed steps.
// Nothing here touches the DOM. Every random draw comes from the run's own source, so a seed and a
// list of steps always replay to the same world: the screenshot scenes depend on that.

import { ARENA, BLOOM, MOTE, PLAYER, SCORE, VIEW, WAVE, WEAPON } from './config.js';
import { WAVES, tuneEnemy } from './enemies.js';
import { clampInside, circlesTouch, directionTo } from './util.js';

/** Bit flags a step returns. The loop and the screenshot stager both read them. */
export const EVENT_HIT = 1;
export const EVENT_OVER = 2;
export const EVENT_CLEAR = 4;
export const EVENT_WAVE = 8;

/** The kinds a body can be, so the renderer can shape each one without a class hierarchy. */
export const KIND_KEEPER = 'keeper';
export const KIND_ENEMY = 'enemy';
export const KIND_SPARK = 'spark';
export const KIND_SPIT = 'spit';
export const KIND_MOTE = 'mote';

const TEAM_KEEPER = 1;
const TEAM_SWARM = 2;

/** The wave director's own phases, in the order a run walks them. */
export const PHASE_BREATHER = 'breather';
export const PHASE_FIGHT = 'fight';
export const PHASE_DONE = 'done';

/** A plain multiplier table a fresh run starts with; boons rewrite copies of it. */
export function defaultStats() {
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

/**
 * The boons as the fight uses them: the run's multipliers layered over config.js. Kept in one
 * place so a boon can never be honoured in one system and forgotten in another.
 */
export function effectiveStats(state) {
  const stats = state.stats ?? defaultStats();
  return {
    cooldown: WEAPON.cooldown / (stats.cooldown || 1),
    damage: WEAPON.damage * (stats.damage || 1),
    speed: WEAPON.speed,
    life: WEAPON.life * (stats.life || 1),
    radius: WEAPON.radius * (stats.radius || 1),
    spread: WEAPON.spread * (stats.spread || 1),
    pierce: stats.pierce ?? 0,
    shots: 1 + (stats.shots ?? 0),
    moveSpeed: PLAYER.speed * (stats.speed || 1),
    dashCooldown: PLAYER.dashCooldown * (stats.dashCooldown || 1),
    bloomRadius: BLOOM.radius * (stats.bloom || 1),
    magnet: MOTE.magnet * (stats.magnet || 1),
  };
}

/** The mutable state of one run: a flat, JSON-shaped object the renderer and scenes can copy. */
function blankState() {
  return {
    time: 0,
    score: 0,
    combo: 1,
    comboTimer: 0,
    kills: 0,
    waveIndex: 0,
    waveName: '',
    waveClock: 0,
    phase: PHASE_BREATHER,
    phaseClock: 0,
    breatherLength: WAVE.firstDelay,
    spawnQueue: [],
    bloomCharge: 0,
    bloomPulse: 0,
    dashClock: 0,
    dashTime: 0,
    fireClock: 0,
    hurtFlash: 0,
    shake: 0,
    player: {
      kind: KIND_KEEPER,
      x: VIEW.width / 2,
      y: VIEW.height / 2,
      vx: 0,
      vy: 0,
      radius: PLAYER.radius,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      invuln: 0,
      aim: -Math.PI / 2,
      dashDirX: 1,
      dashDirY: 0,
      team: TEAM_KEEPER,
    },
    bodies: [],
    motes: [],
    particles: [],
    popups: [],
    stats: defaultStats(),
    boons: [],
    boss: null,
    bossMaxHp: 0,
    nextId: 1,
    over: false,
    won: false,
    /** The run's own tally, for the HUD and the end card: a wave held clean is worth noticing. */
    flawless: 0,
    waveClean: true,
    banner: '',
    bannerClock: 0,
    bannerKind: 'wave',
    elites: 0,
  };
}

export function createWorld(random) {
  const state = blankState();
  const world = {
    state,
    random,
    reset(stats = null, boons = []) {
      const fresh = blankState();
      for (const key of Object.keys(fresh)) state[key] = fresh[key];
      state.stats = { ...defaultStats(), ...(stats ?? {}) };
      state.boons = boons.slice();
      state.player = { ...fresh.player };
      state.player.maxHp = PLAYER.maxHp + (state.stats.maxHp ?? 0);
      state.player.hp = state.player.maxHp;
      state.phaseClock = 0;
      state.bloomCharge = 0;
    },
    step,
    /** The next wave's name, for the breather banner. */
    nextWaveName() {
      return WAVES[state.waveIndex]?.name ?? '';
    },
  };
  return world;
}

/** A faint shimmer of the run's randomness, so spawn points and particles never share a pattern. */
function roll(state) {
  return state.roll();
}

/** A point on the arena's rim, at least `margin` from the keeper so nothing lands on top of it. */
function rimPoint(state, margin) {
  const player = state.player;
  for (let tries = 0; tries < 24; tries += 1) {
    const edge = Math.floor(roll(state) * 4);
    // Enough inset that even a warden's silhouette lands fully inside the frame: a body that spawns
    // half over the border reads as a rendering bug before it reads as a threat.
    const pad = 52;
    // The top rim sits lower than the rest: the HUD strip and the warden's health plate own the top
    // ~120 px of the field, and a body that walks in underneath them is a sprite stuck to the HUD.
    const topPad = 128;
    // The bottom rim clears the build dock the same way the top rim clears the HUD strip: a body
    // that spawns on the floor line sits behind the chips and reads as a sprite stuck under the HUD.
    const bottomPad = 96;
    let x;
    let y;
    if (edge === 0) {
      x = ARENA.x + pad + roll(state) * (ARENA.width - pad * 2);
      y = ARENA.y + topPad;
    } else if (edge === 1) {
      x = ARENA.x + ARENA.width - pad;
      y = ARENA.y + topPad + roll(state) * (ARENA.height - topPad - bottomPad);
    } else if (edge === 2) {
      x = ARENA.x + pad + roll(state) * (ARENA.width - pad * 2);
      y = ARENA.y + ARENA.height - bottomPad;
    } else {
      x = ARENA.x + pad;
      y = ARENA.y + topPad + roll(state) * (ARENA.height - topPad - bottomPad);
    }
    if (Math.hypot(x - player.x, y - player.y) >= margin) return { x, y };
  }
  return { x: ARENA.x + ARENA.width / 2, y: ARENA.y + 40 };
}

function spawnBody(state, recipe, x, y, elite = false) {
  const hp = elite ? Math.round(recipe.hp * 2.4) : recipe.hp;
  const body = {
    id: state.nextId++,
    kind: KIND_ENEMY,
    recipe: recipe.id,
    name: elite ? `Elder ${recipe.name}` : recipe.name,
    behaviour: recipe.behaviour,
    x,
    y,
    vx: 0,
    vy: 0,
    radius: elite ? recipe.radius * 1.22 : recipe.radius,
    hp,
    maxHp: hp,
    speed: recipe.speed * (elite ? 0.9 : 1),
    damage: recipe.damage,
    colour: recipe.colour,
    accent: recipe.accent,
    score: elite ? Math.round(recipe.score * SCORE.eliteBonus) : recipe.score,
    motes: elite ? Math.min(8, (recipe.motes ?? 1) * 3) : recipe.motes,
    children: recipe.children ?? null,
    boss: Boolean(recipe.boss),
    elite,
    ringCooldown: recipe.ringCooldown ?? 0,
    ringCount: recipe.ringCount ?? 0,
    ringSpeed: recipe.ringSpeed ?? 0,
    chargeCooldown: recipe.chargeCooldown ?? 0,
    spitCooldown: recipe.spitCooldown ?? 0,
    team: TEAM_SWARM,
    invuln: 0.35,
    state: 'idle',
    stateClock: 0,
    // An elite opens its first attack sooner, so meeting one changes the shape of the fight.
    cooldown: (recipe.boss ? 2.4 : recipe.spitCooldown ?? 1.6) * (elite ? 0.7 : 1),
    phase: roll(state) * 6.28,
    hurt: 0,
    angle: 0,
  };
  state.bodies.push(body);
  return body;
}

/** Queue one wave's bodies along the rim, the warden first and the rest on a spacing. */
function queueWave(state) {
  const wave = WAVES[state.waveIndex];
  if (!wave) {
    state.phase = PHASE_DONE;
    return;
  }
  state.waveName = wave.name;
  state.waveClock = 0;
  state.spawnQueue = [];
  state.phase = PHASE_FIGHT;
  state.phaseClock = 0;
  state.banner = wave.name;
  state.bannerKind = wave.boss ? 'boss' : 'wave';
  state.bannerClock = WAVE.bannerTime;
  // One elite per wave from the third on: two of them in the later waves, so the field keeps
  // asking a different question instead of only more of the same one.
  const eliteSlots = wave.boss ? 1 : wave.index >= 8 ? 2 : wave.index >= WAVE.firstEliteWave ? 1 : 0;
  const bosses = wave.entries.filter((id) => id === 'warden');
  const others = wave.entries.filter((id) => id !== 'warden');
  let order = 0;
  for (const id of bosses) {
    const point = rimPoint(state, 300);
    state.spawnQueue.push({ recipe: tuneEnemy(id, wave), x: point.x, y: point.y, at: 0.4, elite: false });
    order += 1;
  }
  const normalCount = wave.boss ? Math.max(2, wave.count - 1) : wave.count;
  for (let i = 0; i < normalCount; i += 1) {
    const id = others[i % others.length];
    const point = rimPoint(state, 170);
    // The elite is the last body out, so it walks into a fight already in progress.
    const elite = eliteSlots > 0 && i >= normalCount - eliteSlots;
    state.spawnQueue.push({
      recipe: tuneEnemy(id, wave),
      x: point.x,
      y: point.y,
      at: 1.1 + WAVE.spawnGap * order,
      elite,
    });
    order += 1;
  }
}

/** The wave director: a breather before each wave, then spawns, then the next once clear. */
function stepDirector(state, dt, events) {
  state.phaseClock += dt;
  if (state.phase === PHASE_DONE) return events;

  if (state.phase === PHASE_BREATHER) {
    if (state.phaseClock >= state.breatherLength) {
      queueWave(state);
      events |= EVENT_WAVE;
    }
    return events;
  }

  // PHASE_FIGHT: drain the queue on its own spacing, then wait for the arena to empty.
  state.waveClock += dt;
  while (state.spawnQueue.length > 0 && state.spawnQueue[0].at <= state.waveClock) {
    const head = state.spawnQueue.shift();
    const body = spawnBody(state, head.recipe, head.x, head.y, head.elite);
    if (body.boss) {
      state.boss = body;
      state.bossMaxHp = body.maxHp;
      state.shake = Math.max(state.shake, 10);
    } else if (body.elite) {
      // An elite is announced by its crown and its size on the field, not by a title card: a second
      // named banner over a fight that already has a warden on it reads as two bosses at once.
      state.elites += 1;
      state.shake = Math.max(state.shake, 4);
    } else {
      state.shake = Math.max(state.shake, 1.1);
    }
  }
  if (state.spawnQueue.length > 0) return events;

  const enemiesLeft = state.bodies.some((body) => body.kind === KIND_ENEMY && body.hp > 0);
  if (!enemiesLeft && state.waveClock > 1) {
    state.score += SCORE.perWave * (state.waveIndex + 1);
    // A wave held without a scratch is the run's best evidence of skill, so it pays for itself.
    if (state.waveClean) {
      state.flawless += 1;
      state.score += SCORE.perFlawless * (state.waveIndex + 1);
      state.banner = 'Flawless';
      state.bannerKind = 'flawless';
    } else {
      state.banner = '';
    }
    state.waveClean = true;
    state.waveIndex += 1;
    state.boss = null;
    if (state.waveIndex >= WAVES.length) {
      state.phase = PHASE_DONE;
      state.won = true;
      state.over = true;
      events |= EVENT_CLEAR | EVENT_OVER;
      return events;
    }
    state.phase = PHASE_BREATHER;
    state.phaseClock = 0;
    state.breatherLength = WAVE.breather;
    events |= EVENT_CLEAR;
  }
  return events;
}

/** The keeper: movement, dash, fire and the bloom, all reading the run's effective stats. */
function stepPlayer(state, input, dt, events) {
  const player = state.player;
  const stats = effectiveStats(state);
  player.invuln = Math.max(0, player.invuln - dt);
  state.dashClock = Math.max(0, state.dashClock - dt);

  if (state.dashTime > 0) {
    state.dashTime = Math.max(0, state.dashTime - dt);
    player.x += player.dashDirX * PLAYER.dashSpeed * dt;
    player.y += player.dashDirY * PLAYER.dashSpeed * dt;
    player.vx = player.dashDirX * PLAYER.dashSpeed;
    player.vy = player.dashDirY * PLAYER.dashSpeed;
    state.particles.push({
      x: player.x,
      y: player.y,
      vx: -player.dashDirX * 70,
      vy: -player.dashDirY * 70,
      life: 0.3,
      maxLife: 0.3,
      size: 9 + roll(state) * 5,
      colour: 'moth',
      kind: 'trail',
    });
  } else {
    const targetVx = input.axis.x * stats.moveSpeed;
    const targetVy = input.axis.y * stats.moveSpeed;
    const rate = input.axis.x === 0 && input.axis.y === 0 ? PLAYER.friction : PLAYER.accel / 100;
    player.vx += (targetVx - player.vx) * Math.min(1, rate * dt);
    player.vy += (targetVy - player.vy) * Math.min(1, rate * dt);
    player.x += player.vx * dt;
    player.y += player.vy * dt;
  }
  clampInside(player, ARENA, player.radius);

  const aim = directionTo(input.aim.x, input.aim.y, player.x, player.y);
  player.aim = Math.atan2(aim.y, aim.x);

  if (input.took('dash') && state.dashClock <= 0) {
    const hasAxis = input.axis.x !== 0 || input.axis.y !== 0;
    state.dashTime = PLAYER.dashTime;
    state.dashClock = stats.dashCooldown;
    player.invuln = Math.max(player.invuln, PLAYER.dashIframes);
    player.dashDirX = hasAxis ? input.axis.x : Math.cos(player.aim);
    player.dashDirY = hasAxis ? input.axis.y : Math.sin(player.aim);
    state.shake = Math.max(state.shake, 3);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      state.particles.push({
        x: player.x + Math.cos(angle) * 10,
        y: player.y + Math.sin(angle) * 10,
        vx: -Math.cos(angle) * 210,
        vy: -Math.sin(angle) * 210,
        life: 0.32,
        maxLife: 0.32,
        size: 5 + roll(state) * 4,
        colour: 'moth',
        kind: 'spark',
      });
    }
  }

  state.fireClock = Math.max(0, state.fireClock - dt);
  if (input.firing && state.fireClock <= 0) {
    fireSparks(state, player, stats, aim);
    state.fireClock = stats.cooldown;
  }

  if (input.took('bloom') && state.bloomPulse <= 0 && state.bloomCharge >= BLOOM.chargeNeeded) {
    events |= releaseBloom(state, player, stats);
  }
  return events;
}

/** One volley: `shots` sparks fanned around the aim line, each carrying the run's damage. */
function fireSparks(state, player, stats, aim) {
  const baseAngle = Math.atan2(aim.y, aim.x);
  const mid = (stats.shots - 1) / 2;
  for (let i = 0; i < stats.shots; i += 1) {
    const fan = (i - mid) * 0.12;
    const jitter = (roll(state) - 0.5) * stats.spread * 2;
    const angle = baseAngle + fan + jitter;
    state.bodies.push({
      id: state.nextId++,
      kind: KIND_SPARK,
      x: player.x + Math.cos(angle) * WEAPON.muzzle,
      y: player.y + Math.sin(angle) * WEAPON.muzzle,
      vx: Math.cos(angle) * stats.speed,
      vy: Math.sin(angle) * stats.speed,
      radius: stats.radius,
      damage: stats.damage,
      life: stats.life,
      maxLife: stats.life,
      pierce: stats.pierce,
      hits: 0,
      team: TEAM_KEEPER,
      angle,
    });
  }
  state.shake = Math.max(state.shake, 1.4);
}

/** The bloom: a ring of fire that damages and pushes everything inside it. */
function releaseBloom(state, player, stats) {
  state.bloomCharge = 0;
  state.bloomPulse = BLOOM.duration;
  state.shake = Math.max(state.shake, 7);
  const ring = { x: player.x, y: player.y, radius: stats.bloomRadius };
  for (const body of state.bodies) {
    if (body.kind !== KIND_ENEMY || body.hp <= 0) continue;
    if (!circlesTouch(ring, body)) continue;
    damageBody(state, body, BLOOM.damage * (state.stats?.damage ?? 1));
    const push = directionTo(body.x, body.y, player.x, player.y);
    body.vx += push.x * BLOOM.push;
    body.vy += push.y * BLOOM.push;
  }
  for (const mote of state.motes) {
    if (!mote.collected && circlesTouch(ring, mote)) collectMote(state, mote);
  }
  for (let i = 0; i < 28; i += 1) {
    const angle = (i / 28) * Math.PI * 2;
    state.particles.push({
      x: player.x + Math.cos(angle) * 22,
      y: player.y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * (420 + i * 3),
      vy: Math.sin(angle) * (420 + i * 3),
      life: 0.55,
      maxLife: 0.55,
      size: 8,
      colour: 'bloom',
      kind: 'ring',
    });
  }
  return EVENT_HIT;
}

/** Everything the swarm does, one behaviour at a time. */
function stepEnemies(state, dt, events) {
  const player = state.player;
  for (const body of state.bodies) {
    if (body.kind !== KIND_ENEMY || body.hp <= 0) continue;
    body.hurt = Math.max(0, body.hurt - dt);
    body.invuln = Math.max(0, body.invuln - dt);
    body.stateClock += dt;
    const toPlayer = directionTo(player.x, player.y, body.x, body.y);
    const gap = Math.hypot(player.x - body.x, player.y - body.y);

    switch (body.behaviour) {
      case 'drift': {
        body.phase += dt * 2.1;
        const weave = Math.sin(body.phase) * 0.5;
        const dx = toPlayer.x - toPlayer.y * weave;
        const dy = toPlayer.y + toPlayer.x * weave;
        body.vx += (dx * body.speed - body.vx) * Math.min(1, 4 * dt);
        body.vy += (dy * body.speed - body.vy) * Math.min(1, 4 * dt);
        break;
      }
      case 'charge': {
        if (body.state === 'windup') {
          body.vx *= 1 - Math.min(1, 8 * dt);
          body.vy *= 1 - Math.min(1, 8 * dt);
          if (body.stateClock > 0.6) {
            body.state = 'lunge';
            body.stateClock = 0;
            body.vx = toPlayer.x * body.speed * 5.4;
            body.vy = toPlayer.y * body.speed * 5.4;
          }
        } else if (body.state === 'lunge') {
          if (body.stateClock > 0.46) {
            body.state = 'idle';
            body.stateClock = 0;
            body.cooldown = 1.15;
          }
        } else {
          body.vx += (toPlayer.x * body.speed - body.vx) * Math.min(1, 4.5 * dt);
          body.vy += (toPlayer.y * body.speed - body.vy) * Math.min(1, 4.5 * dt);
          body.cooldown -= dt;
          if (body.cooldown <= 0 && gap < 400) {
            body.state = 'windup';
            body.stateClock = 0;
          }
        }
        break;
      }
      case 'orbit': {
        const wanted = 215;
        const inward = gap > wanted ? 1 : gap < wanted - 60 ? -1 : 0;
        const dx = toPlayer.x * inward - toPlayer.y * 0.85;
        const dy = toPlayer.y * inward + toPlayer.x * 0.85;
        body.vx += (dx * body.speed - body.vx) * Math.min(1, 4 * dt);
        body.vy += (dy * body.speed - body.vy) * Math.min(1, 4 * dt);
        body.cooldown -= dt;
        if (body.cooldown <= 0 && gap < 470) {
          body.cooldown = body.spitCooldown || 2.1;
          state.bodies.push({
            id: state.nextId++,
            kind: KIND_SPIT,
            x: body.x,
            y: body.y,
            vx: toPlayer.x * 255,
            vy: toPlayer.y * 255,
            radius: 8,
            damage: 1,
            life: 3.2,
            maxLife: 3.2,
            team: TEAM_SWARM,
            colour: 'rot',
          });
        }
        break;
      }
      case 'warden': {
        if (body.state === 'ring') {
          body.vx *= 1 - Math.min(1, 10 * dt);
          body.vy *= 1 - Math.min(1, 10 * dt);
          if (body.stateClock > 0.75) {
            body.state = 'idle';
            body.stateClock = 0;
            body.cooldown = body.chargeCooldown || 5;
            body.phase += 0.6;
            const count = body.ringCount || 12;
            for (let i = 0; i < count; i += 1) {
              const angle = (i / count) * Math.PI * 2 + body.phase;
              state.bodies.push({
                id: state.nextId++,
                kind: KIND_SPIT,
                x: body.x + Math.cos(angle) * (body.radius + 4),
                y: body.y + Math.sin(angle) * (body.radius + 4),
                vx: Math.cos(angle) * (body.ringSpeed || 205),
                vy: Math.sin(angle) * (body.ringSpeed || 205),
                radius: 9,
                damage: 1,
                life: 3.4,
                maxLife: 3.4,
                team: TEAM_SWARM,
                colour: 'ember',
              });
            }
            state.shake = Math.max(state.shake, 5);
          }
        } else {
          body.vx += (toPlayer.x * body.speed - body.vx) * Math.min(1, 3.2 * dt);
          body.vy += (toPlayer.y * body.speed - body.vy) * Math.min(1, 3.2 * dt);
          body.cooldown -= dt;
          if (body.cooldown <= 0) {
            body.state = 'ring';
            body.stateClock = 0;
          }
        }
        break;
      }
      default: {
        body.vx += (toPlayer.x * body.speed - body.vx) * Math.min(1, 6 * dt);
        body.vy += (toPlayer.y * body.speed - body.vy) * Math.min(1, 6 * dt);
      }
    }

    body.x += body.vx * dt;
    body.y += body.vy * dt;
    if (Math.abs(body.vx) + Math.abs(body.vy) > 6) body.angle = Math.atan2(body.vy, body.vx);
    clampInside(body, ARENA, body.radius);

    if (body.invuln <= 0 && player.invuln <= 0 && circlesTouch(body, player)) {
      events |= hurtPlayer(state, body.damage, directionTo(player.x, player.y, body.x, body.y));
    }
  }
  return events;
}

/** Move sparks and spits, resolve what they hit, and retire what has run out of life. */
function stepProjectiles(state, dt, events) {
  for (const body of state.bodies) {
    if (body.kind !== KIND_SPARK && body.kind !== KIND_SPIT) continue;
    if (body.life <= 0) continue;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.life -= dt;

    if (body.kind === KIND_SPIT) {
      const player = state.player;
      if (player.invuln <= 0 && circlesTouch(body, player)) {
        events |= hurtPlayer(state, body.damage, directionTo(player.x, player.y, body.x, body.y));
        body.life = 0;
      }
      continue;
    }

    for (const target of state.bodies) {
      if (target.kind !== KIND_ENEMY || target.hp <= 0) continue;
      if (!circlesTouch(body, target)) continue;
      damageBody(state, target, body.damage);
      target.vx += (body.vx / 900) * 45;
      target.vy += (body.vy / 900) * 45;
      for (let i = 0; i < 3; i += 1) {
        const angle = body.angle + Math.PI + (i - 1) * 0.7;
        state.particles.push({
          x: body.x,
          y: body.y,
          vx: Math.cos(angle) * 130,
          vy: Math.sin(angle) * 130,
          life: 0.24,
          maxLife: 0.24,
          size: 5,
          colour: 'wick',
          kind: 'spark',
        });
      }
      if (body.pierce > body.hits) body.hits += 1;
      else {
        body.life = 0;
        break;
      }
    }
  }
  retire(state);
  return events;
}

/** Drop dead bodies. A splitter's shards are born in damageBody, so nothing else is needed here. */
function retire(state) {
  const kept = [];
  for (const body of state.bodies) {
    if (body.hp !== undefined && body.hp <= 0 && body.kind === KIND_ENEMY) continue;
    if ((body.kind === KIND_SPARK || body.kind === KIND_SPIT) && body.life <= 0) continue;
    kept.push(body);
  }
  state.bodies = kept;
}

/** Apply damage to one enemy and, if it dies, pay the keeper, drop motes and split if it splits. */
function damageBody(state, body, amount) {
  if (body.hp <= 0) return;
  body.hp -= amount;
  body.hurt = 0.14;
  if (body.hp > 0) return;

  state.kills += 1;
  state.comboTimer = SCORE.comboWindow;
  state.combo = Math.min(SCORE.comboMax, state.combo + SCORE.comboStep);
  const worth = Math.round(body.score * state.combo);
  state.score += worth;
  state.shake = Math.max(state.shake, body.boss ? 12 : 2.4);
  // A price tag over every kill: the score is the game's other weapon, so it has to be visible.
  // Pops close together are merged rather than stacked, so a crowd dying in one bloom does not
  // bury the enemies still alive under a wall of numbers.
  pushPopup(state, body.x, body.y - body.radius * 0.5, worth, {
    kind: body.boss ? 'boss' : body.elite ? 'elite' : 'kill',
    life: body.boss ? 1.1 : 0.62,
  });

  const burst = body.boss ? 24 : 7;
  for (let i = 0; i < burst; i += 1) {
    const angle = (i / burst) * Math.PI * 2;
    state.particles.push({
      x: body.x,
      y: body.y,
      vx: Math.cos(angle) * (body.boss ? 330 : 155),
      vy: Math.sin(angle) * (body.boss ? 330 : 155),
      life: body.boss ? 0.95 : 0.44,
      maxLife: body.boss ? 0.95 : 0.44,
      size: body.boss ? 11 : 6,
      colour: body.boss ? 'ember' : 'ash',
      kind: 'burst',
    });
  }

  const motes = body.motes ?? 1;
  for (let i = 0; i < motes; i += 1) {
    const angle = (i / motes) * Math.PI * 2 + state.kills * 0.7;
    state.motes.push({
      kind: KIND_MOTE,
      x: body.x + Math.cos(angle) * (motes > 1 ? 18 : 0),
      y: body.y + Math.sin(angle) * (motes > 1 ? 18 : 0),
      vx: Math.cos(angle) * 80,
      vy: Math.sin(angle) * 80,
      radius: MOTE.radius,
      life: MOTE.life,
      collected: false,
      phase: i * 1.3,
    });
  }

  if (body.children) {
    const wave = WAVES[Math.min(state.waveIndex, WAVES.length - 1)];
    const recipe = tuneEnemy(body.children, wave);
    for (let i = 0; i < 2; i += 1) {
      const angle = (i / 2) * Math.PI * 2 + 0.6;
      const child = spawnBody(state, recipe, body.x + Math.cos(angle) * 20, body.y + Math.sin(angle) * 20);
      child.invuln = 0.2;
      child.vx = Math.cos(angle) * 180;
      child.vy = Math.sin(angle) * 180;
    }
  }
}

/** Take a hit: hearts, the flash, the push and the drop to game over. */
function hurtPlayer(state, damage, push) {
  const player = state.player;
  if (player.invuln > 0 || state.over) return 0;
  player.hp -= damage;
  player.invuln = PLAYER.invuln;
  player.vx += push.x * PLAYER.hitPush;
  player.vy += push.y * PLAYER.hitPush;
  state.hurtFlash = 0.55;
  state.shake = Math.max(state.shake, 9);
  state.combo = 1;
  state.comboTimer = 0;
  // The wave is no longer clean: the flawless bonus is spent the moment the keeper is touched.
  state.waveClean = false;
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    state.particles.push({
      x: player.x,
      y: player.y,
      vx: Math.cos(angle) * 205,
      vy: Math.sin(angle) * 205,
      life: 0.46,
      maxLife: 0.46,
      size: 6,
      colour: 'blood',
      kind: 'burst',
    });
  }
  if (player.hp > 0) return EVENT_HIT;
  player.hp = 0;
  state.over = true;
  state.won = false;
  state.phase = PHASE_DONE;
  return EVENT_HIT | EVENT_OVER;
}

/** Motes drift, are pulled in, and fill the bloom meter when they reach the keeper. */
function stepMotes(state, dt, stats) {
  const player = state.player;
  for (const mote of state.motes) {
    if (mote.collected) continue;
    mote.life -= dt;
    mote.phase += dt * 3.4;
    const dx = player.x - mote.x;
    const dy = player.y - mote.y;
    const gap = Math.hypot(dx, dy) || 1;
    if (gap < stats.magnet) {
      const pull = MOTE.pull * (1 - gap / (stats.magnet * 1.6));
      mote.vx += (dx / gap) * pull * dt;
      mote.vy += (dy / gap) * pull * dt;
    } else {
      mote.vx += (MOTE.drift * Math.cos(mote.phase) - mote.vx) * Math.min(1, 2 * dt);
      mote.vy += (MOTE.drift * Math.sin(mote.phase * 0.8) - mote.vy) * Math.min(1, 2 * dt);
    }
    mote.vx *= 1 - Math.min(1, 2.6 * dt);
    mote.vy *= 1 - Math.min(1, 2.6 * dt);
    mote.x += mote.vx * dt;
    mote.y += mote.vy * dt;
    if (gap < player.radius + mote.radius + 5) collectMote(state, mote);
  }
  state.motes = state.motes.filter((mote) => !mote.collected && mote.life > 0);
}

function collectMote(state, mote) {
  if (mote.collected) return;
  mote.collected = true;
  state.bloomCharge = Math.min(BLOOM.chargeNeeded, state.bloomCharge + 1);
  state.score += MOTE.value;
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    state.particles.push({
      x: mote.x,
      y: mote.y,
      vx: Math.cos(angle) * 95,
      vy: Math.sin(angle) * 95,
      life: 0.26,
      maxLife: 0.26,
      size: 4,
      colour: 'moth',
      kind: 'spark',
    });
  }
}

/** Every particle fades on its own clock; the array is capped so a long wave cannot bloat it. */
function stepParticles(state, dt) {
  for (const p of state.particles) {
    p.life -= dt;
    p.x += (p.vx ?? 0) * dt;
    p.y += (p.vy ?? 0) * dt;
    p.vx = (p.vx ?? 0) * (1 - Math.min(1, 3.2 * dt));
    p.vy = (p.vy ?? 0) * (1 - Math.min(1, 3.2 * dt));
  }
  if (state.particles.length > 420) state.particles.splice(0, state.particles.length - 420);
  state.particles = state.particles.filter((p) => p.life > 0);
}

/**
 * Add one score pop, merging it into a live pop within 34 px so a bloom that kills six bodies at
 * once reads as one bigger number instead of six overlapping ones.
 */
function pushPopup(state, x, y, value, { kind = 'kill', life = 0.62 } = {}) {
  for (const popup of state.popups) {
    // A pop within 34 px swallows the new value, and one that already sits within 56 px is nudged
    // aside instead: two pops that close stack into a single unreadable blob precisely where the
    // player is looking, so a nearby pop claims the space and the new one is offset from it.
    const gap = Math.hypot(popup.x - x, popup.y - y);
    if (popup.kind === kind && gap <= 34) {
      popup.value += value;
      popup.life = Math.max(popup.life, life);
      popup.maxLife = Math.max(popup.maxLife, life);
      popup.merges = (popup.merges ?? 1) + 1;
      return;
    }
    if (popup.kind === kind && gap <= 56) {
      y -= 18;
      x += 12;
    }
  }
  state.popups.push({ x, y, value, life, maxLife: life, kind, merges: 1 });
}

/** Score pops drift up and fade; like the particles, they are capped so a busy wave stays cheap. */
function stepPopups(state, dt) {
  for (const popup of state.popups) {
    // A merged pop rises faster, so the eye is pulled to the bigger number it has become.
    popup.life -= dt;
    popup.y -= (26 + Math.min(popup.merges - 1, 4) * 9) * dt;
  }
  if (state.popups.length > 24) state.popups.splice(0, state.popups.length - 24);
  state.popups = state.popups.filter((popup) => popup.life > 0);
  state.bannerClock = Math.max(0, state.bannerClock - dt);
}

/**
 * Advance the world by exactly one fixed step. `input` is a snapshot the caller built
 * ({ axis, aim, firing, took(name) }); the returned flags say what happened.
 */
export function step(world, dt, input, events = 0) {
  const state = world.state;
  state.roll = () => world.random.next();

  if (state.over) {
    stepParticles(state, dt);
    stepPopups(state, dt);
    state.hurtFlash = Math.max(0, state.hurtFlash - dt * 2.4);
    state.shake = Math.max(0, state.shake - dt * 34);
    state.bloomPulse = Math.max(0, state.bloomPulse - dt);
    return events;
  }

  state.time += dt;
  state.comboTimer = Math.max(0, state.comboTimer - dt);
  if (state.comboTimer <= 0) state.combo = 1;
  state.hurtFlash = Math.max(0, state.hurtFlash - dt * 2.4);
  state.shake = Math.max(0, state.shake - dt * 34);
  state.bloomPulse = Math.max(0, state.bloomPulse - dt);

  events = stepPlayer(state, input, dt, events);
  events = stepEnemies(state, dt, events);
  events = stepProjectiles(state, dt, events);
  stepMotes(state, dt, effectiveStats(state));
  events = stepDirector(state, dt, events);
  stepParticles(state, dt);
  stepPopups(state, dt);
  return events;
}
