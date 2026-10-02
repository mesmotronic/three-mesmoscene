// The splash screen: a modern Mesmotronic ident that, once loading finishes, is
// torn apart by a "time quake" and lands in 1993 as the retro title screen.
// Everything is drawn on a 2D canvas so we can genuinely pixelate, tear and
// colour-split both screens.

import logoSvg from './assets/mesmotronic.svg?raw';

const RETRO_FONT = '"Press Start 2P", ui-monospace, monospace';
const MODERN_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const BRAND_BLUE = '#019CC7';
// Wordmark geometry from the SVG (viewBox units): eleven square letters on a fixed
// pitch, with the swirl standing in for the second O. The retro title is sized and
// placed so each pixel-font letter lands exactly in its modern letter's slot.
const VB = { x: 77.024, y: 62.006, w: 165.61, h: 35.994 };
const LETTER = { firstCentre: 81.2925, pitch: 15.7074, top: 75.883, size: 8.537 };
const PIXEL_INK = 7 / 8; // Press Start 2P capitals are 7x7 pixels in an 8x8 cell
const GLITCH_CHARS = [...'!<>-_/\\[]{}=+*^?#%&@$'];
const BLOCK_COLOURS = [BRAND_BLUE, '#ff2bd6', '#000', '#fff', '#3cf', '#fe3'];
const MODERN_TAG = 'Make it Mesmotronic';
const RETRO_TITLE = 'MESMOTRONIC';
const RETRO_TAG = 'WELCOME TO THE MESMOSCENE';
const QUAKE_SECONDS = 2.1;
const MIN_IDENT_SECONDS = 1.4; // let the modern ident breathe before the quake
// at most two soft flashes, well under the 3-per-second photosensitivity limit
const FLASHES = [0.64, 1.08];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

function scramble(text: string, amount: number): string {
  if (amount <= 0) return text;
  let out = '';
  for (const ch of text) out += ch !== ' ' && Math.random() < amount ? pick(GLITCH_CHARS) : ch;
  return out;
}

function layer(w = 1, h = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}
type Layer = ReturnType<typeof layer>;

type Phase = 'loading' | 'quake' | 'ready' | 'gone' | 'error';

export class Splash {
  onStart: (() => void) | null = null;
  /** debugging/capture: pin the quake at this many seconds */
  debugQuakeTime: number | null = null;

  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private phase: Phase = 'loading';
  private W = 1;
  private H = 1;
  private dpr = 1;
  private target = 0; // loading progress 0..1
  private shown = 0; // displayed (eased) progress
  private status = '';
  private errorText = '';
  private logo: HTMLImageElement | null = null;
  private logoKey = '';
  private logoUrl = '';
  private logoAt = 0; // when the modern logo first appeared
  private quakeStart = 0;
  private readyAt = 0;
  private quakeDone: (() => void) | null = null;
  private fontsReady: Promise<unknown>;
  private touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  private modern = layer();
  private retro = layer();
  private work = layer();
  private red = layer();
  private cyan = layer();
  private small = layer();
  private pixModern = layer();
  private pixRetro = layer();
  private noise = layer(128, 128);
  private scanlines: CanvasPattern | null = null;
  private staticNoise: CanvasPattern | null = null;
  private bands: { y: number; h: number; retro: boolean; tear: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
    this.fontsReady = document.fonts ? document.fonts.load(`16px ${RETRO_FONT}`).catch(() => { }) : Promise.resolve();

    const img = this.noise.g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    this.noise.g.putImageData(img, 0, 0);
    this.staticNoise = this.g.createPattern(this.noise.c, 'repeat');

    canvas.addEventListener('click', () => {
      if (this.phase === 'ready') this.onStart?.();
    });
    addEventListener('resize', () => this.resize());
    this.resize();
    this.setLabel('Mesmotronic. Make it Mesmotronic. Loading.');

    const loop = () => {
      if (this.phase === 'gone') return;
      this.draw(performance.now() / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ public

  progress(p: number) {
    this.target = clamp01(p);
  }

  /** Run the time quake into the retro title screen. Resolves once it has landed. */
  async reveal(status: string) {
    this.status = status;
    this.target = 1;
    await this.fontsReady;
    // give the modern ident (and its full progress bar) a moment on screen
    const giveUp = performance.now() + 5000;
    while (
      performance.now() < giveUp &&
      (!this.logo || performance.now() / 1000 - this.logoAt < MIN_IDENT_SECONDS || this.shown < 0.995)
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.phase = 'quake';
    this.quakeStart = performance.now() / 1000;
    await new Promise<void>((r) => (this.quakeDone = r));
  }

  hide() {
    this.phase = 'gone';
    this.canvas.classList.add('gone');
    setTimeout(() => (this.canvas.style.display = 'none'), 600);
  }

  guru(message: string) {
    this.errorText = message.toUpperCase();
    this.phase = 'error';
    this.setLabel(`Software failure. Guru meditation: ${message}`);
  }

  // ------------------------------------------------------------------ setup

  private setLabel(text: string) {
    this.canvas.setAttribute('aria-label', text);
  }

  private resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = Math.max(1, Math.round(innerWidth * this.dpr));
    this.H = Math.max(1, Math.round(innerHeight * this.dpr));
    for (const l of [{ c: this.canvas }, this.modern, this.retro, this.work, this.red, this.cyan, this.pixModern, this.pixRetro]) {
      l.c.width = this.W;
      l.c.height = this.H;
    }
    const scan = layer(1, Math.max(3, Math.round(3 * this.dpr)));
    scan.g.fillStyle = '#000';
    scan.g.fillRect(0, 0, 1, Math.max(1, Math.round(this.dpr)));
    this.scanlines = this.g.createPattern(scan.c, 'repeat');
    this.bands = [];
    this.loadLogo();
  }

  /** Rasterise the SVG at exactly the size it's drawn, so it stays razor sharp. */
  private loadLogo() {
    const L = this.modernLayout();
    const w = Math.round(L.logoW * this.dpr);
    const h = Math.round(L.logoH * this.dpr);
    const key = `${w}x${h}`;
    if (key === this.logoKey) return;
    this.logoKey = key;
    const svg = logoSvg.replace('<svg ', `<svg width="${w}" height="${h}" `);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      if (this.logoKey !== key) return;
      if (!this.logo) this.logoAt = performance.now() / 1000;
      this.logo = img;
      if (this.logoUrl) URL.revokeObjectURL(this.logoUrl);
      this.logoUrl = url;
    };
    img.src = url;
  }

  // ------------------------------------------------------------------ layout

  /** Modern logo width at which its letters are exactly the size of `size`px pixel-font capitals. */
  private logoWidthFor(size: number) {
    return (size * PIXEL_INK * VB.w) / LETTER.size;
  }

  private capRatio = 0;

  /** Cap height of the modern font as a fraction of its size (measured, it varies by platform). */
  private modernCapRatio() {
    if (!this.capRatio) {
      this.g.font = `300 100px ${MODERN_FONT}`;
      this.capRatio = this.g.measureText('H').actualBoundingBoxAscent / 100 || 0.7;
    }
    return this.capRatio;
  }

  private modernLayout() {
    const cssW = this.W / this.dpr;
    const cssH = this.H / this.dpr;
    const pad = Math.round(Math.max(14, Math.min(cssW, cssH) * 0.06));
    const inner = { x: pad, y: pad, w: cssW - pad * 2, h: cssH - pad * 2 };
    // the retro tagline's pixel size (multiple of 8) sets both taglines' cap height
    const retroTagSize = fitPixel(RETRO_TAG.length, 0.25, inner.w * 0.9, [16, 8]);
    const tagCap = retroTagSize * PIXEL_INK;
    const tagSize = tagCap / this.modernCapRatio();
    // multiples of 8 keep the pixel font's pixels square
    const titleSize = [40, 32, 24, 16, 8].find((sz) => this.logoWidthFor(sz) <= Math.min(cssW * 0.8, 720)) ?? 8;
    const logoW = this.logoWidthFor(titleSize);
    const logoH = (logoW * VB.h) / VB.w;
    const x = (cssW - logoW) / 2;
    const y = cssH * 0.46 - logoH / 2;
    const k = logoW / VB.w;
    const letterCy = y + (LETTER.top + LETTER.size / 2 - VB.y) * k;
    const slots = Array.from({ length: RETRO_TITLE.length }, (_, i) => x + (LETTER.firstCentre + i * LETTER.pitch - VB.x) * k);
    const tagCy = y + logoH + Math.max(14, logoH * 0.32) + tagCap / 2; // centre of the capitals
    return {
      cssW,
      cssH,
      inner,
      logoW,
      logoH,
      x,
      y,
      titleSize,
      letterCy,
      slots,
      tagSize,
      tagCap,
      tagCy,
      retroTagSize,
    };
  }

  private retroLayout() {
    const M = this.modernLayout();
    const { cssW, cssH, inner } = M;
    const maxChars = Math.max(10, Math.floor((inner.w * 0.92) / (8 * 1.1)));
    // the backend status gets its own (reserved) line so the layout is identical
    // before it's known, keeping the progress bar and prompt in exactly the same place
    const footer = [
      { text: this.status ? `RUNNING ON ${this.status}` : '', colour: '#8a6ab8' },
      ...[
        { text: 'HEADPHONES OR MASSIVE SPEAKERS RECOMMENDED', colour: '#8a6ab8' },
        { text: 'WARNING: CONTAINS FLASHING LIGHTS AND STROBE EFFECTS', colour: '#ff7777' },
      ].flatMap((l) => wrap(l.text, maxChars).map((text) => ({ text, colour: l.colour }))),
    ];
    const footerTop = inner.y + inner.h - 20 - footer.length * 14;
    // the INSERT COIN prompt sits near the bottom, just above the small print
    const prompt = this.touch ? 'TAP TO START' : 'CLICK OR PRESS SPACE TO START';
    const promptSize = fitPixel(prompt.length, 0.1, inner.w * 0.9, [16, 8]);
    const promptY = footerTop - Math.max(28, inner.h * 0.06) - promptSize * PIXEL_INK;
    const promptCy = promptY + (promptSize * PIXEL_INK) / 2; // the modern progress bar sits on this line
    // title and tagline take over the modern logo's and tagline's exact positions
    return { cssW, cssH, inner, M, tagSize: M.retroTagSize, prompt, promptSize, promptY, promptCy, footer, footerTop };
  }

  // ------------------------------------------------------------------ painters

  private drawModern(g: CanvasRenderingContext2D, corrupt: number, bar: boolean) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.W, this.H);
    if (!this.logo) return;
    const s = this.dpr;
    const L = this.modernLayout();
    g.drawImage(this.logo, Math.round(L.x * s), Math.round(L.y * s), Math.round(L.logoW * s), Math.round(L.logoH * s));

    const spacing = L.tagSize * 0.22 * s;
    g.font = `300 ${L.tagSize * s}px ${MODERN_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = 'rgba(255, 255, 255, 0.75)';
    g.letterSpacing = `${spacing}px`;
    // capitals span exactly the band the retro tagline's pixel capitals will occupy;
    // letter spacing also trails the last glyph, so nudge right to stay centred
    g.fillText(scramble(MODERN_TAG, corrupt), (L.cssW / 2) * s + spacing / 2, (L.tagCy + L.tagCap / 2) * s);
    g.letterSpacing = '0px';

    if (bar) {
      // vertically centred on the line the retro "CLICK TO START" prompt will occupy
      const barW = L.logoW * 0.4;
      const h = Math.max(1, Math.round(1.5 * s));
      const x = Math.round(((L.cssW - barW) / 2) * s);
      const y = Math.round(this.retroLayout().promptCy * s - h / 2);
      const w = Math.round(barW * s);
      g.fillStyle = 'rgba(255, 255, 255, 0.1)';
      g.fillRect(x, y, w, h);
      g.fillStyle = BRAND_BLUE;
      g.fillRect(x, y, Math.round(w * this.shown), h);
    }
  }

  private pixelText(
    g: CanvasRenderingContext2D,
    text: string,
    cx: number,
    y: number,
    size: number,
    spacing: number,
    fill: string | CanvasGradient,
    shadow?: { d: number; colour: string },
  ) {
    const s = this.dpr;
    const adv = size * (1 + spacing);
    const total = text.length * size + (text.length - 1) * size * spacing;
    const x0 = cx - total / 2;
    g.font = `${size * s}px ${RETRO_FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const pass = (dx: number, style: string | CanvasGradient) => {
      g.fillStyle = style;
      for (let i = 0; i < text.length; i++) {
        g.fillText(text[i], Math.round((x0 + i * adv + dx) * s), Math.round((y + size + dx) * s));
      }
    };
    if (shadow) pass(shadow.d, shadow.colour);
    pass(0, fill);
  }

  /** Draw each character with its ink box centred on a given slot (used to match the modern wordmark). */
  private slotText(
    g: CanvasRenderingContext2D,
    text: string,
    slots: number[],
    cy: number,
    size: number,
    fill: string | CanvasGradient,
    shadow: { d: number; colour: string },
  ) {
    const s = this.dpr;
    g.font = `${size * s}px ${RETRO_FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const places = [...text].map((ch, i) => {
      const m = g.measureText(ch);
      const x = slots[i] * s - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
      const y = cy * s + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      return { ch, x, y };
    });
    const d = shadow.d * s;
    g.fillStyle = shadow.colour;
    for (const p of places) g.fillText(p.ch, Math.round(p.x + d), Math.round(p.y + d));
    g.fillStyle = fill;
    for (const p of places) g.fillText(p.ch, Math.round(p.x), Math.round(p.y));
  }

  private drawRetro(g: CanvasRenderingContext2D, now: number, opts: { prompt: boolean; scramble: number }) {
    const s = this.dpr;
    const R = this.retroLayout();
    const M = R.M;

    // black screen with a faint purple CRT glow creeping in from the edges
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.W, this.H);
    g.save();
    g.shadowColor = 'rgba(150, 60, 255, 0.3)';
    g.shadowBlur = Math.min(R.cssW, R.cssH) * 0.08 * s;
    g.lineWidth = 60 * s;
    g.strokeStyle = '#000';
    g.strokeRect(-30 * s, -30 * s, this.W + 60 * s, this.H + 60 * s);
    g.restore();

    // chrome pixel title in the wordmark's letter slots, tagline on the modern tagline's line
    const ink = M.titleSize * PIXEL_INK;
    const grad = g.createLinearGradient(0, (M.letterCy - ink / 2) * s, 0, (M.letterCy + ink / 2) * s);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.45, '#9cf');
    grad.addColorStop(0.5, '#320');
    grad.addColorStop(0.7, '#f90');
    grad.addColorStop(1, '#ffd');
    const title = scramble(RETRO_TITLE, opts.scramble);
    this.slotText(g, title, M.slots, M.letterCy, M.titleSize, grad, { d: M.titleSize / 8, colour: '#602' });
    const tagTop = M.tagCy - (R.tagSize * PIXEL_INK) / 2;
    this.pixelText(g, scramble(RETRO_TAG, opts.scramble), R.cssW / 2, tagTop, R.tagSize, 0.25, '#fff');

    // INSERT COIN style blinking prompt
    if (opts.prompt && (now - this.readyAt) % 1.1 < 0.7) {
      this.pixelText(g, R.prompt, R.cssW / 2, R.promptY, R.promptSize, 0.1, '#ffe74c', { d: R.promptSize / 8, colour: '#8a3b00' });
    }

    // footer: backend, headphones and the flashing lights warning
    let fy = R.footerTop;
    for (const line of R.footer) {
      if (line.text) this.pixelText(g, line.text, R.cssW / 2, fy, 8, 0.1, line.colour);
      fy += 14;
    }
  }

  private pixelate(src: HTMLCanvasElement, px: number, out: Layer) {
    const block = px * this.dpr;
    const w = Math.max(1, Math.round(this.W / block));
    const h = Math.max(1, Math.round(this.H / block));
    if (this.small.c.width !== w || this.small.c.height !== h) {
      this.small.c.width = w;
      this.small.c.height = h;
    }
    // point-sample on the way down too: hard, bright, aliased blocks instead of a dim blur
    this.small.g.imageSmoothingEnabled = false;
    this.small.g.drawImage(src, 0, 0, w, h);
    out.g.imageSmoothingEnabled = false;
    out.g.drawImage(this.small.c, 0, 0, w, h, 0, 0, this.W, this.H);
    return out.c;
  }

  private channel(dst: Layer, colour: string) {
    dst.g.globalCompositeOperation = 'source-over';
    dst.g.drawImage(this.work.c, 0, 0);
    dst.g.globalCompositeOperation = 'multiply';
    dst.g.fillStyle = colour;
    dst.g.fillRect(0, 0, this.W, this.H);
    dst.g.globalCompositeOperation = 'source-over';
  }

  private drawQuake(now: number, t: number) {
    const { W, H, dpr, g } = this;

    if (this.reducedMotion) {
      // no shaking or flashing: a simple crossfade between eras
      const k = smooth(0, 0.8, t);
      this.drawModern(this.modern.g, 0, false);
      this.drawRetro(this.retro.g, now, { prompt: false, scramble: 0 });
      g.drawImage(this.modern.c, 0, 0);
      g.globalAlpha = k;
      g.drawImage(this.retro.c, 0, 0);
      g.globalAlpha = 1;
      if (t >= 0.8) this.land(now);
      return;
    }

    const tremor = smooth(0, 0.3, t);
    const chaos = smooth(0, 0.75, t) * (1 - smooth(1.3, QUAKE_SECONDS - 0.1, t));
    const retroShare = smooth(0.4, 1.35, t);
    const pxModern = 1 + Math.round(8 * smooth(0.2, 1.0, t)); // modern decays back in time...
    const pxRetro = 1 + Math.round(8 * (1 - smooth(1.05, 1.75, t))); // ...and 1993 resolves

    this.drawModern(this.modern.g, smooth(0.1, 0.9, t), false);
    this.drawRetro(this.retro.g, now, { prompt: false, scramble: 1 - smooth(1.0, 1.85, t) });
    const modernSrc = pxModern > 1 ? this.pixelate(this.modern.c, pxModern, this.pixModern) : this.modern.c;
    const retroSrc = pxRetro > 1 ? this.pixelate(this.retro.c, pxRetro, this.pixRetro) : this.retro.c;

    // horizontal bands from either era, torn sideways; layouts hold for a frame or two
    if (!this.bands.length || Math.random() < 0.55) {
      this.bands = [];
      for (let y = 0; y < H;) {
        const h = Math.min(H - y, Math.max(1, Math.round(rand(3, 70) * dpr * (1.15 - chaos))));
        const tear = Math.random() < 0.1 + chaos * 0.55 ? rand(-1, 1) * (chaos * 0.14 + tremor * 0.004) * W : 0;
        this.bands.push({ y, h, retro: Math.random() < retroShare, tear: Math.round(tear) });
        y += h;
      }
    }
    const w = this.work.g;
    w.fillStyle = '#000';
    w.fillRect(0, 0, W, H);
    for (const b of this.bands) {
      const src = b.retro ? retroSrc : modernSrc;
      w.drawImage(src, 0, b.y, W, b.h, b.tear, b.y, W, b.h);
      if (b.tear) w.drawImage(src, 0, b.y, W, b.h, b.tear - Math.sign(b.tear) * W, b.y, W, b.h);
    }

    // corrupted blocks: displaced copies, solid colour, digital noise
    const blocks = Math.floor(chaos * chaos * 16 * Math.random());
    for (let i = 0; i < blocks; i++) {
      const bw = Math.round(rand(16, 240) * dpr);
      const bh = Math.round(rand(4, 48) * dpr);
      const x = Math.round(rand(0, W - bw));
      const y = Math.round(rand(0, H - bh));
      const kind = Math.random();
      if (kind < 0.45) {
        w.drawImage(this.work.c, Math.round(rand(0, W - bw)), Math.round(rand(0, H - bh)), bw, bh, x, y, bw, bh);
      } else if (kind < 0.7) {
        w.globalAlpha = 0.85;
        w.fillStyle = pick(BLOCK_COLOURS);
        w.fillRect(x, y, bw, bh);
        w.globalAlpha = 1;
      } else {
        w.imageSmoothingEnabled = false;
        w.drawImage(this.noise.c, rand(0, 96), rand(0, 96), 32, 8, x, y, bw, bh);
      }
    }

    // RGB split, whole-frame jitter and the odd vertical roll (lost sync)
    const split = Math.round((tremor * 1.5 + chaos * 9 + (Math.random() < 0.15 ? 8 * chaos : 0)) * dpr);
    const jx = Math.round(rand(-1, 1) * (1.5 + chaos * 9) * tremor * dpr);
    const jy = Math.round(rand(-1, 1) * (1 + chaos * 5) * tremor * dpr);
    const roll = t > 0.75 && t < 1.25 && Math.random() < 0.18 ? Math.round(rand(0.1, 0.9) * H) : 0;
    const blit = (src: HTMLCanvasElement, dx: number) => {
      g.drawImage(src, jx + dx, jy - roll);
      if (roll) g.drawImage(src, jx + dx, jy - roll + H);
    };
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (split > 0) {
      this.channel(this.red, '#f00');
      this.channel(this.cyan, '#0ff');
      g.globalCompositeOperation = 'lighter';
      blit(this.red.c, -split);
      blit(this.cyan.c, split);
      g.globalCompositeOperation = 'source-over';
    } else {
      blit(this.work.c, 0);
    }

    // scanlines + static
    if (chaos > 0.02 && this.scanlines && this.staticNoise) {
      g.globalAlpha = 0.35 * chaos;
      g.fillStyle = this.scanlines;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = 0.13 * chaos;
      this.staticNoise.setTransform(new DOMMatrix().translate(rand(0, 128), rand(0, 128)).scale(dpr));
      g.fillStyle = this.staticNoise;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    if (FLASHES.some((f) => t >= f && t < f + 0.05)) {
      g.fillStyle = 'rgba(255, 255, 255, 0.35)';
      g.fillRect(0, 0, W, H);
    }

    if (t >= QUAKE_SECONDS) this.land(now);
  }

  private land(now: number) {
    this.phase = 'ready';
    this.readyAt = now;
    this.canvas.style.cursor = 'pointer';
    this.setLabel(`Welcome to the Mesmoscene. ${this.touch ? 'Tap' : 'Click or press Space'} to start.`);
    this.quakeDone?.();
  }

  private drawGuru(now: number) {
    const { g, W, H, dpr } = this;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const cssW = W / dpr;
    const maxChars = Math.max(10, Math.floor((cssW - 48) / 8.8));
    const lines = [
      ...wrap('SOFTWARE FAILURE. PRESS RELOAD TO CONTINUE.', maxChars),
      '',
      ...wrap(`GURU MEDITATION #${this.errorText}`, maxChars),
    ];
    const boxH = lines.length * 16 + 32;
    if (Math.floor(now * 1.25) % 2 === 0) {
      g.strokeStyle = '#f00';
      g.lineWidth = 6 * dpr;
      g.strokeRect(12 * dpr, 12 * dpr, W - 24 * dpr, boxH * dpr);
    }
    lines.forEach((line, i) => this.pixelText(g, line, cssW / 2, 28 + i * 16, 8, 0.1, '#f33'));
  }

  private draw(now: number) {
    const g = this.g;
    this.shown += (this.target - this.shown) * 0.12;
    if (this.target >= 1 && this.shown > 0.995) this.shown = 1;
    switch (this.phase) {
      case 'loading': {
        g.fillStyle = '#000';
        g.fillRect(0, 0, this.W, this.H);
        if (!this.logo) return;
        g.globalAlpha = smooth(0, 0.8, now - this.logoAt);
        this.drawModern(this.modern.g, 0, true);
        g.drawImage(this.modern.c, 0, 0);
        g.globalAlpha = 1;
        break;
      }
      case 'quake':
        this.drawQuake(now, this.debugQuakeTime ?? now - this.quakeStart);
        break;
      case 'ready':
        this.drawRetro(g, now, { prompt: true, scramble: 0 });
        break;
      case 'error':
        this.drawGuru(now);
        break;
    }
  }
}

/** Largest pixel-font size (multiples of 8 keep pixels square) that fits `chars` in maxW. */
function fitPixel(chars: number, spacing: number, maxW: number, sizes: number[]) {
  return sizes.find((s) => chars * s + (chars - 1) * s * spacing <= maxW) ?? sizes[sizes.length - 1];
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
