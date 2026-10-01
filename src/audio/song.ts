// The song: arrangement + note data. Shared by the synth (worker) and the visuals,
// so every flash, bounce and cut lands exactly on the music.

export const BPM = 130;
export const BEAT = 60 / BPM;
export const STEP = BEAT / 4; // one 16th note / tracker row
export const BAR = BEAT * 4;
export const BARS = 56;
export const DURATION = BARS * BAR; // ~103s, loops seamlessly
export const SAMPLE_RATE = 44100;

export type Inst =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'ohat'
  | 'crash'
  | 'riser'
  | 'boom'
  | 'bass'
  | 'acid'
  | 'lead'
  | 'arp'
  | 'chip'
  | 'pad';

export interface NoteEvent {
  t: number; // seconds
  inst: Inst;
  note: number; // MIDI note
  dur: number; // seconds
  vel: number; // 0..1
  notes?: number[]; // chip chord arpeggio (Amiga 0xy effect)
  acc?: number; // accent (acid)
}

export interface Section {
  name: string;
  bar: number;
  bars: number;
}

export const SECTIONS: Section[] = [
  { name: 'intro', bar: 0, bars: 8 },
  { name: 'plasma', bar: 8, bars: 8 },
  { name: 'boing', bar: 16, bars: 8 },
  { name: 'tunnel', bar: 24, bars: 8 },
  { name: 'glenz', bar: 32, bars: 8 },
  { name: 'metaballs', bar: 40, bars: 8 },
  { name: 'outro', bar: 48, bars: 8 },
];

type ChordName = 'Am' | 'F' | 'C' | 'G' | 'E';

const CHORDS: Record<ChordName, { root: number; pad: number[]; arp: number[] }> = {
  Am: { root: 33, pad: [57, 60, 64], arp: [69, 72, 76, 81] },
  F: { root: 29, pad: [57, 60, 65], arp: [65, 69, 72, 77] },
  C: { root: 36, pad: [55, 60, 64], arp: [67, 72, 76, 79] },
  G: { root: 31, pad: [55, 59, 62], arp: [67, 71, 74, 79] },
  E: { root: 28, pad: [56, 59, 64], arp: [68, 71, 76, 80] },
};

const P1: ChordName[] = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G'];

export const PROGRESSION: ChordName[] = [
  ...P1, // intro
  ...P1, // plasma
  ...P1, // boing
  'F', 'G', 'Am', 'Am', 'F', 'G', 'E', 'E', // breakdown / tunnel
  ...P1, // glenz
  'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E', // climax / metaballs
  ...P1, // outro
];

// [step, note, lengthInSteps]
const MELODY: [number, number, number][][] = [
  [[0, 76, 3], [3, 76, 3], [6, 81, 2], [8, 79, 3], [11, 76, 3], [14, 74, 2]],
  [[0, 72, 3], [3, 72, 3], [6, 77, 2], [8, 76, 3], [11, 72, 3], [14, 69, 2]],
  [[0, 72, 3], [3, 76, 3], [6, 79, 2], [8, 84, 4], [12, 83, 2], [14, 79, 2]],
  [[0, 79, 3], [3, 74, 3], [6, 71, 2], [8, 74, 6], [14, 76, 2]],
  [[0, 76, 3], [3, 76, 3], [6, 81, 2], [8, 79, 3], [11, 76, 3], [14, 74, 2]],
  [[0, 72, 3], [3, 72, 3], [6, 77, 2], [8, 81, 3], [11, 79, 3], [14, 77, 2]],
  [[0, 76, 3], [3, 79, 3], [6, 84, 2], [8, 83, 3], [11, 79, 3], [14, 76, 2]],
  [[0, 79, 4], [4, 74, 4], [8, 71, 2], [10, 74, 2], [12, 79, 4]],
];
const MELODY_E: [number, number, number][] = [[0, 80, 4], [4, 76, 4], [8, 71, 2], [10, 76, 2], [12, 80, 4]];

// [step, semitone offset, accent]
const ACID: [number, number, number][] = [
  [0, 0, 1], [1, 12, 0], [2, 0, 0], [3, 0, 1], [4, 15, 0], [5, 0, 0], [6, 12, 1], [7, 0, 0],
  [8, 0, 0], [9, 7, 1], [10, 0, 0], [11, 12, 0], [12, 0, 1], [13, 3, 0], [14, 12, 0], [15, 10, 1],
];

const ARP_ORDER = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 2, 1, 0];

const within = (bar: number, ...ranges: [number, number][]) => ranges.some(([a, z]) => bar >= a && bar <= z);

export function buildSong(): NoteEvent[] {
  const ev: NoteEvent[] = [];
  const at = (bar: number, step = 0) => (bar * 16 + step) * STEP;
  const add = (inst: Inst, bar: number, step: number, note = 0, steps = 1, vel = 1, extra: Partial<NoteEvent> = {}) =>
    ev.push({ t: at(bar, step), inst, note, dur: steps * STEP, vel, ...extra });

  for (let bar = 0; bar < BARS; bar++) {
    const name = PROGRESSION[bar];
    const ch = CHORDS[name];
    const phrase = bar % 8;

    // --- PAD: always there, the glue
    const padVel = within(bar, [0, 7], [24, 31], [48, 55]) ? 0.9 : 0.55;
    for (const n of ch.pad) add('pad', bar, 0, n, 16, padVel);

    // --- KICK
    const fullKick = within(bar, [8, 22], [28, 30], [32, 46], [48, 51]);
    if (fullKick) for (let b = 0; b < 4; b++) add('kick', bar, b * 4);
    if (bar === 23 || bar === 47) for (let b = 0; b < 2; b++) add('kick', bar, b * 4);
    if (bar === 4) add('kick', bar, 0);

    // --- CLAP on 2 & 4
    if (within(bar, [12, 22], [32, 46], [48, 51]) && bar !== 15) {
      add('clap', bar, 4, 0, 1, 0.9);
      add('clap', bar, 12, 0, 1, 0.9);
    }
    if (bar === 15 || bar === 39) {
      add('clap', bar, 4, 0, 1, 0.9);
      for (let s = 12; s < 16; s++) add('snare', bar, s, 0, 1, 0.5 + (s - 12) * 0.15);
    }

    // --- SNARE ROLLS into drops
    if (bar === 7 || bar === 23 || bar === 47)
      for (let s = 8; s < 16; s++) add('snare', bar, s, 0, 1, 0.3 + (s - 8) * 0.1);
    if (bar === 30) for (let s = 0; s < 16; s += 2) add('snare', bar, s, 0, 1, 0.3 + s * 0.015);
    if (bar === 31) {
      for (let s = 0; s < 12; s++) add('snare', bar, s, 0, 1, 0.5 + s * 0.02);
      for (let k = 0; k < 8; k++) add('snare', bar, 12 + k * 0.5, 0, 1, 0.75 + k * 0.035);
    }

    // --- HATS
    const busyHats = within(bar, [8, 23], [28, 31], [32, 47], [48, 51]);
    const openHats = within(bar, [16, 23], [32, 47], [48, 51]);
    for (let s = 0; s < 16; s++) {
      const off = s % 4 === 2;
      if (openHats && off) {
        add('ohat', bar, s, 0, 1, 0.55);
        continue;
      }
      if (busyHats) add('hat', bar, s, 0, 1, [0.6, 0.3, 0.75, 0.35][s % 4]);
      else if (within(bar, [4, 7], [52, 53]) && s % 2 === 0) add('hat', bar, s, 0, 1, s % 4 === 2 ? 0.5 : 0.25);
    }

    // --- CRASH / BOOM / RISERS
    if ([4, 8, 16, 24, 32, 40, 48].includes(bar)) add('crash', bar, 0, 0, 1, bar === 24 ? 0.7 : 1);
    if ([4, 8, 24, 32, 40].includes(bar)) add('boom', bar, 0, 0, 1, 1);
    if (bar === 6) add('riser', bar, 0, 0, 32, 1);
    if (bar === 15 || bar === 23 || bar === 39 || bar === 47) add('riser', bar, 0, 0, 16, 0.8);
    if (bar === 29) add('riser', bar, 0, 0, 48, 1);

    // --- BASS (offbeat rave bass)
    if (within(bar, [8, 23], [32, 47], [48, 51])) {
      const r = ch.root + 12;
      if (bar < 12) {
        for (const s of [2, 6, 10, 14]) add('bass', bar, s, r, 2, 0.85);
      } else {
        const pat: [number, number, number][] = [[2, 0, 2], [6, 0, 2], [7, 12, 1], [10, 0, 2], [14, 0, 1], [15, 12, 1]];
        for (const [s, o, l] of pat) add('bass', bar, s, r + o, l, o ? 0.75 : 0.95);
      }
    }
    if (bar === 23 || bar === 47) {
      // let the roll breathe: no bass in the second half
      for (let i = ev.length - 1; i >= 0; i--)
        if (ev[i].inst === 'bass' && ev[i].t >= at(bar, 8)) ev.splice(i, 1);
    }

    // --- ACID (climax)
    if (within(bar, [40, 47])) {
      for (const [s, o, a] of ACID) {
        if (bar === 47 && s >= 8) break;
        add('acid', bar, s, ch.root + 24 + o, 1, 0.8, { acc: a });
      }
    }

    // --- LEAD (supersaw hook)
    if (within(bar, [16, 23], [32, 47])) {
      const mel = name === 'E' ? MELODY_E : MELODY[phrase];
      const octave = within(bar, [40, 47]) ? 12 : 0;
      for (const [s, n, l] of mel) add('lead', bar, s, n + octave, l, bar >= 40 ? 0.85 : 0.8);
    }

    // --- ARP (16th pluck)
    if (within(bar, [0, 23], [32, 47], [48, 55])) {
      const vel = within(bar, [52, 55]) ? 0.7 - (bar - 52) * 0.12 : 0.85;
      for (let s = 0; s < 16; s++) add('arp', bar, s, ch.arp[ARP_ORDER[s] % 4], 1, vel);
    }

    // --- CHIP (Amiga tracker arpeggio chords + chip lead)
    if (within(bar, [4, 7], [24, 31])) {
      const notes = ch.pad.map((n) => n + 12);
      const rhythm = bar < 8 ? [0, 3, 6, 8, 11, 14] : [0, 2, 4, 6, 8, 10, 12, 14];
      for (const s of rhythm) add('chip', bar, s, notes[0], 2, 0.75, { notes });
    }
    if (within(bar, [48, 55])) {
      const mel = name === 'E' ? MELODY_E : MELODY[phrase];
      for (const [s, n, l] of mel) add('chip', bar, s, n, l, 0.65);
    }
    if (within(bar, [26, 31])) {
      // slow chip melody over the breakdown
      const mel = MELODY[(bar - 24) % 8];
      for (const [s, n, l] of mel) if (s % 8 === 0) add('chip', bar, s, n + 12, Math.max(l, 6), 0.45);
    }
  }

  ev.sort((a, b) => a.t - b.t);
  return ev;
}
