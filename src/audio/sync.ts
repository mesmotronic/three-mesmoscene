// Visual-side view of the song: per-instrument event tracks with envelope helpers.

import { buildSong, type Inst, type NoteEvent } from './song';

export class Track {
  readonly times: Float64Array;
  readonly events: NoteEvent[];

  constructor(events: NoteEvent[]) {
    this.events = events;
    this.times = Float64Array.from(events.map((e) => e.t));
  }

  /** Index of the last event at or before t, or -1. */
  index(t: number): number {
    let lo = 0;
    let hi = this.times.length - 1;
    let r = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= t + 1e-6) {
        r = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return r;
  }

  since(t: number): number {
    const i = this.index(t);
    return i < 0 ? Infinity : t - this.times[i];
  }

  /** Exponential decay envelope triggered by every event, scaled by velocity. */
  env(t: number, decay: number): number {
    const i = this.index(t);
    if (i < 0) return 0;
    return Math.exp(-(t - this.times[i]) * decay) * this.events[i].vel;
  }

  last(t: number): NoteEvent | null {
    const i = this.index(t);
    return i < 0 ? null : this.events[i];
  }

  count(t: number): number {
    return this.index(t) + 1;
  }
}

const all = buildSong();
const byInst = (...names: Inst[]) => new Track(all.filter((e) => names.includes(e.inst)));

export const tracks = {
  kick: byInst('kick'),
  snare: byInst('snare', 'clap'),
  hat: byInst('hat', 'ohat'),
  crash: byInst('crash'),
  boom: byInst('boom'),
  bass: byInst('bass'),
  acid: byInst('acid'),
  lead: byInst('lead'),
  arp: byInst('arp'),
  chip: byInst('chip'),
  riser: byInst('riser'),
};
