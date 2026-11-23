const boxCanvas = document.getElementById('boxCanvas');
const histCanvas = document.getElementById('histCanvas');
const msdCanvas = document.getElementById('msdCanvas');
const boxCtx = boxCanvas.getContext('2d');
const histCtx = histCanvas.getContext('2d');
const msdCtx = msdCanvas.getContext('2d');

const numSlider = document.getElementById('numParticles');
const diffSlider = document.getElementById('diffConst');
const speedSlider = document.getElementById('stepsPerFrame');
const numVal = document.getElementById('numVal');
const diffVal = document.getElementById('diffVal');
const speedVal = document.getElementById('speedVal');
const resetBtn = document.getElementById('resetBtn');
const randomBtn = document.getElementById('randomBtn');
const reflectiveBtn = document.getElementById('reflectiveBtn');
const periodicBtn = document.getElementById('periodicBtn');
const playBtn = document.getElementById('playBtn');

const THEORY_COLOR = 'rgba(255,107,157,0.9)';
const CONFINED_COLOR = '#ffb86c';

let W = 760, H = 400, histH = 200, msdH = 200;
let boundaryType = 'reflective';
let isRunning = true;
let time = 0;            // simulation time in steps (dt = 1 per step)
let freeVar = 0;         // ∫ 2 D(t) dt: variance of free 1D diffusion (= 2Dt for constant D)
let msdHistory = [];     // {t, msd, free, conf}
let recordStride = 1;    // record every `recordStride` steps; doubles as history is thinned
let initMode = 'center'; // 'center' or 'random'
const maxMsdPoints = 600;
const dpr = window.devicePixelRatio || 1;

function setupCanvas(canvas, w, h) {
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.getContext('2d').scale(dpr, dpr);
}

function resize() {
  const container = document.querySelector('.container');
  W = Math.min(760, container.clientWidth - 42);
  H = Math.floor(W * 0.5);
  histH = Math.floor(W * 0.26);
  msdH = Math.floor(W * 0.26);
  setupCanvas(boxCanvas, W, H);
  setupCanvas(histCanvas, W, histH);
  setupCanvas(msdCanvas, W, msdH);
}

let particles = [];
let numBins = 50;

// ---------------------------------------------------------------------------
// Theory helpers
// ---------------------------------------------------------------------------

// Starting x positions with weights (sum of weights = 1). Used for theory curves.
let startXs = [];

// Confined (reflective) 1D MSD from the cosine-series solution of the diffusion
// equation on [0, W] with no-flux boundaries:
//   p(x,t|x0) = 1/W + (2/W) Σ_n cos(nπx0/W) cos(nπx/W) exp(-n²π² Dt / W²)
// Integrating (x - x0)² against p gives
//   MSD(t) = ⟨W²/3 - x0 W + x0²⟩ + Σ_n 4W/(n²π²) · A_n · exp(-n²π² Dt / W²)
// with A_n = ⟨cos(nπx0/W) · ((W - x0)(-1)^n + x0)⟩ averaged over start positions.
// A_n does not depend on time, so it is precomputed once per initialisation.
const NMAX = 4096;
const seriesA = new Float64Array(NMAX + 1);
let confPlateau = 0;

function precomputeConfinedSeries() {
  confPlateau = 0;
  seriesA.fill(0);
  for (const { x0, w } of startXs) {
    confPlateau += w * (W * W / 3 - x0 * W + x0 * x0);
    const a = Math.PI * x0 / W;
    for (let n = 1; n <= NMAX; n++) {
      const sign = n % 2 === 0 ? 1 : -1;
      seriesA[n] += w * Math.cos(n * a) * ((W - x0) * sign + x0);
    }
  }
}

// v = ∫ 2D dt (so Dt = v / 2; also correct when D changed during the run)
function confinedMSD(v) {
  if (v <= 0) return 0;
  const c = Math.PI * Math.PI * (v / 2) / (W * W);
  let sum = confPlateau;
  for (let n = 1; n <= NMAX; n++) {
    const e = Math.exp(-c * n * n);
    if (e < 1e-16) break;
    sum += 4 * W / (n * n * Math.PI * Math.PI) * seriesA[n] * e;
  }
  // Reflection can only shorten the distance from x0, so MSD ≤ 2Dt.
  // The clamp also absorbs series truncation error at very short times.
  return Math.max(0, Math.min(sum, v));
}

// Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const normCdf = z => 0.5 * (1 + erf(z / Math.SQRT2));

// Theoretical probability of each histogram bin. The free solution is a
// Gaussian of variance 2Dt around x0; boundaries are handled with the method
// of images (mirror images for reflective walls, periodic copies for periodic).
// Integrating over each bin keeps the theory comparable with the bars even
// when the Gaussian is narrower than one bin.
function theoryBinProbs(binWidth) {
  const probs = new Float64Array(numBins);
  if (freeVar <= 1e-12) {
    for (const { x0, w } of startXs) {
      probs[Math.min(numBins - 1, Math.floor(x0 / binWidth))] += w;
    }
    return probs;
  }
  const s = Math.sqrt(freeVar);
  if (s > 3 * W) { // all modes have decayed: distribution is uniform
    probs.fill(1 / numBins);
    return probs;
  }
  const addImage = (m, w) => {
    if (m - 8 * s > W || m + 8 * s < 0) return;
    let prev = normCdf((0 - m) / s);
    for (let i = 0; i < numBins; i++) {
      const c = normCdf(((i + 1) * binWidth - m) / s);
      probs[i] += w * (c - prev);
      prev = c;
    }
  };
  for (const { x0, w } of startXs) {
    if (boundaryType === 'periodic') {
      const K = Math.ceil(8 * s / W) + 1;
      for (let k = -K; k <= K; k++) addImage(x0 + k * W, w);
    } else {
      const K = Math.ceil(8 * s / (2 * W)) + 1;
      for (let k = -K; k <= K; k++) {
        addImage(x0 + 2 * k * W, w);
        addImage(-x0 + 2 * k * W, w);
      }
    }
  }
  return probs;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function initParticles(mode = initMode) {
  initMode = mode;
  const n = parseInt(numSlider.value);
  particles = [];
  time = 0;
  freeVar = 0;
  msdHistory = [];
  recordStride = 1;
  for (let i = 0; i < n; i++) {
    const x = mode === 'center' ? W / 2 : Math.random() * W;
    const y = mode === 'center' ? H / 2 : Math.random() * H;
    // x0: start position; ux: unwrapped x (never wrapped by periodic boundaries)
    particles.push({ x, y, x0: x, ux: x });
  }
  startXs = mode === 'center'
    ? [{ x0: W / 2, w: 1 }]
    : particles.map(p => ({ x0: p.x0, w: 1 / n }));
  precomputeConfinedSeries();
  recordMSD();
}

// 1D MSD along x.
// Reflective: real displacement from the start (saturates in a finite box).
// Periodic: unwrapped displacement (the box is a tile of an infinite space).
function calculateMSD() {
  if (particles.length === 0) return 0;
  let sumSqDisp = 0;
  for (const p of particles) {
    const d = (boundaryType === 'periodic' ? p.ux : p.x) - p.x0;
    sumSqDisp += d * d;
  }
  return sumSqDisp / particles.length;
}

function recordMSD() {
  msdHistory.push({
    t: time,
    msd: calculateMSD(),
    free: freeVar,
    conf: boundaryType === 'reflective' ? confinedMSD(freeVar) : null,
  });
  if (msdHistory.length > maxMsdPoints) {
    // Thin the history instead of dropping old points, so the plot keeps t = 0
    msdHistory = msdHistory.filter((_, i) => i % 2 === 0);
    recordStride *= 2;
  }
}

function step() {
  const D = parseFloat(diffSlider.value);
  const dt = 1;
  const sigma = Math.sqrt(2 * D * dt);

  for (const p of particles) {
    const stepX = gaussianRandom() * sigma;
    const stepY = gaussianRandom() * sigma;

    p.ux += stepX;
    p.x += stepX;
    p.y += stepY;

    if (boundaryType === 'reflective') {
      if (p.x < 0) p.x = -p.x;
      if (p.x > W) p.x = 2 * W - p.x;
      if (p.y < 0) p.y = -p.y;
      if (p.y > H) p.y = 2 * H - p.y;
    } else {
      p.x = ((p.x % W) + W) % W;
      p.y = ((p.y % H) + H) % H;
    }

    // Clamp just in case (only matters for steps larger than the box)
    p.x = Math.max(0, Math.min(W, p.x));
    p.y = Math.max(0, Math.min(H, p.y));
  }

  time++;
  freeVar += 2 * D * dt;
  if (time % recordStride === 0) recordMSD();
}

function updateParticles() {
  const n = parseInt(speedSlider.value);
  for (let i = 0; i < n; i++) step();
}

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function fmt(v) {
  if (v >= 1e5) return v.toExponential(1);
  return Math.round(v).toString();
}

function drawBox() {
  boxCtx.fillStyle = '#0a0a15';
  boxCtx.fillRect(0, 0, W, H);

  // Grid
  boxCtx.strokeStyle = 'rgba(100,255,218,0.1)';
  boxCtx.lineWidth = 1;
  for (let x = 0; x <= W; x += 50) {
    boxCtx.beginPath();
    boxCtx.moveTo(x, 0);
    boxCtx.lineTo(x, H);
    boxCtx.stroke();
  }
  for (let y = 0; y <= H; y += 50) {
    boxCtx.beginPath();
    boxCtx.moveTo(0, y);
    boxCtx.lineTo(W, y);
    boxCtx.stroke();
  }

  // Particles
  for (const p of particles) {
    const gradient = boxCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 4);
    gradient.addColorStop(0, 'rgba(100,255,218,1)');
    gradient.addColorStop(1, 'rgba(100,255,218,0)');
    boxCtx.fillStyle = gradient;
    boxCtx.beginPath();
    boxCtx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    boxCtx.fill();
  }

  // Border
  boxCtx.strokeStyle = 'rgba(100,255,218,0.5)';
  boxCtx.lineWidth = 2;
  boxCtx.strokeRect(1, 1, W - 2, H - 2);

  // Time readout
  boxCtx.fillStyle = 'rgba(224,224,224,0.7)';
  boxCtx.font = '11px sans-serif';
  boxCtx.textAlign = 'right';
  boxCtx.fillText(`t = ${time}`, W - 8, 16);
}

function drawHistogram() {
  histCtx.fillStyle = '#0a0a15';
  histCtx.fillRect(0, 0, W, histH);

  const margin = { top: 20, bottom: 30, left: 10, right: 10 };
  const plotW = W - margin.left - margin.right;
  const plotH = histH - margin.top - margin.bottom;

  // Measured histogram
  const bins = new Array(numBins).fill(0);
  const binWidth = W / numBins;
  for (const p of particles) {
    const binIndex = Math.min(numBins - 1, Math.floor(p.x / binWidth));
    bins[binIndex]++;
  }

  // Probability density (1/px); theory on the same scale
  const total = Math.max(1, particles.length);
  const density = bins.map(b => b / (total * binWidth));
  const theory = Array.from(theoryBinProbs(binWidth), q => q / binWidth);
  const maxDensity = Math.max(...density, ...theory, 1e-9);

  // Axes
  histCtx.strokeStyle = 'rgba(100,255,218,0.3)';
  histCtx.lineWidth = 1;
  histCtx.beginPath();
  histCtx.moveTo(margin.left, margin.top);
  histCtx.lineTo(margin.left, margin.top + plotH);
  histCtx.lineTo(margin.left + plotW, margin.top + plotH);
  histCtx.stroke();

  // X-axis labels
  histCtx.fillStyle = '#888';
  histCtx.font = '11px sans-serif';
  histCtx.textAlign = 'center';
  histCtx.fillText('0', margin.left, margin.top + plotH + 15);
  histCtx.fillText('x', margin.left + plotW / 2, margin.top + plotH + 25);
  histCtx.fillText(W.toString(), margin.left + plotW, margin.top + plotH + 15);

  // Bars
  const barW = plotW / numBins;
  for (let i = 0; i < numBins; i++) {
    const barH = (density[i] / maxDensity) * plotH;
    const x = margin.left + i * barW;
    const y = margin.top + plotH - barH;
    const gradient = histCtx.createLinearGradient(x, y, x, y + barH);
    gradient.addColorStop(0, 'rgba(100,255,218,0.8)');
    gradient.addColorStop(1, 'rgba(100,255,218,0.2)');
    histCtx.fillStyle = gradient;
    histCtx.fillRect(x, y, barW - 1, barH);
  }

  // Theory overlay (Gaussian with boundary images)
  histCtx.strokeStyle = THEORY_COLOR;
  histCtx.lineWidth = 2;
  histCtx.beginPath();
  for (let i = 0; i < numBins; i++) {
    const x = margin.left + (i + 0.5) * barW;
    const y = margin.top + plotH - (theory[i] / maxDensity) * plotH;
    if (i === 0) histCtx.moveTo(x, y);
    else histCtx.lineTo(x, y);
  }
  histCtx.stroke();

  // Legend
  histCtx.font = '11px sans-serif';
  histCtx.textAlign = 'right';
  histCtx.fillStyle = '#64ffda';
  histCtx.fillText('Simulation', W - margin.right - 5, margin.top + 4);
  histCtx.fillStyle = '#ff6b9d';
  const theoryLabel = initMode === 'center'
    ? 'Theory: Gaussian, σ² = 2Dt (+ boundary images)'
    : 'Theory: diffusion equation';
  histCtx.fillText(theoryLabel, W - margin.right - 5, margin.top + 18);
}

function drawMSD() {
  msdCtx.fillStyle = '#0a0a15';
  msdCtx.fillRect(0, 0, W, msdH);

  const margin = { top: 20, bottom: 30, left: 50, right: 20 };
  const plotW = W - margin.left - margin.right;
  const plotH = msdH - margin.top - margin.bottom;

  if (msdHistory.length < 2) {
    msdCtx.fillStyle = '#888';
    msdCtx.font = '12px sans-serif';
    msdCtx.textAlign = 'center';
    msdCtx.fillText('Collecting data...', W / 2, msdH / 2);
    return;
  }

  const reflective = boundaryType === 'reflective';
  const maxT = msdHistory[msdHistory.length - 1].t;
  // In a reflective box the free 2Dt line grows without bound; scale on the
  // data and the confined theory instead and clip the free line.
  const maxMsd = 1.1 * Math.max(
    ...msdHistory.map(d => d.msd),
    ...msdHistory.map(d => (reflective ? d.conf : d.free)),
    1e-9
  );
  const px = t => margin.left + (t / maxT) * plotW;
  const py = v => margin.top + plotH - (v / maxMsd) * plotH;

  // Axes
  msdCtx.strokeStyle = 'rgba(100,255,218,0.3)';
  msdCtx.lineWidth = 1;
  msdCtx.beginPath();
  msdCtx.moveTo(margin.left, margin.top);
  msdCtx.lineTo(margin.left, margin.top + plotH);
  msdCtx.lineTo(margin.left + plotW, margin.top + plotH);
  msdCtx.stroke();

  // Axis labels and ticks
  msdCtx.fillStyle = '#888';
  msdCtx.font = '11px sans-serif';
  msdCtx.textAlign = 'center';
  msdCtx.fillText('Time (steps)', margin.left + plotW / 2, margin.top + plotH + 25);
  msdCtx.fillText('0', margin.left, margin.top + plotH + 14);
  msdCtx.fillText(fmt(maxT), margin.left + plotW, margin.top + plotH + 14);
  msdCtx.textAlign = 'right';
  msdCtx.fillText(fmt(maxMsd), margin.left - 4, margin.top + 4);
  msdCtx.fillText('0', margin.left - 4, margin.top + plotH);
  msdCtx.save();
  msdCtx.textAlign = 'center';
  msdCtx.translate(15, margin.top + plotH / 2);
  msdCtx.rotate(-Math.PI / 2);
  msdCtx.fillText('⟨Δx²⟩ (px²)', 0, 0);
  msdCtx.restore();

  const drawSeries = (key, color, dash) => {
    msdCtx.strokeStyle = color;
    msdCtx.lineWidth = 2;
    msdCtx.setLineDash(dash);
    msdCtx.beginPath();
    msdHistory.forEach((d, i) => {
      if (i === 0) msdCtx.moveTo(px(d.t), py(d[key]));
      else msdCtx.lineTo(px(d.t), py(d[key]));
    });
    msdCtx.stroke();
    msdCtx.setLineDash([]);
  };

  msdCtx.save();
  msdCtx.beginPath();
  msdCtx.rect(margin.left, margin.top, plotW, plotH);
  msdCtx.clip();
  drawSeries('free', THEORY_COLOR, [5, 5]);
  if (reflective) drawSeries('conf', CONFINED_COLOR, [2, 3]);
  drawSeries('msd', '#64ffda', []);
  msdCtx.restore();

  // Legend
  const legend = [
    ['Simulation ⟨Δx²⟩', '#64ffda', []],
    [reflective ? 'Free diffusion: 2Dt' : 'Theory: 2Dt', THEORY_COLOR, [5, 5]],
  ];
  if (reflective) legend.push(['Theory: reflective box', CONFINED_COLOR, [2, 3]]);
  msdCtx.font = '11px sans-serif';
  msdCtx.textAlign = 'left';
  msdCtx.lineWidth = 2;
  legend.forEach(([label, color, dash], i) => {
    const y = margin.top + 10 + i * 16;
    msdCtx.strokeStyle = color;
    msdCtx.setLineDash(dash);
    msdCtx.beginPath();
    msdCtx.moveTo(margin.left + 10, y);
    msdCtx.lineTo(margin.left + 30, y);
    msdCtx.stroke();
    msdCtx.setLineDash([]);
    msdCtx.fillStyle = color;
    msdCtx.fillText(label, margin.left + 35, y + 4);
  });
}

function animate() {
  if (isRunning) {
    updateParticles();
  }
  drawBox();
  drawHistogram();
  drawMSD();
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

// Changing N restarts the run: particles added mid-run would have a shorter
// history than the rest and bias the ensemble MSD.
numSlider.addEventListener('input', () => {
  numVal.textContent = numSlider.value;
  initParticles();
});

diffSlider.addEventListener('input', () => {
  diffVal.textContent = parseFloat(diffSlider.value).toFixed(1);
});

speedSlider.addEventListener('input', () => {
  speedVal.textContent = speedSlider.value;
});

resetBtn.addEventListener('click', () => initParticles('center'));
randomBtn.addEventListener('click', () => initParticles('random'));

// Switching boundaries restarts the run, since the MSD definition and the
// theory both depend on the boundary type.
reflectiveBtn.addEventListener('click', () => {
  boundaryType = 'reflective';
  reflectiveBtn.classList.add('active');
  periodicBtn.classList.remove('active');
  initParticles();
});

periodicBtn.addEventListener('click', () => {
  boundaryType = 'periodic';
  periodicBtn.classList.add('active');
  reflectiveBtn.classList.remove('active');
  initParticles();
});

playBtn.addEventListener('click', () => {
  isRunning = !isRunning;
  if (isRunning) {
    playBtn.textContent = '⏸ Pause';
    playBtn.classList.remove('paused');
  } else {
    playBtn.textContent = '▶ Play';
    playBtn.classList.add('paused');
  }
});

window.addEventListener('resize', () => {
  const oldW = W, oldH = H;
  resize();
  if (W !== oldW || H !== oldH) initParticles(); // box changed: restart
});

// Initialize
resize();
initParticles('center');
animate();
