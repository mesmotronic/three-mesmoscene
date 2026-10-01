// A tiny 4k-intro style software synth. Renders the whole song to PCM up front
// (like depacking a module), so playback is glitch-free and perfectly in sync.

import { BAR, DURATION, STEP, type NoteEvent } from './song';

const TAU = Math.PI * 2;
const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function polyblep(t: number, dt: number) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// Zavalishin TPT state variable filter
class SVF {
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  lp = 0;
  bp = 0;
  hp = 0;
  private sr: number;
  constructor(sr: number) {
    this.sr = sr;
  }
  set(fc: number, q: number) {
    const g = Math.tan((Math.PI * Math.min(Math.max(fc, 20), this.sr * 0.45)) / this.sr);
    this.k = 1 / q;
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  process(v0: number) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
}

interface Mix {
  sr: number;
  len: number;
  L: Float32Array;
  R: Float32Array;
  dly: Float32Array; // mono send to ping-pong delay
  rvL: Float32Array;
  rvR: Float32Array;
  duck: Float32Array; // sidechain gain curve from the kick
  rnd: () => number; // -1..1
}

function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

// Song-position automation
const barAt = (t: number) => t / BAR;
const expRamp = (a: number, b: number, x: number) => a * Math.pow(b / a, Math.min(Math.max(x, 0), 1));

function padCutoff(t: number) {
  const b = barAt(t);
  if (b < 8) return expRamp(350, 2600, b / 8);
  if (b >= 24 && b < 32) return expRamp(700, 5500, (b - 24) / 8);
  if (b >= 48) return expRamp(2600, 450, (b - 50) / 6);
  return 2000;
}
function arpCutoff(t: number) {
  const b = barAt(t);
  if (b < 8) return expRamp(300, 4200, b / 7.5);
  if (b >= 52) return expRamp(4200, 500, (b - 52) / 4);
  return 4200 + 1500 * Math.sin(b * 0.7);
}
function acidCutoff(t: number) {
  const b = barAt(t) - 40;
  return 260 + 2600 * (0.5 - 0.5 * Math.cos((TAU * b) / 4)) * (0.6 + 0.4 * Math.min(b / 8, 1));
}

const fadeTail = (i: number, len: number, sr: number) => Math.min(1, (len - i) / (0.008 * sr));

// ---------------------------------------------------------------- drums

function kick(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const len = Math.floor(0.5 * m.sr);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    const f = 46 + 150 * Math.exp(-t * 32) + 500 * Math.exp(-t * 260);
    ph += (TAU * f) / m.sr;
    let s = Math.sin(ph) * Math.exp(-t * 7.5) + m.rnd() * Math.exp(-t * 600) * 0.25;
    s = Math.tanh(s * 2.4) * 0.72 * e.vel * fadeTail(i, len, m.sr);
    m.L[n] += s;
    m.R[n] += s;
  }
}

function snare(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const len = Math.floor(0.32 * m.sr);
  const hp = new SVF(m.sr);
  hp.set(1800, 0.8);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    ph += (TAU * 185 * (1 + 0.6 * Math.exp(-t * 50))) / m.sr;
    const tone = Math.sin(ph) * Math.exp(-t * 28) * 0.55;
    hp.process(m.rnd());
    const noise = hp.hp * Math.exp(-t * 13) * 0.65;
    const s = Math.tanh((tone + noise) * 1.3) * 0.6 * e.vel * fadeTail(i, len, m.sr);
    m.L[n] += s * 0.95;
    m.R[n] += s * 1.05;
    m.rvL[n] += s * 0.18;
    m.rvR[n] += s * 0.18;
  }
}

function clap(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const len = Math.floor(0.45 * m.sr);
  const bp = new SVF(m.sr);
  bp.set(1250, 1.4);
  const bp2 = new SVF(m.sr);
  bp2.set(2400, 1.1);
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    let env = 0;
    for (const o of [0, 0.011, 0.023]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) * 190));
    if (t >= 0.034) env = Math.max(env, Math.exp(-(t - 0.034) * 15) * 0.85);
    const x = m.rnd();
    bp.process(x);
    bp2.process(x);
    const s = (bp.bp * 1.6 + bp2.bp * 0.8) * env * 0.55 * e.vel * fadeTail(i, len, m.sr);
    m.L[n] += s * 1.05;
    m.R[n] += s * 0.95;
    m.rvL[n] += s * 0.35;
    m.rvR[n] += s * 0.35;
  }
}

const HAT_F = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 2.1);

function hat(m: Mix, e: NoteEvent, open: boolean) {
  const n0 = Math.round(e.t * m.sr);
  const len = Math.floor((open ? 0.42 : 0.07) * m.sr);
  const decay = open ? 8.5 : 65;
  const hp = new SVF(m.sr);
  hp.set(7500, 0.9);
  const phases = HAT_F.map(() => 0);
  const pan = open ? -0.35 : 0.3;
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    let metal = 0;
    for (let k = 0; k < 6; k++) {
      phases[k] = (phases[k] + HAT_F[k] / m.sr) % 1;
      metal += phases[k] < 0.5 ? 1 : -1;
    }
    hp.process(metal * 0.12 + m.rnd() * 0.7);
    const s = hp.hp * Math.exp(-t * decay) * 0.42 * e.vel * fadeTail(i, len, m.sr);
    m.L[n] += s * (1 - pan);
    m.R[n] += s * (1 + pan);
    if (open) {
      m.rvL[n] += s * 0.12;
      m.rvR[n] += s * 0.12;
    }
  }
}

function crash(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const len = Math.floor(2.6 * m.sr);
  const hl = new SVF(m.sr);
  const hr = new SVF(m.sr);
  hl.set(4200, 0.7);
  hr.set(4600, 0.7);
  const phases = HAT_F.map(() => 0);
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    let metal = 0;
    for (let k = 0; k < 6; k++) {
      phases[k] = (phases[k] + (HAT_F[k] * 1.37) / m.sr) % 1;
      metal += phases[k] < 0.5 ? 1 : -1;
    }
    const env = Math.exp(-t * 1.9) * (1 - Math.exp(-t * 900)) * 0.3 * e.vel * fadeTail(i, len, m.sr);
    hl.process(m.rnd() + metal * 0.08);
    hr.process(m.rnd() + metal * 0.08);
    m.L[n] += hl.hp * env;
    m.R[n] += hr.hp * env;
    m.rvL[n] += hl.hp * env * 0.3;
    m.rvR[n] += hr.hp * env * 0.3;
  }
}

function riser(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const len = Math.floor(e.dur * m.sr);
  const fl = new SVF(m.sr);
  const fr = new SVF(m.sr);
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const x = i / len;
    if ((i & 31) === 0) {
      const fc = 250 * Math.pow(36, x);
      fl.set(fc, 2.5);
      fr.set(fc * 1.06, 2.5);
    }
    fl.process(m.rnd());
    fr.process(m.rnd());
    const g = x * x * 0.42 * e.vel * fadeTail(i, len, m.sr);
    m.L[n] += fl.bp * g;
    m.R[n] += fr.bp * g;
    m.rvL[n] += fl.bp * g * 0.6;
    m.rvR[n] += fr.bp * g * 0.6;
  }
}

function boom(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const len = Math.floor(1.8 * m.sr);
  let ph = 0;
  const lp = new SVF(m.sr);
  lp.set(900, 0.7);
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    ph += (TAU * (32 + 50 * Math.exp(-t * 7))) / m.sr;
    lp.process(m.rnd());
    const s =
      (Math.tanh(Math.sin(ph) * 1.8) * Math.exp(-t * 2.2) + lp.lp * Math.exp(-t * 9) * 0.8) *
      0.55 *
      e.vel *
      fadeTail(i, len, m.sr);
    m.L[n] += s;
    m.R[n] += s;
    m.rvL[n] += s * 0.25;
    m.rvR[n] += s * 0.25;
  }
}

// ---------------------------------------------------------------- tonal

function bass(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const rel = 0.03;
  const len = Math.floor((e.dur + rel) * m.sr);
  const f = mtof(e.note);
  const dt = f / m.sr;
  const lp = new SVF(m.sr);
  let ph = 0;
  let sub = 0;
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    if ((i & 15) === 0) lp.set(260 + 2400 * Math.exp(-t * 15) * e.vel, 2.4);
    ph += dt;
    if (ph >= 1) ph -= 1;
    sub += dt;
    const saw = 2 * ph - 1 - polyblep(ph, dt);
    const x = lp.process(saw);
    const amp = Math.min(1, t / 0.003) * (t > e.dur ? Math.max(0, 1 - (t - e.dur) / rel) : 1);
    const s = Math.tanh(x * 1.6 + Math.sin(TAU * sub) * 0.7) * 0.38 * amp * e.vel * m.duck[n];
    m.L[n] += s;
    m.R[n] += s;
  }
}

function acid(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const rel = 0.02;
  const len = Math.floor((e.dur * 0.9 + rel) * m.sr);
  const f = mtof(e.note);
  const dt = f / m.sr;
  const lp = new SVF(m.sr);
  const base = acidCutoff(e.t);
  const acc = e.acc ?? 0;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    if ((i & 15) === 0) lp.set(base * (1 + (1.5 + 3 * acc) * Math.exp(-t * 14)), 7 + acc * 5);
    ph += dt;
    if (ph >= 1) ph -= 1;
    const saw = 2 * ph - 1 - polyblep(ph, dt);
    const x = lp.process(saw);
    const amp = Math.min(1, t / 0.002) * (t > e.dur * 0.9 ? Math.max(0, 1 - (t - e.dur * 0.9) / rel) : 1);
    const s = Math.tanh(x * (2.2 + acc)) * 0.17 * amp * e.vel * m.duck[n];
    m.L[n] += s * 0.9;
    m.R[n] += s * 1.1;
    m.dly[n] += s * 0.22;
  }
}

const SUPER_DETUNE = [-0.21, -0.12, -0.05, 0, 0.05, 0.12, 0.21];
const SUPER_PAN = [-1, 0.6, -0.45, 0, 0.45, -0.6, 1];

function lead(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const rel = 0.18;
  const len = Math.floor((e.dur + rel) * m.sr);
  const f = mtof(e.note);
  const lpL = new SVF(m.sr);
  const lpR = new SVF(m.sr);
  const ph = SUPER_DETUNE.map((_, k) => (k * 0.618) % 1);
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    if ((i & 15) === 0) {
      const fc = 1900 + 5200 * Math.exp(-t * 5);
      lpL.set(fc, 0.9);
      lpR.set(fc, 0.9);
    }
    const vib = Math.sin(TAU * 5.8 * t) * 0.13 * Math.min(1, Math.max(0, (t - 0.16) * 4));
    let l = 0;
    let r = 0;
    for (let k = 0; k < 7; k++) {
      const dt = (f * Math.pow(2, (SUPER_DETUNE[k] + vib) / 12)) / m.sr;
      ph[k] += dt;
      if (ph[k] >= 1) ph[k] -= 1;
      const s = 2 * ph[k] - 1 - polyblep(ph[k], dt);
      l += s * (1 - SUPER_PAN[k]) * 0.5;
      r += s * (1 + SUPER_PAN[k]) * 0.5;
    }
    let env: number;
    if (t < 0.004) env = t / 0.004;
    else if (t < e.dur) env = 0.55 + 0.45 * Math.exp(-(t - 0.004) * 4);
    else env = (0.55 + 0.45 * Math.exp(-(e.dur - 0.004) * 4)) * Math.max(0, 1 - (t - e.dur) / rel);
    const g = 0.13 * e.vel * env * (0.7 + 0.3 * m.duck[n]);
    const sl = lpL.process(l) * g;
    const sr = lpR.process(r) * g;
    m.L[n] += sl;
    m.R[n] += sr;
    m.dly[n] += (sl + sr) * 0.3;
    m.rvL[n] += sl * 0.3;
    m.rvR[n] += sr * 0.3;
  }
}

function arp(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const len = Math.floor(0.32 * m.sr);
  const f = mtof(e.note);
  const dt = f / m.sr;
  const lp = new SVF(m.sr);
  const cut = arpCutoff(e.t);
  const pan = Math.round(e.t / STEP) % 2 ? 0.4 : -0.4;
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    if ((i & 15) === 0) lp.set(180 + cut * (0.25 + 0.75 * Math.exp(-t * 20)), 2.6);
    ph += dt;
    if (ph >= 1) ph -= 1;
    const pw = 0.5 + 0.18 * Math.sin(e.t * 1.3);
    let sq = (ph < pw ? 1 : -1) + polyblep(ph, dt);
    const p2 = (ph + 1 - pw) % 1;
    sq -= polyblep(p2, dt);
    const s = lp.process(sq) * Math.exp(-t * 11) * 0.11 * e.vel * m.duck[n] * fadeTail(i, len, m.sr);
    m.L[n] += s * (1 - pan);
    m.R[n] += s * (1 + pan);
    m.dly[n] += s * 0.4;
    m.rvL[n] += s * 0.12;
    m.rvR[n] += s * 0.12;
  }
}

function chip(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const rel = 0.025;
  const len = Math.floor((e.dur + rel) * m.sr);
  const notes = e.notes ?? [e.note];
  const freqs = notes.map(mtof);
  const lp = new SVF(m.sr);
  lp.set(6500, 0.7);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    // 50Hz VBL tick arpeggio, just like ProTracker's 0xy
    let f = freqs[Math.floor(t * 50) % freqs.length];
    if (freqs.length === 1) f *= Math.pow(2, (Math.sin(TAU * 6 * t) * 0.18 * Math.min(1, t * 5)) / 12);
    const dt = f / m.sr;
    ph += dt;
    if (ph >= 1) ph -= 1;
    let sq = (ph < 0.25 ? 1 : -1) + polyblep(ph, dt);
    sq -= polyblep((ph + 0.75) % 1, dt);
    const amp =
      (0.35 + 0.65 * Math.exp(-t * 4)) *
      Math.min(1, t / 0.002) *
      (t > e.dur ? Math.max(0, 1 - (t - e.dur) / rel) : 1);
    const s = lp.process(sq) * amp * 0.12 * e.vel;
    m.L[n] += s;
    m.R[n] += s;
    m.dly[n] += s * 0.3;
    m.rvL[n] += s * 0.2;
    m.rvR[n] += s * 0.2;
  }
}

function pad(m: Mix, e: NoteEvent) {
  const n0 = Math.round(e.t * m.sr);
  const atk = 0.35;
  const rel = 0.9;
  const len = Math.floor((e.dur + rel) * m.sr);
  const f = mtof(e.note);
  const det = [-0.11, 0.0, 0.11];
  const ph = det.map((_, k) => (k * 0.37 + e.note * 0.11) % 1);
  const lpL = new SVF(m.sr);
  const lpR = new SVF(m.sr);
  for (let i = 0; i < len; i++) {
    const n = n0 + i;
    if (n >= m.len) break;
    const t = i / m.sr;
    if ((i & 31) === 0) {
      const fc = padCutoff(e.t + t) * (1 + 0.2 * Math.sin(TAU * 0.3 * (e.t + t) + e.note));
      lpL.set(fc, 1.1);
      lpR.set(fc * 1.04, 1.1);
    }
    let l = 0;
    let r = 0;
    for (let k = 0; k < 3; k++) {
      const dt = (f * Math.pow(2, det[k] / 12)) / m.sr;
      ph[k] += dt;
      if (ph[k] >= 1) ph[k] -= 1;
      const s = 2 * ph[k] - 1 - polyblep(ph[k], dt);
      if (k === 0) l += s;
      else if (k === 2) r += s;
      else {
        l += s * 0.6;
        r += s * 0.6;
      }
    }
    const env = Math.min(1, t / atk) * (t > e.dur ? Math.max(0, 1 - (t - e.dur) / rel) : 1);
    const g = 0.062 * e.vel * env * (0.45 + 0.55 * m.duck[n]);
    const sl = lpL.process(l) * g;
    const sr = lpR.process(r) * g;
    m.L[n] += sl;
    m.R[n] += sr;
    m.rvL[n] += sl * 0.5;
    m.rvR[n] += sr * 0.5;
  }
}

// ---------------------------------------------------------------- fx

function pingPong(m: Mix) {
  const D = Math.round(3 * STEP * m.sr); // dotted eighth
  const bl = new Float32Array(D);
  const br = new Float32Array(D);
  let idx = 0;
  let fl = 0;
  let fr = 0;
  const fb = 0.42;
  for (let n = 0; n < m.len; n++) {
    const ol = bl[idx];
    const or = br[idx];
    fl += (ol - fl) * 0.33;
    fr += (or - fr) * 0.33;
    bl[idx] = m.dly[n] + fr * fb;
    br[idx] = fl * fb;
    idx = idx + 1 === D ? 0 : idx + 1;
    m.L[n] += ol * 0.55;
    m.R[n] += or * 0.55;
    m.rvL[n] += ol * 0.15;
    m.rvR[n] += or * 0.15;
  }
}

// Freeverb (Jezar's public domain design)
function freeverb(m: Mix) {
  const scale = m.sr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const room = 0.87;
  const damp = 0.28;
  const gain = 0.015;
  const outs = [new Float32Array(m.len), new Float32Array(m.len)];
  for (let c = 0; c < 2; c++) {
    const spread = c ? 23 : 0;
    const combs = combT.map((t) => new Float32Array(Math.round((t + spread) * scale)));
    const cIdx = new Int32Array(8);
    const cStore = new Float64Array(8);
    const aps = apT.map((t) => new Float32Array(Math.round((t + spread) * scale)));
    const aIdx = new Int32Array(4);
    const out = outs[c];
    for (let n = 0; n < m.len; n++) {
      const inp = (m.rvL[n] + m.rvR[n]) * gain;
      let acc = 0;
      for (let k = 0; k < 8; k++) {
        const buf = combs[k];
        const y = buf[cIdx[k]];
        cStore[k] = y * (1 - damp) + cStore[k] * damp;
        buf[cIdx[k]] = inp + cStore[k] * room;
        if (++cIdx[k] >= buf.length) cIdx[k] = 0;
        acc += y;
      }
      for (let k = 0; k < 4; k++) {
        const buf = aps[k];
        const b = buf[aIdx[k]];
        buf[aIdx[k]] = acc + b * 0.5;
        if (++aIdx[k] >= buf.length) aIdx[k] = 0;
        acc = b - acc;
      }
      out[n] = acc;
    }
  }
  // keep a little of the dry send's stereo image in the wet signal
  for (let n = 0; n < m.len; n++) {
    m.L[n] += outs[0][n] * 0.9 + outs[1][n] * 0.1;
    m.R[n] += outs[1][n] * 0.9 + outs[0][n] * 0.1;
  }
}

// ---------------------------------------------------------------- render

export interface RenderedSong {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export function renderSong(
  events: NoteEvent[],
  sr: number,
  progress?: (p: number) => void,
  master = true,
): RenderedSong {
  const loopLen = Math.round(DURATION * sr);
  const len = loopLen + Math.round(4 * sr); // tail gets wrapped to the start for a seamless loop
  const m: Mix = {
    sr,
    len,
    L: new Float32Array(len),
    R: new Float32Array(len),
    dly: new Float32Array(len),
    rvL: new Float32Array(len),
    rvR: new Float32Array(len),
    duck: new Float32Array(len).fill(1),
    rnd: makeRng(0x5eed1993),
  };

  // sidechain: everything melodic pumps with the kick
  for (const e of events) {
    if (e.inst !== 'kick') continue;
    const n0 = Math.round(e.t * sr);
    const dl = Math.floor(0.42 * sr);
    for (let i = 0; i < dl && n0 + i < len; i++) {
      const t = i / sr;
      const g = 1 - 0.72 * Math.min(1, t / 0.004) * Math.exp(-t * 8.5);
      if (g < m.duck[n0 + i]) m.duck[n0 + i] = g;
    }
  }

  const total = events.length;
  let last = -1;
  events.forEach((e, i) => {
    switch (e.inst) {
      case 'kick': kick(m, e); break;
      case 'snare': snare(m, e); break;
      case 'clap': clap(m, e); break;
      case 'hat': hat(m, e, false); break;
      case 'ohat': hat(m, e, true); break;
      case 'crash': crash(m, e); break;
      case 'riser': riser(m, e); break;
      case 'boom': boom(m, e); break;
      case 'bass': bass(m, e); break;
      case 'acid': acid(m, e); break;
      case 'lead': lead(m, e); break;
      case 'arp': arp(m, e); break;
      case 'chip': chip(m, e); break;
      case 'pad': pad(m, e); break;
    }
    const p = Math.floor((i / total) * 80);
    if (p !== last) {
      last = p;
      progress?.(p / 100);
    }
  });

  pingPong(m);
  progress?.(0.85);
  freeverb(m);
  progress?.(0.95);

  // wrap the tail around so the loop point is seamless
  const left = new Float32Array(loopLen);
  const right = new Float32Array(loopLen);
  left.set(m.L.subarray(0, loopLen));
  right.set(m.R.subarray(0, loopLen));
  for (let n = loopLen; n < len; n++) {
    left[n - loopLen] += m.L[n];
    right[n - loopLen] += m.R[n];
  }

  // master: DC block, normalise, gentle tanh "tape" saturation
  let peak = 0;
  let dcl = 0;
  let dcr = 0;
  let pl = 0;
  let pr = 0;
  // pre-warm the DC blocker on the end of the loop so the wrap point is continuous
  for (let n = loopLen - Math.round(3 * sr); n < loopLen; n++) {
    dcl = left[n] - pl + 0.9995 * dcl;
    dcr = right[n] - pr + 0.9995 * dcr;
    pl = left[n];
    pr = right[n];
  }
  for (let n = 0; n < loopLen; n++) {
    const l = left[n];
    const r = right[n];
    dcl = l - pl + 0.9995 * dcl;
    dcr = r - pr + 0.9995 * dcr;
    pl = l;
    pr = r;
    left[n] = dcl;
    right[n] = dcr;
    peak = Math.max(peak, Math.abs(dcl), Math.abs(dcr));
  }
  const drive = master ? 1.25 / (peak || 1) : 1;
  const norm = master ? 0.96 / Math.tanh(1.25) : 1;
  for (let n = 0; n < loopLen; n++) {
    if (!master) continue;
    left[n] = Math.tanh(left[n] * drive) * norm;
    right[n] = Math.tanh(right[n] * drive) * norm;
  }
  progress?.(1);
  return { left, right, sampleRate: sr };
}
