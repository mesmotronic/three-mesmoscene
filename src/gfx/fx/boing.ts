// Tribute to the 1984 Amiga Boing Ball, bouncing on the kick drum,
// with a ring of shaded vector bobs orbiting it.

import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  cos,
  dot,
  float,
  floor,
  fract,
  fwidth,
  instanceIndex,
  max,
  min,
  mix,
  normalView,
  normalize,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  uv,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import { U, rainbow, type V2 } from '../shared';

const FLOOR_Y = -2.0;
const WALL_Z = -3.5;
const RADIUS = 1.05;

const gridLines = (g: V2) => {
  const w = fwidth(g);
  const l = abs(fract(g.sub(0.5)).sub(0.5)).div(w.mul(1.5));
  return float(1).sub(min(min(l.x, l.y), 1));
};

function gridMaterial(axis: 'xy' | 'xz') {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const g = (axis === 'xy' ? wp.xy : wp.xz).mul(1.15);
    const line = gridLines(g);
    const fade = axis === 'xy' ? smoothstep(6.0, -1.0, wp.y) : smoothstep(-6.0, 2.0, wp.z);
    const bg = mix(vec3(0.42, 0.42, 0.5), vec3(0.72, 0.72, 0.76), fade).add(U.kick.mul(0.06));
    const purple = mix(vec3(0.62, 0.0, 0.66), vec3(1.0, 0.3, 1.0), U.kick);
    return mix(bg, purple, line.mul(0.95));
  })();
  return mat;
}

export class Boing {
  readonly group = new THREE.Group();
  readonly camera = { pos: new THREE.Vector3(0, 0.4, 8.2), target: new THREE.Vector3(0, -0.3, -1) };
  private root = new THREE.Group();
  private spinner = new THREE.Group();
  private wallShadow: THREE.Mesh;
  private floorShadow: THREE.Mesh;
  private bobs: THREE.Sprite;
  private spin = 0;
  readonly u = { bobRadius: uniform(2.0), bobTwist: uniform(0) };

  constructor() {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(80, 30), gridMaterial('xy'));
    wall.position.set(0, FLOOR_Y + 15, WALL_Z);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), gridMaterial('xz'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, FLOOR_Y, WALL_Z + 20);
    this.group.add(wall, ground);

    const shadowMat = () =>
      new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
    this.wallShadow = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 48), shadowMat());
    this.floorShadow = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 48), shadowMat());
    this.floorShadow.rotation.x = -Math.PI / 2;
    this.group.add(this.wallShadow, this.floorShadow);

    const ballMat = new THREE.MeshBasicNodeMaterial();
    ballMat.colorNode = Fn(() => {
      const t = uv();
      const chk = floor(t.x.mul(16)).add(floor(t.y.mul(8))).mod(2);
      const base = mix(vec3(1.0, 1.0, 1.0), vec3(0.9, 0.0, 0.05), chk);
      const n = normalize(normalView);
      const l = normalize(vec3(-0.45, 0.65, 0.7));
      const diff = max(dot(n, l), 0);
      const spec = pow(max(dot(reflect(l.negate(), n), vec3(0, 0, 1)), 0), float(28));
      const rim = pow(float(1).sub(max(n.z, 0)), float(3)).mul(0.35);
      return base.mul(diff.mul(0.8).add(0.28)).add(spec.mul(0.7)).add(vec3(0.6, 0.2, 1.0).mul(rim));
    })();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 24), ballMat);
    const tilt = new THREE.Group();
    tilt.rotation.z = -0.38;
    this.spinner.add(ball);
    tilt.add(this.spinner);
    this.root.add(tilt);
    this.group.add(this.root);

    // vector bobs
    const BOBS = 56;
    const bobMat = new THREE.SpriteNodeMaterial();
    const fi = float(instanceIndex);
    const a = fi.div(BOBS).mul(Math.PI * 2);
    const tw = this.u.bobTwist;
    bobMat.positionNode = vec3(
      cos(a.add(U.time.mul(0.9))).mul(this.u.bobRadius),
      sin(a.mul(3).add(U.time.mul(1.7))).mul(0.55).add(sin(a.mul(2).add(U.time)).mul(tw)),
      sin(a.add(U.time.mul(0.9))).mul(this.u.bobRadius),
    );
    bobMat.scaleNode = float(0.32).add(U.kick.mul(0.08));
    const hue = varying(fi.div(BOBS));
    bobMat.colorNode = Fn(() => {
      const d = uv().sub(0.5).mul(2);
      const r2 = dot(d, d);
      const nz = sqrt(max(float(1).sub(r2), 0));
      const n = vec3(d.x, d.y, nz);
      const light = max(dot(n, normalize(vec3(-0.5, 0.6, 0.7))), 0);
      const col = rainbow(hue.add(U.time.mul(0.15)))
        .mul(light.mul(0.9).add(0.15))
        .add(pow(light, float(24)).mul(0.9));
      return vec4(col, step(r2, 1));
    })();
    bobMat.alphaTest = 0.5;
    this.bobs = new THREE.Sprite(bobMat);
    this.bobs.count = BOBS;
    this.bobs.frustumCulled = false;
    this.group.add(this.bobs);
  }

  /** beat: song position in beats (ball lands on every beat) */
  update(time: number, beat: number, dt: number, local: number) {
    const ph = beat - Math.floor(beat);
    const H = 2.2;
    const h = H * 4 * ph * (1 - ph);
    const period = 4 * (60 / 130) * 2; // two bars across
    const x01 = (time / period) % 2;
    const tri = x01 < 1 ? x01 : 2 - x01;
    const x = (tri * 2 - 1) * 3.4;
    const dir = x01 < 1 ? 1 : -1;
    this.spin += dir * dt * 2.8;
    const squash = Math.exp(-ph * 22) + Math.exp(-(1 - ph) * 30) * 0.5;
    const y = FLOOR_Y + RADIUS * (1 - 0.16 * squash) + h;
    this.root.position.set(x, y, 0);
    this.root.scale.set(1 + 0.1 * squash, 1 - 0.16 * squash, 1 + 0.1 * squash);
    this.spinner.rotation.y = this.spin;

    this.wallShadow.position.set(x + 0.75, y - 0.35, WALL_Z + 0.01);
    this.wallShadow.scale.copy(this.root.scale);
    const k = 1 - (h / H) * 0.55;
    this.floorShadow.position.set(x + 0.25, FLOOR_Y + 0.01, 0.15);
    this.floorShadow.scale.set(k, k * 0.55, 1);
    (this.floorShadow.material as THREE.MeshBasicNodeMaterial).opacity = 0.45 * k;

    this.bobs.position.set(x, y, 0);
    this.u.bobRadius.value = 2.0 + Math.sin(time * 1.3) * 0.25;
    this.u.bobTwist.value = Math.min(1, Math.max(0, (local - 7.4) / 3)) * 1.1;

    // camera drifts, then swings around in the second half
    const swing = Math.sin(Math.max(0, local - 7.38) * 0.45) * 0.75;
    this.camera.pos.set(Math.sin(swing) * 8.2 + Math.sin(time * 0.4) * 0.4, 0.4 + Math.sin(time * 0.6) * 0.3, Math.cos(swing) * 8.2);
    this.camera.target.set(x * 0.15, -0.1, -1);
  }
}
