// Bitmap-font text rendered entirely in TSL: a glyph atlas (fill / outline / drop
// shadow packed into R / G / B) plus a texture holding the message bytes, so any
// layer can be a sine scroller, a bouncing title or a static caption.

import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  clamp,
  float,
  floor,
  fract,
  max,
  mix,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { U, rainbow, screenLayer, screenP } from './shared';

const CELL = 64;
const CW = 0.74; // horizontal advance as a fraction of the glyph cell
const COLS = 16;
const ROWS = 6;
const MAXLEN = 1024;
const MSG_ROWS = 32;

function buildAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = CELL * COLS;
  c.height = CELL * ROWS;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'lighter';
  g.font = `900 ${CELL * 0.66}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  for (let i = 0; i < COLS * ROWS; i++) {
    const ch = String.fromCharCode(32 + i);
    const x = (i % COLS) * CELL + CELL / 2;
    const y = Math.floor(i / COLS) * CELL + CELL / 2 + 2;
    // squeeze wide glyphs (W, M...) so every letter fits the monospace advance
    const fit = Math.min(1, (CELL * CW - 12) / Math.max(1, g.measureText(ch).width));
    const pass = (color: string, dx: number, dy: number, stroke: number) => {
      g.save();
      g.translate(x + dx, y + dy);
      g.scale(fit, 1);
      g.fillStyle = color;
      g.strokeStyle = color;
      if (stroke) {
        g.lineWidth = stroke;
        g.strokeText(ch, 0, 0);
      }
      g.fillText(ch, 0, 0);
      g.restore();
    };
    pass('#0000ff', 4, 5, 8); // B: drop shadow
    pass('#00ff00', 0, 0, 8); // G: outline
    pass('#ff0000', 0, 0, 0); // R: fill
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

/** All on-screen strings live in one texture, one message per row. */
class MessageBank {
  readonly data = new Uint8Array(MAXLEN * MSG_ROWS * 4);
  readonly texture: THREE.DataTexture;
  private rows = 0;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, MAXLEN, MSG_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
  }

  add(text: string): { row: number; len: number } {
    const row = this.rows++;
    const s = text.toUpperCase().slice(0, MAXLEN);
    for (let i = 0; i < s.length; i++) {
      let code = s.charCodeAt(i);
      if (code < 32 || code > 127) code = 32;
      this.data[(row * MAXLEN + i) * 4] = code;
    }
    this.texture.needsUpdate = true;
    return { row, len: s.length };
  }
}

let atlas: THREE.CanvasTexture | null = null;
export const messages = (() => {
  let bank: MessageBank | null = null;
  return () => (bank ??= new MessageBank());
})();

export interface TextStyle {
  size?: number; // glyph height, fraction of screen height
  y?: number; // baseline centre, screen units (-0.5..0.5)
  amp?: number; // sine amplitude
  freq?: number; // sine frequency across the screen
  speed?: number; // sine phase speed
  rigid?: number; // 0 = letters bend, 1 = letters bounce as solid blocks
  grid?: number; // pixelation of the font (font pixels per glyph)
  hue?: number;
  order?: number;
}

export class TextLayer {
  readonly mesh: THREE.Mesh;
  readonly u = {
    row: uniform(0),
    len: uniform(0),
    scroll: uniform(0), // in characters
    x: uniform(0),
    y: uniform(0),
    size: uniform(0.12),
    amp: uniform(0.05),
    freq: uniform(5),
    speed: uniform(3),
    rigid: uniform(0),
    grid: uniform(20),
    hue: uniform(0),
    alpha: uniform(1),
    zoom: uniform(1), // horizontal stretch
    mono: uniform(0), // 1 = chrome/white instead of rainbow
  };

  constructor(style: TextStyle = {}) {
    atlas ??= buildAtlas();
    const msgTex = messages().texture;
    const u = this.u;
    u.size.value = style.size ?? 0.12;
    u.y.value = style.y ?? 0;
    u.amp.value = style.amp ?? 0.05;
    u.freq.value = style.freq ?? 5;
    u.speed.value = style.speed ?? 3;
    u.rigid.value = style.rigid ?? 0;
    u.grid.value = style.grid ?? 20;
    u.hue.value = style.hue ?? 0;

    const atlasTex = atlas;
    const shader = Fn(() => {
      const P = screenP();
      const S = u.size;
      const W = S.mul(CW).mul(u.zoom);
      const cx = P.x.sub(u.x).div(W).add(u.scroll);
      const ci = floor(cx);
      const lx = fract(cx);
      const wx = mix(P.x, ci.add(0.5).sub(u.scroll).mul(W).add(u.x), u.rigid);
      const yoff = sin(wx.mul(u.freq).add(U.time.mul(u.speed)))
        .mul(u.amp)
        .add(sin(wx.mul(u.freq).mul(0.37).sub(U.time.mul(u.speed).mul(0.61))).mul(u.amp).mul(0.4));
      const ly = P.y.sub(u.y).sub(yoff).div(S).add(0.5);

      const inside = step(0, ci)
        .mul(step(ci, u.len.sub(1)))
        .mul(step(0, ly))
        .mul(step(ly, 1));

      const cIdx = clamp(ci, 0, MAXLEN - 1);
      const code = texture(msgTex, vec2(cIdx.add(0.5).div(MAXLEN), u.row.add(0.5).div(MSG_ROWS))).r.mul(255);
      const glyph = floor(code.add(0.5)).sub(32);
      const gx = glyph.mod(COLS);
      const gy = floor(glyph.div(COLS));

      const G = u.grid;
      const cellX = lx.sub(0.5).mul(CW).add(0.5);
      const qx = floor(cellX.mul(G)).add(0.5).div(G);
      const qy = floor(clamp(ly, 0, 0.999).mul(G)).add(0.5).div(G);
      const auv = vec2(gx.add(qx).div(COLS), float(ROWS).sub(gy).sub(1).add(qy).div(ROWS));
      const m = texture(atlasTex, auv);
      const fill = step(0.5, m.r);
      const outline = step(0.5, m.g).mul(fill.oneMinus());
      const shadow = step(0.5, m.b).mul(max(fill, step(0.5, m.g)).oneMinus());

      // copper-gradient fill with a specular stripe, rainbow cycling per character
      const hue = u.hue.add(qy.mul(0.45)).add(ci.mul(0.05)).add(U.time.mul(0.25));
      const band = smoothstep(0.08, 0.0, abs(qy.sub(0.68)));
      const shade = mix(float(0.55), float(1.25), smoothstep(0.1, 0.8, qy));
      const chrome = mix(vec3(0.18, 0.2, 0.55), vec3(0.95, 0.97, 1.0), smoothstep(0.35, 0.75, qy)).add(
        vec3(0.6, 0.35, 0.1).mul(smoothstep(0.42, 0.3, qy)),
      );
      const base = mix(rainbow(hue).mul(shade), chrome, u.mono);
      const fillCol = base.add(vec3(band.mul(0.7))).add(U.kick.mul(0.25));
      const outlineCol = vec3(0.04, 0.0, 0.12);
      const col = fillCol.mul(fill).add(outlineCol.mul(outline));
      const alpha = max(max(fill, outline), shadow.mul(0.55)).mul(inside).mul(u.alpha);
      return vec4(col, alpha);
    });

    this.mesh = screenLayer(shader(), { order: style.order ?? 100, transparent: true });
  }

  setMessage(msg: { row: number; len: number }) {
    this.u.row.value = msg.row;
    this.u.len.value = msg.len;
  }

  /** Centre the message on screen. */
  center() {
    this.u.x.value = 0;
    this.u.scroll.value = this.u.len.value / 2;
  }

  /** Scroll so that the text enters from the right edge at t = 0. */
  scrollAt(t: number, charsPerSecond: number, aspect: number) {
    const W = this.u.size.value * CW * this.u.zoom.value;
    this.u.x.value = 0;
    this.u.scroll.value = t * charsPerSecond - aspect / 2 / W;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }
}
