// Raymarched set pieces: a twisting neon tunnel and chrome metaballs.

import * as THREE from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  PI,
  abs,
  atan,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  normalize,
  or,
  pow,
  reflect,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { U, neon, rainbow, rot2, screenLayer, screenP, type V3 } from '../shared';

const tunnelPath = (z: Node<'float'>) =>
  vec2(sin(z.mul(0.21)).mul(1.6).add(sin(z.mul(0.071)).mul(1.2)), cos(z.mul(0.17)).mul(1.2));

export function tunnel(order = -100) {
  const u = { travel: uniform(0), alpha: uniform(1), square: uniform(0), ring: uniform(0) };
  const shader = Fn(() => {
    const p = screenP().mul(2);
    const T = u.travel;
    const ro = vec3(tunnelPath(T), T);
    const ta = vec3(tunnelPath(T.add(1.5)), T.add(1.5));
    const fwd = normalize(ta.sub(ro));
    const roll = sin(T.mul(0.13)).mul(0.7).add(U.kick.mul(0.04));
    const right = normalize(cross(fwd, vec3(sin(roll), cos(roll), 0)));
    const up = cross(right, fwd);
    const rd = normalize(fwd.mul(1.25).add(right.mul(p.x)).add(up.mul(p.y)));

    const t = float(0.1).toVar();
    const R = 2.2;
    Loop(96, () => {
      const pos = ro.add(rd.mul(t));
      const q = rot2(pos.xy.sub(tunnelPath(pos.z)), pos.z.mul(0.12).add(U.time.mul(0.2)));
      const r = mix(length(q), max(abs(q.x), abs(q.y)), u.square);
      const d = float(R).sub(r);
      t.addAssign(d.mul(0.55));
      If(or(d.lessThan(0.002), t.greaterThan(48)), () => {
        Break();
      });
    });

    const pos = ro.add(rd.mul(t));
    const q = rot2(pos.xy.sub(tunnelPath(pos.z)), pos.z.mul(0.12).add(U.time.mul(0.2)));
    const ang = atan(q.y, q.x).div(PI);
    const tc = vec2(ang.mul(6), pos.z.mul(0.5));
    const cell = floor(tc);
    const f = fract(tc);
    const chk = abs(cell.x.add(cell.y)).mod(2);
    const edge = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus()));
    const lines = smoothstep(0.09, 0.0, edge);
    const hue = cell.y.mul(0.045).add(U.time.mul(0.08));
    const tile = mix(vec3(0.03, 0.01, 0.08), neon(hue).mul(0.4), chk);
    const lineCol = rainbow(hue.add(0.5)).mul(float(0.7).add(U.kick.mul(1.6)));
    // light rings racing toward the camera on every beat
    const ringPos = fract(pos.z.mul(0.0625).sub(U.beat.mul(0.25)));
    const ring = smoothstep(0.06, 0.0, abs(ringPos.sub(0.5))).mul(float(0.4).add(U.snare.mul(1.5)).add(u.ring));
    let col = tile.add(lineCol.mul(lines)).add(vec3(1.0, 0.55, 0.95).mul(ring));
    const fog = exp(t.mul(-0.065));
    const fogCol = vec3(0.12, 0.02, 0.2).add(neon(U.time.mul(0.05)).mul(0.08));
    col = mix(fogCol, col, fog);
    // hot core at the vanishing point
    col = col.add(vec3(0.9, 0.5, 1.0).mul(float(0.02).div(length(p.mul(0.6)).add(0.04))).mul(fog.oneMinus()));
    return col.mul(u.alpha);
  });
  return { mesh: screenLayer(shader(), { order }), u };
}

const smin = (a: Node<'float'>, b: Node<'float'>, k: number) => {
  const h = max(float(k).sub(abs(a.sub(b))), 0).div(k);
  return min(a, b).sub(h.mul(h).mul(k * 0.25));
};

/** Environment the chrome reflects: raster-bar sky over a checkerboard floor. */
const env = (d: V3): V3 => {
  const y = d.y;
  const sky = mix(vec3(0.2, 0.08, 0.4), vec3(0.35, 0.6, 1.0), smoothstep(-0.05, 0.9, y));
  const bands = pow(sin(y.mul(15).add(U.time.mul(2.5))).mul(0.5).add(0.5), float(6));
  const strip = smoothstep(0.04, 0.0, abs(y.sub(0.55))).mul(1.6);
  const skyCol = sky.add(rainbow(y.mul(0.8).add(U.time.mul(0.1))).mul(bands).mul(1.5)).add(strip);
  const fl = d.xz.div(max(y.negate(), 0.04)).mul(0.6).add(vec2(0, U.time.mul(1.5)));
  const chk = abs(floor(fl.x).add(floor(fl.y))).mod(2);
  const floorCol = mix(vec3(0.12, 0.02, 0.25), vec3(1.0, 0.3, 0.75), chk).mul(smoothstep(0.0, -0.25, y));
  const horizon = vec3(1.0, 0.55, 0.2).mul(smoothstep(0.12, 0.0, abs(y)));
  return mix(skyCol, floorCol, step(y, 0)).add(horizon);
};

export function metaballs(order = -100) {
  const N = 7;
  const centers = Array.from({ length: N }, () => uniform(new THREE.Vector3()));
  const u = { alpha: uniform(1), radius: uniform(0.62), camAngle: uniform(0), camDist: uniform(4.3) };

  const sdf = (p: V3): Node<'float'> => {
    let d: Node<'float'> = length(p.sub(centers[0])).sub(u.radius);
    for (let i = 1; i < N; i++) d = smin(d, length(p.sub(centers[i])).sub(u.radius.mul(1 - i * 0.05)), 0.75);
    return d;
  };

  const shader = Fn(() => {
    const p = screenP().mul(2);
    const a = u.camAngle;
    const ro = vec3(sin(a).mul(u.camDist), sin(U.time.mul(0.3)).mul(0.9), cos(a).mul(u.camDist));
    const fwd = normalize(ro.negate());
    const right = normalize(cross(fwd, vec3(0, 1, 0)));
    const up = cross(right, fwd);
    const rd = normalize(fwd.mul(1.7).add(right.mul(p.x)).add(up.mul(p.y)));

    const t = float(0).toVar();
    const hit = float(0).toVar();
    Loop(80, () => {
      const d = sdf(ro.add(rd.mul(t)));
      If(d.lessThan(0.0015), () => {
        hit.assign(1);
        Break();
      });
      t.addAssign(d);
      If(t.greaterThan(12), () => {
        Break();
      });
    });

    const bg = env(rd).mul(0.38).mul(smoothstep(1.6, 0.3, length(p)));
    const col = bg.toVar();
    If(hit.greaterThan(0.5), () => {
      const pos = ro.add(rd.mul(t));
      const e = 0.002;
      const k1 = vec3(1, -1, -1);
      const k2 = vec3(-1, -1, 1);
      const k3 = vec3(-1, 1, -1);
      const k4 = vec3(1, 1, 1);
      const n = normalize(
        k1
          .mul(sdf(pos.add(k1.mul(e))))
          .add(k2.mul(sdf(pos.add(k2.mul(e)))))
          .add(k3.mul(sdf(pos.add(k3.mul(e)))))
          .add(k4.mul(sdf(pos.add(k4.mul(e))))),
      );
      const r = reflect(rd, n);
      const fres = pow(float(1).sub(max(dot(n, rd.negate()), 0)), float(3));
      const tint = mix(vec3(1.0, 1.0, 1.0), rainbow(pos.y.mul(0.4).add(U.time.mul(0.15))), 0.25);
      const spec = pow(max(dot(r, normalize(vec3(0.5, 0.8, 0.4))), 0), float(40));
      col.assign(
        env(r)
          .mul(tint)
          .mul(float(0.55).add(fres.mul(0.6)))
          .add(spec.mul(1.5))
          .add(U.kick.mul(0.12)),
      );
    });
    return col.mul(u.alpha);
  });

  const update = (time: number, kick: number) => {
    for (let i = 0; i < N; i++) {
      const s = 0.6 + i * 0.13;
      centers[i].value.set(
        Math.sin(time * s * 0.9 + i * 1.7) * 1.0,
        Math.cos(time * s * 0.7 + i * 2.3) * 0.7,
        Math.sin(time * s * 0.6 + i * 0.9) * 0.8,
      );
    }
    u.radius.value = 0.6 + kick * 0.14;
  };

  return { mesh: screenLayer(shader(), { order }), u, update };
}
