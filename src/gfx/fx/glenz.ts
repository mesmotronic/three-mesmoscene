// Glenz vectors: see-through, two-tone faceted solids, nested and spinning.

import * as THREE from 'three/webgpu';
import { Fn, abs, attribute, dot, float, frontFacing, mix, normalView, normalize, select, uniform, vec3 } from 'three/tsl';
import { U } from '../shared';

/** Raise a pyramid on every face (the classic glenz "star"). */
function stellate(src: THREE.BufferGeometry, height: number): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src;
  const p = g.getAttribute('position');
  const out: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
    const edge = a.distanceTo(b);
    const apex = a.clone().add(b).add(c).divideScalar(3).addScaledVector(n, edge * height);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) out.push(u.x, u.y, u.z, v.x, v.y, v.z, apex.x, apex.y, apex.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return geo;
}

function withFaceIds(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src;
  const count = g.getAttribute('position').count;
  const ids = new Float32Array(count);
  for (let i = 0; i < count; i++) ids[i] = Math.floor(i / 3);
  g.setAttribute('faceId', new THREE.BufferAttribute(ids, 1));
  g.computeVertexNormals();
  return g;
}

const rgb = (hex: number) => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};

function glenzMaterial(colA: number, colB: number) {
  const u = { a: uniform(rgb(colA)), b: uniform(rgb(colB)), intensity: uniform(0.32) };
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  mat.colorNode = Fn(() => {
    const parity = attribute('faceId', 'float').mod(2);
    const base = mix(u.a, u.b, parity);
    const n = normalize(normalView);
    const light = abs(dot(n, normalize(vec3(0.35, 0.55, 1.0))));
    const facing = select(frontFacing, float(1.0), float(0.38));
    return base.mul(light.mul(0.75).add(0.25)).mul(facing).mul(u.intensity.add(U.kick.mul(0.12)));
  })();
  return { mat, u };
}

export class Glenz {
  readonly group = new THREE.Group();
  readonly camera = { pos: new THREE.Vector3(0, 0, 7), target: new THREE.Vector3(0, 0, 0) };
  private outer: THREE.Object3D;
  private inner: THREE.Object3D;
  private sats: THREE.Object3D[] = [];
  private mats: ReturnType<typeof glenzMaterial>[] = [];

  constructor() {
    const make = (geo: THREE.BufferGeometry, a: number, b: number, edges = true) => {
      const g = withFaceIds(geo);
      const m = glenzMaterial(a, b);
      this.mats.push(m);
      const obj = new THREE.Group();
      obj.add(new THREE.Mesh(g, m.mat));
      if (edges) {
        const lines = new THREE.LineSegments(
          new THREE.EdgesGeometry(g, 1),
          new THREE.LineBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        obj.add(lines);
      }
      return obj;
    };
    this.outer = make(stellate(new THREE.OctahedronGeometry(1.35, 0), 1.0), 0xffffff, 0x2266ff);
    this.inner = make(stellate(new THREE.IcosahedronGeometry(0.62, 0), 0.5), 0xff3399, 0xffcc22);
    this.group.add(this.outer, this.inner);
    for (let i = 0; i < 4; i++) {
      const s = make(stellate(new THREE.TetrahedronGeometry(0.42, 0), 0.9), 0x22ffcc, 0xaa33ff, false);
      this.sats.push(s);
      this.group.add(s);
    }
  }

  update(time: number, local: number, kick: number, lead: number) {
    const k = 1 + kick * 0.12;
    this.outer.rotation.set(time * 0.7, time * 0.9 + lead * 0.2, time * 0.35);
    this.outer.scale.setScalar(1.15 * k);
    this.inner.rotation.set(-time * 1.3, time * 0.5, -time * 0.9);
    this.inner.scale.setScalar(1 + kick * 0.25);
    const satOn = Math.min(1, Math.max(0, (local - 7.38) / 1.5));
    this.sats.forEach((s, i) => {
      const a = time * 1.1 + (i * Math.PI) / 2;
      const r = 3.0 * satOn;
      s.visible = satOn > 0;
      s.position.set(Math.cos(a) * r, Math.sin(a * 2) * 0.8, Math.sin(a) * r);
      s.rotation.set(time * 2 + i, time * 1.7, 0);
      s.scale.setScalar(satOn * (1 + kick * 0.3));
    });
    // swap the two-tone palette every two bars
    const swap = Math.floor(local / 3.69) % 2;
    this.mats[0].u.b.value.copy(rgb(swap ? 0xff2266 : 0x2266ff));
    this.group.position.y = Math.sin(time * 1.1) * 0.25;
    this.camera.pos.set(Math.sin(time * 0.2) * 1.5, Math.cos(time * 0.27) * 0.8, 7 - kick * 0.25);
  }
}
