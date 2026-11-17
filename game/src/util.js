// Small geometry helpers shared by the simulation and the renderer: distance, clamping,
// circle-versus-circle overlap and the easing curves the HUD animates with.

export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);


/** Frame-rate independent approach: move `from` toward `to` by `rate` per second. */

export function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** True when two circles overlap. Both are { x, y, radius }. */
export function circlesTouch(a, b) {
  const reach = a.radius + b.radius;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= reach * reach;
}

/** A unit vector from b to a, or a fixed one when the two points coincide. */
export function directionTo(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/** Keep a circle of `radius` fully inside the arena rectangle. */
export function clampInside(body, arena, radius) {
  body.x = clamp(body.x, arena.x + radius, arena.x + arena.width - radius);
  body.y = clamp(body.y, arena.y + radius, arena.y + arena.height - radius);
}

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/** Shortest signed difference between two angles, in [-pi, pi). */
/** Format seconds as m:ss, the shape the run clock in the HUD uses. */
export function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}
