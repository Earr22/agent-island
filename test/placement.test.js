const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sanitizePlacement,
  targetBounds,
  visualBounds,
  freeBoundsForVisual,
  clampFreeBoundsForLayout,
  nearestSnapEdge,
  ratioForEdge
} = require('../src/placement');

const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };

test('sanitizes persisted placement data', () => {
  assert.deepEqual(sanitizePlacement({ mode: 'left', ratio: 2, displayId: 7 }), {
    mode: 'left', ratio: 0.96, x: null, y: null, displayId: '7'
  });
  assert.equal(sanitizePlacement({ mode: 'unknown' }).mode, 'top');
});

test('positions edge placements on the correct transparent-canvas edge', () => {
  assert.deepEqual(targetBounds({ placement: { mode: 'top', ratio: 0.5 }, display, edgeOffset: 4 }), {
    x: 740, y: 4, width: 440, height: 276
  });
  assert.deepEqual(targetBounds({ placement: { mode: 'right', ratio: 0.5 }, display, edgeOffset: 4 }), {
    x: 1476, y: 402, width: 440, height: 276
  });
});

test('preserves the visible island position when converting an edge drag to free placement', () => {
  const windowBounds = { x: 4, y: 402, width: 440, height: 276 };
  const visible = visualBounds(windowBounds, 'left', { width: 40, height: 110 });
  const free = freeBoundsForVisual(visible);
  assert.deepEqual(visualBounds(free, 'free', { width: 40, height: 110 }), visible);
});

test('offers the nearest edge and derives its along-edge ratio', () => {
  assert.equal(nearestSnapEdge({ x: 12, y: 700 }, display), 'left');
  assert.equal(nearestSnapEdge({ x: 960, y: 500 }, display), '');
  assert.equal(ratioForEdge('left', { x: 12, y: 540 }, display), 0.5);
});

test('keeps the snap confirmation layout fully visible at screen corners', () => {
  const draggedFromVerticalSide = { x: 1710, y: -2, width: 440, height: 276 };
  const clamped = clampFreeBoundsForLayout(
    draggedFromVerticalSide,
    display,
    { width: 310, height: 58 }
  );
  const prompt = visualBounds(clamped, 'free', { width: 310, height: 58 });
  assert.equal(prompt.y, 6);
  assert.equal(prompt.x + prompt.width, 1914);
});
