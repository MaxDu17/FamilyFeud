/* Audience board: a pure renderer of the state sent by the operator console. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = SS.escapeHtml;
  const stage = $('stage');
  const isPreview = new URLSearchParams(location.search).has('preview') || window.self !== window.top;
  if (isPreview) document.body.classList.add('preview');

  /* ---------------- stage scaling ---------------- */
  function fitStage() {
    const s = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    stage.style.setProperty('--s', s);
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  /* ---------------- decorations ---------------- */
  let snowOn = false;
  buildLights();
  startSnow();
  const confetti = makeConfetti($('confetti'));

  function buildLights() {
    const W = 1600, spans = 8, sag = 30, top = 6;
    const colors = ['#ff3b4f', '#ffd23f', '#2fd36b', '#3fa9ff', '#ff8a3d'];
    const spanW = W / spans;
    let d = '';
    let bulbs = '';
    let n = 0;
    for (let s = 0; s < spans; s++) {
      const x0 = s * spanW, x1 = x0 + spanW, cx = (x0 + x1) / 2, cy = top + 2 * sag;
      d += (s === 0 ? `M${x0},${top} ` : '') + `Q${cx},${cy} ${x1},${top} `;
      for (let k = 1; k <= 4; k++) {
        const t = k / 5;
        const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
        const y = (1 - t) * (1 - t) * top + 2 * (1 - t) * t * cy + t * t * top;
        const dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx);
        const dy = 2 * (1 - t) * (cy - top) + 2 * t * (top - cy);
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const c = colors[n % colors.length];
        const delay = (Math.random() * 3).toFixed(2), dur = (1.6 + Math.random() * 2).toFixed(2);
        bulbs += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(ang * 0.6).toFixed(1)})">
          <rect x="-4" y="-1" width="8" height="8" rx="1.5" fill="#26352a"/>
          <ellipse class="bulb" cx="0" cy="17" rx="7.5" ry="11.5" fill="${c}" style="--delay:${delay}s;--dur:${dur}s;filter:drop-shadow(0 0 7px ${c}) drop-shadow(0 0 14px ${c})"/>
          <ellipse cx="-2.5" cy="12" rx="2" ry="4" fill="rgba(255,255,255,0.6)"/>
        </g>`;
        n++;
      }
    }
    $('lights').innerHTML = `<svg viewBox="0 0 1600 90" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="#1d2b20" stroke-width="3.5"/>${bulbs}</svg>`;
  }

  function startSnow() {
    const c = $('snow');
    const ctx = c.getContext('2d');
    const N = isPreview ? 35 : 120;
    const flakes = Array.from({ length: N }, () => ({
      x: Math.random() * 1600, y: Math.random() * 900,
      r: 0.8 + Math.random() * 2.6, vy: 0.25 + Math.random() * 0.8,
      ph: Math.random() * Math.PI * 2, a: 0.25 + Math.random() * 0.55,
    }));
    function frame(t) {
      ctx.clearRect(0, 0, 1600, 900);
      if (!snowOn) { requestAnimationFrame(frame); return; }
      for (const f of flakes) {
        f.y += f.vy;
        f.x += Math.sin(t * 0.0006 + f.ph) * 0.35;
        if (f.y > 910) { f.y = -10; f.x = Math.random() * 1600; }
        ctx.globalAlpha = f.a;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function makeConfetti(canvas) {
    const ctx = canvas.getContext('2d');
    const colors = ['#ffd257', '#ff3b4f', '#2fd36b', '#ffffff', '#3fa9ff', '#ffb02e'];
    let parts = [];
    let rainUntil = 0;
    let running = false;
    function spawn(x, y, vx, vy) {
      parts.push({ x, y, vx, vy, w: 8 + Math.random() * 8, h: 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[(Math.random() * colors.length) | 0], wob: Math.random() * 6 });
    }
    function loop() {
      ctx.clearRect(0, 0, 1600, 900);
      const now = performance.now();
      if (now < rainUntil) for (let i = 0; i < 6; i++) spawn(Math.random() * 1600, -20, (Math.random() - 0.5) * 2, 2 + Math.random() * 3);
      parts = parts.filter((p) => p.y < 960 && p.x > -60 && p.x < 1660);
      for (const p of parts) {
        p.vy += 0.12; p.vx *= 0.99; p.vy = Math.min(p.vy, 7);
        p.x += p.vx + Math.sin((p.wob += 0.1)) * 0.6; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.wob)));
        ctx.restore();
      }
      if (parts.length || now < rainUntil) requestAnimationFrame(loop);
      else { running = false; ctx.clearRect(0, 0, 1600, 900); }
    }
    function ensure() { if (!running) { running = true; requestAnimationFrame(loop); } }
    return {
      burst(x, y, n = 140, up = 1) {
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
          const sp = 6 + Math.random() * 10;
          spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp * up);
        }
        ensure();
      },
      rain(ms = 4000) { rainUntil = performance.now() + ms; ensure(); },
    };
  }

  /* ---------------- helpers ---------------- */
  function fitText(el, max, min, allowWrap) {
    el.style.whiteSpace = 'nowrap';
    el.style.lineHeight = '';
    let s = max;
    el.style.fontSize = s + 'px';
    while (s > min && el.scrollWidth > el.clientWidth + 1) { s -= 2; el.style.fontSize = s + 'px'; }
    if (allowWrap && el.scrollWidth > el.clientWidth + 1) {
      el.style.whiteSpace = 'normal';
      el.style.lineHeight = '1';
      s = Math.min(max, Math.round(min * 1.3));
      el.style.fontSize = s + 'px';
      while (s > 16 && el.scrollHeight > el.clientHeight + 1) { s -= 2; el.style.fontSize = s + 'px'; }
    }
  }
  function fitBlock(el, max, min) {
    let s = max;
    el.style.fontSize = s + 'px';
    while (s > min && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) { s -= 2; el.style.fontSize = s + 'px'; }
  }

  const tweens = new WeakMap();
  function setNum(el, v) {
    const tw = tweens.get(el);
    if (tw) cancelAnimationFrame(tw.raf);
    tweens.delete(el);
    el.dataset.val = v;
    el.textContent = v;
  }
  function tweenNum(el, to, dur = 1200, delay = 0, onTick) {
    const from = parseInt(el.dataset.val || '0', 10) || 0;
    if (from === to) return;
    const prev = tweens.get(el);
    if (prev) { cancelAnimationFrame(prev.raf); clearTimeout(prev.to); }
    const rec = {};
    tweens.set(el, rec);
    el.dataset.val = to; // logical target
    rec.to = setTimeout(() => {
      const t0 = performance.now();
      el.classList.add('counting');
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(from + (to - from) * e);
        if (onTick) onTick(k);
        if (k < 1) rec.raf = requestAnimationFrame(step);
        else { el.classList.remove('counting'); tweens.delete(el); }
      };
      rec.raf = requestAnimationFrame(step);
    }, delay);
  }

  function setScreen(phase) {
    const id = { title: 'screen-title', round: 'screen-round', fast: 'screen-fast', winner: 'screen-winner' }[phase] || 'screen-title';
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }

  /* ---------------- state handling ---------------- */
  let S = null;
  let roundKey = null;
  let lastPhase = null;
  let titleKey = '';
  const seen = [];
  const boardId = SS.uid();

  function apply(st, fx, sync) {
    const prev = S;
    S = st;
    $('waiting').classList.add('gone');
    const instant = sync || !prev;

    // titles & names
    const tk = st.title + '|' + st.teams.join('|');
    if (tk !== titleKey) {
      titleKey = tk;
      const classicTitle = /^family\s+feud$/i.test(st.title.trim());
      $('title-main').classList.toggle('classic-title', classicTitle);
      $('title-main').textContent = classicTitle ? 'Family\nFeud' : st.title;
      $('head-title').textContent = st.title;
      $('title-team-a').textContent = st.teams[0];
      $('title-team-b').textContent = st.teams[1];
      $('pod-a-name').textContent = st.teams[0];
      $('pod-b-name').textContent = st.teams[1];
      document.title = st.title + ' — Audience';
      fitAllStatic();
    }

    if (st.phase !== lastPhase) {
      setScreen(st.phase);
      if (st.phase === 'winner' && !instant) setTimeout(() => confetti.rain(6000), 300);
      lastPhase = st.phase;
    }

    renderRound(st, prev, instant, fx);
    renderScores(st, instant, fx);
    renderFast(st, prev, instant);
    renderWinner(st);

    if (!instant) fx.forEach((f) => runFx(f, st));
  }

  function fitQuestion() {
    const qt = $('question-text');
    // single line if it fits at a big size, otherwise allow 2 lines
    qt.style.whiteSpace = 'nowrap';
    let s = 52;
    qt.style.fontSize = s + 'px';
    while (s > 36 && qt.scrollWidth > qt.clientWidth + 1) { s -= 2; qt.style.fontSize = s + 'px'; }
    if (qt.scrollWidth > qt.clientWidth + 1) {
      qt.style.whiteSpace = 'normal';
      fitBlock(qt, 42, 22);
    }
  }

  function fitAllStatic() {
    fitBlock($('title-main'), 168, 40);
    fitBlock($('pod-a-name'), 40, 20);
    fitBlock($('pod-b-name'), 40, 20);
  }

  /* ---------- main round ---------- */
  function buildBoard(r) {
    const board = $('board');
    board.classList.toggle('sudden', !!r.sudden);
    board.classList.add('no-anim');
    const n = r.sudden ? 1 : 8;
    let html = '';
    for (let i = 0; i < n; i++) {
      const a = r.answers[i];
      html += `<div class="slot${a ? '' : ' empty'}" data-i="${i}"><div class="flipper">
        <div class="face front">${a ? `<div class="ornament"><span>${i + 1}</span></div>` : ''}</div>
        <div class="face back"><div class="ans">${a ? esc(a.text) : ''}</div><div class="pts">${a ? a.pts : ''}</div></div>
      </div></div>`;
    }
    board.innerHTML = html;
    fitBoardText(r);
    void board.offsetWidth;
    board.classList.remove('no-anim');
  }
  function fitBoardText(r) {
    document.querySelectorAll('#board .ans').forEach((el) => {
      if (r.sudden) fitText(el, 80, 40, true);
      else fitText(el, 48, 30, true);
    });
  }

  function renderRound(st, prev, instant, fx) {
    const r = st.round;
    if (!r) return;
    let inst = instant;
    if (r.uid !== roundKey) {
      buildBoard(r);
      roundKey = r.uid;
      inst = true;
    }
    const pr = prev && prev.round && prev.round.uid === r.uid ? prev.round : null;

    $('round-label').textContent = r.label;
    const ml = $('mult-label');
    ml.textContent = r.sudden ? 'Top Answer Wins' : SS.multLabel(r.mult, r.sudden);
    ml.classList.toggle('hot', r.mult > 1 || !!r.sudden);

    const qt = $('question-text');
    if (qt.dataset.q !== r.question) {
      qt.dataset.q = r.question;
      qt.textContent = r.question;
      fitQuestion();
    }
    $('question').classList.toggle('off', !r.showQuestion);

    // slots
    const slots = document.querySelectorAll('#board .slot');
    slots.forEach((slot, i) => {
      const a = r.answers[i];
      if (!a) return;
      const isRev = slot.classList.contains('revealed');
      slot.classList.toggle('free', !!a.free);
      if (a.revealed !== isRev) {
        if (inst || !a.revealed) {
          slot.classList.add('no-anim');
          slot.classList.toggle('revealed', a.revealed);
          void slot.offsetWidth;
          slot.classList.remove('no-anim');
        } else {
          slot.classList.add('revealed');
          slot.classList.remove('flash');
          void slot.offsetWidth;
          slot.classList.add('flash');
        }
      }
    });

    // bank
    const bankEl = $('bank-val');
    const shownBank = r.winner != null ? 0 : r.bank;
    const awardFx = fx.find((f) => f.type === 'award');
    if (inst) setNum(bankEl, shownBank);
    else if (awardFx) tweenNum(bankEl, shownBank, 1400, (awardFx.delay || 0) + 300);
    else if (parseInt(bankEl.dataset.val || '0', 10) !== shownBank) {
      tweenNum(bankEl, shownBank, 500, 250);
      const b = bankEl.parentElement;
      b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    }

    // strike marks
    const marks = document.querySelectorAll('#strike-marks i');
    const strikeFx = fx.find((f) => f.type === 'strike');
    const applyMarks = () => marks.forEach((m, i) => m.classList.toggle('on', i < r.strikes));
    if (strikeFx && !inst) setTimeout(applyMarks, 700); else applyMarks();
    $('strike-marks').classList.toggle('hidden', !!r.sudden);

    // pods
    const enteringSteal = !inst && pr && pr.stage !== 'steal' && r.stage === 'steal';
    if (enteringSteal) setTimeout(() => { if (S.round && S.round.uid === r.uid) updatePods(S.round); }, 1400);
    else updatePods(r);
  }

  function updatePods(r) {
    [0, 1].forEach((t) => {
      const pod = $(t === 0 ? 'pod-a' : 'pod-b');
      const tag = $(t === 0 ? 'pod-a-tag' : 'pod-b-tag');
      let cls = '', label = '';
      if (S.phase === 'round' && r) {
        if (r.stage === 'play' && r.control === t) { cls = 'control'; label = 'In Control'; }
        else if (r.stage === 'steal' && r.control != null && r.control !== t) { cls = 'steal'; label = 'Steal!'; }
        else if (r.stage === 'done' && r.winner === t) { cls = 'won'; label = 'Round Winner'; }
      }
      pod.classList.toggle('control', cls === 'control');
      pod.classList.toggle('steal', cls === 'steal');
      pod.classList.toggle('tagged', !!label);
      if (label) tag.textContent = label;
    });
  }

  function renderScores(st, instant, fx) {
    const awardFx = fx.find((f) => f.type === 'award');
    [0, 1].forEach((t) => {
      const el = $(t === 0 ? 'pod-a-score' : 'pod-b-score');
      const to = st.scores[t];
      if (instant) setNum(el, to);
      else if (parseInt(el.dataset.val || '0', 10) !== to) {
        tweenNum(el, to, awardFx ? 1400 : 600, awardFx ? (awardFx.delay || 0) + 300 : 0);
      }
    });
  }

  /* ---------- bonus round ---------- */
  let fastBuilt = false;
  function buildFast() {
    for (let p = 0; p < 2; p++) {
      let html = '';
      for (let i = 0; i < 5; i++) html += `<div class="fm-row" data-p="${p}" data-i="${i}"><div class="fm-ans"><span class="hide"></span></div><div class="fm-pts"><span class="hide"></span></div></div>`;
      $('fm-col-' + p).innerHTML = html;
    }
    fastBuilt = true;
  }

  function renderFast(st, prev, instant) {
    const fm = st.fm;
    if (!fm) return;
    if (!fastBuilt) buildFast();
    $('fm-head').textContent = st.bonusName;
    $('fm-goal').textContent = 'Goal: ' + st.bonusTarget;
    $('fm-l1').classList.toggle('active', fm.player === 0);
    $('fm-l2').classList.toggle('active', fm.player === 1);

    const tm = fm.timer;
    const timerEl = $('fm-timer');
    $('fm-timer-val').textContent = Math.max(0, Math.ceil(tm.remaining));
    timerEl.classList.toggle('idle', !tm.running);
    timerEl.classList.toggle('low', tm.running && tm.remaining <= 5);

    const pfm = prev && prev.fm;
    let total = 0;
    for (let p = 0; p < 2; p++) {
      $('fm-col-' + p).classList.toggle('hidden-col', p === 0 && fm.hideP1);
      for (let i = 0; i < 5; i++) {
        const e = fm.rows[p][i];
        const pe = pfm ? pfm.rows[p][i] : null;
        const row = document.querySelector(`.fm-row[data-p="${p}"][data-i="${i}"]`);
        const ansSpan = row.querySelector('.fm-ans span');
        const ptsSpan = row.querySelector('.fm-pts span');
        if (e.showPts) total += e.pts || 0;

        // answer text
        const wantText = e.showText ? e.text : '';
        if (ansSpan.dataset.t !== wantText || (e.showText && ansSpan.classList.contains('hide'))) {
          ansSpan.dataset.t = wantText;
          if (e.showText) {
            ansSpan.textContent = e.text || '—';
            fitText(row.querySelector('.fm-ans'), 38, 20, false);
            if (!instant && !(pe && pe.showText)) {
              ansSpan.classList.add('hide');
              void ansSpan.offsetWidth;
            }
            ansSpan.classList.remove('hide');
          } else {
            ansSpan.classList.add('hide');
            ansSpan.textContent = '';
          }
        }
        row.classList.toggle('has-text', !!e.showText);

        // points
        const wantPts = e.showPts ? String(e.pts || 0) : '';
        if (ptsSpan.dataset.t !== wantPts) {
          ptsSpan.dataset.t = wantPts;
          if (e.showPts) {
            ptsSpan.textContent = e.pts || 0;
            if (!instant && !(pe && pe.showPts)) { ptsSpan.classList.add('hide'); void ptsSpan.offsetWidth; }
            ptsSpan.classList.remove('hide');
          } else {
            ptsSpan.classList.add('hide');
            ptsSpan.textContent = '';
          }
        }
        row.classList.toggle('has-pts', !!e.showPts && (e.pts || 0) > 0);
        row.classList.toggle('zero', !!e.showPts && !(e.pts > 0));
      }
    }
    const totalEl = $('fm-total');
    if (instant) setNum(totalEl, total); else tweenNum(totalEl, total, 700, 150);
    totalEl.parentElement.classList.toggle('reached', total >= st.bonusTarget);
  }

  /* ---------- winner ---------- */
  function renderWinner(st) {
    if (st.phase !== 'winner') return;
    const w = st.winner;
    const nameEl = $('win-name');
    const name = w === 0 || w === 1 ? st.teams[w] : "It's a tie!";
    if (nameEl.dataset.n !== name) {
      nameEl.dataset.n = name;
      nameEl.textContent = name;
      fitBlock(nameEl, 190, 70);
    }
    $('win-sub').textContent = w === 0 || w === 1 ? 'Wins!' : '';
    $('win-scores').innerHTML = `<div class="ws a">${esc(st.teams[0])}<b>${st.scores[0]}</b></div><div class="ws b">${esc(st.teams[1])}<b>${st.scores[1]}</b></div>`;
  }

  /* ---------- effects ---------- */
  const X_SVG = '<svg viewBox="0 0 100 100"><g stroke-linecap="round" fill="none"><path d="M20 20 L80 80 M80 20 L20 80" stroke="#fff" stroke-width="27"/><path d="M20 20 L80 80 M80 20 L20 80" stroke="#e8112d" stroke-width="18"/><path d="M22 20 L78 76" stroke="rgba(255,255,255,0.35)" stroke-width="4"/></g></svg>';
  let xTimer = null;
  function showX(n) {
    const ov = $('x-overlay');
    clearTimeout(xTimer);
    ov.innerHTML = X_SVG.repeat(Math.max(1, Math.min(3, n)));
    stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake');
    xTimer = setTimeout(() => { ov.innerHTML = ''; }, 1600);
  }

  let introTimer = null;
  function showIntro(f) {
    const ov = $('intro-overlay');
    $('intro-round').textContent = f.label;
    const rib = $('intro-ribbon');
    const ribText = f.sudden ? 'Top answer wins' : f.mult > 1 ? SS.multLabel(f.mult) : '';
    rib.textContent = ribText;
    rib.classList.toggle('hidden', !ribText);
    fitBlock($('intro-round'), 230, 80);
    clearTimeout(introTimer);
    ov.classList.remove('show'); void ov.offsetWidth; ov.classList.add('show');
    introTimer = setTimeout(() => ov.classList.remove('show'), 2700);
  }

  let fmWinTimer = null;
  function runFx(f, st) {
    switch (f.type) {
      case 'strike': showX(f.count); break;
      case 'x': showX(1); break;
      case 'intro': showIntro(f); break;
      case 'buzz': {
        const pod = $(f.team === 0 ? 'pod-a' : 'pod-b');
        pod.classList.remove('buzz'); void pod.offsetWidth; pod.classList.add('buzz');
        break;
      }
      case 'award': {
        setTimeout(() => {
          const pod = $(f.team === 0 ? 'pod-a' : 'pod-b');
          pod.classList.remove('win'); void pod.offsetWidth; pod.classList.add('win');
          confetti.burst(f.team === 0 ? 147 : 1453, 470, 120);
        }, (f.delay || 0) + 200);
        break;
      }
      case 'confetti': confetti.rain(f.ms || 5000); break;
      case 'fmWin': {
        $('fm-win-val').textContent = f.total;
        const w = $('fm-win');
        w.classList.add('show');
        confetti.rain(5000);
        clearTimeout(fmWinTimer);
        fmWinTimer = setTimeout(() => w.classList.remove('show'), 5500);
        break;
      }
      default: break;
    }
    void st;
  }

  /* ---------------- background & look ---------------- */
  let bgUrl = null;
  let look = { dim: 0.35, blur: 0, snow: false, lights: false };
  function applyAssets(msg) {
    if (bgUrl && bgUrl.startsWith('blob:')) URL.revokeObjectURL(bgUrl);
    bgUrl = null;
    if (msg.bg && msg.bg.blob) bgUrl = URL.createObjectURL(msg.bg.blob);
    else if (msg.bg && msg.bg.url) bgUrl = msg.bg.url;
    const el = $('bg-image');
    el.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : 'none';
    el.classList.toggle('on', !!bgUrl);
    if (msg.look) applyLook(msg.look);
    else applyLook(look);
  }
  function applyLook(l) {
    look = Object.assign({}, look, l || {});
    $('bg-image').style.filter = look.blur > 0 ? `blur(${look.blur}px)` : '';
    $('bg-dim').style.opacity = bgUrl ? look.dim : 0;
    snowOn = look.snow !== false;
    $('snow').classList.toggle('off', !snowOn);
    $('lights').classList.toggle('off', look.lights === false);
  }

  /* ---------------- transport ---------------- */
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel(SS.CHANNEL) : null;
  function sendHello() {
    const msg = { app: 'ss', type: 'hello', boardId, preview: isPreview, needSync: !S };
    try { if (window.opener && !window.opener.closed) window.opener.postMessage(msg, '*'); } catch (e) { /* ignore */ }
    try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*'); } catch (e) { /* ignore */ }
    try { if (bc) bc.postMessage(msg); } catch (e) { /* ignore */ }
  }
  function onMsg(msg) {
    if (!msg || msg.app !== 'ss' || !['state', 'assets', 'look'].includes(msg.type)) return;
    if (msg.id) {
      if (seen.includes(msg.id)) return;
      seen.push(msg.id);
      if (seen.length > 200) seen.shift();
    }
    try {
      if (msg.type === 'state') apply(msg.state, msg.fx || [], !!msg.sync);
      else if (msg.type === 'assets') applyAssets(msg);
      else applyLook(msg.look);
    } catch (e) { console.error(e); }
  }
  window.addEventListener('message', (e) => onMsg(e.data));
  if (bc) bc.onmessage = (e) => onMsg(e.data);
  sendHello();
  setInterval(sendHello, 2000);

  document.fonts && document.fonts.ready.then(() => {
    fitAllStatic();
    fitQuestion();
    if (S && S.round) fitBoardText(S.round);
    document.querySelectorAll('.fm-ans').forEach((el) => fitText(el, 38, 20, false));
  });

  /* ---------------- fullscreen & cursor ---------------- */
  if (!isPreview) {
    const hint = $('fs-hint');
    setTimeout(() => hint.classList.add('gone'), 9000);
    const toggleFs = () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen && document.exitFullscreen();
    };
    document.addEventListener('click', () => { if (!document.fullscreenElement) toggleFs(); hint.classList.add('gone'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFs(); });
    document.addEventListener('fullscreenchange', () => hint.classList.add('gone'));
    let idle = null;
    document.addEventListener('mousemove', () => {
      document.body.classList.remove('hide-cursor');
      clearTimeout(idle);
      idle = setTimeout(() => document.body.classList.add('hide-cursor'), 2500);
    });
  }
})();
