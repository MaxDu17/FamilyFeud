/* Operator console: owns the game state, scoring rules, sounds, and drives the audience board. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = SS.escapeHtml;

  /* =========================================================
   * Config & data
   * ========================================================= */
  let setup = Object.assign({}, SS.defaultSetup, SS.store.get('ss_setup', {}));
  // Upgrade the old stock names while keeping personalized settings and game state.
  if (setup.title === 'Holiday Survey Showdown') setup.title = SS.defaultSetup.title;
  if (setup.bonusName === 'Lightning Round') setup.bonusName = SS.defaultSetup.bonusName;
  let savedText = SS.store.get('ss_data_text', null);
  const fileText = () => String(window.SURVEY_DATA || '').replace(/^\s*\n/, '');
  let dataText = savedText != null ? savedText : fileText();
  let dataSource = savedText != null ? 'browser' : 'file';
  let parsed = SS.parseSurvey(dataText);

  /* =========================================================
   * Game state
   * ========================================================= */
  function newFm() {
    return {
      player: 0,
      hideP1: false,
      rows: [0, 1].map(() => Array.from({ length: SS.FAST_QUESTIONS }, () => ({ text: '', pts: 0, showText: false, showPts: false }))),
      timer: { duration: setup.timer1, remaining: setup.timer1, running: false },
      celebrated: false,
    };
  }
  function newGame() {
    return { version: 1, phase: 'title', scores: [0, 0], roundIndex: -1, round: null, results: {}, fm: newFm(), winner: null };
  }
  let game = SS.store.get('ss_game', null);
  if (!game || game.version !== 1) game = newGame();
  game.fm.timer.running = false;

  let currentTab = 'game';
  const undoStack = [];

  /* =========================================================
   * Sound
   * ========================================================= */
  const SFX = new window.SoundEngine();
  const audioPrefs = Object.assign({ sfx: 0.9, music: 0.55, muted: false }, SS.store.get('ss_audio', {}));
  SFX.setVolumes(audioPrefs);
  SFX.onchange = () => { renderAudio(); if (typeof renderSoundList === 'function') renderSoundList(); };
  SFX.init().then(() => { SFX.setVolumes(audioPrefs); renderAudio(); });
  const play = (name, opts) => SFX.play(name, opts);
  document.addEventListener('pointerdown', () => SFX.unlock(), true);
  document.addEventListener('keydown', () => SFX.unlock(), true);

  /* =========================================================
   * Transport to audience screens
   * ========================================================= */
  const clients = new Set();
  const boards = new Map(); // boardId -> {lastSeen, preview}
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel(SS.CHANNEL) : null;

  function post(msg) {
    for (const w of clients) {
      try {
        if (w.closed) { clients.delete(w); continue; }
        w.postMessage(msg, '*');
      } catch (e) { clients.delete(w); }
    }
    if (bc) { try { bc.postMessage(msg); } catch (e) { /* ignore */ } }
  }
  function stateMsg(fx, sync) {
    return { app: 'ss', type: 'state', id: SS.uid(), state: boardState(), fx: fx || [], sync: !!sync };
  }
  function broadcast(fx, sync) { post(stateMsg(fx, sync)); }

  function onHello(msg, source) {
    if (source) clients.add(source);
    if (source && !msg.preview && source !== window) boardWin = source;
    const known = boards.has(msg.boardId);
    boards.set(msg.boardId, { lastSeen: Date.now(), preview: !!msg.preview });
    if (!known || msg.needSync) {
      const reply = stateMsg([], true);
      const assets = assetsMsg();
      if (source) { try { source.postMessage(reply, '*'); source.postMessage(assets, '*'); } catch (e) { /* ignore */ } }
      else if (bc) { bc.postMessage(reply); bc.postMessage(assets); }
    }
    renderConn();
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.app === 'ss' && m.type === 'hello') onHello(m, e.source);
  });
  if (bc) bc.onmessage = (e) => {
    const m = e.data;
    if (m && m.app === 'ss' && m.type === 'hello') onHello(m, null);
  };
  setInterval(renderConn, 2000);

  let boardWin = null;
  function openBoard() {
    SFX.unlock();
    if (boardWin && !boardWin.closed) {
      try { boardWin.focus(); } catch (e) { /* ignore */ }
      toast('The audience screen is already open (check your other screen or window).');
      return;
    }
    const w = window.open(new URL('board.html', location.href).href, 'ss-audience', 'popup=yes,width=1280,height=760');
    if (!w) { toast('The browser blocked the popup. Allow popups for this page and try again.'); return; }
    boardWin = w;
    clients.add(w);
    toast('Drag the new window onto the TV, then click inside it for full screen.');
  }

  function boardState() {
    const r = game.round;
    return {
      title: setup.title,
      teams: [setup.teamA, setup.teamB],
      scores: game.scores.slice(),
      phase: game.phase,
      target: setup.target,
      bonusName: setup.bonusName,
      bonusTarget: setup.bonusTarget,
      winner: game.winner,
      round: r ? {
        uid: r.uid, label: r.label, question: r.question, showQuestion: r.showQuestion,
        mult: r.mult, sudden: r.sudden, answers: r.answers, bank: r.bank, strikes: r.strikes,
        stage: r.stage, control: r.control, winner: r.winner,
      } : null,
      fm: { player: game.fm.player, hideP1: game.fm.hideP1, timer: game.fm.timer, rows: game.fm.rows },
    };
  }

  /* =========================================================
   * Commit / undo
   * ========================================================= */
  function save() { SS.store.set('ss_game', game); }
  function commit(fx, opts) {
    save();
    renderAll();
    broadcast(fx || [], opts && opts.sync);
  }
  function snapshot() {
    undoStack.push(JSON.stringify(game));
    if (undoStack.length > 200) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) { toast('Nothing to undo'); return; }
    stopTimer();
    game = JSON.parse(undoStack.pop());
    game.fm.timer.running = false;
    revealSeq++;
    commit([], { sync: true });
    toast('Undone');
  }

  /* =========================================================
   * Main-game rules
   * ========================================================= */
  const teamName = (t) => (t === 0 ? setup.teamA : setup.teamB);
  function roundLabel(idx) {
    const d = parsed.rounds[idx];
    if (d.sudden) return 'Sudden Death';
    return 'Round ' + parsed.rounds.slice(0, idx + 1).filter((r) => !r.sudden).length;
  }

  function startRound(idx) {
    const d = parsed.rounds[idx];
    if (!d) return;
    const r = game.round;
    if (r && r.stage !== 'done' && r.bank > 0) {
      if (!confirm(`The current round has ${r.bank} points in the bank that haven't been awarded yet.\n\nStart ${roundLabel(idx)} anyway?`)) return;
    }
    if (game.results[idx] && !confirm(`${roundLabel(idx)} was already played. Play it again? (Scores already awarded stay.)`)) return;
    snapshot();
    revealSeq++;
    SFX.stopMusic(0.8);
    game.round = {
      uid: SS.uid(), index: idx, label: roundLabel(idx), question: d.question, mult: d.mult, sudden: d.sudden,
      answers: d.answers.map((a) => ({ text: a.text, pts: a.pts, revealed: false, free: false })),
      bank: 0, strikes: 0, stage: 'faceoff', control: null, winner: null, buzz: null, showQuestion: true,
    };
    game.roundIndex = idx;
    game.phase = 'round';
    play('roundStart');
    switchTab('game');
    commit([{ type: 'intro', label: game.round.label, mult: d.mult, sudden: d.sudden }]);
  }

  function awardInternal(team, fx, delayMs) {
    const r = game.round;
    r.winner = team;
    r.stage = 'done';
    game.scores[team] += r.bank;
    game.results[r.index] = { winner: team, amount: r.bank };
    fx.push({ type: 'award', team, amount: r.bank, delay: delayMs });
    setTimeout(() => { play('chaching'); play('applause'); }, delayMs);
  }

  function reveal(i) {
    const r = game.round;
    if (!r || game.phase !== 'round') return;
    const a = r.answers[i];
    if (!a || a.revealed) return;
    if (r.sudden && i !== 0) return;
    snapshot();
    a.revealed = true;
    const fx = [{ type: 'reveal', i }];
    if (r.stage === 'done') {
      a.free = true;
      play('ding', { gain: 0.75 });
      commit(fx);
      return;
    }
    r.bank += a.pts * r.mult;
    play('ding');
    if (r.stage === 'steal') awardInternal(1 - r.control, fx, 1100);
    else if (r.stage === 'play' && r.answers.every((x) => x.revealed)) awardInternal(r.control, fx, 1100);
    commit(fx);
  }

  function strike() {
    const r = game.round;
    if (!r || game.phase !== 'round') { play('strike'); return; }
    if (r.stage === 'faceoff' || r.stage === 'done') {
      play('strike');
      broadcast([{ type: 'x' }]);
      return;
    }
    if (r.stage === 'play') {
      snapshot();
      r.strikes = Math.min(3, r.strikes + 1);
      if (r.strikes >= 3) r.stage = 'steal';
      play('strike');
      commit([{ type: 'strike', count: r.strikes }]);
      return;
    }
    if (r.stage === 'steal') stealFailed();
  }

  function stealFailed() {
    const r = game.round;
    if (!r || r.stage !== 'steal') return;
    snapshot();
    play('strike');
    const fx = [{ type: 'x' }];
    awardInternal(r.control, fx, 1300);
    commit(fx);
  }

  function buzz(team) {
    const r = game.round;
    play('buzzin');
    if (r && r.stage === 'faceoff') { r.buzz = team; save(); renderRoundPanel(); }
    broadcast([{ type: 'buzz', team }]);
  }

  function setControl(team) {
    const r = game.round;
    if (!r || r.stage === 'done' || r.stage === 'steal') return;
    snapshot();
    r.control = team;
    if (r.stage === 'faceoff') r.stage = 'play';
    play('whoosh', { gain: 0.6 });
    commit([]);
  }

  function manualAward(team) {
    const r = game.round;
    if (!r || r.stage === 'done') return;
    snapshot();
    const fx = [];
    awardInternal(team, fx, 0);
    commit(fx);
  }

  let revealSeq = 0;
  function revealRemaining() {
    const r = game.round;
    if (!r || r.stage !== 'done') return;
    const hidden = r.answers.map((a, i) => (!a.revealed && (!r.sudden || i === 0) ? i : -1)).filter((i) => i >= 0);
    if (!hidden.length) return;
    snapshot();
    const token = ++revealSeq;
    const uid = r.uid;
    hidden.forEach((i, k) => {
      setTimeout(() => {
        if (token !== revealSeq || !game.round || game.round.uid !== uid) return;
        const a = game.round.answers[i];
        if (a.revealed) return;
        a.revealed = true;
        a.free = true;
        play('ding', { gain: 0.6 });
        commit([{ type: 'reveal', i }]);
      }, k * 750);
    });
  }

  function toggleQuestion() {
    if (!game.round) return;
    game.round.showQuestion = !game.round.showQuestion;
    commit([]);
  }

  function computeWinner() {
    if (game.scores[0] === game.scores[1]) return -1;
    return game.scores[0] > game.scores[1] ? 0 : 1;
  }

  function setScreen(phase) {
    if (game.phase === phase) return;
    snapshot();
    game.phase = phase;
    if (phase === 'winner') {
      game.winner = computeWinner();
      SFX.stopMusic(0.4);
      play('fanfare');
      setTimeout(() => play('applause'), 1600);
    }
    if (phase === 'round' && !game.round) toast('No round started yet. Pick one from the Main Game tab.');
    commit([]);
  }

  function setWinner(t) {
    snapshot();
    game.winner = t;
    commit([]);
  }

  function setScore(team, v) {
    v = Math.max(-9999, Math.min(99999, Math.round(Number(v) || 0)));
    if (game.scores[team] === v) return;
    snapshot();
    game.scores[team] = v;
    commit([]);
  }

  function newGameReset() {
    if (!confirm('Start a new game? This clears both scores and all round progress.')) return;
    snapshot();
    stopTimer();
    revealSeq++;
    game = newGame();
    commit([], { sync: true });
    toast('New game ready');
  }

  function gameStatus() {
    const main = parsed.rounds.map((r, i) => ({ r, i })).filter((x) => !x.r.sudden);
    const allMainDone = main.length > 0 && main.every((x) => game.results[x.i]);
    let reached = -1;
    if (setup.target > 0) {
      if (game.scores[0] >= setup.target && game.scores[0] >= game.scores[1]) reached = 0;
      else if (game.scores[1] >= setup.target) reached = 1;
    }
    const sudden = parsed.rounds.findIndex((r, i) => r.sudden && !game.results[i]);
    let next = -1;
    for (let i = (game.round ? game.round.index + 1 : 0); i < parsed.rounds.length; i++) {
      if (!parsed.rounds[i].sudden && !game.results[i]) { next = i; break; }
    }
    if (next === -1) next = parsed.rounds.findIndex((r, i) => !r.sudden && !game.results[i]);
    return { allMainDone, reached, sudden, next, tied: game.scores[0] === game.scores[1] };
  }

  /* =========================================================
   * Bonus round
   * ========================================================= */
  function fastQuestions() {
    const qs = parsed.fast.slice(0, SS.FAST_QUESTIONS);
    while (qs.length < SS.FAST_QUESTIONS) qs.push({ question: `Question ${qs.length + 1} (add [fast] questions in Setup)`, answers: [] });
    return qs;
  }
  function fmTotal() {
    let t = 0;
    game.fm.rows.forEach((col) => col.forEach((e) => { if (e.showPts) t += e.pts || 0; }));
    return t;
  }
  function fmDuration(p) { return p === 0 ? setup.timer1 : setup.timer2; }

  function fmSetPlayer(p) {
    if (game.fm.player === p) return;
    snapshot();
    stopTimer();
    game.fm.player = p;
    game.fm.timer = { duration: fmDuration(p), remaining: fmDuration(p), running: false };
    if (p === 1 && game.fm.rows[0].some((e) => e.showText)) game.fm.hideP1 = true;
    commit([]);
  }

  function checkFmWin(fx) {
    const total = fmTotal();
    if (!game.fm.celebrated && total >= setup.bonusTarget) {
      game.fm.celebrated = true;
      fx.push({ type: 'fmWin', total });
      setTimeout(() => { play('fanfare'); setTimeout(() => play('applause'), 1500); }, 700);
    }
  }

  function fmShowText(i, p = game.fm.player) {
    const e = game.fm.rows[p][i];
    if (e.showText) return;
    snapshot();
    e.showText = true;
    play('whoosh');
    commit([]);
  }
  function fmShowPts(i, p = game.fm.player) {
    const e = game.fm.rows[p][i];
    if (e.showPts) return;
    snapshot();
    e.showText = true;
    e.showPts = true;
    if ((e.pts || 0) > 0) play('ding'); else play('strike');
    const fx = [];
    checkFmWin(fx);
    commit(fx);
  }
  function fmHideRow(i, p = game.fm.player) {
    const e = game.fm.rows[p][i];
    snapshot();
    e.showText = false;
    e.showPts = false;
    if (fmTotal() < setup.bonusTarget) game.fm.celebrated = false;
    commit([]);
  }
  let fmSeq = 0;
  function fmRevealAll() {
    const p = game.fm.player;
    const token = ++fmSeq;
    let t = 0;
    for (let i = 0; i < SS.FAST_QUESTIONS; i++) {
      const e = game.fm.rows[p][i];
      if (e.showPts || !String(e.text || '').trim()) continue;
      if (!e.showText) {
        setTimeout(() => { if (token === fmSeq) fmShowText(i, p); }, t);
        t += 1300;
      }
      setTimeout(() => { if (token === fmSeq) fmShowPts(i, p); }, t);
      t += 1500;
    }
  }
  function fmPick(i, text, pts) {
    const e = game.fm.rows[game.fm.player][i];
    if (text != null) e.text = text;
    e.pts = pts;
    save();
    if (e.showText || e.showPts) broadcast([]);
    renderFast();
  }
  function fmReset() {
    if (!confirm('Clear all bonus-round answers and reset the timer?')) return;
    snapshot();
    stopTimer();
    fmSeq++;
    game.fm = newFm();
    commit([], { sync: true });
  }

  // timer
  let timerIv = null;
  function startTimer() {
    const tm = game.fm.timer;
    if (tm.running) return;
    if (tm.remaining <= 0) tm.remaining = tm.duration;
    tm.running = true;
    const t0 = performance.now();
    const base = tm.remaining;
    let lastSec = Math.ceil(base);
    timerIv = setInterval(() => {
      const rem = Math.max(0, base - (performance.now() - t0) / 1000);
      tm.remaining = rem;
      const sec = Math.ceil(rem);
      if (sec !== lastSec) {
        lastSec = sec;
        if (rem <= 0) {
          stopTimer();
          tm.remaining = 0;
          play('timeup');
          commit([]);
          return;
        }
        play(sec <= 5 ? 'tickHigh' : 'tick', { gain: sec <= 5 ? 0.9 : 0.5 });
        broadcast([]);
        renderFastTimer();
      }
    }, 50);
    play('tick', { gain: 0.5 });
    commit([]);
  }
  function stopTimer() {
    if (timerIv) clearInterval(timerIv);
    timerIv = null;
    game.fm.timer.running = false;
  }
  function pauseTimer() {
    if (!game.fm.timer.running) return;
    stopTimer();
    game.fm.timer.remaining = Math.ceil(game.fm.timer.remaining);
    commit([]);
  }
  function toggleTimer() { game.fm.timer.running ? pauseTimer() : startTimer(); }
  function resetTimer() {
    stopTimer();
    const d = fmDuration(game.fm.player);
    game.fm.timer = { duration: d, remaining: d, running: false };
    commit([]);
  }

  /* =========================================================
   * Rendering
   * ========================================================= */
  function renderAll() {
    renderHeader();
    renderStrip();
    renderRoundPanel();
    renderFast();
    renderScores();
    renderScreenSeg();
    renderAudio();
  }

  function renderHeader() {
    $('hdr-title').textContent = setup.title;
    $('tab-btn-fast').textContent = setup.bonusName;
    $('btn-undo').disabled = !undoStack.length;
    document.title = setup.title + ' — Operator';
  }

  function renderConn() {
    const now = Date.now();
    const live = [...boards.values()].some((b) => !b.preview && now - b.lastSeen < 5000);
    const el = $('conn');
    el.classList.toggle('on', live);
    el.querySelector('span').textContent = live ? 'Audience screen connected' : 'Audience screen not open';
  }

  function renderScreenSeg() {
    document.querySelectorAll('#screen-seg button').forEach((b) => b.classList.toggle('active', b.dataset.screen === game.phase));
  }

  function renderScores() {
    const html = [0, 1].map((t) => `
      <div class="score-row ${t === 0 ? 'a' : 'b'}">
        <div class="nm">${esc(teamName(t))}</div>
        <div class="score-ctl">
          <button data-action="scoreAdj" data-t="${t}" data-d="-5" title="−5">−</button>
          <input type="number" id="score-${t}" data-score="${t}" value="${game.scores[t]}">
          <button data-action="scoreAdj" data-t="${t}" data-d="5" title="+5">+</button>
        </div>
      </div>`).join('') +
      `<div class="target-note">${setup.target > 0 ? `First to ${setup.target} points wins.` : 'Highest score after the last round wins.'} Edit a score to fix mistakes.</div>`;
    preserveFocus($('score-editor'), html);
  }

  function renderStrip() {
    const chips = parsed.rounds.map((r, i) => {
      const res = game.results[i];
      const cur = game.round && game.round.index === i && game.phase === 'round';
      const cls = ['rchip', cur ? 'current' : '', res ? (res.winner === 0 ? 'done-a' : 'done-b') : ''].join(' ');
      const m = r.sudden ? 'TIE' : '×' + r.mult;
      return `<button class="${cls}" data-action="startRound" data-i="${i}" title="${esc(r.question)}">
        <div class="t">${esc(roundLabel(i))} <span class="m ${r.mult > 1 || r.sudden ? 'hot' : ''}">${m}</span></div>
        <div class="q">${res ? `<span class="done">✓ ${esc(teamName(res.winner))} +${res.amount}</span>` : esc(r.question)}</div>
      </button>`;
    }).join('');
    const fast = `<button class="rchip fast" data-action="gotoFast"><div class="t">${esc(setup.bonusName)}</div><div class="q">${parsed.fast.length} question${parsed.fast.length === 1 ? '' : 's'}</div></button>`;
    $('rounds-strip').innerHTML = chips + fast;
  }

  function stageGuide(r) {
    const c = r.control;
    if (r.sudden && r.stage !== 'done') {
      return `<b>Sudden death.</b> Only the #1 answer is on the board. The host reads the question and players buzz in. Whoever names the top answer wins: click it, then award the bank to their team.`;
    }
    switch (r.stage) {
      case 'faceoff': return `<b>Face-off.</b> The host reads the question and one player from each team buzzes in. Press <kbd>Q</kbd> or <kbd>P</kbd> when someone buzzes, then click their answer if it's on the board (or <kbd>X</kbd> if it's not). The face-off winner chooses to play or pass, so click who will <b>play</b>.`;
      case 'play': return `<b>Playing: ${esc(teamName(c))}.</b> Click each correct answer. Wrong answer → <kbd>X</kbd> for a strike. Three strikes and the other team gets to steal. Find every answer and they win the bank.`;
      case 'steal': return `<b>Steal chance: ${esc(teamName(1 - c))}!</b> They confer and give ONE answer. If it's on the board, click it and they win the whole bank. If not, click <b>Steal failed</b> (or <kbd>X</kbd>) and the bank goes to ${esc(teamName(c))}.`;
      case 'done': return `<b>Round over: ${game.results[r.index] ? game.results[r.index].amount : r.bank} points to ${esc(teamName(r.winner))}.</b> Click the remaining answers to show them (no points), or use <b>Reveal remaining</b>. Then start the next round.`;
      default: return '';
    }
  }

  function renderRoundPanel() {
    const r = game.round;
    const st = gameStatus();
    const panel = $('round-panel');
    let banner = '';

    if (game.phase === 'winner') {
      banner = `<div class="banner win">🏆 Winner screen is showing: <b>${game.winner === -1 ? "It's a tie" : esc(teamName(game.winner))}</b>
        <span style="flex:1"></span>Show instead:
        <button class="btn teamA" data-action="setWinner" data-t="0">${esc(setup.teamA)}</button>
        <button class="btn teamB" data-action="setWinner" data-t="1">${esc(setup.teamB)}</button>
        <button class="btn" data-action="setWinner" data-t="-1">Tie</button></div>`;
    } else if (st.reached >= 0 && (!r || r.stage === 'done')) {
      banner = `<div class="banner win">🏆 ${esc(teamName(st.reached))} reached ${setup.target} points. Game over!
        <span style="flex:1"></span>
        <button class="btn primary" data-action="screen" data-v="winner">Show winner screen</button>
        <button class="btn" data-action="gotoFast">Go to ${esc(setup.bonusName)}</button></div>`;
    } else if (st.allMainDone && (!r || r.stage === 'done')) {
      if (st.tied && st.sudden >= 0) {
        banner = `<div class="banner win">It's a tie after the last round!
          <span style="flex:1"></span><button class="btn primary" data-action="startRound" data-i="${st.sudden}">Play Sudden Death</button></div>`;
      } else {
        const w = computeWinner();
        banner = `<div class="banner win">That was the last round. ${w === -1 ? "It's a tie!" : `Winner: <b>${esc(teamName(w))}</b>, ${Math.max(...game.scores)} to ${Math.min(...game.scores)}.`}
          <span style="flex:1"></span>
          <button class="btn primary" data-action="screen" data-v="winner">Show winner screen</button>
          <button class="btn" data-action="gotoFast">Go to ${esc(setup.bonusName)}</button></div>`;
      }
    }

    if (!r) {
      const first = parsed.rounds.length ? 0 : -1;
      panel.innerHTML = `${banner}<div class="card empty-state">
        <h2>Ready when you are</h2>
        <p class="muted">${parsed.rounds.length} main round${parsed.rounds.length === 1 ? '' : 's'} loaded${parsed.fast.length ? ` + ${parsed.fast.length} bonus questions` : ''}.<br>
        Open the audience screen, show the <b>Title</b> screen and play the theme while everyone settles in.</p>
        <div class="btn-row" style="justify-content:center">
          <button class="btn" data-action="screen" data-v="title">Show title screen</button>
          <button class="btn" data-sound="theme">▶ Play theme</button>
          ${first >= 0 ? `<button class="btn primary big" data-action="startRound" data-i="0">Start ${esc(roundLabel(0))} ▶</button>` : '<span class="muted">Add questions in Setup first.</span>'}
        </div></div>`;
      return;
    }

    const stages = r.sudden ? [['faceoff', 'Sudden death'], ['done', 'Round over']] : [['faceoff', 'Face-off'], ['play', 'Play'], ['steal', 'Steal'], ['done', 'Round over']];
    const curIdx = stages.findIndex((s) => s[0] === r.stage);
    const stepper = stages.map((s, k) => `<div class="step ${k === curIdx ? 'on' : k < curIdx ? 'past' : ''}"><b>${k + 1}</b>${s[1]}</div>`).join('');

    const slots = r.sudden ? 1 : 8;
    let rows = '';
    for (let i = 0; i < Math.max(slots, r.sudden ? r.answers.length : 8); i++) {
      const a = r.answers[i];
      if (!a) { rows += `<div class="ans-row empty">—</div>`; continue; }
      const off = r.sudden && i > 0;
      const val = a.pts * r.mult;
      rows += `<button class="ans-row ${a.revealed ? 'revealed' : ''} ${a.free ? 'free' : ''} ${off ? 'offboard' : ''}" data-action="reveal" data-i="${i}" ${a.revealed || off ? 'disabled' : ''}>
        <span class="n">${off ? '·' : i + 1}</span>
        <span class="a">${esc(a.text)}${off ? ' <small class="muted">(not on board)</small>' : ''}</span>
        <span class="p">${a.pts}${r.mult > 1 ? `<small>= ${val} in bank</small>` : ''}</span>
      </button>`;
    }

    const A = esc(setup.teamA), B = esc(setup.teamB);
    let controls = '';
    if (r.stage === 'faceoff') {
      controls += `<div class="ctl-group"><div class="lbl">Buzzed in</div><div class="btns">
          <button class="btn big teamA" data-action="buzz" data-t="0">🔔 ${A} <kbd>Q</kbd></button>
          <button class="btn big teamB" data-action="buzz" data-t="1">🔔 ${B} <kbd>P</kbd></button>
          ${r.buzz != null ? `<span class="muted">Last buzz: <b>${esc(teamName(r.buzz))}</b></span>` : ''}
          <span style="flex:1"></span>
          <button class="btn big red" data-action="strike">✗ Not on board <kbd>X</kbd></button>
        </div></div>`;
      if (!r.sudden) {
        controls += `<div class="ctl-group"><div class="lbl">Face-off winner chose to play or pass. Who plays?</div><div class="btns">
          <button class="btn huge teamA" data-action="control" data-t="0">▶ ${A} plays</button>
          <button class="btn huge teamB" data-action="control" data-t="1">▶ ${B} plays</button>
        </div></div>`;
      } else {
        controls += `<div class="ctl-group"><div class="lbl">Who named the top answer?</div><div class="btns">
          <button class="btn huge teamA" data-action="award" data-t="0">🏆 Award bank to ${A}</button>
          <button class="btn huge teamB" data-action="award" data-t="1">🏆 Award bank to ${B}</button>
        </div></div>`;
      }
    } else if (r.stage === 'play') {
      const dots = [0, 1, 2].map((k) => `<i class="${k < r.strikes ? 'on' : ''}">✗</i>`).join('');
      controls += `<div class="ctl-group"><div class="lbl">Playing: ${esc(teamName(r.control))}</div><div class="btns">
          <button class="btn huge red" data-action="strike">✗ STRIKE <kbd>X</kbd></button>
          <span class="strike-dots">${dots}</span>
          <span style="flex:1"></span>
          <button class="btn" data-action="control" data-t="${1 - r.control}">Oops, switch to ${esc(teamName(1 - r.control))}</button>
        </div></div>`;
    } else if (r.stage === 'steal') {
      controls += `<div class="ctl-group"><div class="lbl">Stealing: ${esc(teamName(1 - r.control))}</div><div class="btns">
          <span class="muted">Their answer is on the board? Click it above.</span>
          <span style="flex:1"></span>
          <button class="btn huge red" data-action="stealFailed">✗ Steal failed → bank to ${esc(teamName(r.control))} <kbd>X</kbd></button>
        </div></div>`;
    } else if (r.stage === 'done') {
      const remaining = r.answers.some((a, i) => !a.revealed && (!r.sudden || i === 0));
      const nextBtn = st.next >= 0 && st.reached < 0
        ? `<button class="btn huge primary" data-action="startRound" data-i="${st.next}">Start ${esc(roundLabel(st.next))} ▶</button>` : '';
      controls += `<div class="ctl-group"><div class="lbl">Round over</div><div class="btns">
          <button class="btn big" data-action="revealRemaining" ${remaining ? '' : 'disabled'}>Reveal remaining answers</button>
          <span style="flex:1"></span>
          ${nextBtn}
        </div></div>`;
    }
    if (r.stage !== 'done') {
      controls += `<div class="override">Manual override:
        <button class="btn" data-action="award" data-t="0">Award bank (${r.bank}) to ${A}</button>
        <button class="btn" data-action="award" data-t="1">Award bank (${r.bank}) to ${B}</button>
        <span class="muted">Undo with ⌘Z / Ctrl+Z</span></div>`;
    }

    panel.innerHTML = `${banner}<div class="card">
      <div class="round-top">
        <div>
          <div class="rlabel">${esc(r.label)} · ${esc(SS.multLabel(r.mult, r.sudden))}${r.mult > 1 ? ` (×${r.mult})` : ''}</div>
          <div class="qtext">${esc(r.question)}</div>
        </div>
        <div class="right">
          <div class="bankbox"><div class="v">${r.bank}</div><div class="l">Bank</div></div>
          <label class="toggle"><input type="checkbox" data-action="toggleQuestion" ${r.showQuestion ? 'checked' : ''}> Question on screen</label>
        </div>
      </div>
      <div class="stepper">${stepper}</div>
      <div class="guide">${stageGuide(r)}</div>
      <div class="answers ${r.sudden ? 'sudden' : ''}">${rows}</div>
      <div class="controls">${controls}</div>
    </div>`;
  }

  function renderFastTimer() {
    const tm = game.fm.timer;
    const el = $('fm-op-timer');
    if (!el) return;
    el.textContent = Math.max(0, Math.ceil(tm.remaining));
    el.classList.toggle('low', tm.running && tm.remaining <= 5);
    const btn = $('fm-timer-btn');
    if (btn) btn.innerHTML = (tm.running ? '❚❚ Pause' : '▶ Start timer') + ' <kbd>Space</kbd>';
  }

  const norm = (s) => String(s || '').trim().toLowerCase();

  function renderFast() {
    const fm = game.fm;
    const p = fm.player;
    const qs = fastQuestions();
    const total = fmTotal();
    const tm = fm.timer;
    const cards = qs.map((q, i) => {
      const e = fm.rows[p][i];
      const o = fm.rows[1 - p][i];
      const chips = q.answers.map((a) => `<button class="chip ${p === 1 && o.text && norm(o.text) === norm(a.text) ? 'taken' : ''}" data-action="fmPick" data-i="${i}" data-text="${esc(a.text)}" data-pts="${a.pts}">${esc(a.text)}<b>${a.pts}</b></button>`).join('') +
        `<button class="chip zero" data-action="fmPick" data-i="${i}" data-pts="0" title="Their answer isn't on the survey list">✗ 0 pts</button>`;
      const status = e.showPts ? 'On screen ✓' : e.showText ? 'Answer shown' : 'Hidden';
      return `<div class="fm-q">
        <span class="num">${i + 1}</span>
        <div>
          <div class="qt">${esc(q.question)}</div>
          <div class="chips">${chips}</div>
          <div class="fm-entry">
            <input type="text" id="fmt-${i}" data-fm="text" data-i="${i}" value="${esc(e.text)}" placeholder="What did Player ${p + 1} say?">
            <input type="number" class="pts" id="fmp-${i}" data-fm="pts" data-i="${i}" value="${e.pts}" min="0">
            <button class="btn" data-action="fmShowText" data-i="${i}" ${e.showText ? 'disabled' : ''}>Show answer</button>
            <button class="btn primary" data-action="fmShowPts" data-i="${i}" ${e.showPts ? 'disabled' : ''}>Show points</button>
            <button class="btn ghost" data-action="fmHide" data-i="${i}" title="Hide this row on the big screen">Hide</button>
          </div>
          <div class="fm-other">${p === 1 ? (o.text ? `Player 1 said: <b>${esc(o.text)}</b> (${o.pts})` : 'Player 1: no answer') : (fm.rows[1][i].text ? `Player 2 said: <b>${esc(fm.rows[1][i].text)}</b>` : '')} <span style="float:right">${status}</span></div>
        </div>
      </div>`;
    }).join('');

    const html = `<div class="card">
      ${game.phase !== 'fast' ? `<div class="banner info" style="margin-bottom:12px">The audience isn't seeing the ${esc(setup.bonusName)} board yet. <span style="flex:1"></span><button class="btn primary" data-action="screen" data-v="fast">Show it on screen</button></div>` : ''}
      <div class="fm-top">
        <div class="fm-players">
          <button data-action="fmPlayer" data-v="0" class="${p === 0 ? 'active' : ''}">Player 1 · ${setup.timer1}s</button>
          <button data-action="fmPlayer" data-v="1" class="${p === 1 ? 'active' : ''}">Player 2 · ${setup.timer2}s</button>
        </div>
        <div class="fm-timer-box">
          <span class="fm-timer-num" id="fm-op-timer">${Math.max(0, Math.ceil(tm.remaining))}</span>
          <button class="btn big primary" data-action="fmTimer" id="fm-timer-btn"></button>
          <button class="btn" data-action="fmTimerReset">Reset</button>
          <button class="btn red" data-action="fmDuplicate">Duplicate! <kbd>D</kbd></button>
        </div>
        <div class="fm-total-box"><div class="v">${total}</div><div class="l">Total · goal ${setup.bonusTarget}</div></div>
      </div>
      ${cards}
      <div class="fm-bottom">
        <button class="btn primary big" data-action="fmRevealAll">Reveal all for Player ${p + 1}</button>
        <label class="toggle"><input type="checkbox" data-action="fmHideP1" ${fm.hideP1 ? 'checked' : ''}> Hide Player 1's answers on screen</label>
        <span style="flex:1"></span>
        <button class="btn danger" data-action="fmReset">Reset bonus round</button>
      </div>
    </div>`;
    preserveFocus($('fast-panel'), html);
    renderFastTimer();
  }

  function renderAudio() {
    const st = $('audio-status');
    if (st) st.textContent = !SFX.ready ? 'loading sounds…' : !SFX.musicReady ? 'preparing theme…' : SFX.isMusicPlaying() ? '♪ music playing' : 'ready';
    const tb = $('btn-theme');
    if (tb) {
      tb.classList.toggle('playing', SFX.isMusicPlaying());
      tb.textContent = SFX.isMusicPlaying() ? '■ Stop theme' : '▶ Theme music';
    }
  }

  function preserveFocus(container, html) {
    const ae = document.activeElement;
    let id = null, s = null, e = null;
    if (ae && ae.id && container.contains(ae)) {
      id = ae.id;
      try { s = ae.selectionStart; e = ae.selectionEnd; } catch (err) { /* number inputs */ }
    }
    container.innerHTML = html;
    if (id) {
      const el = document.getElementById(id);
      if (el) {
        el.focus();
        try { if (s != null) el.setSelectionRange(s, e); } catch (err) { /* ignore */ }
      }
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    ['game', 'fast', 'setup', 'look', 'help'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== tab));
    document.querySelector('.layout').classList.toggle('wide', tab === 'setup' || tab === 'help');
  }

  /* =========================================================
   * Setup tab
   * ========================================================= */
  const SETUP_FIELDS = ['title', 'teamA', 'teamB', 'target', 'bonusName', 'bonusTarget', 'timer1', 'timer2'];
  function fillSetup() {
    SETUP_FIELDS.forEach((k) => { $('set-' + k).value = setup[k]; });
    $('data-text').value = dataText;
    renderSource();
    renderParsePreview(parsed);
  }
  function saveSetup() {
    const s = {};
    SETUP_FIELDS.forEach((k) => {
      const v = $('set-' + k).value;
      s[k] = ['target', 'bonusTarget', 'timer1', 'timer2'].includes(k) ? Math.max(0, parseInt(v, 10) || 0) : v.trim();
    });
    if (!s.title) s.title = SS.defaultSetup.title;
    if (!s.teamA) s.teamA = 'Team A';
    if (!s.teamB) s.teamB = 'Team B';
    if (!s.bonusName) s.bonusName = SS.defaultSetup.bonusName;
    if (!s.bonusTarget) s.bonusTarget = SS.defaultSetup.bonusTarget;
    if (s.timer1 < 5) s.timer1 = 20;
    if (s.timer2 < 5) s.timer2 = 25;
    setup = Object.assign({}, setup, s);
    SS.store.set('ss_setup', setup);
    if (!game.fm.timer.running) {
      const d = fmDuration(game.fm.player);
      if (game.fm.timer.remaining === game.fm.timer.duration) game.fm.timer = { duration: d, remaining: d, running: false };
    }
    commit([]);
    $('setup-saved').textContent = 'Saved ✓';
    setTimeout(() => { $('setup-saved').textContent = ''; }, 2000);
  }
  function renderSource() {
    $('source-note').innerHTML = dataSource === 'browser'
      ? 'Using questions <b>saved in this browser</b>. Edits to survey-data.js are ignored until you click “Reload from survey-data.js”.'
      : 'Using questions from <b>survey-data.js</b>. Editing here and clicking Save keeps your version in this browser.';
  }
  function renderParsePreview(p) {
    let html = '';
    if (p.errors.length) html += `<div class="err">✗ ${p.errors.map(esc).join('<br>✗ ')}</div>`;
    const mainCount = p.rounds.filter((r) => !r.sudden).length;
    const sd = p.rounds.filter((r) => r.sudden).length;
    html += `<div class="ok">✓ ${mainCount} main round${mainCount === 1 ? '' : 's'}${sd ? `, ${sd} sudden-death tiebreaker` : ''}, ${p.fast.length} bonus question${p.fast.length === 1 ? '' : 's'}.</div>`;
    if (p.warnings.length) html += `<ul class="warn">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
    let n = 0;
    html += '<div class="pp-rounds">' + p.rounds.map((r) => {
      const lbl = r.sudden ? 'Sudden death' : `Round ${++n} · ×${r.mult}`;
      const tot = r.answers.reduce((s, a) => s + a.pts, 0);
      return `<div class="pp-round"><div class="h">${lbl}</div><div class="qq">${esc(r.question)}</div><div class="aa">${r.answers.map((a) => `${esc(a.text)} (${a.pts})`).join(' · ')}</div><div class="aa">${r.answers.length} answers · ${tot} total</div></div>`;
    }).join('') + p.fast.map((r, i) => `<div class="pp-round"><div class="h">Bonus Q${i + 1}</div><div class="qq">${esc(r.question)}</div><div class="aa">${r.answers.map((a) => `${esc(a.text)} (${a.pts})`).join(' · ')}</div></div>`).join('') + '</div>';
    $('parse-preview').innerHTML = html;
  }
  function saveData(text, msg) {
    dataText = text;
    parsed = SS.parseSurvey(dataText);
    SS.store.set('ss_data_text', dataText);
    dataSource = 'browser';
    renderSource();
    renderParsePreview(parsed);
    renderAll();
    toast(msg || 'Questions saved');
  }

  function printSheet() {
    let n = 0;
    const rounds = parsed.rounds.map((r) => {
      const lbl = r.sudden ? 'Sudden death (tiebreaker, only #1 counts)' : `Round ${++n} · ${SS.multLabel(r.mult)}`;
      return `<div class="ph-round"><h3>${esc(lbl)}</h3><div class="ph-q">${esc(r.question)}</div><table>${r.answers.map((a, i) => `<tr><td class="n">${i + 1}</td><td>${esc(a.text)}</td><td class="p">${a.pts}</td></tr>`).join('')}</table></div>`;
    }).join('');
    const fast = parsed.fast.length ? `<div class="ph-break"></div><div class="ph-title">${esc(setup.bonusName)}</div><div class="ph-sub">Player 1: ${setup.timer1}s · Player 2: ${setup.timer2}s · Goal: ${setup.bonusTarget} points</div>` +
      parsed.fast.map((r, i) => `<div class="ph-round"><h3>Question ${i + 1}</h3><div class="ph-q">${esc(r.question)}</div><table>${r.answers.map((a, k) => `<tr><td class="n">${k + 1}</td><td>${esc(a.text)}</td><td class="p">${a.pts}</td></tr>`).join('')}</table></div>`).join('') : '';
    $('print-area').innerHTML = `<div class="ph-title">${esc(setup.title)}: Host Sheet</div>
      <div class="ph-sub">${esc(setup.teamA)} vs ${esc(setup.teamB)} · ${setup.target > 0 ? `First to ${setup.target} wins` : 'Highest score wins'}</div>${rounds}${fast}`;
    window.print();
  }

  /* =========================================================
   * Events
   * ========================================================= */
  document.addEventListener('click', (ev) => {
    const snd = ev.target.closest('[data-sound]');
    if (snd) {
      const name = snd.dataset.sound;
      if (name === 'theme' && SFX.isMusicPlaying()) SFX.stopMusic(1.2);
      else play(name);
      renderAudio();
      return;
    }
    const tabBtn = ev.target.closest('#tabs button');
    if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }
    const scr = ev.target.closest('#screen-seg button');
    if (scr) { setScreen(scr.dataset.screen); return; }

    const el = ev.target.closest('[data-action]');
    if (!el) return;
    const act = el.dataset.action;
    const i = el.dataset.i != null ? parseInt(el.dataset.i, 10) : null;
    const t = el.dataset.t != null ? parseInt(el.dataset.t, 10) : null;
    switch (act) {
      case 'undo': undo(); break;
      case 'startRound': startRound(i); break;
      case 'reveal': reveal(i); break;
      case 'strike': strike(); break;
      case 'buzz': buzz(t); break;
      case 'control': setControl(t); break;
      case 'award': manualAward(t); break;
      case 'stealFailed': stealFailed(); break;
      case 'revealRemaining': revealRemaining(); break;
      case 'toggleQuestion': toggleQuestion(); break;
      case 'screen': setScreen(el.dataset.v); break;
      case 'setWinner': setWinner(t); break;
      case 'scoreAdj': setScore(t, game.scores[t] + parseInt(el.dataset.d, 10)); break;
      case 'stopMusic': SFX.stopMusic(1.2); break;
      case 'gotoFast': switchTab('fast'); break;
      case 'fmPlayer': fmSetPlayer(parseInt(el.dataset.v, 10)); break;
      case 'fmTimer': toggleTimer(); break;
      case 'fmTimerReset': resetTimer(); break;
      case 'fmDuplicate': play('duplicate'); break;
      case 'fmPick': fmPick(i, el.dataset.text != null ? el.dataset.text : null, parseInt(el.dataset.pts, 10) || 0); break;
      case 'fmShowText': fmShowText(i); break;
      case 'fmShowPts': fmShowPts(i); break;
      case 'fmHide': fmHideRow(i); break;
      case 'fmRevealAll': fmRevealAll(); break;
      case 'fmHideP1': snapshot(); game.fm.hideP1 = !game.fm.hideP1; commit([]); break;
      case 'fmReset': fmReset(); break;
      default: break;
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.fm) {
      const i = parseInt(el.dataset.i, 10);
      const e = game.fm.rows[game.fm.player][i];
      if (el.dataset.fm === 'text') e.text = el.value;
      else e.pts = Math.max(0, parseInt(el.value, 10) || 0);
      save();
      if (e.showText || e.showPts) broadcast([]);
    }
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.score != null) setScore(parseInt(el.dataset.score, 10), el.value);
    if (el.dataset.fm) renderFast();
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const typing = (tag === 'INPUT' && !['checkbox', 'range', 'radio', 'button'].includes(e.target.type)) || tag === 'TEXTAREA';
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (currentTab === 'game') {
      if (/^[1-8]$/.test(k)) { reveal(parseInt(k, 10) - 1); e.preventDefault(); }
      else if (k === 'x') strike();
      else if (k === 'q') buzz(0);
      else if (k === 'p') buzz(1);
    } else if (currentTab === 'fast') {
      if (k === ' ') { e.preventDefault(); toggleTimer(); }
      else if (k === 'd') play('duplicate');
    }
  });

  $('btn-open-board').addEventListener('click', openBoard);
  $('btn-save-setup').addEventListener('click', saveSetup);
  $('btn-new-game').addEventListener('click', newGameReset);
  $('btn-save-data').addEventListener('click', () => saveData($('data-text').value));
  $('btn-print').addEventListener('click', printSheet);
  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([$('data-text').value], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'survey-questions.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('btn-reload-file').addEventListener('click', () => {
    if (!confirm('Replace the questions saved in this browser with the contents of survey-data.js?')) return;
    SS.store.remove('ss_data_text');
    dataText = fileText();
    dataSource = 'file';
    parsed = SS.parseSurvey(dataText);
    fillSetup();
    renderAll();
    toast('Loaded survey-data.js');
  });
  $('file-import').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      $('data-text').value = rd.result;
      saveData(String(rd.result), `Imported ${f.name}`);
      ev.target.value = '';
    };
    rd.readAsText(f);
  });
  let ppTimer = null;
  $('data-text').addEventListener('input', () => {
    clearTimeout(ppTimer);
    ppTimer = setTimeout(() => renderParsePreview(SS.parseSurvey($('data-text').value)), 300);
  });

  ['vol-sfx', 'vol-music'].forEach((id) => {
    const el = $(id);
    el.value = id === 'vol-sfx' ? audioPrefs.sfx : audioPrefs.music;
    el.addEventListener('input', () => {
      audioPrefs[id === 'vol-sfx' ? 'sfx' : 'music'] = parseFloat(el.value);
      SFX.setVolumes(audioPrefs);
      SS.store.set('ss_audio', audioPrefs);
    });
  });
  $('mute').checked = !!audioPrefs.muted;
  $('mute').addEventListener('change', () => {
    audioPrefs.muted = $('mute').checked;
    SFX.setVolumes(audioPrefs);
    SS.store.set('ss_audio', audioPrefs);
  });

  /* =========================================================
   * Look & Sound: swappable background image and audio files
   * Picked files are kept in IndexedDB (this browser); files in the
   * images/ and sounds/ folders are found automatically.
   * ========================================================= */
  const AssetDB = (() => {
    let dbp = null;
    function open() {
      if (!dbp) {
        dbp = new Promise((res, rej) => {
          if (!window.indexedDB) { rej(new Error('IndexedDB unavailable')); return; }
          const r = indexedDB.open('survey-showdown-assets', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('assets');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
      }
      return dbp;
    }
    function run(mode, fn) {
      return open().then((db) => new Promise((res, rej) => {
        const t = db.transaction('assets', mode);
        const req = fn(t.objectStore('assets'));
        t.oncomplete = () => res(req ? req.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      }));
    }
    return {
      get: (k) => run('readonly', (s) => s.get(k)),
      set: (k, v) => run('readwrite', (s) => s.put(v, k)),
      del: (k) => run('readwrite', (s) => s.delete(k)),
    };
  })();
  let dbWarned = false;
  function dbFail(e) {
    console.warn(e);
    if (!dbWarned) {
      dbWarned = true;
      toast("This browser can't save picked files, so they only last until you close it. The folder option always works.");
    }
  }
  const fmtSize = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');

  /* ---------- background ---------- */
  let look = Object.assign({ dim: 0.35, blur: 0, snow: false, lights: false }, SS.store.get('ss_look', {}));
  let bg = { kind: 'builtin' }; // or {kind:'upload', blob, name, size} or {kind:'file', url}
  let bgThumbUrl = null;

  function assetsMsg() {
    return {
      app: 'ss', type: 'assets', id: SS.uid(), look,
      bg: bg.kind === 'upload' ? { blob: bg.blob } : bg.kind === 'file' ? { url: bg.url } : null,
    };
  }
  function sendAssets() { post(assetsMsg()); }
  function sendLook() { post({ app: 'ss', type: 'look', id: SS.uid(), look }); }

  function probeImage(urls) {
    return new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (i >= urls.length) { resolve(null); return; }
        const u = urls[i++];
        const img = new Image();
        img.onload = () => resolve(u);
        img.onerror = next;
        img.src = u;
      };
      next();
    });
  }
  const findFolderBackground = () => probeImage(['jpg', 'jpeg', 'png', 'webp', 'JPG', 'JPEG', 'PNG'].map((e) => 'images/background.' + e));

  async function loadBackground() {
    let saved = null;
    try { saved = await AssetDB.get('bg'); } catch (e) { /* storage unavailable */ }
    if (saved && saved.blob) bg = { kind: 'upload', blob: saved.blob, name: saved.name, size: saved.size };
    else {
      const url = await findFolderBackground();
      bg = url ? { kind: 'file', url } : { kind: 'builtin' };
    }
    renderLook();
    sendAssets();
  }
  async function pickBackground(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Please choose an image file (jpg, png, webp…).'); return; }
    bg = { kind: 'upload', blob: file, name: file.name, size: file.size };
    renderLook();
    sendAssets();
    toast('Background updated');
    try { await AssetDB.set('bg', { blob: file, name: file.name, size: file.size }); } catch (e) { dbFail(e); }
  }
  async function removeBackground() {
    try { await AssetDB.del('bg'); } catch (e) { /* ignore */ }
    const url = await findFolderBackground();
    bg = url ? { kind: 'file', url } : { kind: 'builtin' };
    renderLook();
    sendAssets();
    toast(url ? 'Using ' + url + ' from the images folder' : 'Using the built-in background');
  }
  function setLook(patch) {
    look = Object.assign({}, look, patch);
    SS.store.set('ss_look', look);
    sendLook();
    const d = document.querySelector('#bg-thumb .dim');
    if (d) d.style.opacity = look.dim;
  }

  function renderLook() {
    const thumb = $('bg-thumb');
    if (bgThumbUrl) { URL.revokeObjectURL(bgThumbUrl); bgThumbUrl = null; }
    let url = null;
    if (bg.kind === 'upload') url = bgThumbUrl = URL.createObjectURL(bg.blob);
    else if (bg.kind === 'file') url = bg.url;
    thumb.style.backgroundImage = url ? `url("${url}")` : '';
    thumb.innerHTML = url ? `<div class="dim" style="opacity:${look.dim}"></div>` : '<span>Built-in night sky</span>';
    $('bg-status').innerHTML = bg.kind === 'upload'
      ? `Using <b>${esc(bg.name)}</b> (${fmtSize(bg.size)}), saved in this browser.`
      : bg.kind === 'file' ? `Using <b>${esc(bg.url)}</b> from the images folder.` : 'Using the <b>built-in</b> background.';
    $('bg-remove').disabled = bg.kind !== 'upload';
    $('look-dim').value = look.dim;
    $('look-blur').value = look.blur;
    $('look-snow').checked = look.snow !== false;
    $('look-lights').checked = look.lights !== false;
  }

  /* ---------- sounds ---------- */
  const SOUNDS = window.SOUND_LIST;
  const soundLabel = (k) => (SOUNDS.find((s) => s.key === k) || { label: k }).label;
  const soundVol = Object.assign({}, SS.store.get('ss_sound_vol', {}));
  Object.keys(soundVol).forEach((k) => SFX.setSoundVolume(k, soundVol[k]));

  async function loadUploadedSounds() {
    for (const s of SOUNDS) {
      let v = null;
      try { v = await AssetDB.get('sound:' + s.key); } catch (e) { return; }
      if (v && v.blob) {
        try { await SFX.setUpload(s.key, v.blob, v.name); } catch (e) { console.warn('saved sound unreadable', s.key, e); }
      }
    }
  }
  async function pickSound(key, file) {
    if (!file) return;
    try { await SFX.setUpload(key, file, file.name); } catch (e) {
      toast("Couldn't read that file. Try an mp3, m4a or wav.");
      return;
    }
    toast(`${soundLabel(key)}: now using ${file.name}`);
    try { await AssetDB.set('sound:' + key, { blob: file, name: file.name, size: file.size }); } catch (e) { dbFail(e); }
  }
  async function resetSound(key) {
    if (SFX.music && SFX.music.name === key) SFX.stopMusic(0.3);
    SFX.clearUpload(key);
    try { await AssetDB.del('sound:' + key); } catch (e) { /* ignore */ }
  }

  let soundSig = '';
  function renderSoundList(force) {
    const sig = JSON.stringify(SOUNDS.map((s) => SFX.sourceOf(s.key)));
    if (!force && sig === soundSig) { updateSoundButtons(); return; }
    soundSig = sig;
    $('sound-list').innerHTML = SOUNDS.map((s) => {
      const src = SFX.sourceOf(s.key);
      const srcText = src.kind === 'upload' ? `Your file: ${src.label}` : src.kind === 'folder' ? `Folder: ${src.label}` : 'Built-in';
      return `<div class="snd-row">
        <div><div class="snd-name">${esc(s.label)}</div><div class="snd-desc">${esc(s.desc)}</div></div>
        <span class="snd-src ${src.kind}" title="${esc(srcText)}">${esc(srcText)}</span>
        <input type="range" min="0" max="1" step="0.05" value="${SFX.volOf(s.key)}" data-snd-vol="${s.key}" title="Volume for this sound">
        <button class="btn" data-snd-play="${s.key}" title="Preview">▶</button>
        <label class="btn file-btn">Replace…<input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.aac" data-snd-file="${s.key}"></label>
        <span class="reset-slot">${src.kind === 'upload' ? `<button class="btn ghost" data-snd-reset="${s.key}">Reset</button>` : ''}</span>
      </div>`;
    }).join('');
    $('sound-names').innerHTML = SOUNDS.map((s) => `<tr><td><code>${s.file}.mp3</code></td><td>${esc(s.label)}</td></tr>`).join('');
    updateSoundButtons();
  }
  function updateSoundButtons() {
    document.querySelectorAll('[data-snd-play]').forEach((b) => {
      b.textContent = SFX.music && SFX.music.name === b.dataset.sndPlay ? '■' : '▶';
    });
  }

  document.addEventListener('click', (ev) => {
    const p = ev.target.closest('[data-snd-play]');
    if (p) {
      const k = p.dataset.sndPlay;
      if (SFX.music && SFX.music.name === k) SFX.stopMusic(0.5); else play(k);
      updateSoundButtons();
      return;
    }
    const r = ev.target.closest('[data-snd-reset]');
    if (r) { resetSound(r.dataset.sndReset).then(() => toast(`${soundLabel(r.dataset.sndReset)}: back to the default`)); }
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.sndFile) { pickSound(el.dataset.sndFile, el.files[0]); el.value = ''; }
    if (el.dataset.sndVol && el.dataset.sndVol !== 'theme') play(el.dataset.sndVol);
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.sndVol) {
      const v = parseFloat(el.value);
      SFX.setSoundVolume(el.dataset.sndVol, v);
      soundVol[el.dataset.sndVol] = v;
      SS.store.set('ss_sound_vol', soundVol);
    }
  });
  $('sounds-rescan').addEventListener('click', () => {
    SFX.probeFolder().then(() => {
      const n = SOUNDS.filter((s) => SFX.folder[s.key]).length;
      toast(n ? `Found ${n} sound file${n === 1 ? '' : 's'} in the sounds folder` : 'No matching files found in the sounds folder');
    });
  });
  $('sounds-reset-all').addEventListener('click', async () => {
    if (!confirm('Remove every sound you picked with Replace and reset all volumes? (Files in the sounds folder stay in use.)')) return;
    for (const s of SOUNDS) await resetSound(s.key);
    Object.keys(soundVol).forEach((k) => { delete soundVol[k]; SFX.setSoundVolume(k, 1); });
    SS.store.set('ss_sound_vol', soundVol);
    renderSoundList(true);
    toast('All sounds reset');
  });
  $('bg-file').addEventListener('change', (ev) => { pickBackground(ev.target.files[0]); ev.target.value = ''; });
  $('bg-remove').addEventListener('click', removeBackground);
  $('look-dim').addEventListener('input', (ev) => setLook({ dim: parseFloat(ev.target.value) }));
  $('look-blur').addEventListener('input', (ev) => setLook({ blur: parseFloat(ev.target.value) }));
  $('look-snow').addEventListener('change', (ev) => setLook({ snow: ev.target.checked }));
  $('look-lights').addEventListener('change', (ev) => setLook({ lights: ev.target.checked }));

  /* =========================================================
   * Boot
   * ========================================================= */
  fillSetup();
  renderAll();
  renderConn();
  broadcast([], true);
  renderLook();
  renderSoundList(true);
  loadBackground();
  loadUploadedSounds();
  if (parsed.errors.length) switchTab('setup');

  // exposed for debugging / testing in the console
  window.__op = { get game() { return game; }, get parsed() { return parsed; }, get bg() { return bg; }, get look() { return look; }, SFX, reveal, strike, setControl, startRound, setScreen, pickBackground, pickSound, resetSound, removeBackground, AssetDB };
})();
