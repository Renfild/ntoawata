// Procedural sound for the desk: everything is synthesised with WebAudio, no files to load.
// Browsers only start audio after a user gesture, so a saved "on" waits for the first click or key.

const PREF_KEY = "renfild.sound";
const listeners = new Set();

let enabled = readPref();
let ctx = null;
let master = null;
let noise = null;
let armed = false;

export const sound = {
  get enabled() {
    return enabled;
  },
  set(on) {
    enabled = Boolean(on);
    writePref(enabled);
    if (enabled) {
      start();
      chime();
    } else if (master) {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    }
    for (const fn of listeners) fn(enabled);
  },
  toggle() {
    this.set(!enabled);
  },
  onChange(fn) {
    listeners.add(fn);
    fn(enabled);
  },
  key,
  lamp,
  cat,
  sign,
  mouse,
};

if (enabled) armStart();

document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else if (enabled) ctx.resume();
});

function armStart() {
  if (armed) return;
  armed = true;
  const go = () => {
    window.removeEventListener("pointerdown", go, true);
    window.removeEventListener("keydown", go, true);
    if (enabled) start();
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
}

function start() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!ctx) {
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    noise = noiseBuffer(ctx, 3);
    ambience();
  }
  ctx.resume();
  master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
}

function live() {
  return enabled && ctx && ctx.state === "running";
}

// Rain on the glass, a low city rumble and a faint neon hum.
function ambience() {
  const rain = loopNoise();
  const high = filter("highpass", 500, 0.5);
  const low = filter("lowpass", 7000, 0.5);
  const rainGain = gain(0.06);
  rain.connect(high).connect(low).connect(rainGain).connect(master);
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.07;
  const swellDepth = gain(0.02);
  swell.connect(swellDepth).connect(rainGain.gain);
  swell.start();

  const rumble = loopNoise();
  rumble.connect(filter("lowpass", 160, 0.7)).connect(gain(0.22)).connect(master);

  const hum = ctx.createOscillator();
  hum.frequency.value = 100;
  const humGain = gain(0.004);
  hum.connect(filter("lowpass", 400, 0.7)).connect(humGain).connect(master);
  hum.start();

  scheduleDrips();
}

function scheduleDrips() {
  const tick = () => {
    if (live()) drip();
    window.setTimeout(tick, 250 + Math.random() * 900);
  };
  tick();
}

function drip() {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  const f = 1400 + Math.random() * 1800;
  osc.frequency.setValueAtTime(f, t);
  osc.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.05);
  const g = envelope(t, 0.012 + Math.random() * 0.012, 0.001, 0.06);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.08);
}

function key() {
  if (!live()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const click = filter("bandpass", 2600 + Math.random() * 1600, 1.4);
  src.connect(click).connect(envelope(t, 0.32, 0.001, 0.035)).connect(master);
  src.start(t, Math.random() * 2, 0.05);

  const thock = ctx.createOscillator();
  thock.type = "triangle";
  thock.frequency.setValueAtTime(210 + Math.random() * 50, t);
  thock.frequency.exponentialRampToValueAtTime(85, t + 0.05);
  thock.connect(envelope(t, 0.18, 0.002, 0.07)).connect(master);
  thock.start(t);
  thock.stop(t + 0.09);
}

function lamp(on) {
  if (!live()) return;
  const t = ctx.currentTime;
  for (const [delay, freq] of [[0, 3200], [0.045, 2400]]) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.connect(filter("bandpass", freq, 3)).connect(envelope(t + delay, 0.45, 0.001, 0.025)).connect(master);
    src.start(t + delay, Math.random() * 2, 0.04);
  }
  if (!on) return;
  const hum = ctx.createOscillator();
  hum.frequency.value = 120;
  hum.connect(envelope(t + 0.05, 0.03, 0.02, 0.5)).connect(master);
  hum.start(t + 0.05);
  hum.stop(t + 0.6);
}

function cat() {
  if (!live()) return;
  meow(ctx.currentTime);
  purr(ctx.currentTime + 0.7, 2.8);
}

function meow(t) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(520, t);
  osc.frequency.linearRampToValueAtTime(780, t + 0.16);
  osc.frequency.linearRampToValueAtTime(610, t + 0.42);
  osc.frequency.linearRampToValueAtTime(450, t + 0.62);
  const out = envelope(t, 0.16, 0.05, 0.62);
  // Two moving formants turn the buzz into an "ee-a-oo".
  for (const [from, mid, to, level] of [[900, 1500, 700, 1], [2600, 2200, 1200, 0.5]]) {
    const f = filter("bandpass", from, 6);
    f.frequency.setValueAtTime(from, t);
    f.frequency.linearRampToValueAtTime(mid, t + 0.2);
    f.frequency.linearRampToValueAtTime(to, t + 0.6);
    osc.connect(f).connect(gain(level)).connect(out);
  }
  out.connect(master);
  osc.start(t);
  osc.stop(t + 0.7);
}

function purr(t, length) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const body = filter("lowpass", 240, 1.2);
  const pulse = gain(0.5);
  const rate = ctx.createOscillator();
  rate.frequency.value = 24;
  const depth = gain(0.5);
  rate.connect(depth).connect(pulse.gain);
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(0.5, t + 0.4);
  out.gain.setValueAtTime(0.5, t + length - 0.6);
  out.gain.linearRampToValueAtTime(0.0001, t + length);
  src.connect(body).connect(pulse).connect(out).connect(master);
  src.start(t);
  rate.start(t);
  src.stop(t + length + 0.05);
  rate.stop(t + length + 0.05);
}

function sign() {
  if (!live()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(1320, t + 0.09);
  osc.connect(filter("lowpass", 2400, 0.8)).connect(envelope(t, 0.06, 0.004, 0.16)).connect(master);
  osc.start(t);
  osc.stop(t + 0.2);
  const buzz = ctx.createOscillator();
  buzz.type = "sawtooth";
  buzz.frequency.value = 100;
  buzz.connect(filter("lowpass", 700, 0.7)).connect(envelope(t, 0.03, 0.01, 0.3)).connect(master);
  buzz.start(t);
  buzz.stop(t + 0.35);
}

function mouse() {
  if (!live()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.connect(filter("bandpass", 4200, 2.5)).connect(envelope(t, 0.3, 0.0008, 0.02)).connect(master);
  src.start(t, Math.random() * 2, 0.03);
}

function chime() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.05;
  [660, 990].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(envelope(t + i * 0.09, 0.08, 0.01, 0.35)).connect(master);
    osc.start(t + i * 0.09);
    osc.stop(t + i * 0.09 + 0.4);
  });
}

function loopNoise() {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.start();
  return src;
}

function filter(type, frequency, q) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

function gain(value) {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

function envelope(t, peak, attack, decay) {
  const node = ctx.createGain();
  node.gain.setValueAtTime(0.0001, t);
  node.gain.exponentialRampToValueAtTime(peak, t + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return node;
}

function noiseBuffer(context, seconds) {
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  // Slightly pinked white noise: softer highs sound more like rain than hiss.
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * 0.55 + white * 0.45;
    data[i] = last;
  }
  return buffer;
}

function readPref() {
  try {
    return window.localStorage.getItem(PREF_KEY) === "on";
  } catch {
    return false;
  }
}

function writePref(on) {
  try {
    window.localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // Storage can be blocked; the toggle still works for this visit.
  }
}
