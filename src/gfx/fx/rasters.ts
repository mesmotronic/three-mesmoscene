// Copper raster bars and the Amiga "twister" column.

import {
  Break,
  Fn,
  If,
  Loop,
  PI,
  abs,
  and,
  cos,
  float,
  floor,
  fract,
  max,
  mix,
  pow,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec4,
} from 'three/tsl';
import { U, rainbow, screenLayer, screenP } from '../shared';

/** Sine-swinging copper bars, depth sorted like the real thing. */
export function rasterBars(order = 50) {
  const u = {
    alpha: uniform(1),
    spread: uniform(0.62), // swing amplitude (screen units, height = 1)
    width: uniform(0.045),
    center: uniform(0),
    speed: uniform(1.6),
    rainbowMix: uniform(0),
  };
  const shader = Fn(() => {
    const P = screenP();
    // quantise to "scanlines" so bars have that chunky copper look
    const lines = U.res.y.div(3);
    const y = floor(P.y.mul(lines)).add(0.5).div(lines);
    const best = float(-2).toVar();
    const out = vec4(0).toVar();
    const N = 9;
    Loop(N, ({ i }) => {
      const fi = float(i);
      const ph = U.time.mul(u.speed).add(fi.mul(0.58));
      const by = sin(ph).mul(u.spread).mul(0.5).add(sin(U.time.mul(0.7).add(fi.mul(0.31))).mul(0.06)).add(u.center);
      const bz = cos(ph);
      const w = u.width.mul(float(1).add(U.kick.mul(0.35)));
      const d = abs(y.sub(by)).div(w);
      If(and(d.lessThan(1), bz.greaterThan(best)), () => {
        const shade = sqrt(float(1).sub(d.mul(d)));
        const hue = fi.div(N).add(U.time.mul(0.08).mul(u.rainbowMix));
        const c = rainbow(hue);
        const base = c.mul(c).mul(1.15);
        const depthShade = bz.mul(0.3).add(0.7);
        const col = base.mul(pow(shade, float(0.9))).mul(depthShade).add(pow(shade, float(40)).mul(0.45));
        out.assign(vec4(col, 1));
        best.assign(bz);
      });
    });
    return vec4(out.rgb, out.a.mul(u.alpha));
  });
  return { mesh: screenLayer(shader(), { order, transparent: true }), u };
}

/** A pair of twisting textured columns. */
export function twisters(order = 40) {
  const u = { alpha: uniform(1), x: uniform(0.62), w: uniform(0.085) };
  const shader = Fn(() => {
    const P = screenP();
    const side = step(0, P.x).mul(2).sub(1);
    const lx = P.x.sub(side.mul(u.x)).div(u.w);
    const ang = U.time
      .mul(1.6)
      .mul(side)
      .add(sin(P.y.mul(3.1).add(U.time.mul(1.2))).mul(1.7))
      .add(U.kick.mul(0.6));
    const out = vec4(0).toVar();
    Loop(4, ({ i }) => {
      const a0 = ang.add(float(i).mul(PI).mul(0.5));
      const x0 = sin(a0);
      const x1 = sin(a0.add(PI.mul(0.5)));
      If(and(x1.greaterThan(x0), and(lx.greaterThanEqual(x0), lx.lessThan(x1))), () => {
        const t = lx.sub(x0).div(x1.sub(x0));
        const light = x1.sub(x0).div(1.4142);
        const stripes = step(0.5, fract(P.y.mul(9).add(float(i).mul(0.25)).add(U.time.mul(0.5))));
        const base = rainbow(float(i).mul(0.25).add(U.time.mul(0.05)).add(side.mul(0.13)));
        const edge = smoothstep(0.0, 0.08, t).mul(smoothstep(1.0, 0.92, t));
        const col = base
          .mul(float(0.25).add(light.mul(0.85)))
          .mul(mix(float(0.55), float(1), stripes))
          .mul(edge)
          .add(pow(max(light, 0), float(8)).mul(0.4));
        out.assign(vec4(col, 1));
      });
    });
    return vec4(out.rgb, out.a.mul(u.alpha));
  });
  return { mesh: screenLayer(shader(), { order, transparent: true }), u };
}

/** Kefrens bars: one bar per scanline that is never cleared, so they pile into a twisting curtain. */
export function kefrens(order = 45) {
  const u = { alpha: uniform(1), x: uniform(0), width: uniform(0.05), top: uniform(0.36), lines: uniform(170) };
  const shader = Fn(() => {
    const P = screenP();
    const line = floor(float(0.5).sub(P.y).mul(u.lines));
    const topLine = float(0.5).sub(u.top).mul(u.lines);
    const out = vec4(0).toVar();
    Loop(120, ({ i }) => {
      const L = line.sub(float(i));
      If(L.lessThan(topLine), () => {
        Break();
      });
      const bx = sin(L.mul(0.045).add(U.time.mul(2.1)))
        .mul(0.32)
        .add(sin(L.mul(0.019).sub(U.time.mul(1.25))).mul(0.22))
        .mul(U.viewAspect.mul(0.5))
        .add(u.x);
      const d = P.x.sub(bx).div(u.width.mul(float(1).add(U.kick.mul(0.3))));
      If(abs(d).lessThan(1), () => {
        const shade = sqrt(float(1).sub(d.mul(d)));
        const c = rainbow(L.mul(0.012).add(U.time.mul(0.15)));
        out.assign(vec4(c.mul(c).mul(shade).mul(1.25).add(pow(shade, float(30)).mul(0.5)), 1));
        Break();
      });
    });
    return vec4(out.rgb, out.a.mul(u.alpha));
  });
  return { mesh: screenLayer(shader(), { order, transparent: true }), u };
}
