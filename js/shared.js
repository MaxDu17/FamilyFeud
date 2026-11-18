/* Shared helpers used by both the operator console and the audience board. */
(function () {
  const SS = {};

  SS.CHANNEL = 'survey-showdown-v1';
  SS.MAX_BOARD_ANSWERS = 8;
  SS.FAST_QUESTIONS = 5;

  SS.defaultSetup = {
    title: 'Family Feud',
    teamA: 'The Elves',
    teamB: 'The Reindeer',
    target: 300,          // first team to this many points wins (0 = just play every round)
    bonusName: 'Fast Money',
    bonusTarget: 200,
    timer1: 20,
    timer2: 25,
  };

  SS.multLabel = function (mult, sudden) {
    if (sudden) return 'Sudden Death';
    if (mult === 2) return 'Double Points';
    if (mult === 3) return 'Triple Points';
    if (mult > 3) return mult + '× Points';
    return 'Single Points';
  };

  /* ------------------------------------------------------------------
   * Survey text format
   *
   *   [x2] Name something people do at a holiday party.
   *   Eat, 38
   *   Dance, 22
   *
   * A line that does NOT end in a number starts a new question.
   * A line that ends in a number is an answer for the current question.
   * Optional tags at the start of a question line:
   *   [x1] [x2] [x3]        point multiplier (default x1)
   *   [double] [triple]     same as x2 / x3
   *   [sudden]              sudden-death tiebreaker (only the #1 answer is on the board)
   *   [fast] / [bonus] / [lightning]   bonus-round question
   * Start a line with "Q:" to force it to be a question (e.g. if it ends in a number).
   * Lines starting with # are comments.
   * ------------------------------------------------------------------ */
  const ANSWER_RE = /^(.+?)(?:\s*[,;|\t:=]\s*|\s+[-–—]\s*|\s+)(\d{1,4})\s*(?:pts?|points?)?\.?$/i;
  const TAG_RE = /^\s*\[([^\]]+)\]\s*/;
  const QPREFIX_RE = /^\s*(?:q(?:uestion)?\s*\d*\s*[:.)-])\s*/i;

  SS.parseSurvey = function (text) {
    const out = { rounds: [], fast: [], warnings: [], errors: [] };
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let cur = null;

    function finish() {
      if (!cur) return;
      if (!cur.answers.length) {
        out.warnings.push(`Line ${cur.line}: "${short(cur.question)}" has no answers, so it was skipped.`);
      } else {
        cur.answers.sort((a, b) => b.pts - a.pts); // stable: ties keep file order
        if (cur.kind === 'fast') {
          out.fast.push({ question: cur.question, answers: cur.answers, line: cur.line });
        } else {
          if (cur.answers.length > SS.MAX_BOARD_ANSWERS) {
            out.warnings.push(`Line ${cur.line}: "${short(cur.question)}" has ${cur.answers.length} answers; only the top ${SS.MAX_BOARD_ANSWERS} fit on the board.`);
            cur.answers = cur.answers.slice(0, SS.MAX_BOARD_ANSWERS);
          }
          out.rounds.push({
            question: cur.question,
            mult: cur.mult,
            sudden: cur.sudden,
            answers: cur.answers,
            line: cur.line,
          });
        }
      }
      cur = null;
    }

    lines.forEach((raw, idx) => {
      const lineNo = idx + 1;
      let line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) return;

      // Pull off leading [tags]
      const tags = [];
      let m;
      while ((m = line.match(TAG_RE))) {
        tags.push(m[1].trim().toLowerCase());
        line = line.slice(m[0].length);
      }
      let forcedQuestion = tags.length > 0;
      if (QPREFIX_RE.test(line)) {
        forcedQuestion = true;
        line = line.replace(QPREFIX_RE, '');
      }

      const am = forcedQuestion ? null : line.match(ANSWER_RE);
      if (am && cur) {
        cur.answers.push({ text: am[1].trim(), pts: parseInt(am[2], 10) });
        return;
      }
      if (am && !cur) {
        out.warnings.push(`Line ${lineNo}: "${short(line)}" looks like an answer but there is no question above it.`);
        return;
      }

      // New question
      finish();
      const q = { question: line, mult: 1, sudden: false, kind: 'main', answers: [], line: lineNo };
      tags.forEach((t) => {
        const tt = t.replace(/\s+/g, '');
        if (/^x?\d+x?$/.test(tt)) q.mult = Math.max(1, parseInt(tt.replace(/x/g, ''), 10) || 1);
        else if (tt === 'single') q.mult = 1;
        else if (tt === 'double') q.mult = 2;
        else if (tt === 'triple') q.mult = 3;
        else if (tt.startsWith('sudden') || tt === 'tiebreaker') { q.sudden = true; }
        else if (['fast', 'fastmoney', 'bonus', 'lightning', 'lightninground', 'speed'].includes(tt)) q.kind = 'fast';
        else out.warnings.push(`Line ${lineNo}: unknown tag [${t}] was ignored.`);
      });
      if (q.sudden && !tags.some((t) => /^x?\d|double|triple|single/.test(t))) q.mult = 3;
      cur = q;
    });
    finish();

    if (!out.rounds.length) out.errors.push('No main-game questions found. Add at least one question with answers.');
    if (out.fast.length && out.fast.length < SS.FAST_QUESTIONS) {
      out.warnings.push(`Bonus round has ${out.fast.length} question(s); the classic format uses ${SS.FAST_QUESTIONS}.`);
    }
    if (out.fast.length > SS.FAST_QUESTIONS) {
      out.warnings.push(`Bonus round has ${out.fast.length} questions; only the first ${SS.FAST_QUESTIONS} are used.`);
      out.fast = out.fast.slice(0, SS.FAST_QUESTIONS);
    }
    return out;
  };

  /** Turn parsed data back into the text format (used for export). */
  SS.serializeSurvey = function (parsed) {
    const parts = [];
    parsed.rounds.forEach((r) => {
      const tag = r.sudden ? '[sudden] ' : r.mult !== 1 ? `[x${r.mult}] ` : '[x1] ';
      parts.push(tag + r.question + '\n' + r.answers.map((a) => `${a.text}, ${a.pts}`).join('\n'));
    });
    parsed.fast.forEach((r) => {
      parts.push('[fast] ' + r.question + '\n' + r.answers.map((a) => `${a.text}, ${a.pts}`).join('\n'));
    });
    return parts.join('\n\n') + '\n';
  };

  function short(s) {
    s = String(s);
    return s.length > 50 ? s.slice(0, 47) + '…' : s;
  }

  SS.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  SS.uid = function () {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  };

  SS.store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
  };

  window.SS = SS;
})();
