const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// Run the real operator actions with browser rendering/audio replaced by no-ops.
function harness(saved) {
  const storage = new Map(saved ? [['ss_game', JSON.stringify(saved)]] : []);
  const events = {};
  const listeners = {};
  const pending = [];
  const element = { addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } };
  const context = vm.createContext({
    console, JSON, Math, Date,
    document: { getElementById: () => element, addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); events[type] = (event) => listeners[type].forEach((listener) => listener(event)); } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    confirm: () => true,
    setTimeout: (fn) => { pending.push(fn); return pending.length; }, clearTimeout() {},
    setInterval() {}, clearInterval() {},
    window: { addEventListener() {}, SOUND_LIST: [], SoundEngine: class {
      init() { return { then() {} }; }
      setVolumes() {} play() {} stopMusic() {}
    } },
  });
  vm.runInContext(read('js/shared.js'), context);
  context.SS = context.window.SS;
  vm.runInContext(read('survey-data.js'), context);
  const source = read('js/operator.js');
  // Keep all production action/event code; skip DOM boot and expose actions only in this VM.
  const marker = '  /* =========================================================\n   * Boot';
  assert.ok(source.includes(marker));
  vm.runInContext(source.slice(0, source.indexOf(marker)) + `
    renderAll = renderScores = renderRoundPanel = renderFast = switchTab = () => {};
    window.test = {
      get game() { return game; }, boardState, fmPick, fmShowText, fmShowPts, fmHideRow,
      fmSetPlayer, fmReset, fmRevealAll, undo, setScore, setScreen, setWinner,
      newGameReset, gameStatus, startRound, reveal, setControl,
    };
  })();`, context);
  const api = context.window.test;
  return {
    api, events,
    scores: () => Array.from(api.boardState().scores),
    reload: () => harness(JSON.parse(storage.get('ss_game'))),
    flush: () => { while (pending.length) pending.shift()(); },
  };
}

test('reveals add once, both players score, hiding the column retains points', () => {
  const h = harness(), a = h.api;
  a.setScore(0, 100); a.setScore(1, 150);
  a.fmPick(0, 'First', 41); a.fmShowText(0);
  assert.deepEqual(h.scores(), [100, 150]);
  a.fmShowPts(0); a.fmShowPts(0);
  assert.deepEqual(h.scores(), [141, 150]);
  a.fmSetPlayer(1);
  assert.equal(a.game.fm.hideP1, true);
  a.fmPick(0, 'Second', 22); a.fmShowPts(0);
  assert.deepEqual(h.scores(), [141, 172]);
  assert.deepEqual(h.reload().scores(), [141, 172]);
});

test('edits, row hiding, reset and Undo adjust the right totals', () => {
  const h = harness(), a = h.api;
  a.setScore(0, 100); a.setScore(1, 80);
  a.fmPick(0, 'First', 41); a.fmShowPts(0);
  a.fmPick(0, 'Corrected', 50);
  assert.deepEqual(h.scores(), [150, 80]);
  a.undo(); assert.deepEqual(h.scores(), [141, 80]);
  a.fmHideRow(0); assert.deepEqual(h.scores(), [100, 80]);
  a.undo(); assert.deepEqual(h.scores(), [141, 80]);
  a.fmSetPlayer(1); a.fmPick(0, 'Second', 22); a.fmShowPts(0);
  assert.deepEqual(h.scores(), [141, 102]);
  a.fmReset(); assert.deepEqual(h.scores(), [100, 80]);
  a.undo(); assert.deepEqual(h.scores(), [141, 102]);
});

test('manual score adjustments remain final totals and winner follows corrections', () => {
  const h = harness(), a = h.api;
  a.setScore(0, 100); a.setScore(1, 120);
  a.fmPick(0, 'First', 41); a.fmShowPts(0);
  a.setScore(0, 130); assert.deepEqual(h.scores(), [130, 120]);
  a.setScreen('winner'); assert.equal(a.boardState().winner, 0);
  a.fmPick(0, 'Correction', 0);
  assert.deepEqual(h.scores(), [89, 120]);
  assert.equal(a.boardState().winner, 1);
  a.undo(); assert.equal(a.boardState().winner, 0);
  a.setWinner(1); a.fmHideRow(0); a.undo();
  assert.equal(a.boardState().winner, 1, 'Undo preserves an explicit host override');
});

test('typed point corrections are undoable, sync scores, and recompute the winner', () => {
  const h = harness(), a = h.api;
  a.setScore(1, 20);
  a.fmPick(0, 'First', 41); a.fmShowPts(0); a.setScreen('winner');
  h.events.input({ target: { dataset: { fm: 'pts', i: '0' }, value: '10' } });
  assert.deepEqual(h.scores(), [10, 20]);
  assert.equal(a.boardState().winner, 1);
  a.undo(); assert.deepEqual(h.scores(), [41, 20]);
});

test('old saves include Fast Money without modifying stored main-round awards', () => {
  const h = harness(), a = h.api;
  a.setScore(1, 100); a.fmPick(0, 'First', 41); a.fmShowPts(0);
  const old = JSON.parse(JSON.stringify(a.game));
  delete old.scoringVersion;
  const migrated = harness(old);
  assert.deepEqual(migrated.scores(), [41, 100]);
  assert.deepEqual(Array.from(migrated.api.game.scores), [0, 100]);
});

test('queued reveals are cancelled by Undo, player switch, bonus reset and new game', () => {
  for (const action of ['undo', 'fmSetPlayer', 'fmReset', 'newGameReset']) {
    const h = harness(), a = h.api;
    a.fmPick(0, 'First', 41); a.fmRevealAll();
    a[action](1); h.flush();
    assert.deepEqual(h.scores(), [0, 0], action);
  }
});

test('main-round awards and target detection include bonus without altering the bank', () => {
  const h = harness(), a = h.api;
  a.startRound(0); a.setControl(0);
  const expected = a.game.round.answers.reduce((n, row) => n + row.pts, 0) * a.game.round.mult;
  a.game.round.answers.forEach((_, i) => a.reveal(i));
  assert.deepEqual(h.scores(), [expected, 0]);
  a.fmPick(0, 'Bonus', 300); a.fmShowPts(0);
  assert.deepEqual(h.scores(), [expected + 300, 0]);
  assert.equal(a.game.round.bank, expected);
  assert.equal(a.gameStatus().reached, 0);
  a.fmReset(); assert.deepEqual(h.scores(), [expected, 0]);
});


test('completed reveal-all counts each row once and survives another reveal-all', () => {
  const h = harness(), a = h.api;
  a.fmPick(0, 'First', 41); a.fmPick(1, 'Second', 22);
  a.fmRevealAll(); h.flush();
  assert.deepEqual(h.scores(), [63, 0]);
  a.fmRevealAll(); h.flush();
  assert.deepEqual(h.scores(), [63, 0]);
});

test('a manual winner override survives reload with the new scoring rules', () => {
  const h = harness(), a = h.api;
  a.fmPick(0, 'First', 41); a.fmShowPts(0);
  a.setScreen('winner'); a.setWinner(1);
  assert.equal(h.reload().api.boardState().winner, 1);
});
