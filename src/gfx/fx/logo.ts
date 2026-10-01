// The group logo: chrome-gradient letters with outline + drop shadow,
// per-scanline raster wobble and a glint sweeping across.

import * as THREE from 'three/webgpu';
import { Fn, abs, floor, max, mix, sin, smoothstep, step, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { U, screenLayer, screenP } from '../shared';

function buildLogo(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'lighter';
  let size = 300;
  const font = (s: number) => `italic 900 ${s}px "Arial Black", Impact, "Helvetica Neue", sans-serif`;
  g.font = font(size);
  const w = g.measureText(text).width;
  size = Math.min(size, (size * 1840) / w);
  g.font = font(size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const x = c.width / 2;
  const y = c.height / 2 + size * 0.04;
  const pass = (color: string, dx: number, dy: number, stroke: number) => {
    g.fillStyle = color;
    g.strokeStyle = color;
    if (stroke) {
      g.lineWidth = stroke;
      g.strokeText(text, x + dx, y + dy);
    }
    g.fillText(text, x + dx, y + dy);
  };
  pass('#0000ff', 18, 18, 30);
  pass('#00ff00', 0, 0, 30);
  pass('#ff0000', 0, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export class Logo {
  readonly mesh: THREE.Mesh;
  readonly u = {
    x: uniform(0),
    y: uniform(0.28),
    w: uniform(1.4), // width in screen-height units
    sx: uniform(1),
    sy: uniform(1),
    wobble: uniform(0.02),
    wobFreq: uniform(18),
    alpha: uniform(1),
    grid: uniform(420), // horizontal logo pixels (lower = chunkier)
    hue: uniform(0),
  };

  constructor(text = 'MESMOTRONIC') {
    const tex = buildLogo(text);
    const u = this.u;
    const shader = Fn(() => {
      const P = screenP();
      const scan = floor(P.y.mul(U.res.y.div(3))).div(U.res.y.div(3));
      const wob = sin(scan.mul(u.wobFreq).add(U.time.mul(5.0)))
        .mul(u.wobble)
        .add(sin(scan.mul(u.wobFreq.mul(2.7)).sub(U.time.mul(9.0))).mul(u.wobble).mul(U.kick).mul(1.5));
      const size = vec2(u.w.mul(u.sx), u.w.mul(0.25).mul(u.sy));
      const q0 = P.sub(vec2(u.x.add(wob), u.y)).div(size).add(0.5);
      const grid = vec2(u.grid, u.grid.mul(0.25));
      const q = floor(q0.mul(grid)).add(0.5).div(grid);
      const inside = step(0, q0.x).mul(step(q0.x, 1)).mul(step(0, q0.y)).mul(step(q0.y, 1));
      const m = texture(tex, q);
      const fill = step(0.5, m.r);
      const outline = step(0.5, m.g).mul(fill.oneMinus());
      const shadow = step(0.5, m.b).mul(max(fill, step(0.5, m.g)).oneMinus());

      // classic 80s chrome: sky above the horizon, desert below
      const gy = q.y.sub(0.22).div(0.56);
      const sky = mix(vec3(0.95, 0.98, 1.0), vec3(0.1, 0.25, 0.85), smoothstep(0.5, 1.0, gy));
      const ground = mix(vec3(0.25, 0.08, 0.02), vec3(1.0, 0.85, 0.35), smoothstep(0.48, 0.0, gy));
      const horizon = smoothstep(0.04, 0.0, abs(gy.sub(0.49)));
      let chrome = mix(ground, sky, step(0.5, gy)).mul(horizon.mul(0.6).oneMinus());
      // hue tint driven by the music
      chrome = mix(chrome, chrome.mul(vec3(1.0, 0.45, 1.2)), u.hue);
      const glintPos = U.time.mul(0.45).fract().mul(3.0).sub(1.0);
      const glint = smoothstep(0.035, 0.0, abs(q.x.add(q.y.mul(0.35)).sub(glintPos)));
      const fillCol = chrome.add(glint.mul(1.2)).add(U.kick.mul(0.15));
      const outlineCol = mix(vec3(0.25, 0.0, 0.35), vec3(0.95, 0.2, 0.75), smoothstep(0.1, 0.9, q.y));
      const col = fillCol.mul(fill).add(outlineCol.mul(outline));
      const a = max(max(fill, outline), shadow.mul(0.6)).mul(inside).mul(u.alpha);
      return vec4(col, a);
    });
    this.mesh = screenLayer(shader(), { order: 90, transparent: true });
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }
}
