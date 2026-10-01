// GPU compute "dot morph": the Atari/Amiga dot-ball effect, scaled up to 32k
// particles with spring physics. Targets morph between maths shapes and text.

import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  PI,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  length,
  mix,
  normalize,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { U, rainbow, type V3 } from '../shared';

export const DOT_COUNT = 32768;

export const SHAPES = {
  sphere: 0,
  torus: 1,
  cube: 2,
  knot: 3,
  wave: 4,
  textA: 5,
  textB: 6,
  helix: 7,
} as const;

function textPoints(text: string, count: number, width = 5.6): Float32Array {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 200;
  g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  size = Math.min(size, (size * 980) / g.measureText(text).width);
  g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
  g.fillText(text, 512, 128);
  const img = g.getImageData(0, 0, c.width, c.height).data;
  const px: number[] = [];
  for (let y = 0; y < c.height; y += 2)
    for (let x = 0; x < c.width; x += 2) if (img[(y * c.width + x) * 4 + 3] > 128) px.push(x, y);
  const out = new Float32Array(count * 4);
  const n = px.length / 2;
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    if (i % 3) {
      // two thirds of the dots form a halo ring so the letters don't saturate
      const a = rnd() * Math.PI * 2;
      const r = width * (0.56 + rnd() * 0.08);
      out[i * 4] = Math.cos(a) * r;
      out[i * 4 + 1] = Math.sin(a) * r * 0.55;
      out[i * 4 + 2] = -0.6 + (rnd() - 0.5) * 0.3;
      out[i * 4 + 3] = 1;
      continue;
    }
    const k = Math.floor(rnd() * n) * 2;
    const x = px[k] + rnd() * 2;
    const y = px[k + 1] + rnd() * 2;
    out[i * 4] = ((x - 512) / 1024) * width;
    out[i * 4 + 1] = (-(y - 128) / 1024) * width;
    out[i * 4 + 2] = (rnd() - 0.5) * 0.25;
    out[i * 4 + 3] = 1;
  }
  return out;
}

export class Dots {
  readonly object: THREE.Sprite;
  readonly u = {
    shapeA: uniform(0),
    shapeB: uniform(0),
    morph: uniform(0),
    impulse: uniform(0),
    stiff: uniform(30),
    damp: uniform(5),
    swirl: uniform(0),
    dt: uniform(1 / 60),
    size: uniform(0.022),
    alpha: uniform(0.4),
    scale: uniform(1),
  };
  private update: THREE.ComputeNode;
  private init: THREE.ComputeNode;
  private initialised = false;

  constructor(textA = 'WEBGPU', textB = 'TSL') {
    const N = DOT_COUNT;
    const pos = instancedArray(N, 'vec4');
    const vel = instancedArray(N, 'vec4');
    const tA = instancedArray(textPoints(textA, N), 'vec4');
    const tB = instancedArray(textPoints(textB, N, 4.2), 'vec4');
    const u = this.u;

    const shape = (k: Node<'float'>): V3 => {
      const i = instanceIndex;
      const fi = float(i);
      const u01 = fi.add(0.5).div(N);
      const r1 = hash(i);
      const out = vec3(0).toVar();
      If(k.lessThan(0.5), () => {
        // fibonacci sphere
        const y = float(1).sub(u01.mul(2));
        const r = sqrt(float(1).sub(y.mul(y)));
        const phi = fi.mul(2.39996323);
        out.assign(vec3(cos(phi).mul(r), y, sin(phi).mul(r)).mul(1.7));
      })
        .ElseIf(k.lessThan(1.5), () => {
          const a = fract(fi.div(128)).mul(PI.mul(2));
          const b = floor(fi.div(128)).div(N / 128).mul(PI.mul(2));
          const R = float(1.35).add(cos(a).mul(0.55));
          out.assign(vec3(R.mul(cos(b)), sin(a).mul(0.55), R.mul(sin(b))));
        })
        .ElseIf(k.lessThan(2.5), () => {
          const face = fi.mod(6);
          const j = floor(fi.div(6));
          const gx = j.mod(74).div(73).mul(2).sub(1);
          const gy = floor(j.div(74)).div(73).mul(2).sub(1);
          const side = float(1).sub(face.mod(2).mul(2));
          const axis = floor(face.div(2));
          const pX = vec3(side, gx, gy);
          const pY = vec3(gx, side, gy);
          const pZ = vec3(gx, gy, side);
          out.assign(mix(mix(pX, pY, axis.equal(1).select(float(1), float(0))), pZ, axis.equal(2).select(float(1), float(0))).mul(1.15));
        })
        .ElseIf(k.lessThan(3.5), () => {
          // (2,3) torus knot tube
          const s = u01.mul(PI.mul(2));
          const r = cos(s.mul(3)).add(2);
          const c = vec3(r.mul(cos(s.mul(2))), r.mul(sin(s.mul(2))), sin(s.mul(3)).negate()).mul(0.62);
          const th = r1.mul(PI.mul(2));
          const ph = hash(i.add(777)).mul(PI);
          const off = vec3(sin(ph).mul(cos(th)), sin(ph).mul(sin(th)), cos(ph)).mul(0.24);
          out.assign(c.add(off));
        })
        .ElseIf(k.lessThan(4.5), () => {
          const gx = fi.mod(181).div(180).mul(2).sub(1);
          const gz = floor(fi.div(181)).div(181).mul(2).sub(1);
          const y = sin(gx.mul(5).add(U.time.mul(3))).mul(cos(gz.mul(4).add(U.time.mul(2)))).mul(0.45);
          out.assign(vec3(gx.mul(2.6), y.add(U.kick.mul(0.3).mul(sin(gx.mul(9)))), gz.mul(2.6)));
        })
        .ElseIf(k.lessThan(5.5), () => {
          out.assign(tA.element(i).xyz);
        })
        .ElseIf(k.lessThan(6.5), () => {
          out.assign(tB.element(i).xyz);
        })
        .Else(() => {
          // double helix
          const strand = fi.mod(2);
          const s = u01.mul(PI.mul(8)).add(U.time);
          const a = s.add(strand.mul(PI));
          const y = u01.mul(4.4).sub(2.2);
          const rr = float(0.9).add(r1.mul(0.12));
          out.assign(vec3(cos(a).mul(rr), y, sin(a).mul(rr)));
        });
      return out;
    };

    this.init = Fn(() => {
      const i = instanceIndex;
      const th = hash(i).mul(PI.mul(2));
      const z = hash(i.add(99)).mul(2).sub(1);
      const r = sqrt(float(1).sub(z.mul(z)));
      pos.element(i).assign(vec4(vec3(cos(th).mul(r), z, sin(th).mul(r)).mul(12), 1));
      vel.element(i).assign(vec4(0));
    })().compute(N);

    this.update = Fn(() => {
      const i = instanceIndex;
      const p = pos.element(i);
      const v = vel.element(i);
      const target = mix(shape(u.shapeA), shape(u.shapeB), u.morph).mul(u.scale);
      const jitter = vec3(hash(i.add(1)), hash(i.add(2)), hash(i.add(3))).sub(0.5);
      let nv = v.xyz.add(target.sub(p.xyz).mul(u.stiff).mul(u.dt)).mul(exp(u.dt.mul(u.damp).negate()));
      nv = nv.add(normalize(p.xyz.add(jitter.mul(0.3))).mul(u.impulse).mul(hash(i.add(4)).add(0.35)));
      nv = nv.add(vec3(p.z.negate(), 0, p.x).mul(u.swirl).mul(u.dt));
      v.assign(vec4(nv, 0));
      p.assign(vec4(p.xyz.add(nv.mul(u.dt)), 1));
    })().compute(N);

    const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.positionNode = pos.toAttribute().xyz;
    mat.scaleNode = u.size.mul(float(1).add(U.kick.mul(0.5)));
    const hue = varying(float(instanceIndex).div(N).mul(0.7));
    const speed = varying(length(vel.toAttribute().xyz));
    mat.colorNode = Fn(() => {
      const d = uv().sub(0.5).mul(2);
      const r2 = dot(d, d);
      const a = smoothstep(1.0, 0.35, r2);
      const c = rainbow(hue.add(U.time.mul(0.12)));
      const col = c
        .mul(c)
        .mul(float(0.6).add(speed.mul(0.05)))
        .add(vec3(0.8, 0.7, 1.0).mul(smoothstep(4.0, 14.0, speed)).mul(0.5));
      return vec4(col, a.mul(u.alpha));
    })();
    this.object = new THREE.Sprite(mat);
    this.object.count = N;
    this.object.frustumCulled = false;
  }

  step(renderer: THREE.WebGPURenderer, dt: number) {
    if (!this.initialised) {
      renderer.compute(this.init);
      this.initialised = true;
    }
    this.u.dt.value = Math.min(dt, 1 / 30);
    renderer.compute(this.update);
  }
}
