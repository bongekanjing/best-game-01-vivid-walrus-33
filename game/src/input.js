// Input: keyboard for movement and abilities, pointer for aim and fire. The game never reads the
// raw events while drawing, so one Input instance is polled once per simulation step and the same
// answer is used by the whole step.

const MOVE_KEYS = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

/** Actions that fire once per press, however long the key is held. */
const PRESS_ACTIONS = {
  Space: 'dash',
  ShiftLeft: 'bloom',
  ShiftRight: 'bloom',
  KeyE: 'bloom',
  KeyP: 'pause',
  Escape: 'pause',
  KeyR: 'restart',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Digit1: 'choice1',
  Digit2: 'choice2',
  Digit3: 'choice3',
};

export function createInput(canvas) {
  const held = new Set();
  const pressed = new Set();
  const pointer = { x: 640, y: 360, inside: false, down: false };
  let anyKey = false;

  function keyName(event) {
    return event.code || event.key;
  }

  function onKeyDown(event) {
    const code = keyName(event);
    if (MOVE_KEYS[code] || PRESS_ACTIONS[code] || code === 'Tab') event.preventDefault();
    if (!held.has(code)) pressed.add(PRESS_ACTIONS[code] ?? code);
    held.add(code);
    anyKey = true;
  }

  function onKeyUp(event) {
    held.delete(keyName(event));
  }

  /** Screen pixels to field coordinates: the canvas is letterboxed, so both axes scale by one factor. */
  function toField(event) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / 1280, rect.height / 720) || 1;
    const offsetX = rect.left + (rect.width - 1280 * scale) / 2;
    const offsetY = rect.top + (rect.height - 720 * scale) / 2;
    return { x: (event.clientX - offsetX) / scale, y: (event.clientY - offsetY) / scale };
  }

  function onPointerMove(event) {
    const point = toField(event);
    pointer.x = point.x;
    pointer.y = point.y;
    pointer.inside = true;
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button > 2) return;
    onPointerMove(event);
    pointer.down = true;
  }

  function onPointerUp() {
    pointer.down = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('blur', () => {
    held.clear();
    pointer.down = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** The direction the keeper wants to walk, as a unit-or-shorter vector. */
    axis() {
      let x = 0;
      let y = 0;
      if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1;
      if (held.has('KeyD') || held.has('ArrowRight')) x += 1;
      if (held.has('KeyW') || held.has('ArrowUp')) y -= 1;
      if (held.has('KeyS') || held.has('ArrowDown')) y += 1;
      const length = Math.hypot(x, y);
      return length > 1 ? { x: x / length, y: y / length } : { x, y };
    },
    /** True once for each press of the named action since the last poll. */
    took(action) {
      return pressed.has(action);
    },
    /** True while any key that matters is held down. */
    firing() {
      return pointer.down || held.has('KeyJ') || held.has('KeyF');
    },
    aim() {
      return { x: pointer.x, y: pointer.y };
    },
    /** Called by the loop at the end of every step: presses do not carry over. */
    endStep() {
      pressed.clear();
    },
    get anyKey() {
      return anyKey;
    },
    /** The autopilot's seam: a screenshot scene steers with the same poll the player uses. */
    setPointer(x, y, down) {
      pointer.x = x;
      pointer.y = y;
      pointer.inside = true;
      pointer.down = down;
    },
    hold(code, on) {
      if (on) held.add(code);
      else held.delete(code);
    },
    press(action) {
      pressed.add(action);
    },
  };
}
