import { h, replace } from '../h.js';

const COLORS = ['#f0efe9', '#c8ff00', '#ff4a1c', '#3aa0ff', '#8c8b85'];
const BASE = 500; // stroke widths are in px at a 500px-wide canvas
const ROUND_MS = 75_000;

export function mount(root, { move }) {
  let s = null;
  let round = -1;
  let strokes = [];
  let color = COLORS[0];
  let deadline = 0;
  let raf = 0;

  const status = h('div.game-status');
  const timer = h('div.timer', h('i'));
  const word = h('div.sketch-word');
  const canvas = h('canvas');
  const wrap = h('div.sketch-wrap', canvas);
  const ctx = canvas.getContext('2d');

  const swatches = COLORS.map((c) =>
    h('button.swatch', { style: `background:${c}`, 'aria-label': `Color ${c}`, onClick: () => pickColor(c) }),
  );
  const tools = h('div.row',
    h('div.swatches', swatches),
    h('div.spacer'),
    h('button.btn.small', { onClick: () => { strokes = []; redraw(); move({ clear: true }); } }, 'Clear'),
    h('button.btn.small', { onClick: () => move({ skip: true }) }, 'Skip'),
  );
  const guessInput = h('input.input', { placeholder: 'Your guess', maxlength: 40, autocomplete: 'off', enterkeyhint: 'send' });
  const guessForm = h('form.row', {
    onSubmit(e) {
      e.preventDefault();
      const g = guessInput.value.trim();
      if (g) move({ guess: g });
      guessInput.value = '';
    },
  }, guessInput, h('button.btn.primary', { type: 'submit' }, 'Guess'));
  const guesses = h('div.guesses');
  const again = h('button.btn.primary.block.hidden', { onClick: () => move({ rematch: true }) }, 'Play again');

  // Keep the canvas square and as big as the panel allows, so the tools
  // below never scroll away while you draw.
  const area = h('div.sketch-area', wrap);
  root.classList.add('game-fit');
  root.append(status, timer, word, area, tools, guessForm, guesses, again);
  const areaRo = new ResizeObserver(() => {
    const r = area.getBoundingClientRect();
    const size = Math.floor(Math.min(r.width, r.height));
    if (size > 0) wrap.style.width = `${size}px`;
  });
  areaRo.observe(area);

  function pickColor(c) {
    color = c;
    swatches.forEach((b, i) => b.classList.toggle('on', COLORS[i] === c));
  }
  pickColor(COLORS[0]);

  // --- canvas ------------------------------------------------------------

  function fit() {
    const r = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    redraw();
  }

  function drawStroke({ pts, c, w }) {
    if (!pts.length) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = (w * W) / BASE;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
    if (pts.length === 1) ctx.lineTo(pts[0][0] * W + 0.1, pts[0][1] * H);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x * W, y * H);
    ctx.stroke();
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(drawStroke);
  }

  const ro = new ResizeObserver(fit);
  ro.observe(wrap);

  let drawing = null;
  let unsent = [];
  let flushTimer = 0;

  const canDraw = () => s && s.phase === 'draw' && s.drawer === s.you;

  function point(e) {
    const r = canvas.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  }

  function flush() {
    flushTimer = 0;
    if (!drawing || unsent.length < 2) return;
    move({ stroke: { pts: unsent, c: drawing.c, w: drawing.w } });
    unsent = [unsent[unsent.length - 1]];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!canDraw()) return;
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);
    drawing = { pts: [p], c: color, w: 5 };
    strokes.push(drawing);
    unsent = [p, p];
    drawStroke(drawing);
    flush();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = point(e);
    const last = drawing.pts[drawing.pts.length - 1];
    drawing.pts.push(p);
    unsent.push(p);
    drawStroke({ pts: [last, p], c: drawing.c, w: drawing.w });
    if (!flushTimer) flushTimer = setTimeout(flush, 40);
  });
  const end = () => {
    if (!drawing) return;
    clearTimeout(flushTimer);
    flush();
    drawing = null;
    unsent = [];
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!s || s.phase !== 'draw') return;
    const left = Math.max(0, deadline - performance.now());
    timer.firstChild.style.transform = `scaleX(${left / ROUND_MS})`;
    timer.classList.toggle('low', left < 10_000);
  }
  raf = requestAnimationFrame(tick);

  return {
    update(next) {
      s = next;
      if (s.round !== round) {
        round = s.round;
        strokes = [];
        redraw();
      }
      if (s.phase === 'draw') deadline = performance.now() + s.remaining;
      else timer.firstChild.style.transform = 'scaleX(0)';

      const drawer = s.drawer === s.you;
      status.replaceChildren(
        h('span', 'Round ', h('b', `${s.round}/${s.rounds}`)),
        h('span', drawer && s.phase === 'draw' ? 'You draw' : s.phase === 'draw' ? 'You guess' : '', ''),
        h('span', 'Got ', h('b', s.score)),
      );

      if (s.phase === 'draw') word.textContent = drawer ? s.word : s.mask.split('').join(' ');
      else if (s.phase === 'reveal') word.textContent = `${s.solved ? 'Got it' : 'It was'}: ${s.word}`;
      else word.textContent = `${s.score} of ${s.rounds}. ${s.score === s.rounds ? 'Telepathic.' : s.score >= s.rounds / 2 ? 'Decent.' : 'Rough.'}`;

      tools.classList.toggle('hidden', !(drawer && s.phase === 'draw'));
      guessForm.classList.toggle('hidden', drawer || s.phase !== 'draw');
      wrap.style.cursor = canDraw() ? 'crosshair' : 'default';
      replace(guesses, s.guesses.slice(-12).map((g) => h(`span${g.correct ? '.ok' : ''}`, g.text)));
      again.classList.toggle('hidden', s.phase !== 'over');
    },
    event(data) {
      if (data.clear) {
        strokes = [];
        redraw();
      } else if (data.stroke) {
        strokes.push(data.stroke);
        drawStroke(data.stroke);
      }
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(flushTimer);
      ro.disconnect();
      areaRo.disconnect();
    },
  };
}
