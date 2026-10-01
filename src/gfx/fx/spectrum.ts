// Tracker-style LED spectrum analyser fed by the WebAudio AnalyserNode.

import * as THREE from 'three/webgpu';
import { Fn, abs, float, floor, fract, max, mix, smoothstep, step, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { screenLayer, screenP } from '../shared';

const BARS = 40;

export class Spectrum {
  readonly mesh: THREE.Mesh;
  readonly u = { alpha: uniform(1), y: uniform(-0.44), h: uniform(0.13), w: uniform(0.9) };
  private data = new Uint8Array(BARS * 4);
  private levels = new Float32Array(BARS);
  private peaks = new Float32Array(BARS);
  private tex: THREE.DataTexture;

  constructor() {
    this.tex = new THREE.DataTexture(this.data, BARS, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const u = this.u;
    const tex = this.tex;
    const shader = Fn(() => {
      const P = screenP();
      const lx = P.x.div(u.w).add(0.5);
      const ly = P.y.sub(u.y).div(u.h);
      const inside = step(0, lx).mul(step(lx, 1)).mul(step(0, ly)).mul(step(ly, 1));
      const bar = floor(lx.mul(BARS));
      const fx = fract(lx.mul(BARS));
      const s = texture(tex, vec2(bar.add(0.5).div(BARS), 0.5));
      const SEG = 14;
      const seg = floor(ly.mul(SEG)).add(0.5).div(SEG);
      const gapY = step(0.22, fract(ly.mul(SEG)));
      const gapX = step(0.12, fx).mul(step(fx, 0.88));
      const lit = step(seg, s.r);
      const peak = step(abs(seg.sub(s.g)), 0.5 / SEG);
      const col = mix(vec3(0.1, 1.0, 0.25), vec3(1.0, 0.9, 0.1), smoothstep(0.45, 0.7, seg));
      const col2 = mix(col, vec3(1.0, 0.15, 0.1), smoothstep(0.75, 0.9, seg));
      const on = max(lit, peak);
      const a = on.mul(0.95).add(float(0.1)).mul(gapX).mul(gapY).mul(inside).mul(u.alpha);
      return vec4(col2.mul(on.mul(0.85).add(0.15)), a);
    });
    this.mesh = screenLayer(shader(), { order: 120, transparent: true });
  }

  /** Feed with byte frequency data (or null to synthesise from envelopes). */
  update(freq: Uint8Array | null, fallback: number[], dt: number) {
    for (let i = 0; i < BARS; i++) {
      let v: number;
      if (freq && freq.length) {
        // log-ish frequency mapping
        const f0 = Math.floor(Math.pow(freq.length * 0.7, i / BARS));
        const f1 = Math.max(f0 + 1, Math.floor(Math.pow(freq.length * 0.7, (i + 1) / BARS)));
        let m = 0;
        for (let k = f0; k < f1 && k < freq.length; k++) m = Math.max(m, freq[k]);
        v = Math.pow(m / 255, 1.6) * 1.15;
      } else {
        const band = fallback[Math.min(fallback.length - 1, Math.floor((i / BARS) * fallback.length))];
        v = band * (0.75 + 0.25 * Math.sin(i * 1.7 + performance.now() * 0.01));
      }
      this.levels[i] = Math.max(v, this.levels[i] - dt * 2.5);
      this.peaks[i] = Math.max(this.levels[i], this.peaks[i] - dt * 0.35);
      this.data[i * 4] = Math.min(255, this.levels[i] * 255);
      this.data[i * 4 + 1] = Math.min(255, this.peaks[i] * 255);
    }
    this.tex.needsUpdate = true;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }
}
