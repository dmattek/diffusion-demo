const boxCanvas = document.getElementById('boxCanvas');
const histCanvas = document.getElementById('histCanvas');
const msdCanvas = document.getElementById('msdCanvas');
const boxCtx = boxCanvas.getContext('2d');
const histCtx = histCanvas.getContext('2d');
const msdCtx = msdCanvas.getContext('2d');

const numSlider = document.getElementById('numParticles');
const diffSlider = document.getElementById('diffConst');
const numVal = document.getElementById('numVal');
const diffVal = document.getElementById('diffVal');
const resetBtn = document.getElementById('resetBtn');
const randomBtn = document.getElementById('randomBtn');
const reflectiveBtn = document.getElementById('reflectiveBtn');
const periodicBtn = document.getElementById('periodicBtn');
const playBtn = document.getElementById('playBtn');

let W = 760, H = 400, histH = 200, msdH = 200;
let boundaryType = 'reflective';
let isRunning = true;
let time = 0;
let msdHistory = [];
let initialPositions = [];
const maxMsdPoints = 500;
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

function initParticles(centered = true) {
  const n = parseInt(numSlider.value);
  particles = [];
  initialPositions = [];
  time = 0;
  msdHistory = [];
  for (let i = 0; i < n; i++) {
    const x = centered ? W / 2 : Math.random() * W;
    const y = centered ? H / 2 : Math.random() * H;
    particles.push({ x, y, dx: 0, dy: 0 }); // dx, dy track cumulative displacement
    initialPositions.push({ x, y });
  }
}

function calculateMSD() {
  if (particles.length === 0) return 0;
  let sumSqDisp = 0;
  for (let p of particles) {
    sumSqDisp += p.dx * p.dx; // 1D MSD along x
  }
  return sumSqDisp / particles.length;
}

function updateParticles() {
  const D = parseFloat(diffSlider.value);
  const dt = 1;
  const sigma = Math.sqrt(2 * D * dt);

  for (let p of particles) {
    const stepX = gaussianRandom() * sigma;
    const stepY = gaussianRandom() * sigma;

    p.dx += stepX; // Track cumulative displacement for MSD
    p.dy += stepY;

    p.x += stepX;
    p.y += stepY;

    if (boundaryType === 'reflective') {
      // Reflective boundaries
      if (p.x < 0) p.x = -p.x;
      if (p.x > W) p.x = 2 * W - p.x;
      if (p.y < 0) p.y = -p.y;
      if (p.y > H) p.y = 2 * H - p.y;
    } else {
      // Periodic boundaries (modulo for large jumps)
      p.x = ((p.x % W) + W) % W;
      p.y = ((p.y % H) + H) % H;
    }

    // Clamp just in case
    p.x = Math.max(0, Math.min(W, p.x));
    p.y = Math.max(0, Math.min(H, p.y));
  }

  time++;
  const msd = calculateMSD();
  msdHistory.push({ t: time, msd: msd });
  if (msdHistory.length > maxMsdPoints) {
    msdHistory.shift();
  }
}

function gaussianRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
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
  for (let p of particles) {
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
}

function drawHistogram() {
  histCtx.fillStyle = '#0a0a15';
  histCtx.fillRect(0, 0, W, histH);

  const margin = { top: 20, bottom: 30, left: 10, right: 10 };
  const plotW = W - margin.left - margin.right;
  const plotH = histH - margin.top - margin.bottom;

  // Calculate histogram
  const bins = new Array(numBins).fill(0);
  const binWidth = W / numBins;

  for (let p of particles) {
    const binIndex = Math.min(numBins - 1, Math.floor(p.x / binWidth));
    bins[binIndex]++;
  }

  // Normalize to probability density
  const total = particles.length;
  const density = bins.map(b => b / (total * binWidth) * W);
  const maxDensity = Math.max(...density, 0.001);

  // Draw axes
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

  // Draw bars
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

  // Draw smooth curve overlay
  histCtx.strokeStyle = '#64ffda';
  histCtx.lineWidth = 2;
  histCtx.beginPath();
  for (let i = 0; i < numBins; i++) {
    const x = margin.left + (i + 0.5) * barW;
    const y = margin.top + plotH - (density[i] / maxDensity) * plotH;
    if (i === 0) histCtx.moveTo(x, y);
    else histCtx.lineTo(x, y);
  }
  histCtx.stroke();
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

  const D = parseFloat(diffSlider.value);
  const maxT = msdHistory[msdHistory.length - 1].t;
  const theoreticalMax = 2 * D * maxT;
  const maxMsd = Math.max(...msdHistory.map(d => d.msd), theoreticalMax) * 1.1;

  // Draw axes
  msdCtx.strokeStyle = 'rgba(100,255,218,0.3)';
  msdCtx.lineWidth = 1;
  msdCtx.beginPath();
  msdCtx.moveTo(margin.left, margin.top);
  msdCtx.lineTo(margin.left, margin.top + plotH);
  msdCtx.lineTo(margin.left + plotW, margin.top + plotH);
  msdCtx.stroke();

  // Axis labels
  msdCtx.fillStyle = '#888';
  msdCtx.font = '11px sans-serif';
  msdCtx.textAlign = 'center';
  msdCtx.fillText('Time (t)', margin.left + plotW / 2, margin.top + plotH + 25);
  msdCtx.save();
  msdCtx.translate(15, margin.top + plotH / 2);
  msdCtx.rotate(-Math.PI / 2);
  msdCtx.fillText('⟨Δx²⟩', 0, 0);
  msdCtx.restore();

  // Draw theoretical line 2Dt
  msdCtx.strokeStyle = 'rgba(255,107,157,0.8)';
  msdCtx.lineWidth = 2;
  msdCtx.setLineDash([5, 5]);
  msdCtx.beginPath();
  const startT = msdHistory[0].t;
  for (let i = 0; i <= 100; i++) {
    const t = startT + (maxT - startT) * i / 100;
    const theory = 2 * D * t;
    const x = margin.left + ((t - startT) / (maxT - startT)) * plotW;
    const y = margin.top + plotH - (theory / maxMsd) * plotH;
    if (i === 0) msdCtx.moveTo(x, y);
    else msdCtx.lineTo(x, y);
  }
  msdCtx.stroke();
  msdCtx.setLineDash([]);

  // Draw measured MSD
  msdCtx.strokeStyle = '#64ffda';
  msdCtx.lineWidth = 2;
  msdCtx.beginPath();
  for (let i = 0; i < msdHistory.length; i++) {
    const d = msdHistory[i];
    const x = margin.left + ((d.t - startT) / (maxT - startT)) * plotW;
    const y = margin.top + plotH - (d.msd / maxMsd) * plotH;
    if (i === 0) msdCtx.moveTo(x, y);
    else msdCtx.lineTo(x, y);
  }
  msdCtx.stroke();

  // Legend
  msdCtx.font = '11px sans-serif';
  msdCtx.textAlign = 'left';

  msdCtx.strokeStyle = '#64ffda';
  msdCtx.beginPath();
  msdCtx.moveTo(margin.left + 10, margin.top + 10);
  msdCtx.lineTo(margin.left + 30, margin.top + 10);
  msdCtx.stroke();
  msdCtx.fillStyle = '#64ffda';
  msdCtx.fillText('Measured ⟨Δx²⟩', margin.left + 35, margin.top + 14);

  msdCtx.strokeStyle = 'rgba(255,107,157,0.8)';
  msdCtx.setLineDash([5, 5]);
  msdCtx.beginPath();
  msdCtx.moveTo(margin.left + 10, margin.top + 28);
  msdCtx.lineTo(margin.left + 30, margin.top + 28);
  msdCtx.stroke();
  msdCtx.setLineDash([]);
  msdCtx.fillStyle = '#ff6b9d';
  msdCtx.fillText('Theory: 2Dt', margin.left + 35, margin.top + 32);
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

// Event listeners
numSlider.addEventListener('input', () => {
  numVal.textContent = numSlider.value;
  const currentN = particles.length;
  const newN = parseInt(numSlider.value);

  if (newN > currentN) {
    for (let i = currentN; i < newN; i++) {
      particles.push({ x: W / 2, y: H / 2, dx: 0, dy: 0 });
      initialPositions.push({ x: W / 2, y: H / 2 });
    }
  } else {
    particles = particles.slice(0, newN);
    initialPositions = initialPositions.slice(0, newN);
  }
});

diffSlider.addEventListener('input', () => {
  diffVal.textContent = parseFloat(diffSlider.value).toFixed(1);
});

resetBtn.addEventListener('click', () => initParticles(true));
randomBtn.addEventListener('click', () => initParticles(false));

reflectiveBtn.addEventListener('click', () => {
  boundaryType = 'reflective';
  reflectiveBtn.classList.add('active');
  periodicBtn.classList.remove('active');
});

periodicBtn.addEventListener('click', () => {
  boundaryType = 'periodic';
  periodicBtn.classList.add('active');
  reflectiveBtn.classList.remove('active');
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

window.addEventListener('resize', resize);

// Initialize
resize();
initParticles(true);
animate();
