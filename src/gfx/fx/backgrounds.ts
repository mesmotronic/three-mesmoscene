// Full-screen oldskool backgrounds: starfield, plasma, XOR rotozoomer.

import {
  Fn,
  Loop,
  abs,
  cos,
  float,
  floor,
  fract,
  int,
  length,
  mix,
  normalize,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { U, copper, hash12, neon, rainbow, rot2, screenLayer, screenP } from '../shared';

export function starfield(order = -100) {
  const u = { travel: uniform(0), alpha: uniform(1), spin: uniform(0), warp: uniform(0) };
  const shader = Fn(() => {
    const p = rot2(screenP(), u.spin).toVar();
    const col = vec3(0).toVar();
    const LAYERS = 8;
    Loop(LAYERS, ({ i }) => {
      const fi = float(i);
      const depth = fract(fi.div(LAYERS).add(u.travel));
      const scale = mix(float(42), float(0.9), depth);
      const fade = smoothstep(0.0, 0.5, depth).mul(smoothstep(1.0, 0.88, depth));
      const q = p.mul(scale).add(vec2(fi.mul(13.17), fi.mul(7.31)));
      const id = floor(q);
      const f = fract(q).sub(0.5);
      const h = hash12(id.add(fi.mul(3.1)));
      const off = vec2(hash12(id.add(1.7)), hash12(id.add(9.2))).sub(0.5).mul(0.6);
      // stretch stars radially when warping
      const dir = normalize(id.add(0.5).add(0.0001));
      const rel = f.sub(off);
      const along = rel.x.mul(dir.x).add(rel.y.mul(dir.y));
      const across = rel.x.mul(dir.y).sub(rel.y.mul(dir.x));
      const d = length(vec2(along.div(float(1).add(u.warp.mul(depth).mul(6))), across));
      const r = mix(float(0.025), float(0.09), h);
      const star = smoothstep(r, float(0), d).mul(step(0.62, h));
      const tint = mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.85, 0.65), hash12(id.add(5.5)));
      col.addAssign(tint.mul(star).mul(fade).mul(2.2));
    });
    // faint nebula glow
    const neb = smoothstep(1.2, 0.0, length(p.mul(vec2(0.7, 1.3)))).mul(0.08);
    return col.add(vec3(0.25, 0.05, 0.35).mul(neb)).mul(u.alpha);
  });
  return { mesh: screenLayer(shader(), { order }), u };
}

export function plasma(order = -100) {
  const u = { alpha: uniform(1), copperMix: uniform(0), bands: uniform(10), zoom: uniform(3.2) };
  const shader = Fn(() => {
    const p = screenP().mul(u.zoom);
    const t = U.time.mul(0.9);
    const c1 = vec2(sin(t.mul(0.5)).mul(2.0), cos(t.mul(0.33)).mul(1.4));
    const c2 = vec2(sin(t.mul(0.27)).mul(-2.4), cos(t.mul(0.41)).mul(1.1));
    const v = sin(p.x.mul(1.3).add(t))
      .add(sin(p.y.mul(1.7).sub(t.mul(1.3))))
      .add(sin(p.x.add(p.y).mul(1.1).add(t.mul(0.7))))
      .add(sin(length(p.sub(c1)).mul(2.2).sub(t.mul(1.5))))
      .add(sin(length(p.sub(c2)).mul(1.6).add(t)));
    // posterise into palette bands like an 8-bit palette-cycling plasma
    const vb = floor(v.mul(u.bands)).div(u.bands);
    const hue = vb.mul(0.11).add(U.time.mul(0.08));
    const base = mix(rainbow(hue), copper(hue.mul(1.7)), u.copperMix);
    const bright = float(0.5).add(U.kick.mul(0.35)).add(U.snare.mul(0.15));
    // scanline-ish dither between bands
    return base.mul(bright).mul(u.alpha);
  });
  return { mesh: screenLayer(shader(), { order }), u };
}

export function rotozoom(order = -100) {
  const u = { alpha: uniform(1) };
  const shader = Fn(() => {
    const p = screenP();
    const t = U.time;
    const a = t.mul(0.35).add(sin(t.mul(0.21)).mul(1.4));
    const z = float(2.4).add(sin(t.mul(0.43)).mul(1.5)).add(U.kick.mul(0.25));
    const q = rot2(p, a).mul(z).add(vec2(t.mul(0.6), t.mul(0.37)));
    // the classic XOR texture
    const ix = int(floor(q.x.mul(32)));
    const iy = int(floor(q.y.mul(32)));
    const x = float(ix.bitXor(iy).bitAnd(int(63))).div(63);
    const cell = floor(q.mul(2));
    const chk = abs(cell.x.add(cell.y)).mod(2);
    const hue = x.mul(0.6).add(t.mul(0.1)).add(chk.mul(0.25));
    const col = mix(neon(hue), copper(x), chk).mul(x.mul(0.7).add(0.3));
    return col.mul(0.42).mul(u.alpha);
  });
  return { mesh: screenLayer(shader(), { order }), u };
}
