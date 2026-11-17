// The renderer: one canvas, drawn back to front, with no images and no fonts to load. Everything
// is a shape, a gradient or a short line of text, so the game has no assets at all and still has a
// look: a cold blue night, a warm ember glow, and a moth carrying the last flame.

import { ARENA, BLOOM, PALETTE, PLAYER, VIEW, WAVE } from './config.js';
import { BOONS, countBoons } from './boons.js';
import { KIND_ENEMY, KIND_SPARK, KIND_SPIT } from './world.js';
import { clamp, easeOutCubic, formatClock } from './util.js';

/** Two decimals at most, with no trailing zeros: a stat readout, not a measurement. */
function round2(value) {
  return String(Math.round(value * 100) / 100);
}

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

export function createRenderer(canvas, { shotMode = false } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  /** A fixed star field, so the background never shimmers between frames. */
  const stars = makeStars(150);
  const fades = new Map();

  /** Fit the logical 1280x720 field into whatever the window is, letterboxed and crisp. */
  function resize() {
    // In a screenshot scene the canvas is the field itself. The page is captured at exactly 1280x720,
    // but a headless viewport is 80 px shorter than the window (browser chrome), so fitting to
    // innerHeight would scale the game to 89% and leave a dead band across the bottom of every shot.
    // The capture is the deliverable here, so the frame drops the fit and draws 1:1.
    const width = shotMode ? VIEW.width : Math.max(1, Math.floor(window.innerWidth * (window.devicePixelRatio || 1)));
    const height = shotMode ? VIEW.height : Math.max(1, Math.floor(window.innerHeight * (window.devicePixelRatio || 1)));
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
      // The stage is the arena: nothing the simulation owns is drawn outside its frame. Without
      // this clip a glow or a stray tracer paints into the black letterbox and the arena edge stops
      // reading as a boundary.
      //
      // A results card is not a fight. Bodies, sparks and score pops behind the card read as smears
      // through the veil, so the card gets the empty night sky instead — the bokeh in the backdrop
      // is deliberate, a half-erased warden at 6% opacity is not.
      const results = overlay === SCREEN_OVER || overlay === SCREEN_WIN;
      if (!results) {
        ctx.save();
        roundRect(ARENA.x, ARENA.y, ARENA.width, ARENA.height, 22);
        ctx.clip();
        drawMotes(state);
        drawBodies(state);
        drawParticles(state);
        drawPlayer(state);
        // Score pops last, over the field: a number for a kill the player just earned cannot be
        // occluded by the body it was earned on, which is exactly where it is spawned.
        drawPopups(state);
        ctx.restore();
      }
      // The live HUD is for the fight only. A results card that still shows hearts, the run clock
      // and a kill count behind it repeats the card's own stats in a second, misaligned place.
      if (!results) drawHud(state);
      drawOverlayLayer(state, overlay, extra);
      drawBanner(state, overlay);
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

    // An elite wears a rotating crown of spikes, drawn under the body so the silhouette reads first.
    if (body.elite) {
      ctx.save();
      ctx.rotate(-body.angle * 0.35 + (body.stateClock || 0) * 1.1);
      ctx.strokeStyle = 'rgba(255, 230, 168, 0.85)';
      ctx.lineWidth = 2;
      const spikes = 9;
      for (let i = 0; i < spikes; i += 1) {
        const angle = (i / spikes) * Math.PI * 2;
        const inner = body.radius * 1.18;
        const outer = body.radius * (i % 2 === 0 ? 1.62 : 1.4);
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }

    // A soft halo in the body's own colour separates it from whatever is behind it.
    const aura = ctx.createRadialGradient(0, 0, body.radius * 0.5, 0, 0, body.radius * 1.85);
    aura.addColorStop(0, hexAlpha(colour, body.elite ? 0.5 : 0.34));
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

    // A hairline health bar over anything that has taken a knock. Never over a warden: the HUD's long
    // bar already tracks its health, and two bars for one body at different fills reads as a bug.
    if (!body.boss && body.hp < body.maxHp) {
      const width = body.radius * 2.4;
      const height = 3.5;
      const x = body.x - width / 2;
      const y = body.y - body.radius - 11;
      ctx.fillStyle = 'rgba(5, 7, 15, 0.75)';
      ctx.fillRect(x - 1, y - 1, width + 2, height + 2);
      ctx.fillStyle = PALETTE.blood;
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
    // The keeper's fire wears the same construction as a spit — a dark separator ring around a hot
    // core — so the two projectiles on the field are told apart by colour and never by brightness.
    // Without the ring a warm speck is indistinguishable from a star, and a mint rim made it
    // indistinguishable from a bloom mote, which is the pickup the player is meant to chase.
    ctx.beginPath();
    ctx.arc(body.x, body.y, body.radius + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4, 6, 13, 0.9)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(body.x, body.y, body.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#fff8e2';
    ctx.fill();

    // A point of white on the leading edge: the spark has a direction as well as a colour.
    ctx.globalAlpha = fade * 0.9;
    ctx.beginPath();
    ctx.arc(body.x + Math.cos(body.angle) * body.radius * 0.3,
      body.y + Math.sin(body.angle) * body.radius * 0.3, body.radius * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }

  /** A spit is the one thing that hurts the keeper on contact, so it is drawn as a hard, hot
   *  projectile: a white core inside a saturated rim inside a black ring. Nothing in the backdrop or
   *  the pickup set has that outline, so it can never be mistaken for ambience at a glance. */
  function drawSpit(body) {
    const pulse = 1 + Math.sin(body.life * 22) * 0.1;
    const r = body.radius * pulse;
    ctx.save();
    const halo = ctx.createRadialGradient(body.x, body.y, 1, body.x, body.y, r * 3);
    halo.addColorStop(0, 'rgba(255, 77, 109, 0.42)');
    halo.addColorStop(1, 'rgba(255, 77, 109, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(body.x, body.y, r * 3, 0, Math.PI * 2);
    ctx.fill();

    // The dark ring: this is what separates a spit from a mote or a star.
    ctx.beginPath();
    ctx.arc(body.x, body.y, r + 2.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(4, 6, 13, 0.95)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(body.x, body.y, r, 0, Math.PI * 2);
    ctx.fillStyle = body.colour === 'rot' ? PALETTE.rot : PALETTE.ember;
    ctx.fill();

    // The hot core and a small specular bead: reads as fast and dangerous, not as a glow.
    ctx.beginPath();
    ctx.arc(body.x, body.y, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = '#fffaf0';
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
    halo.addColorStop(0, `rgba(255, 236, 190, ${0.46 * flicker})`);
    halo.addColorStop(0.35, 'rgba(255, 181, 74, 0.20)');
    halo.addColorStop(0.62, 'rgba(125, 226, 209, 0.10)');
    halo.addColorStop(1, 'rgba(255, 181, 74, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 82, 0, Math.PI * 2);
    ctx.fill();

    // A cold ring at the halo's edge. Nothing else on the field wears cyan in a circle, so at
    // thumbnail size — where the body is three pixels of cream — this ring is what finds the keeper.
    ctx.strokeStyle = 'rgba(125, 226, 209, 0.34)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius + 21, 0, Math.PI * 2);
    ctx.stroke();

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

    // The muzzle flash: for the first half of every cooldown a short hot wedge sits along the aim
    // line. It is the one mark that ties the sparks in flight to the body that fired them — without
    // it a volley reads as ambient light that happens to be near the keeper.
    const cooldown = state.stats?.cooldown || 0.24;
    const flash = clamp(state.fireClock / cooldown, 0, 1);
    if (flash > 0) {
      const reach = player.radius + 26 - 10 * (1 - flash);
      const spread = 0.30 + 0.14 * (1 - flash);
      ctx.save();
      ctx.rotate(player.aim);
      ctx.globalAlpha = 0.62 * flash;
      const wedge = ctx.createLinearGradient(0, 0, reach, 0);
      wedge.addColorStop(0, 'rgba(255, 236, 190, 0.95)');
      wedge.addColorStop(1, 'rgba(255, 181, 74, 0)');
      ctx.fillStyle = wedge;
      ctx.beginPath();
      ctx.moveTo(player.radius * 0.6, 0);
      ctx.arc(0, 0, reach, -spread, spread);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
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
    // Opaque enough that a body drifting up the screen cannot read as part of the readout: the
    // strip is a bar, not a wash, so nothing behind it is mistaken for a meter or a health bar.
    const strip = ctx.createLinearGradient(0, ARENA.y + 10, 0, ARENA.y + 70);
    strip.addColorStop(0, 'rgba(5, 7, 15, 0.88)');
    strip.addColorStop(1, 'rgba(5, 7, 15, 0.72)');
    ctx.fillStyle = strip;
    roundRect(ARENA.x + 10, ARENA.y + 10, ARENA.width - 20, 60, 14);
    ctx.fill();

    // Hearts.
    for (let i = 0; i < state.player.maxHp; i += 1) {
      const full = i < state.player.hp;
      drawHeart(ARENA.x + 40 + i * 30, ARENA.y + 34, full);
    }

    // The flawless tally sits beside the hearts, inside the strip: it is the run's second score and
    // it does not belong floating over the playfield where a body can drift through it.
    if (state.flawless > 0) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      // Bright, not dim red: this is the stat the whole scoring bonus hangs on, and at 12 px in dark
      // red it was the one readout that failed a contrast check at a glance.
      ctx.fillStyle = PALETTE.moth;
      ctx.font = '800 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(`${state.flawless} flawless`, ARENA.x + 46, ARENA.y + 54);
    }

    // Score, with the combo multiplier beside it when it is above one.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('SCORE', ARENA.x + 210, ARENA.y + 27);
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '800 28px ui-sans-serif, system-ui, sans-serif';
    // The same thousands-separated figures the results card prints: a score that gains a comma only
    // once the run ends reads as a different number, not the same one getting bigger.
    ctx.fillText(state.score.toLocaleString('en-US'), ARENA.x + 210, ARENA.y + 50);
    if (state.combo > 1.02) {
      ctx.fillStyle = PALETTE.ember;
      ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(`x${state.combo.toFixed(2)}`, ARENA.x + 330, ARENA.y + 48);
    }

    // Wave, centred.
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '800 14px ui-sans-serif, system-ui, sans-serif';
    // A death ends the run too, so the banner keys off the win, not the phase: a run that fell in
    // wave eight says so, rather than claiming it reached the final.
    const waveLabel = state.won ? 'ALL TEN HELD' : `WAVE ${Math.min(state.waveIndex + 1, 10)} / 10`;
    ctx.fillText(waveLabel, VIEW.width / 2, ARENA.y + 27);
    ctx.fillStyle = PALETTE.wick;
    ctx.font = '700 21px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(state.waveName || 'Gathering', VIEW.width / 2, ARENA.y + 51);

    // Clock and the kill count.
    ctx.textAlign = 'right';
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('TIME', ARENA.x + ARENA.width - 160, ARENA.y + 27);
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '800 26px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(formatClock(state.time), ARENA.x + ARENA.width - 160, ARENA.y + 50);
    // Kills in the warm accent, not grey: at thumbnail size grey-on-black is the first thing gone,
    // and the kill count is the number that says the loop is rewarding.
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${state.kills} slain`, ARENA.x + ARENA.width - 40, ARENA.y + 50);

    // The build the run has drafted, on its own slim bar along the arena floor. In the playfield they
      // read as enemy name plates floating over the fight; on a bar that mirrors the HUD strip they are
      // unmistakably part of the readout, and the loop's payoff is visible during the fight itself.
      const footerY = ARENA.y + ARENA.height - 40;
      if ((state.boons ?? []).length > 0) {
        // Opaque, like the top strip: a body drifting along the floor otherwise shows through the
        // dock and reads as an enemy half-buried in the HUD.
        const bar = ctx.createLinearGradient(0, footerY, 0, footerY + 32);
        bar.addColorStop(0, 'rgba(5, 7, 15, 0.86)');
        bar.addColorStop(1, 'rgba(5, 7, 15, 0.94)');
        ctx.fillStyle = bar;
        roundRect(ARENA.x + 10, footerY, ARENA.width - 20, 32, 12);
        ctx.fill();
      }
      drawBuildStrip(state, footerY + 16);

    // The warden's long health bar, under the strip, while it lives: the name gets its own line
    // above the track with a clear gap, so a label never sits on top of the bar it labels. The plate
    // behind it keeps a body that has drifted up the field from printing over the warden's name.
    if (state.boss && state.boss.hp > 0) {
      const width = 420;
      const x = VIEW.width / 2 - width / 2;
      const y = ARENA.y + 98;
      ctx.fillStyle = 'rgba(5, 7, 15, 0.78)';
      roundRect(x - 26, y - 40, width + 52, 60, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(5, 7, 15, 0.72)';
      roundRect(x - 3, y - 3, width + 6, 14, 7);
      ctx.fill();
      // The spent track is a dim bar, not a bright one: a lighter grey ghost reads as a second,
      // healthier bar rather than as the part already taken off.
      ctx.fillStyle = 'rgba(233, 239, 249, 0.09)';
      roundRect(x, y, width, 8, 4);
      ctx.fill();
      ctx.fillStyle = PALETTE.flame;
      roundRect(x, y, width * clamp(state.boss.hp / state.bossMaxHp, 0, 1), 8, 4);
      ctx.fill();
      ctx.fillStyle = PALETTE.wick;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(state.boss.name.toUpperCase(), VIEW.width / 2, y - 14);
    }

    if (state.hurtFlash > 0) {
      ctx.globalAlpha = clamp(state.hurtFlash, 0, 0.5) * 0.6;
      ctx.fillStyle = PALETTE.blood;
      ctx.fillRect(0, 0, VIEW.width, VIEW.height);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /**
   * The drafted build, as chips on the arena floor. Each chip is the boon's tone colour and its
   * count, so the row reads as a build at a glance and stays legible at thumbnail size: a chip says
   * *which* axis was taken and *how deep*, which no single stat readout on the HUD can show.
   */
  function drawBuildStrip(state, atY = ARENA.y + ARENA.height - 30) {
    const taken = state.boons ?? [];
    if (taken.length === 0) return;
    const counts = countBoons(taken);
    const order = BOONS.filter((boon) => counts.has(boon.id));
    if (order.length === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';

    const gap = 6;
    const widths = order.map((boon) => {
      const label = counts.get(boon.id) > 1 ? `${boon.name} ${counts.get(boon.id)}` : boon.name;
      return ctx.measureText(label).width + 22;
    });
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (order.length - 1);
    let x = VIEW.width / 2 - total / 2;
    const y = atY;

    order.forEach((boon, index) => {
      const width = widths[index];
      const hue = PALETTE[boon.tone] ?? PALETTE.ember;
      ctx.fillStyle = 'rgba(5, 7, 15, 0.82)';
      roundRect(x, y - 13, width, 26, 13);
      ctx.fill();
      ctx.strokeStyle = hue;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      roundRect(x, y - 13, width, 26, 13);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = hue;
      const label = counts.get(boon.id) > 1 ? `${boon.name} ${counts.get(boon.id)}` : boon.name;
      ctx.fillText(label, x + width / 2, y);
      x += width + gap;
    });
    ctx.restore();
  }

  /** Score pops: the number every kill was worth, floating where it died. */
  function drawPopups(state) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const popup of state.popups) {
      const fade = clamp(popup.life / (popup.maxLife || 1), 0, 1);
      ctx.globalAlpha = fade * fade * 0.95;
      // A merged pop grows with what it swallowed, so one number carries the whole burst.
      const size = popup.kind === 'kill' ? 13 + Math.min(popup.merges ?? 1, 5) * 2.2 : 19;
      ctx.font = `800 ${size.toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
      // Struck first in near-black, then filled: without the stroke a pop shares its value with the
      // ambient spark dust and stops reading as feedback the moment the field gets busy.
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(5, 7, 15, 0.9)';
      ctx.strokeText(`+${popup.value}`, popup.x, popup.y);
      ctx.fillStyle = popup.kind === 'boss' ? PALETTE.ember : popup.kind === 'elite' ? PALETTE.wick : PALETTE.moth;
      ctx.fillText(`+${popup.value}`, popup.x, popup.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** The wave banner: a banded announcement across the field, and the flawless call-out. */
  function drawBanner(state, overlay) {
    if (overlay || !state.banner || state.bannerClock <= 0) return;
    const total = state.bannerKind === 'flawless' ? 1.5 : WAVE.bannerTime;
    const age = 1 - clamp(state.bannerClock / total, 0, 1);
    const inAlpha = clamp(age / 0.18, 0, 1);
    const outAlpha = clamp((1 - age) / 0.3, 0, 1);
    const alpha = Math.min(inAlpha, outAlpha);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // A band, not a floating headline: the announcement sits on its own dark plate so the fight
    // behind it never competes with the words, and the plate gives it an edge to read against.
    const bandHeight = state.bannerKind === 'flawless' ? 56 : 74;
    const y = 232 + (1 - easeOutCubic(clamp(age / 0.22, 0, 1))) * 16;
    const plate = ctx.createLinearGradient(0, y - bandHeight / 2, 0, y + bandHeight / 2);
    plate.addColorStop(0, 'rgba(5, 7, 15, 0)');
    plate.addColorStop(0.22, 'rgba(5, 7, 15, 0.82)');
    plate.addColorStop(0.78, 'rgba(5, 7, 15, 0.82)');
    plate.addColorStop(1, 'rgba(5, 7, 15, 0)');
    ctx.fillStyle = plate;
    ctx.fillRect(ARENA.x, y - bandHeight / 2, ARENA.width, bandHeight);

    // A hairline above and below the band, in the banner's own colour, so the announcement reads as
    // a framed title rather than as text that happened to land on the field.
    const edge = state.bannerKind === 'flawless' ? PALETTE.moth : PALETTE.ember;
    ctx.strokeStyle = edge;
    ctx.globalAlpha = alpha * 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(VIEW.width / 2 - 260, y - bandHeight / 2 + 4);
    ctx.lineTo(VIEW.width / 2 + 260, y - bandHeight / 2 + 4);
    ctx.moveTo(VIEW.width / 2 - 260, y + bandHeight / 2 - 4);
    ctx.lineTo(VIEW.width / 2 + 260, y + bandHeight / 2 - 4);
    ctx.stroke();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = state.bannerKind === 'flawless' ? PALETTE.moth : PALETTE.wick;
    ctx.font = '800 30px ui-sans-serif, system-ui, sans-serif';
    const line = state.bannerKind === 'flawless' ? state.banner.toUpperCase() : state.banner;
    ctx.fillText(line, VIEW.width / 2, state.bannerKind === 'flawless' ? y : y - 9);
    if (state.bannerKind !== 'flawless') {
      ctx.fillStyle = PALETTE.ember;
      ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(
        state.bannerKind === 'boss'
          ? 'THE WARDEN WAKES'
          : `WAVE ${Math.min(state.waveIndex + 1, 10)} OF TEN`,
        VIEW.width / 2,
        y + 18,
      );
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawHeart(x, y, full) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.bezierCurveTo(-9, -3, -7, -10, 0, -5);
    ctx.bezierCurveTo(7, -10, 9, -3, 0, 5);
    ctx.closePath();
    ctx.fillStyle = full ? PALETTE.blood : 'rgba(255, 77, 109, 0.30)';
    ctx.fill();
    if (full) {
      ctx.strokeStyle = 'rgba(255, 230, 168, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      // A drained heart keeps its outline so the count of what is left survives at thumbnail size:
      // at 16% fill the empty pips vanished and three lives read as one.
      ctx.strokeStyle = 'rgba(255, 77, 109, 0.62)';
      ctx.lineWidth = 1.2;
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

    const glow = ctx.createRadialGradient(VIEW.width / 2, 220, 20, VIEW.width / 2, 220, 360);
    glow.addColorStop(0, 'rgba(255, 181, 74, 0.20)');
    glow.addColorStop(1, 'rgba(255, 181, 74, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    // The crest sits well above the wordmark: the moth is the emblem, not a watermark behind the
    // type, so it gets its own band of the screen.
    const bob = Math.sin((state?.time ?? 0) * 2.4) * 5;
    drawTitleMoth(VIEW.width / 2, 122 + bob, state?.time ?? 0);

    // A hairline either side of the wordmark, the cheapest way to make a centred title read as a
    // deliberate lockup rather than a line of text that happens to be centred.
    ctx.strokeStyle = 'rgba(255, 181, 74, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(VIEW.width / 2 - 300, 214);
    ctx.lineTo(VIEW.width / 2 - 226, 214);
    ctx.moveTo(VIEW.width / 2 + 226, 214);
    ctx.lineTo(VIEW.width / 2 + 300, 214);
    ctx.stroke();

    ctx.fillStyle = PALETTE.wick;
    ctx.font = '800 86px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('WICKFALL', VIEW.width / 2, 250);
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '600 20px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Ten waves. One keeper. The last flame.', VIEW.width / 2, 286);

    // The rulebook, in a panel of its own so it is not skimmed as part of the control list: what
    // wins and what loses are the two lines a new player has to read.
    const panelWidth = 540;
    const panelX = VIEW.width / 2 - panelWidth / 2;
    ctx.fillStyle = 'rgba(255, 181, 74, 0.07)';
    roundRect(panelX, 310, panelWidth, 64, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 181, 74, 0.28)';
    ctx.lineWidth = 1;
    roundRect(panelX, 310, panelWidth, 64, 12);
    ctx.stroke();
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '700 17px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Hold all ten waves to keep the flame.', VIEW.width / 2, 337);
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Lose all three hearts and the wick goes out.', VIEW.width / 2, 362);

    // The controls as key caps in two measured columns, the whole table centred on the canvas:
    // measure both columns first, then lay them out, so the block's own width decides its inset
    // instead of a guess at where the middle is.
    const lines = [
      ['WASD', 'move'],
      ['MOUSE', 'aim and throw sparks'],
      ['SPACE', 'dash through danger'],
      ['SHIFT', 'bloom, once the ring is lit'],
      ['P', 'pause'],
    ];
    const keyPad = 22;
    let keyCol = 0;
    let verbCol = 0;
    ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
    for (const [key] of lines) keyCol = Math.max(keyCol, ctx.measureText(key).width + keyPad);
    ctx.font = '500 15px ui-sans-serif, system-ui, sans-serif';
    for (const [, what] of lines) verbCol = Math.max(verbCol, ctx.measureText(what).width);
    const gap = 18;
    const blockLeft = VIEW.width / 2 - (keyCol + gap + verbCol) / 2;
    lines.forEach(([key, what], index) => {
      const rowY = 420 + index * 31;
      ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 181, 74, 0.16)';
      roundRect(blockLeft, rowY - 15, keyCol, 24, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 181, 74, 0.5)';
      ctx.lineWidth = 1;
      roundRect(blockLeft, rowY - 15, keyCol, 24, 6);
      ctx.stroke();
      ctx.fillStyle = PALETTE.wick;
      ctx.textAlign = 'center';
      ctx.fillText(key, blockLeft + keyCol / 2, rowY);
      ctx.fillStyle = PALETTE.bone;
      ctx.font = '500 15px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(what, blockLeft + keyCol + gap, rowY);
    });

    // A rule, then the call to action on its own line: the primary action gets the space.
    ctx.strokeStyle = 'rgba(233, 239, 249, 0.16)';
    ctx.beginPath();
    ctx.moveTo(VIEW.width / 2 - 180, 582);
    ctx.lineTo(VIEW.width / 2 + 180, 582);
    ctx.stroke();

    const pulse = 0.72 + 0.28 * Math.sin((state?.time ?? 0) * 3.2);
    ctx.textAlign = 'center';
    ctx.globalAlpha = entry * pulse;
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '700 25px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('press ENTER or click to begin', VIEW.width / 2, 622);
    ctx.globalAlpha = entry;
    ctx.fillStyle = PALETTE.ember;
    ctx.font = '700 13px ui-sans-serif, system-ui, sans-serif';
    const best = extra?.best ?? 0;
    // Thousands-separated, and with the run it came from: a bare four-digit number under the title
    // reads as a layout artefact, not as a score to beat.
    ctx.fillText(
      best > 0 ? `BEST RUN  ${best.toLocaleString('en-US')}` : 'NO RUN YET — THE FLAME IS UNLIT',
      VIEW.width / 2,
      656,
    );
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
      const tone = COLOUR[card.tone] ?? PALETTE.wick;
      ctx.fillStyle = hovered ? 'rgba(255, 181, 74, 0.16)' : 'rgba(19, 27, 49, 0.94)';
      roundRect(x, y, cardWidth, cardHeight, 18);
      ctx.fill();
      ctx.strokeStyle = hovered ? PALETTE.ember : 'rgba(233, 239, 249, 0.2)';
      ctx.lineWidth = hovered ? 2.5 : 1.5;
      roundRect(x, y, cardWidth, cardHeight, 18);
      ctx.stroke();

      // A tone band across the top of the card: at sheet scale the colour is the only thing that
      // survives, so it carries the category (hot, quick, wide) before any word does.
      ctx.save();
      roundRect(x, y, cardWidth, cardHeight, 18);
      ctx.clip();
      ctx.fillStyle = tone;
      ctx.globalAlpha = hovered ? 0.5 : 0.3;
      ctx.fillRect(x, y, cardWidth, 5);
      ctx.globalAlpha = 1;
      ctx.restore();

      ctx.fillStyle = PALETTE.ember;
      ctx.font = '800 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(index + 1), x + cardWidth / 2, y + 30);
      ctx.fillStyle = PALETTE.bone;
      ctx.font = '800 26px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(card.name, x + cardWidth / 2, y + 74);

      // The consequence, at the size the name had: this is the line that decides the pick, and at
      // 253 px it was collapsing into grey texture while the title stayed legible.
      ctx.fillStyle = tone;
      ctx.font = '800 30px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(card.detail, x + cardWidth / 2, y + 122);

      // What the number is now, and what it becomes: without a before there is no axis to compare
      // three cards on, only three unrelated claims. Extra hearts are tracked as a bonus over the
      // base three, so the card reads in hearts the player can count on the HUD, not in a bonus.
      const bonus = state.stats?.[card.stat];
      if (typeof bonus === 'number') {
        const base = card.stat === 'maxHp' ? PLAYER.maxHp : 0;
        const now = base + bonus;
        const next = card.step ? now + card.step : card.factor ? now * card.factor : now;
        ctx.fillStyle = PALETTE.ash;
        ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(`${round2(now)}  →  ${round2(next)}`, x + cardWidth / 2, y + 152);
      }

      ctx.fillStyle = PALETTE.ash;
      ctx.font = '500 14px ui-sans-serif, system-ui, sans-serif';
      wrapText(card.blurb, x + cardWidth / 2, y + 186, cardWidth - 44, 20);

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
    // Nearly opaque: the fight behind a results card is noise, and a moth or a score pop bleeding
    // through the middle of the card reads as a rendering fault rather than as atmosphere.
    const veil = ctx.createLinearGradient(0, 0, 0, VIEW.height);
    if (won) {
      veil.addColorStop(0, 'rgba(8, 12, 24, 0.94)');
      veil.addColorStop(1, 'rgba(5, 7, 15, 0.97)');
    } else {
      veil.addColorStop(0, 'rgba(24, 9, 16, 0.94)');
      veil.addColorStop(1, 'rgba(10, 5, 9, 0.97)');
    }
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = won ? PALETTE.ember : PALETTE.blood;
    ctx.font = '800 60px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(won ? 'THE FLAME HOLDS' : 'THE WICK GOES OUT', VIEW.width / 2, 232);
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '600 17px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(
      won ? 'All ten waves broken. The dark steps back.' : `You fell in wave ${Math.min(state.waveIndex + 1, 10)} of ten.`,
      VIEW.width / 2,
      270,
    );

    // The score, once: the results screen is the only place this run's number is printed, so it can
    // be the biggest thing on the card without competing with a live HUD behind it.
    ctx.fillStyle = PALETTE.bone;
    ctx.font = '800 62px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(state.score.toLocaleString('en-US'), VIEW.width / 2, 360);
    ctx.fillStyle = PALETTE.ash;
    ctx.font = '700 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(won && extra?.record ? 'SCORE — A NEW BEST' : 'SCORE', VIEW.width / 2, 386);

    // Four readings, not five: the score is already the hero above, so repeating it as "best" only
    // filled a column. A record is called a record instead of showing the same number twice.
    const stats = [
      ['waves cleared', `${Math.min(state.waveIndex, 10)} of 10`],
      ['slain', `${state.kills}`],
      ['flawless', `${state.flawless ?? 0} of 10`],
      ['time', formatClock(state.time)],
    ];
    stats.forEach(([label, value], index) => {
      const x = VIEW.width / 2 - 300 + index * 200;
      ctx.fillStyle = PALETTE.ember;
      ctx.font = '800 24px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(value, x, 456);
      ctx.fillStyle = PALETTE.ash;
      ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(label, x, 480);
    });

    // The one thing the player has to do next, drawn as a key cap with a chip per key rather than a
    // sentence in the dimmest colour on the card.
    ctx.strokeStyle = won ? 'rgba(255, 181, 74, 0.28)' : 'rgba(255, 77, 109, 0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(VIEW.width / 2 - 220, 518);
    ctx.lineTo(VIEW.width / 2 + 220, 518);
    ctx.stroke();

    const bounce = 0.86 + 0.14 * Math.sin(state.time * 3.4);
    ctx.globalAlpha = bounce;
    ctx.fillStyle = PALETTE.wick;
    ctx.font = '700 26px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('press R or ENTER to run again', VIEW.width / 2, 592);
    ctx.globalAlpha = 1;

    // The run's build, under the results: the draft is the game's thesis, so the card that ends the
    // run shows what the keeper actually assembled out of it instead of only what it scored.
    drawBuildStrip(state, 548);

    // The tip, clearly subordinate: one line of what the next run should chase.
    ctx.fillStyle = won ? PALETTE.moth : PALETTE.ash;
    ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(
      won
        ? `${state.flawless ?? 0} of 10 waves held without a scratch. Chase ten.`
        : `You held ${state.flawless ?? 0} clean — a wave with no hit pays a flawless bonus.`,
      VIEW.width / 2,
      640,
    );
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
