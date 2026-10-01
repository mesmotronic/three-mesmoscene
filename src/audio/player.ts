import { DURATION } from './song';

export interface RenderedAudio {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

export function renderInWorker(onProgress: (p: number) => void): Promise<RenderedAudio> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data.p);
      else if (e.data.type === 'done') {
        worker.terminate();
        resolve(e.data as RenderedAudio);
      }
    };
    worker.onerror = (e) => reject(e);
    worker.postMessage('go');
  });
}

/** Plays the pre-rendered loop and exposes a sample-accurate song clock. */
export class Player {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private buffer: AudioBuffer;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  readonly freq: Uint8Array<ArrayBuffer>;

  constructor(audio: RenderedAudio) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.buffer = this.ctx.createBuffer(2, audio.left.length, audio.sampleRate);
    this.buffer.copyToChannel(audio.left as Float32Array<ArrayBuffer>, 0);
    this.buffer.copyToChannel(audio.right as Float32Array<ArrayBuffer>, 1);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.55;
    this.analyser.connect(this.ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
  }

  async start(offset = 0) {
    await this.ctx.resume();
    this.source?.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.analyser);
    this.offset = ((offset % DURATION) + DURATION) % DURATION;
    this.startedAt = this.ctx.currentTime + 0.06;
    src.start(this.startedAt, this.offset);
    this.source = src;
  }

  /** Song position (seconds) of the sample currently leaving the speakers. */
  time(): number {
    const ctx = this.ctx;
    let now: number;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      now = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    } else {
      now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    }
    const t = now - this.startedAt + this.offset;
    return t < this.offset ? this.offset : ((t % DURATION) + DURATION) % DURATION;
  }

  spectrum(): Uint8Array {
    this.analyser.getByteFrequencyData(this.freq);
    return this.freq;
  }
}
