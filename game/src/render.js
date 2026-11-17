// The renderer: one canvas, drawn back to front, with no images and no fonts to load. Everything
// is a shape, a gradient or a short line of text, so the game has no assets at all and still has a
// look: a cold blue night, a warm ember glow, and a moth carrying the last flame.

import { ARENA, BLOOM, PALETTE, PLAYER, VIEW } from './config.js';
import { KIND_ENEMY, KIND_SPARK, KIND_SPIT } from './world.js';
import { clamp, easeOutCubic, formatClock } from './util.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_BOONS = 'boons';
export const SCREEN_WIN = 'win';

/** Named colours resolved to strings once, so the draw calls stay short. */
const COLOUR = {
  wick: PALETTE.wick,
  ember: PALETTE.ember,
  flame: PALETTE.flame,
  moth: PALETTE.moth,
  mothDeep: PALETTE.mothDeep,
  blood: PALETTE.blood,
  bloom: PALETTE.bloom,
  rot: PALETTE.rot,
  ash: PALETTE.ash,
  bone: PALETTE.bone,
  nightDeep: PALETTE.nightDeep,
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  /** A fixed star field, so the background never shimmers between frames. */
  const stars = makeStars(150);
  const fades = new Map();

  /** Fit the logical 1280x720 field into whatever the window is, letterboxed and crisp. */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function begin(state) {
    resize();
    const scale = Math.min(canvas.width / VIEW.width, canvas.height / VIEW.height);
    const offsetX = (canvas.width - VIEW.width * scale) / 2;
    const offsetY = (canvas.height - VIEW.height * scale) / 2;
    const shake = state ? state.shake : 0;
    const jitterX = shake > 0 ? (Math.sin(state.time * 61) * shake) / 2 : 0;
    const jitterY = shake > 0 ? (Math.cos(state.time * 47) * shake) / 2 : 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.nightDeep;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offsetX + jitterX * scale, offsetY + jitterY * scale);
  }

  /** Draw a whole frame. `overlay` is the screen drawn over the fight (title, pause, boons). */
  function draw(state, overlay, extra) {
    begin(state);
    drawBackdrop(state);
    drawArena(state);
    if (state) {
      drawMotes(state);
      drawBodies(state);
      drawParticles(state);
      drawPlayer(state);
      drawOverlayLayer(state, overlay, extra);
      drawHud(state);
    }
  }

  /** The title screen has no run behind it: a still, quiet backdrop and the logo. */
  function drawTitle(state, extra) {
    begin({ time: 0, shake: 0 });
    drawBackdrop({ time: state?.time ?? 0 });
    drawArena({ time: state?.time ?? 0 });
    drawParticles({ particles: [] });
    drawTitleScreen(state, extra);
  }

  function drawBackdrop(state) {
    const night = ctx.createLinearGradient(0, 0, 0, VIEW.height);
    night.addColorStop(0, PALETTE.nightDeep);
    night.addColorStop(0.55, PALETTE.night);
    night.addColorStop(1, '#0d1426');
    ctx.fillStyle = night;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    for (const star of stars) {
      const twinkle = 0.55 + 0.45 * Math.sin(state.time * star.speed + star.phase);
      ctx.globalAlpha = star.alpha * twinkle;
      ctx.fillStyle = star.warm ? PALETTE.ember : PALETTE.bone;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // The horizon glow: the last fire somewhere off the bottom of the field.
    const glow = ctx.createRadialGradient(VIEW.width / 2, VIEW.height + 90, 40, VIEW.width / 2, VIEW.height + 90, 620);
    glow.addColorStop(0, 'rgba(255, 122, 61, 0.30)');
    glow.addColorStop(0.45, 'rgba(255, 122, 61, 0.09)');
    glow.addColorStop(1, 'rgba(255, 122, 61, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  }

  function drawArena(state) {
    ctx.save();
    ctx.strokeStyle = 'rgba(233, 239, 249, 0.13)';
    ctx.lineWidth = 2;
    roundRect(ARENA.x, ARENA.y, ARENA.width, ARENA.height, 22);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 181, 74, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([9, 13]);
    roundRect(ARENA.x + 9, ARENA.y + 9, ARENA.width - 18, ARENA.height - 18, 17);
    ctx.stroke();
    ctx.setLineDash([]);

    // A faint ember wash inside the ring, so the fighting floor is warmer than the night.
    const wash = ctx.createRadialGradient(VIEW.width / 2, VIEW.height / 2, 60, VIEW.width / 2, VIEW.height / 2, 620);
    wash.addColorStop(0, 'rgba(255, 181, 74, 0.055)');
    wash.addColorStop(1, 'rgba(255, 181, 74, 0)');
    ctx.fillStyle = wash;
    ctx.fillRect(ARENA.x, ARENA.y, ARENA.width, ARENA.height);

    const pulse = state && state.bloomPulse > 0 ? state.bloomPulse / BLOOM.duration : 0;
    if (pulse > 0) {
      ctx.globalAlpha = pulse * 0.5;
      ctx.strokeStyle = PALETTE.bloom;
      ctx.lineWidth = 5;
      roundRect(ARENA.x, ARENA.y, ARENA.width, ARENA.height, 22);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawMotes(state) {
    for (const mote of state.motes) {
      const bob = Math.sin(mote.phase) * 1.6;
      ctx.globalAlpha = clamp(mote.life / 1.6, 0, 1);
      const halo = ctx.createRadialGradient(mote.x, mote.y + bob, 1, mote.x, mote.y + bob, 18);
      halo.addColorStop(0, 'rgba(125, 226, 209, 0.55)');
      halo.addColorStop(1, 'rgba(125, 226, 209, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y + bob, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.moth;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y + bob, mote.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#eafffb';
      ctx.beginPath();
      ctx.arc(mote.x - 1.5, mote.y + bob - 1.5, mote.radius * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawBodies(state) {
    for (const body of state.bodies) {
      if (body.kind === KIND_ENEMY) drawEnemy(body);
      else if (body.kind === KIND_SPARK) drawSpark(body);
      else if (body.kind === KIND_SPIT) drawSpit(body);
    }
  }

  /** Every enemy is a body with an eye, its own silhouette and a wind-up tell. Each silhouette is
   *  filled in its own colour and then ringed in a dark outline, so nothing sinks into the night. */
  function drawEnemy(body) {
    const hurt = body.hurt > 0;
    const colour = hurt ? '#ffffff' : body.colour;
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.rotate(body.angle * 0.35);

    // A soft halo in the body's own colour separates it from whatever is behind it.
    const aura = ctx.createRadialGradient(0, 0, body.radius * 0.5, 0, 0, body.radius * 1.85);
    aura.addColorStop(0, hexAlpha(colour, 0.34));
    aura.addColorStop(1, hexAlpha(colour, 0));
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, body.radius * 1.85, 0, Math.PI * 2);
    ctx.fill();

    if (body.state === 'windup') {
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(body.stateClock * 26);
      ctx.fillStyle = PALETTE.blood;
      ctx.beginPath();
      ctx.arc(0, 0, body.radius * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = 'rgba(4, 6, 13, 0.92)';
    ctx.lineWidth = body.boss ? 3 : 2.2;
    ctx.lineJoin = 'round';

    switch (body.recipe) {
      case 'wisp': {
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (let i = 0; i < 7; i += 1) {
          const angle = (i / 7) * Math.PI * 2;
          const radius = i % 2 === 0 ? body.radius : body.radius * 0.62;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'lunger': {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(body.radius * 1.5, 0);
        ctx.lineTo(-body.radius * 0.7, body.radius * 0.95);
        ctx.lineTo(-body.radius * 0.3, 0);
        ctx.lineTo(-body.radius * 0.7, -body.radius * 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'spitter': {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(0, 0, body.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = body.accent;
        for (let i = 0; i < 5; i += 1) {
          const angle = (i / 5) * Math.PI * 2 + body.phase;
          ctx.beginPath();
          ctx.arc(Math.cos(angle) * body.radius * 0.6, Math.sin(angle) * body.radius * 0.6, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'splitter': {
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const angle = (i / 6) * Math.PI * 2 + body.phase * 0.4;
          const x = Math.cos(angle) * body.radius;
          const y = Math.sin(angle) * body.radius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = body.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-body.radius * 0.5, 0);
        ctx.lineTo(body.radius * 0.5, 0);
        ctx.stroke();
        break;
      }
      case 'warden': {
        const glow = ctx.createRadialGradient(0, 0, body.radius * 0.4, 0, 0, body.radius * 2.4);
        glow.addColorStop(0, 'rgba(255, 122, 61, 0.5)');
        glow.addColorStop(1, 'rgba(255, 122, 61, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, body.radius * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (let i = 0; i < 8; i += 1) {
          const angle = (i / 8) * Math.PI * 2;
          const radius = i % 2 === 0 ? body.radius : body.radius * 0.76;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = body.accent;
        ctx.beginPath();
        ctx.arc(0, 0, body.radius * 0.44, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
      default: {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.ellipse(0, 0, body.radius, body.radius * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Two eyes, so every silhouette faces the player.
    const eye = body.recipe === 'warden' ? 7 : 3.4;
    ctx.fillStyle = body.recipe === 'warden' ? PALETTE.nightDeep : PALETTE.nightDeep;
    ctx.beginPath();
    ctx.arc(body.radius * 0.32, -body.radius * 0.3, eye, 0, Math.PI * 2);
    ctx.arc(body.radius * 0.32, body.radius * 0.3, eye, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // A hairline health bar over anything that has taken a knock, and always over a warden.
    if (body.boss || body.hp < body.maxHp) {
      const width = body.boss ? 120 : body.radius * 2.4;
      const height = body.boss ? 7 : 3.5;
      const x = body.x - width / 2;
      const y = body.y - body.radius - (body.boss ? 20 : 11);
      ctx.fillStyle = 'rgba(5, 7, 15, 0.75)';
      ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
      ctx.fillStyle = body.boss ? PALETTE.ember : PALETTE.blood;
      ctx.fillRect(x, y, width * clamp(body.hp / body.maxHp, 0, 1), height);
    }
  }

  function drawSpark(body) {
    const fade = clamp(body.life / body.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.35 + fade * 0.65;
    const trailLength = 16 + fade * 12;
    const tail = ctx.createLinearGradient(
      body.x - Math.cos(body.angle) * trailLength,
      body.y - Math.sin(body.angle) * trailLength,
      body.x,
      body.y,
    );
    tail.addColorStop(0, 'rgba(255, 181, 74, 0)');
    tail.addColorStop(1, 'rgba(255, 230, 168, 0.95)');
    ctx.strokeStyle = tail;
    ctx.lineWidth = body.radius * 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(body.x - Math.cos(body.angle) * trailLength, body.y - Math.sin(body.angle) * trailLength);
    ctx.lineTo(body.x, body.y);
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#fff8e2';
    ctx.beginPath();
    ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSpit(body) {
    const pulse = 1 + Math.sin(body.life * 22) * 0.12;
    ctx.save();
    const halo = ctx.createRadialGradient(body.x, body.y, 1, body.x, body.y, body.radius * 3);
    halo.addColorStop(0, 'rgba(255, 77, 109, 0.4)');
    halo.addColorStop(1, 'rgba(255, 77, 109, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(body.x, body.y, body.radius * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = body.colour === 'rot' ? PALETTE.rot : PALETTE.ember;
    ctx.beginPath();
    ctx.arc(body.x, body.y, body.radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles(state) {
    for (const p of state.particles) {
      const fade = clamp(p.life / (p.maxLife || 1), 0, 1);
      ctx.globalAlpha = fade * (p.kind === 'trail' ? 0.5 : 0.9);
      ctx.fillStyle = COLOUR[p.colour] ?? PALETTE.ash;
      if (p.kind === 'ring') {
        ctx.strokeStyle = COLOUR[p.colour] ?? PALETTE.bloom;
        ctx.lineWidth = p.size * fade * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (2.4 - fade), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.kind === 'burst' ? fade + 0.4 : 1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** The keeper: a moth with lantern wings, a halo of wick light and a bloom meter around it. */
  function drawPlayer(state) {
    const player = state.player;
    const flicker = 0.86 + Math.sin(state.time * 9) * 0.08;
    ctx.save();
    ctx.translate(player.x, player.y);

    // The lantern halo: the keeper is the brightest small thing on the field, so it always reads.
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 82);
    halo.addColorStop(0, `rgba(255, 236, 190, ${0.42 * flicker})`);
    halo.addColorStop(0.4, 'rgba(255, 181, 74, 0.16)');
    halo.addColorStop(1, 'rgba(255, 181, 74, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 82, 0, Math.PI * 2);
    ctx.fill();

    // The dash and the hit invulnerability both read as a ring around the body.
    if (state.dashTime > 0) {
      ctx.strokeStyle = 'rgba(125, 226, 209, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (player.invuln > 0 && state.dashTime <= 0) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(state.time * 34);
      ctx.strokeStyle = PALETTE.blood;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.rotate(player.aim + Math.PI / 2);

    // Wings: two moth wings either side of the body, beating on the run clock, outlined so they
    // stay distinct from the starfield.
    const beat = Math.sin(state.time * 14) * 0.16;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(4, 6, 13, 0.9)';
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.rotate(side * (0.52 + beat));
      const wing = ctx.createLinearGradient(0, 0, side * 30, 14);
      wing.addColorStop(0, '#9df3e2');
      wing.addColorStop(1, '#2f8f86');
      ctx.fillStyle = wing;
      ctx.beginPath();
      ctx.moveTo(0, 5);
      ctx.bezierCurveTo(side * 18, -14, side * 34, -2, side * 30, 6);
      ctx.bezierCurveTo(side * 26, 18, side * 10, 16, 0, 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // The body: a bright lantern-shaped husk with a dark outline and a white core.
    ctx.beginPath();
    ctx.moveTo(0, -player.radius * 1.15);
    ctx.bezierCurveTo(player.radius * 0.85, -player.radius * 0.6, player.radius * 0.8, player.radius * 0.6, 0, player.radius * 1.1);
    ctx.bezierCurveTo(-player.radius * 0.8, player.radius * 0.6, -player.radius * 0.85, -player.radius * 0.6, 0, -player.radius * 1.15);
    ctx.closePath();
    ctx.fillStyle = PALETTE.wick;
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(4, 6, 13, 0.92)';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, -player.radius * 0.34, player.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // The wick, and a bright bead at its tip: the direction the keeper is facing.
    ctx.strokeStyle = PALETTE.flame;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(0, -player.radius * 1.0);
    ctx.lineTo(0, -player.radius * 1.9);
    ctx.stroke();
    ctx.fillStyle = '#fff3cf';
    ctx.beginPath();
    ctx.arc(0, -player.radius * 2.05, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawBloomMeter(state);
  }

  /** The bloom meter: eight pips in a ring, filled as motes are gathered. */
  function drawBloomMeter(state) {
    const player = state.player;
    const ready = state.bloomCharge >= BLOOM.chargeNeeded;
    ctx.save();
    ctx.translate(player.x, player.y);
    for (let i = 0; i < BLOOM.chargeNeeded; i += 1) {
      const angle = -Math.PI / 2 + (i / BLOOM.chargeNeeded) * Math.PI * 2;
      const radius = player.radius + 15;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const filled = i < state.bloomCharge;
      ctx.globalAlpha = filled ? (ready ? 0.7 + 0.3 * Math.sin(state.time * 7) : 0.95) : 0.22;
      ctx.fillStyle = filled ? PALETTE.bloom : PALETTE.ash;
      ctx.beginPath();
      ctx.arc(x, y, filled ? 3.2 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (ready) {
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.12 * Math.sin(state.time * 5);
      ctx.strokeStyle = PALETTE.bloom;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.radius + 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /** The HUD: hearts, score, wave, clock and the combo, along the top of the field. */
  function drawHud(state) {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 15, 0.42)';
    roundRect(ARENA.x + 10, ARENA.y + 10, ARENA.width - 20, 56, 14);
    ctx.fill();

    // Hearts.
    for (let i = 0; i < state.player.maxHp; i += 1) {
      const full = i < state.player.hp;
      drawHeart(ARENA.x + 40 + i * 30, ARENA.y + 38, full);
    }

    // Score, with the combo multiplier beside it when it is above one.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('SCORE', ARENA.x + 210, ARENA.y + 28);
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '700 24px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(String(state.score).padStart(5, '0'), ARENA.x + 210, ARENA.y + 46);
    if (state.combo > 1.02) {
      ctx.fillStyle = PALETTE.ember;
      ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(`x${state.combo.toFixed(2)}`, ARENA.x + 320, ARENA.y + 46);
    }

    // Wave, centred.
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    // A death ends the run too, so the banner keys off the win, not the phase: a run that fell in
    // wave eight says so, rather than claiming it reached the final.
    const waveLabel = state.won ? 'ALL TEN HELD' : `WAVE ${Math.min(state.waveIndex + 1, 10)} / 10`;
    ctx.fillText(waveLabel, VIEW.width / 2, ARENA.y + 28);
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '700 17px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(state.waveName || 'Gathering', VIEW.width / 2, ARENA.y + 48);

    // Clock and the broom/kill count.
    ctx.textAlign = 'right';
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('TIME', ARENA.x + ARENA.width - 150, ARENA.y + 28);
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '700 20px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(formatClock(state.time), ARENA.x + ARENA.width - 150, ARENA.y + 46);
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${state.kills} slain`, ARENA.x + ARENA.width - 40, ARENA.y + 46);

    // The warden's long health bar, under the HUD, while it lives.
    if (state.boss && state.boss.hp > 0) {
      const width = 420;
      const x = VIEW.width / 2 - width / 2;
      const y = ARENA.y + 78;
      ctx.fillStyle = 'rgba(5, 7, 15, 0.6)';
      roundRect(x - 2, y - 2, width + 4, 12, 6);
      ctx.fill();
      ctx.fillStyle = PALETTE.flame;
      roundRect(x, y, width * clamp(state.boss.hp / state.bossMaxHp, 0, 1), 8, 4);
      ctx.fill();
      ctx.fillStyle = PALETTE.wick;
      ctx.textAlign = 'center';
      ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(state.boss.name.toUpperCase(), VIEW.width / 2, y - 10);
    }

    if (state.hurtFlash > 0) {
      ctx.globalAlpha = clamp(state.hurtFlash, 0, 0.5) * 0.6;
      ctx.fillStyle = PALETTE.blood;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawHeart(x, y, full) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.bezierCurveTo(-9, -3, -7, -10, 0, -5);
    ctx.bezierCurveTo(7, -10, 9, -3, 0, 5);
    ctx.closePath();
    ctx.fillStyle = full ? PALETTE.blood : 'rgba(255, 77, 109, 0.16)';
    ctx.fill();
    if (full) {
      ctx.strokeStyle = 'rgba(255, 230, 168, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Screens drawn over the fight: the title, the pause card, the boon draft and the end. */
  function drawOverlayLayer(state, overlay, extra) {
    if (!overlay) return;
    if (overlay === SCREEN_TITLE) drawTitleScreen(state, extra);
    else if (overlay === SCREEN_PAUSED) drawPauseCard(state);
    else if (overlay === SCREEN_BOONS) drawBoonCards(state, extra);
    else if (overlay === SCREEN_OVER || overlay === SCREEN_WIN) drawEndCard(state, overlay === SCREEN_WIN, extra);
  }

  function drawTitleScreen(state, extra) {
    // Fade in over the first half-second of screen time, so a screenshot taken later is at full
    // strength and a player still sees it arrive.
    const entry = easeOutCubic(clamp((state?.time ?? 0) / 0.5, 0, 1));
    ctx.save();
    ctx.globalAlpha = entry;
    ctx.textAlign = 'center';

    const glow = ctx.createRadialGradient(VIEW.width / 2, 300, 20, VIEW.width / 2, 300, 340);
    glow.addColorStop(0, 'rgba(255, 181, 74, 0.18)');
    glow.addColorStop(1, 'rgba(255, 181, 74, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    ctx.fillStyle = PALETTE.wick;
    ctx.font = '800 92px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('WICKFALL', VIEW.width / 2, 268);
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '600 20px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Ten waves. One keeper. The last flame.', VIEW.width / 2, 308);
    // The one line the tagline leaves out: what actually wins and loses. A player should not have
    // to infer the rulebook from the verb list, and the start screen is where the goal belongs.
    // Drawn one step brighter than the control text so it reads as the rule, not another control.
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '600 17px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Clear all ten waves to hold the flame.', VIEW.width / 2, 342);
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '500 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Lose all three hearts and the wick goes out.', VIEW.width / 2, 366);

    // A lone moth above the wordmark, beating its wings on the clock.
    const bob = Math.sin((state?.time ?? 0) * 2.4) * 6;
    drawTitleMoth(VIEW.width / 2, 170 + bob, state?.time ?? 0);

    // The controls, one row each: the key in ember on the left, what it does in ash on the right.
    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    const lines = [
      ['WASD or arrows', 'move'],
      ['mouse or J', 'throw sparks'],
      ['space', 'dash through danger'],
      ['shift or E', 'bloom, once the ring is lit'],
      ['P', 'pause'],
    ];
    lines.forEach(([key, what], index) => {
      const y = 404 + index * 30;
      ctx.textAlign = 'right';
      ctx.fillStyle = PALETTE.ember;
      ctx.fillText(key, VIEW.width / 2 - 18, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = PALETTE.ash;
      ctx.fillText(what, VIEW.width / 2 + 18, y);
    });

    const pulse = 0.6 + 0.4 * Math.sin((state?.time ?? 0) * 3.2);
    ctx.textAlign = 'center';
    ctx.globalAlpha = entry * pulse;
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '700 22px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('press ENTER or click to begin', VIEW.width / 2, 588);
    ctx.globalAlpha = entry;
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`best ${extra?.best ?? 0}`, VIEW.width / 2, 622);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawTitleMoth(x, y, time) {
    ctx.save();
    ctx.translate(x, y);
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 90);
    halo.addColorStop(0, 'rgba(255, 230, 168, 0.5)');
    halo.addColorStop(1, 'rgba(255, 181, 74, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 90, 0, Math.PI * 2);
    ctx.fill();
    const beat = Math.sin(time * 5.5) * 0.22;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.rotate(side * (0.62 + beat));
      ctx.fillStyle = 'rgba(125, 226, 209, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.quadraticCurveTo(side * 34, -16, side * 46, 4);
      ctx.quadraticCurveTo(side * 36, 24, 0, 14);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = PALETTE.wick;
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPauseCard(state) {
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 15, 0.72)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '800 46px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('PAUSED', VIEW.width / 2, 320);
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 17px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('P or ESC resumes · R restarts the run', VIEW.width / 2, 362);
    ctx.restore();
  }

  /** The boon draft: three cards, each with its name, its change and the stat it moves. */
  function drawBoonCards(state, extra) {
    const cards = extra?.cards ?? [];
    ctx.save();
    ctx.fillStyle = 'rgba(5, 7, 15, 0.78)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    // The director has already advanced waveIndex past the wave just finished, so that number is
    // the wave that was cleared, not the one coming.
    ctx.fillText(`WAVE ${Math.max(1, state.waveIndex)} CLEARED`, VIEW.width / 2, 150);
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '800 40px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Choose a boon', VIEW.width / 2, 200);
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('1, 2 or 3 — or click a card', VIEW.width / 2, 232);

    const cardWidth = 300;
    const cardHeight = 250;
    const gap = 34;
    const totalWidth = cards.length * cardWidth + (cards.length - 1) * gap;
    const startX = VIEW.width / 2 - totalWidth / 2;
    cards.forEach((card, index) => {
      const x = startX + index * (cardWidth + gap);
      const y = 280;
      const hovered = extra?.hover === index;
      ctx.fillStyle = hovered ? 'rgba(255, 181, 74, 0.16)' : 'rgba(19, 27, 49, 0.94)';
      roundRect(x, y, cardWidth, cardHeight, 18);
      ctx.fill();
      ctx.strokeStyle = hovered ? PALETTE.ember : 'rgba(233, 239, 249, 0.2)';
      ctx.lineWidth = hovered ? 2.5 : 1.5;
      roundRect(x, y, cardWidth, cardHeight, 18);
      ctx.stroke();

      ctx.fillStyle = PALETTE.ember;
      ctx.font = '800 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(index + 1), x + cardWidth / 2, y + 30);
      ctx.fillStyle = PALETTE.bone;
      ctx.font = '800 25px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(card.name, x + cardWidth / 2, y + 76);
      ctx.fillStyle = COLOUR[card.tone] ?? PALETTE.wick;
      ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(card.detail, x + cardWidth / 2, y + 112);

      ctx.fillStyle = PALETTE.ash;
      ctx.font = '500 14px ui-sans-serif, system-ui, sans-serif';
      wrapText(card.blurb, x + cardWidth / 2, y + 152, cardWidth - 44, 20);

      if (extra?.taken?.[card.id]) {
        ctx.fillStyle = PALETTE.moth;
        ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(`taken x${extra.taken[card.id]}`, x + cardWidth / 2, y + cardHeight - 18);
      }
    });
    ctx.restore();
  }

  function drawEndCard(state, won, extra) {
    ctx.save();
    ctx.fillStyle = won ? 'rgba(10, 15, 30, 0.82)' : 'rgba(20, 8, 14, 0.82)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = won ? PALETTE.ember : PALETTE.blood;
    ctx.font = '800 64px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(won ? 'THE FLAME HOLDS' : 'THE WICK GOES OUT', VIEW.width / 2, 250);
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 17px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(
      won ? 'All ten waves broken. The dark steps back.' : `You fell in wave ${Math.min(state.waveIndex + 1, 10)} of ten.`,
      VIEW.width / 2,
      292,
    );

    ctx.fillStyle = PALETTE.bone;
    ctx.font = '800 58px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(String(state.score), VIEW.width / 2, 384);
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('SCORE', VIEW.width / 2, 412);

    const stats = [
      ['waves cleared', `${Math.min(state.waveIndex, 10)}`],
      ['slain', `${state.kills}`],
      ['time', formatClock(state.time)],
      ['best', String(extra?.best ?? state.score)],
    ];
    stats.forEach(([label, value], index) => {
      const x = VIEW.width / 2 - 300 + index * 200;
      ctx.fillStyle = PALETTE.ember;
      ctx.font = '800 22px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(value, x, 480);
      ctx.fillStyle = PALETTE.ash;
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(label, x, 502);
    });

    const pulse = 0.6 + 0.4 * Math.sin(state.time * 3.2);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = PALETTE.wick;
    ctx.font = '700 20px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('press R or ENTER to run again', VIEW.width / 2, 570);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** The title fade-in, keyed so a restart replays it. */
  function fadeFor(key) {
    if (!fades.has(key)) fades.set(key, 0);
    const value = Math.min(1, fades.get(key) + 0.05);
    fades.set(key, value);
    return easeOutCubic(value);
  }

  /** A plain word wrapper for the boon cards; canvas has none and the text is short. */
  function wrapText(text, centreX, top, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let y = top;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, centreX, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, centreX, y);
  }

  function roundRect(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  return { draw, drawTitle, drawHud, resize };
}

/** `#rrggbb` plus an alpha, as the `rgba()` strings canvas wants. */
function hexAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A fixed star field: three size classes, a few warm ones, deterministic from a constant seed. */
function makeStars(count) {
  let seed = 0x51ed270b;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    stars.push({
      x: next() * VIEW.width,
      y: next() * VIEW.height,
      size: 0.6 + next() * 1.6,
      alpha: 0.25 + next() * 0.5,
      speed: 0.6 + next() * 1.9,
      phase: next() * Math.PI * 2,
      warm: next() < 0.18,
    });
  }
  return stars;
}
