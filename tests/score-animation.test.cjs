const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function animationHarness() {
  let now = 0, nextId = 0;
  const timers = new Map(), frames = new Map();
  const context = vm.createContext({
    performance: { now: () => now },
    setTimeout: (fn) => { timers.set(++nextId, fn); return nextId; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => { frames.set(++nextId, fn); return nextId; },
    cancelAnimationFrame: (id) => frames.delete(id),
  });
  const source = fs.readFileSync(path.join(__dirname, '../js/board.js'), 'utf8');
  const start = source.indexOf('  const tweens = new WeakMap();');
  const end = source.indexOf('  function setScreen(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  return {
    set: context.setNum, tween: context.tweenNum,
    start() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); },
    finish() { now += 2000; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((fn) => fn(now)); },
  };
}
function counter() {
  const classes = new Set();
  return { textContent: 0, dataset: {}, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) }, classes };
}

test('team counters animate independently to their individual scores', () => {
  const h = animationHarness(), left = counter(), right = counter();
  h.set(left, 31); h.set(right, 132);
  h.tween(left, 72, 700, 150); h.tween(right, 144, 700, 150);
  h.start(); h.finish();
  assert.equal(left.textContent, 72);
  assert.equal(right.textContent, 144);
});

test('Undo before the count-up starts cancels its delayed callback', () => {
  const h = animationHarness(), el = counter();
  h.set(el, 31); h.tween(el, 72, 700, 150); h.set(el, 31);
  h.start(); h.finish();
  assert.equal(el.textContent, 31);
  assert.equal(el.classes.has('counting'), false);
});

test('Undo during a count-up cancels pending animation frames', () => {
  const h = animationHarness(), el = counter();
  h.set(el, 31); h.tween(el, 72, 700, 150); h.start(); h.set(el, 31); h.finish();
  assert.equal(el.textContent, 31);
  assert.equal(el.classes.has('counting'), false);
});
