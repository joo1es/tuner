import './style.css';

// ===== Instruments =====
const INSTRUMENTS = {
  guitar: {
    label: 'Guitar',
    strings: [
      { name: 'E2', note: 'E', octave: 2, freq: 82.41 },
      { name: 'A2', note: 'A', octave: 2, freq: 110.00 },
      { name: 'D3', note: 'D', octave: 3, freq: 146.83 },
      { name: 'G3', note: 'G', octave: 3, freq: 196.00 },
      { name: 'B3', note: 'B', octave: 3, freq: 246.94 },
      { name: 'E4', note: 'E', octave: 4, freq: 329.63 },
    ],
    minFreq: 70,
    maxFreq: 400,
  },
  ukulele: {
    label: 'Ukulele',
    strings: [
      { name: 'G4', note: 'G', octave: 4, freq: 392.00 },
      { name: 'C4', note: 'C', octave: 4, freq: 261.63 },
      { name: 'E4', note: 'E', octave: 4, freq: 329.63 },
      { name: 'A4', note: 'A', octave: 4, freq: 440.00 },
    ],
    minFreq: 200,
    maxFreq: 520,
  },
};

let currentInstrument = 'guitar';
let STRINGS = INSTRUMENTS.guitar.strings;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const A4 = 440;

// ===== DOM =====
const app = document.getElementById('app');
app.innerHTML = `
  <div class="tuner">
    <div class="header">
      <div class="logo">
        <div class="logo-icon">&#9835;</div>
        <h1>TUNER</h1>
      </div>
      <div class="header-actions">
        <div class="instrument-switch" id="instrumentSwitch">
          <button class="instrument-option active" data-inst="guitar">Guitar</button>
          <button class="instrument-option" data-inst="ukulele">Ukulele</button>
        </div>
        <button class="theme-toggle" id="themeToggle" title="Toggle theme"></button>
      </div>
    </div>

    <div class="note-card">
      <div class="note-display">
        <span class="note-name" id="noteName">-</span>
        <span class="note-octave" id="noteOctave"></span>
      </div>
      <div class="cents-display" id="centsDisplay"></div>
    </div>

    <div class="meter-card">
      <canvas class="meter-canvas" id="meterCanvas"></canvas>
    </div>

    <div class="waveform-card">
      <canvas class="waveform-canvas" id="waveformCanvas"></canvas>
    </div>

    <div class="strings-label">Strings</div>
    <div class="strings" id="stringButtons"></div>

    <div class="controls">
      <button class="start-btn" id="startBtn">START LISTENING</button>
      <div class="status-text" id="statusText"></div>
    </div>
  </div>
`;

const noteNameEl = document.getElementById('noteName');
const noteOctaveEl = document.getElementById('noteOctave');
const centsDisplayEl = document.getElementById('centsDisplay');
const meterCanvas = document.getElementById('meterCanvas');
const waveformCanvas = document.getElementById('waveformCanvas');
const startBtn = document.getElementById('startBtn');
const statusText = document.getElementById('statusText');
const stringButtonsEl = document.getElementById('stringButtons');
const themeToggle = document.getElementById('themeToggle');

// ===== Theme =====
function isSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(dark) {
  document.body.classList.toggle('light', !dark);
  themeToggle.textContent = dark ? '\u263E' : '\u2600';
  localStorage.setItem('tuner-theme', dark ? 'dark' : 'light');
}

// Init: saved preference > system default
const savedTheme = localStorage.getItem('tuner-theme');
if (savedTheme) {
  applyTheme(savedTheme === 'dark');
} else {
  applyTheme(isSystemDark());
}

// Listen for system theme changes (only when no manual override)
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
mediaQuery.addEventListener('change', (e) => {
  if (!localStorage.getItem('tuner-theme')) {
    applyTheme(e.matches);
  }
});

themeToggle.addEventListener('click', () => {
  const isDark = !document.body.classList.contains('light');
  // Clear saved preference so system tracking resumes if they go back to default
  if (isDark === isSystemDark()) {
    localStorage.removeItem('tuner-theme');
  }
  applyTheme(!isDark);
});

// ===== State =====
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let stream = null;
let isListening = false;
let animFrameId = null;
let smoothedFreq = 0;
let lastSignalTime = 0;
let micPermissionGranted = false;
const meterCtx = meterCanvas.getContext('2d');
const waveCtx = waveformCanvas.getContext('2d');

// ===== String Buttons =====
function buildStringButtons() {
  stringButtonsEl.innerHTML = '';
  STRINGS.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.className = 'string-btn';
    btn.innerHTML = `${s.name}<span class="freq">${s.freq} Hz</span>`;
    btn.addEventListener('click', () => {
      const wasActive = btn.classList.contains('active');
      document.querySelectorAll('.string-btn').forEach(b => b.classList.remove('active'));
      if (!wasActive) btn.classList.add('active');
    });
    stringButtonsEl.appendChild(btn);
  });
}
buildStringButtons();

// ===== Instrument Switch =====
const instrumentSwitch = document.getElementById('instrumentSwitch');
instrumentSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('.instrument-option');
  if (!btn || btn.classList.contains('active')) return;
  instrumentSwitch.querySelectorAll('.instrument-option').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentInstrument = btn.dataset.inst;
  STRINGS = INSTRUMENTS[currentInstrument].strings;
  buildStringButtons();
});

// ===== Canvas Resize =====
function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  for (const c of [meterCanvas, waveformCanvas]) {
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  drawMeter(0);
}
window.addEventListener('resize', resizeCanvases);

// ===== Pitch Detection (YIN) =====
function detectPitch(buffer, sampleRate) {
  const size = buffer.length;

  let rms = 0;
  for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / size);
  if (rms < 0.008) return -1;

  const diff = new Float32Array(size);
  for (let tau = 1; tau < size; tau++) {
    let sum = 0;
    for (let i = 0; i < size - tau; i++) {
      const d = buffer[i] - buffer[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  const cmndf = new Float32Array(size);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < size; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = diff[tau] / (runningSum / tau);
  }

  const threshold = 0.2;
  let tau = -1;
  for (let i = 1; i < size - 1; i++) {
    if (cmndf[i] < threshold) {
      while (i + 1 < size && cmndf[i + 1] < cmndf[i]) i++;
      tau = i;
      break;
    }
  }

  if (tau === -1 || tau < 2) return -1;

  const s0 = cmndf[tau - 1];
  const s1 = cmndf[tau];
  const s2 = cmndf[tau + 1];
  const denom = 2 * (2 * s1 - s2 - s0);
  const shift = denom !== 0 ? (s0 - s2) / denom : 0;
  const period = tau + shift;

  const freq = sampleRate / period;
  const inst = INSTRUMENTS[currentInstrument];
  if (freq < inst.minFreq || freq > inst.maxFreq) return -1;
  return freq;
}

// ===== Frequency -> Note =====
function freqToNote(freq) {
  const semitones = 12 * Math.log2(freq / A4);
  const rounded = Math.round(semitones);
  const cents = Math.round((semitones - rounded) * 100);
  const name = NOTE_NAMES[((9 + rounded) % 12 + 12) % 12];
  const octave = 4 + Math.floor((rounded + 9) / 12);
  return { name, octave, cents };
}

// ===== Draw Meter =====
function getComputedColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function centsToAngle(c) {
  return Math.PI + ((c + 50) / 100) * Math.PI;
}

function drawMeter(cents) {
  const w = meterCanvas.getBoundingClientRect().width;
  const h = meterCanvas.getBoundingClientRect().height;
  const ctx = meterCtx;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h - 8;
  const r = Math.min(w / 2 - 16, h - 20);

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.lineWidth = 4;
  ctx.strokeStyle = getComputedColor('--meter-bg');
  ctx.stroke();

  // Colored zones
  const zones = [
    { from: -50, to: -10, color: getComputedColor('--flat') },
    { from: -10, to: -3, color: getComputedColor('--warning') },
    { from: -3, to: 3, color: getComputedColor('--in-tune') },
    { from: 3, to: 10, color: getComputedColor('--warning') },
    { from: 10, to: 50, color: getComputedColor('--flat') },
  ];
  for (const z of zones) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, centsToAngle(z.from), centsToAngle(z.to));
    ctx.lineWidth = 8;
    ctx.strokeStyle = z.color + '60';
    ctx.stroke();
  }

  // Tick marks
  for (let c = -50; c <= 50; c += 10) {
    const a = centsToAngle(c);
    const isMajor = c % 50 === 0 || c === 0;
    const len = isMajor ? 10 : 5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6));
    ctx.lineTo(cx + Math.cos(a) * (r + 6 + len), cy + Math.sin(a) * (r + 6 + len));
    ctx.strokeStyle = getComputedColor('--text-secondary');
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.stroke();
  }

  // Labels
  ctx.font = '11px sans-serif';
  ctx.fillStyle = getComputedColor('--text-secondary');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelR = r * 0.55;
  ctx.fillText('\u266D', cx + Math.cos(centsToAngle(-25)) * labelR, cy + Math.sin(centsToAngle(-25)) * labelR);
  ctx.fillText('\u266F', cx + Math.cos(centsToAngle(25)) * labelR, cy + Math.sin(centsToAngle(25)) * labelR);

  // Needle
  const clamped = Math.max(-50, Math.min(50, cents));
  const angle = centsToAngle(clamped);
  const needleLen = r - 8;
  const nx = cx + Math.cos(angle) * needleLen;
  const ny = cy + Math.sin(angle) * needleLen;

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = Math.abs(clamped) <= 3 ? getComputedColor('--in-tune') : getComputedColor('--needle');
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Pivot dot
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fillStyle = getComputedColor('--meter-bg');
  ctx.fill();
  ctx.strokeStyle = getComputedColor('--accent');
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// ===== Draw Waveform =====
function drawWaveform(byteData) {
  const w = waveformCanvas.getBoundingClientRect().width;
  const h = waveformCanvas.getBoundingClientRect().height;
  const ctx = waveCtx;
  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  const step = w / byteData.length;
  for (let i = 0; i < byteData.length; i++) {
    const y = (byteData[i] / 128.0) * h / 2;
    if (i === 0) ctx.moveTo(0, y);
    else ctx.lineTo(i * step, y);
  }
  ctx.strokeStyle = getComputedColor('--accent');
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ===== Update UI =====
function updateUI(freq) {
  if (freq < 0) {
    noteNameEl.textContent = '-';
    noteNameEl.className = 'note-name';
    noteOctaveEl.textContent = '';
    centsDisplayEl.textContent = '';
    drawMeter(0);
    return;
  }

  const note = freqToNote(freq);
  noteNameEl.textContent = note.name;
  noteOctaveEl.textContent = note.octave;
  const inTune = Math.abs(note.cents) <= 3;
  noteNameEl.className = 'note-name' + (inTune ? ' in-tune' : '');
  centsDisplayEl.textContent = `${note.cents > 0 ? '+' : ''}${note.cents} cents`;
  centsDisplayEl.className = 'cents-display' + (inTune ? ' in-tune' : '');
  drawMeter(note.cents);

  document.querySelectorAll('.string-btn').forEach((btn, i) => {
    const ratio = Math.abs(freq - STRINGS[i].freq) / STRINGS[i].freq;
    btn.classList.toggle('detected', ratio < 0.02);
  });
}

// ===== Audio Loop =====
function loop() {
  if (!isListening) return;

  const bufLen = analyser.fftSize;
  const timeData = new Float32Array(bufLen);
  analyser.getFloatTimeDomainData(timeData);

  const byteData = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(byteData);
  drawWaveform(byteData);

  const freq = detectPitch(timeData, audioCtx.sampleRate);

  if (freq > 0) {
    smoothedFreq = smoothedFreq === 0 ? freq : smoothedFreq * 0.65 + freq * 0.35;
    lastSignalTime = performance.now();
    updateUI(smoothedFreq);
  } else if (performance.now() - lastSignalTime > 600) {
    smoothedFreq = 0;
    updateUI(-1);
  }

  animFrameId = requestAnimationFrame(loop);
}

// ===== Audio Setup =====
async function setupAudio() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  sourceNode.connect(analyser);

  isListening = true;
  smoothedFreq = 0;
  lastSignalTime = performance.now();
  startBtn.textContent = 'STOP';
  startBtn.classList.add('listening');
  statusText.textContent = 'Listening \u2014 play a string!';
  loop();
}

function stop() {
  isListening = false;
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (sourceNode) sourceNode.disconnect();
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  analyser = null;
  sourceNode = null;
  stream = null;
  smoothedFreq = 0;

  startBtn.textContent = 'START LISTENING';
  startBtn.classList.remove('listening');
  statusText.textContent = '';
  noteNameEl.textContent = '-';
  noteNameEl.className = 'note-name';
  noteOctaveEl.textContent = '';
  centsDisplayEl.textContent = '';
  drawMeter(0);
  waveCtx.clearRect(0, 0, waveformCanvas.getBoundingClientRect().width, waveformCanvas.getBoundingClientRect().height);
  document.querySelectorAll('.string-btn').forEach(b => b.classList.remove('detected'));
}

// ===== Start Button =====
startBtn.addEventListener('click', async () => {
  if (isListening) {
    stop();
    return;
  }
  try {
    statusText.textContent = 'Requesting microphone access...';
    await setupAudio();
    micPermissionGranted = true;
  } catch (e) {
    statusText.textContent = 'Microphone access denied.';
    console.error(e);
  }
});

// ===== Auto-start if permission already granted =====
async function tryAutoStart() {
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    if (result.state === 'granted') {
      statusText.textContent = 'Microphone access detected, starting...';
      await setupAudio();
      micPermissionGranted = true;
    }
  } catch {
    // permissions API not supported or query failed — user clicks manually
  }
}

// ===== Init =====
resizeCanvases();
tryAutoStart();
