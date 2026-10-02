// The director: one scene, one camera, one post pass. Every frame we ask the song
// where we are and switch/drive the effects so everything lands on the beat.

import * as THREE from 'three/webgpu';
import { BAR, BEAT, DURATION, SECTIONS } from '../audio/song';
import { tracks } from '../audio/sync';
import { DESIGN_ASPECT, U } from './shared';
import { Post } from './post';
import { TextLayer, messages } from './text';
import { Logo } from './fx/logo';
import { plasma, rotozoom, starfield } from './fx/backgrounds';
import { kefrens, rasterBars, twisters } from './fx/rasters';
import { metaballs, tunnel } from './fx/raymarch';
import { Boing } from './fx/boing';
import { Glenz } from './fx/glenz';
import { Dots, SHAPES } from './fx/dots';
import { Spectrum } from './fx/spectrum';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const TEXT = {
  intro1: 'THE YEAR IS 1993... OR IS IT?',
  intro2: 'WEBGPU + TSL + THREE.JS',
  presents: 'PRESENTS',
  welcome: 'WELCOME TO THE',
  title: 'MESMOSCENE',
  plasma: 'YO!!! MESMOTRONIC IS BACK WITH A NEW CRACKTRO... 100% REALTIME WEBGPU + TSL, EVERY SOUND SYNTHESISED LIVE!!!',
  boing: 'THE BOING BALL LIVES!!! RESPECT TO THE AMIGA CREW OF 1984... NOW BOUNCING ON EVERY KICK DRUM!!!',
  dots1: '32768 DOTS',
  dots2: 'ON THE GPU',
  glenz: 'GLENZ VECTORS! XOR ROTOZOOMER! TWISTERS! JUST LIKE MUM USED TO CODE... IN A SHADER LANGUAGE WRITTEN IN JS!!!',
  greets:
    'GREETINGS TO FAIRLIGHT * FUTURE CREW * SANITY * SPACEBALLS * KEFRENS * FARBRAUSCH * ANDROMEDA * MRDOOB AND THE THREE.JS CREW!!!',
  thanks: 'THANKS FOR WATCHING',
  again: '...AND AGAIN FROM THE TOP!',
};

const FLASH_WORDS = ['WEBGPU', 'TSL', 'THREE.JS', 'COMPUTE', 'RAYMARCH', 'NO', 'COPPER', 'WAS', 'HARMED', 'IN', 'THIS', 'DEMO', '!!!', 'MESMO', 'TRONIC'];

const DOT_SEQ = [SHAPES.sphere, SHAPES.torus, SHAPES.knot, SHAPES.textA, SHAPES.cube, SHAPES.textB, SHAPES.helix, SHAPES.wave];

export class Demo {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
  readonly post: Post;

  private stars = starfield();
  private plasma = plasma();
  private roto = rotozoom();
  private tunnel = tunnel();
  private meta = metaballs();
  private rasters = rasterBars();
  private twist = twisters();
  private kefrens = kefrens();
  private boing = new Boing();
  private glenz = new Glenz();
  private dots = new Dots('WEBGPU', 'TSL');
  private logo = new Logo('MESMOTRONIC');
  private spectrum = new Spectrum();
  private scroller = new TextLayer({ size: 0.13, y: -0.3, amp: 0.07, freq: 4, speed: 3, order: 100 });
  private title = new TextLayer({ size: 0.09, y: 0, amp: 0.02, freq: 6, speed: 4, rigid: 1, order: 101 });
  private caption = new TextLayer({ size: 0.06, y: -0.12, amp: 0.008, freq: 8, speed: 5, rigid: 1, grid: 16, order: 102 });

  private msg: Record<keyof typeof TEXT, { row: number; len: number }>;
  private words: { row: number; len: number }[];
  private all: { visible: boolean }[];
  private kickCount = -1;
  private starTravel = 0;
  private tunnelTravel = 0;
  private metaAngle = 0;

  private renderer: THREE.WebGPURenderer;

  constructor(renderer: THREE.WebGPURenderer) {
    this.renderer = renderer;
    this.camera.position.set(0, 0, 6);
    const bank = messages();
    this.msg = Object.fromEntries(Object.entries(TEXT).map(([k, v]) => [k, bank.add(v)])) as typeof this.msg;
    this.words = FLASH_WORDS.map((w) => bank.add(w));

    const meshes = [
      this.stars.mesh,
      this.plasma.mesh,
      this.roto.mesh,
      this.tunnel.mesh,
      this.meta.mesh,
      this.rasters.mesh,
      this.twist.mesh,
      this.kefrens.mesh,
      this.logo.mesh,
      this.spectrum.mesh,
      this.scroller.mesh,
      this.title.mesh,
      this.caption.mesh,
    ];
    this.scene.add(...meshes, this.boing.group, this.glenz.group, this.dots.object);
    this.all = [...meshes, this.boing.group, this.glenz.group, this.dots.object];
    this.post = new Post(renderer, this.scene, this.camera);
  }

  resize(w: number, h: number, pixelRatio: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    U.aspect.value = w / h;
    U.fit.value = Math.min(1, w / h / DESIGN_ASPECT);
    U.viewAspect.value = Math.max(w / h, DESIGN_ASPECT);
    U.res.value.set(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio));
  }

  update(t: number, dt: number, freq: Uint8Array | null) {
    t = ((t % DURATION) + DURATION) % DURATION;
    const bar = t / BAR;
    let si = 0;
    for (let i = 0; i < SECTIONS.length; i++) if (bar >= SECTIONS[i].bar) si = i;
    const sec = SECTIONS[si];
    const local = t - sec.bar * BAR;
    const lbar = local / BAR;
    const secLen = sec.bars * BAR;

    // ---- music → uniforms
    const kick = tracks.kick.env(t, 7);
    const snare = tracks.snare.env(t, 9);
    const crash = tracks.crash.env(t, 1.6);
    const lead = tracks.lead.env(t, 3);
    const leadEv = tracks.lead.last(t);
    U.time.value = t;
    U.beat.value = t / BEAT;
    U.kick.value = kick;
    U.snare.value = snare;
    U.hat.value = tracks.hat.env(t, 30);
    U.crash.value = crash;
    U.bass.value = tracks.bass.env(t, 8);
    U.lead.value = lead;
    U.leadNote.value = leadEv ? (leadEv.note - 69) / 24 : 0;
    U.arp.value = tracks.arp.env(t, 12);

    const kc = tracks.kick.count(t);
    const kickHit = kc !== this.kickCount && this.kickCount >= 0 && tracks.kick.since(t) < 0.1;
    this.kickCount = kc;

    for (const o of this.all) o.visible = false;

    // ---- post defaults + section transitions
    const P = this.post.u;
    const edgeIn = local;
    const edgeOut = secLen - local;
    const cutIn = si > 0 ? Math.max(0, 1 - edgeIn / 0.35) : 0;
    const cutOut = si < SECTIONS.length - 1 ? Math.max(0, 1 - edgeOut / 0.4) : 0;
    P.pixel.value = 1 + cutIn * cutIn * 22 + cutOut * cutOut * 28;
    P.flash.value = Math.min(1, crash * 0.45 + (si > 0 ? Math.exp(-edgeIn * 7) * 0.75 : 0));
    P.flashColor.value.set(1, 1, 1);
    P.ca.value = 0.002 + kick * 0.006 + snare * 0.004;
    const rollGlitch = tracks.snare.since(t) < 0.12 && [7, 23, 31, 47].includes(Math.floor(bar)) ? snare : 0;
    P.glitch.value = Math.max(rollGlitch * 0.8, cutIn * 0.8);
    P.fade.value = 1;
    P.invert.value = 0;
    const shake = (si === 3 || si === 5 ? 0.006 : 0.0025) * kick;
    P.shake.value.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    P.bloom.value = 1;

    // camera default
    this.camera.position.set(0, 0, 6);
    this.camera.lookAt(0, 0, 0);
    this.camera.fov = 50;

    // shared defaults for text layers
    for (const l of [this.scroller, this.title, this.caption]) {
      l.u.alpha.value = 1;
      l.u.zoom.value = 1;
      l.u.mono.value = 0;
    }

    switch (sec.name) {
      case 'intro':
        this.intro(local, lbar, dt, kick);
        break;
      case 'plasma':
        this.partPlasma(local, lbar, kick, snare);
        break;
      case 'boing':
        this.partBoing(t, local, dt);
        break;
      case 'tunnel':
        this.partTunnel(t, local, lbar, dt, kick, kickHit);
        break;
      case 'glenz':
        this.partGlenz(t, local, lbar, kick, lead);
        break;
      case 'metaballs':
        this.partMeta(t, lbar, dt, kick, kickHit);
        break;
      case 'outro':
        this.outro(local, lbar, dt);
        break;
    }

    // spectrum analyser
    if (this.spectrum.mesh.visible) {
      this.spectrum.update(freq, [kick, U.bass.value, snare, U.arp.value, U.hat.value, lead * 0.7], dt);
    }

    // narrow screens: keep the designed horizontal field of view
    const fit = U.fit.value;
    if (fit < 1) this.camera.fov = (2 * Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) / fit) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    if (this.dots.object.visible) this.dots.step(this.renderer, dt);
  }

  render() {
    this.post.render();
  }

  // ------------------------------------------------------------------ parts

  private typewriter(layer: TextLayer, msg: { row: number; len: number }, t0: number, local: number, cps = 14) {
    layer.setMessage(msg);
    layer.center();
    layer.u.len.value = Math.max(0, Math.min(msg.len, Math.floor((local - t0) * cps)));
    layer.visible = local >= t0;
  }

  private intro(local: number, lbar: number, dt: number, kick: number) {
    const riser = lbar >= 6 ? (lbar - 6) / 2 : 0;
    this.starTravel += dt * (0.03 + lbar * 0.012 + riser * riser * 0.9);
    this.stars.mesh.visible = true;
    this.stars.u.travel.value = this.starTravel;
    this.stars.u.alpha.value = smooth(0, 1.2, lbar);
    this.stars.u.warp.value = riser * 1.5;
    this.stars.u.spin.value = local * 0.03;

    this.rasters.mesh.visible = lbar > 0.5;
    this.rasters.u.alpha.value = smooth(0.5, 3, lbar) * 0.9;
    this.rasters.u.spread.value = 0.25 + smooth(0.5, 4, lbar) * 0.45;
    this.rasters.u.center.value = 0;
    this.rasters.u.rainbowMix.value = 0;

    if (lbar < 2) {
      this.typewriter(this.title, this.msg.intro1, 0.6, local);
      this.title.u.size.value = 0.075;
      this.title.u.y.value = 0;
      this.title.u.alpha.value = 1 - smooth(1.75, 2, lbar);
    } else if (lbar < 4) {
      this.typewriter(this.title, this.msg.intro2, 2 * BAR + 0.2, local);
      this.title.u.size.value = 0.085;
      this.title.u.y.value = 0;
      this.title.u.alpha.value = 1 - smooth(3.8, 4, lbar);
    }

    if (lbar >= 4) {
      // the logo drops in on the BOOM
      const tt = local - 4 * BAR;
      this.logo.mesh.visible = true;
      const bounce = Math.exp(-tt * 3.2) * Math.abs(Math.cos(tt * 7.5));
      this.logo.u.y.value = 0.2 + bounce * 0.65;
      this.logo.u.w.value = 1.45;
      this.logo.u.sx.value = 1 + kick * 0.05;
      this.logo.u.sy.value = 1 + Math.exp(-tt * 10) * 0.4;
      this.logo.u.wobble.value = 0.006 + riser * 0.05;
      this.logo.u.grid.value = 420;
      this.logo.u.hue.value = 0;
      this.logo.u.alpha.value = 1;
      this.spectrum.visible = true;
      this.spectrum.u.alpha.value = smooth(4, 4.5, lbar);
      this.spectrum.u.y.value = -0.45;

      if (lbar < 6) {
        this.typewriter(this.caption, this.msg.presents, 4.25 * BAR, local, 10);
        this.caption.u.y.value = 0.02;
        this.caption.u.size.value = 0.06;
      } else {
        // "WELCOME TO THE" types out, then "MESMOSCENE" slams in half a bar later
        this.typewriter(this.caption, this.msg.welcome, 6 * BAR, local, 16);
        this.caption.u.y.value = 0.0;
        this.caption.u.size.value = 0.06;
        const tt = local - 6.5 * BAR;
        if (tt >= 0) {
          this.title.setMessage(this.msg.title);
          this.title.center();
          this.title.visible = true;
          this.title.u.size.value = 0.12 + riser * 0.04 + Math.exp(-tt * 10) * 0.1;
          this.title.u.y.value = -0.17;
          this.title.u.amp.value = 0.02 + riser * 0.03;
          this.title.u.zoom.value = 1 + riser * 0.12;
        }
      }
    }
  }

  private partPlasma(local: number, lbar: number, kick: number, snare: number) {
    this.plasma.mesh.visible = true;
    this.plasma.u.copperMix.value = smooth(3.8, 4.2, lbar);
    this.plasma.u.bands.value = lbar < 4 ? 8 : 14;
    this.plasma.u.zoom.value = 3.2 + Math.sin(local * 0.3) * 0.8;

    this.rasters.mesh.visible = lbar >= 4;
    this.rasters.u.alpha.value = 0.85;
    this.rasters.u.spread.value = 0.5;
    this.rasters.u.center.value = 0.0;
    this.rasters.u.rainbowMix.value = 0;

    this.logo.mesh.visible = true;
    this.logo.u.y.value = 0.3 + Math.sin(local * 1.7) * 0.025;
    this.logo.u.w.value = 1.3;
    this.logo.u.sx.value = 1 + kick * 0.07;
    this.logo.u.sy.value = 1 - kick * 0.05;
    this.logo.u.wobble.value = 0.012 + snare * 0.03;
    this.logo.u.hue.value = snare * 0.8;
    this.logo.u.grid.value = 420;
    this.logo.u.alpha.value = 1;

    this.scroller.visible = true;
    this.scroller.setMessage(this.msg.plasma);
    this.scroller.u.size.value = 0.13;
    this.scroller.u.y.value = -0.27;
    this.scroller.u.amp.value = lbar < 4 ? 0.06 : 0.1;
    this.scroller.u.freq.value = 4;
    this.scroller.u.rigid.value = 0;
    this.scroller.scrollAt(local, 8.5, U.viewAspect.value);
  }

  private partBoing(t: number, local: number, dt: number) {
    this.boing.group.visible = true;
    this.boing.update(t, U.beat.value, dt, local);
    this.camera.position.copy(this.boing.camera.pos);
    this.camera.lookAt(this.boing.camera.target);
    this.camera.fov = 45;

    this.scroller.visible = true;
    this.scroller.setMessage(this.msg.boing);
    this.scroller.u.size.value = 0.1;
    this.scroller.u.y.value = 0.37;
    this.scroller.u.amp.value = 0.035;
    this.scroller.u.freq.value = 6;
    this.scroller.u.speed.value = 5;
    this.scroller.u.rigid.value = 1;
    this.scroller.scrollAt(local, 8, U.viewAspect.value);
    this.post.u.flashColor.value.set(1, 0.85, 0.95);
  }

  private partTunnel(t: number, local: number, lbar: number, dt: number, kick: number, kickHit: boolean) {
    const speed = lbar < 4 ? 2.2 : 4.5 + Math.max(0, lbar - 6) * 7;
    this.tunnelTravel += dt * speed;
    this.tunnel.mesh.visible = true;
    this.tunnel.u.travel.value = this.tunnelTravel;
    this.tunnel.u.square.value = 0.5 + 0.5 * Math.sin(local * 0.6);
    this.tunnel.u.ring.value = lbar >= 7 ? (lbar - 7) * 2 : 0;
    this.tunnel.u.alpha.value = 1;

    const d = this.dots;
    d.object.visible = true;
    const idx = Math.floor(lbar);
    d.u.shapeA.value = DOT_SEQ[idx % DOT_SEQ.length];
    d.u.shapeB.value = d.u.shapeA.value;
    d.u.morph.value = 0;
    const isText = d.u.shapeA.value === SHAPES.textA || d.u.shapeA.value === SHAPES.textB;
    d.u.scale.value = isText ? 1.0 : 0.9;
    d.u.stiff.value = isText ? 55 : 32;
    d.u.damp.value = isText ? 6 : 4.5;
    d.u.swirl.value = 0;
    d.u.size.value = isText ? 0.026 : 0.024;
    d.u.alpha.value = isText ? 0.75 : 0.42;
    // dim the tunnel while the dots spell something out
    const fb = lbar - idx;
    const textDip = isText ? smooth(0, 0.15, fb) * (1 - smooth(0.85, 1, fb)) : 0;
    this.tunnel.u.alpha.value = 1 - textDip * 0.55;
    d.u.impulse.value = kickHit && lbar >= 4 ? (isText ? 1.0 : 3.5) : 0;
    d.object.rotation.set(
      isText ? Math.sin(t * 0.9) * 0.15 : t * 0.4,
      isText ? Math.sin(t * 0.7) * 0.35 : t * 0.7,
      0,
    );
    d.object.position.set(0, 0, 0);
    d.object.scale.setScalar(1 + kick * 0.05);

    this.camera.position.set(0, 0, 6.2);
    this.camera.lookAt(0, 0, 0);

    if (lbar >= 0.5 && lbar < 2) this.typewriter(this.caption, this.msg.dots1, 0.5 * BAR, local, 12);
    else if (lbar >= 2 && lbar < 3.75) this.typewriter(this.caption, this.msg.dots2, 2 * BAR, local, 12);
    this.caption.u.y.value = -0.38;
    this.caption.u.size.value = 0.07;
    this.caption.u.alpha.value = 1 - smooth(3.5, 3.75, lbar);
  }

  private partGlenz(t: number, local: number, lbar: number, kick: number, lead: number) {
    this.roto.mesh.visible = true;
    this.twist.mesh.visible = true;
    this.twist.u.x.value = U.viewAspect.value * 0.36;
    this.twist.u.alpha.value = 1;
    this.glenz.group.visible = true;
    this.glenz.update(t, local, kick, lead);
    this.camera.position.copy(this.glenz.camera.pos);
    this.camera.lookAt(this.glenz.camera.target);

    this.scroller.visible = true;
    this.scroller.setMessage(this.msg.glenz);
    this.scroller.u.size.value = 0.11;
    this.scroller.u.y.value = -0.36;
    this.scroller.u.amp.value = 0.04;
    this.scroller.u.freq.value = 7;
    this.scroller.u.speed.value = 4;
    this.scroller.u.rigid.value = 0;
    this.scroller.u.mono.value = lbar >= 4 ? 1 : 0;
    this.scroller.scrollAt(local, 9, U.viewAspect.value);
  }

  private partMeta(t: number, lbar: number, dt: number, kick: number, kickHit: boolean) {
    this.metaAngle += dt * (0.35 + kick * 0.6);
    this.meta.mesh.visible = true;
    this.meta.u.camAngle.value = this.metaAngle;
    this.meta.update(t, kick);

    const d = this.dots;
    d.object.visible = true;
    // first a rippling dot landscape under the blobs, then a Saturn ring around them
    const ring = lbar >= 4;
    const shape = ring ? SHAPES.torus : SHAPES.wave;
    d.u.shapeA.value = shape;
    d.u.shapeB.value = shape;
    d.u.morph.value = 0;
    d.u.scale.value = ring ? 1.9 : 1.7;
    d.u.stiff.value = ring ? 35 : 40;
    d.u.damp.value = 4;
    d.u.swirl.value = ring ? 1.5 : 0;
    d.u.size.value = 0.024;
    d.u.alpha.value = 0.4;
    d.u.impulse.value = kickHit && ring ? 1.2 : 0;
    if (ring) {
      d.object.position.set(0, 0, 0);
      d.object.rotation.set(0.45 + Math.sin(t * 0.4) * 0.2, t * 0.3, 0.25);
    } else {
      d.object.position.set(0, -1.9, 0);
      d.object.rotation.set(0.12, t * 0.15, 0);
    }
    this.camera.position.set(0, 0, 7);
    this.camera.lookAt(0, 0, 0);

    // shout a word on every snare / clap
    const sn = tracks.snare.last(t);
    const first = tracks.snare.count(t - lbar * BAR - 1e-3);
    if (sn && lbar < 7.5 && tracks.snare.count(t) > first) {
      const n = tracks.snare.count(t) - first - 1;
      const since = t - sn.t;
      const word = this.words[n % this.words.length];
      this.title.setMessage(word);
      this.title.center();
      this.title.visible = true;
      this.title.u.size.value = 0.22 + Math.exp(-since * 12) * 0.1;
      this.title.u.y.value = 0;
      this.title.u.amp.value = 0.02;
      this.title.u.alpha.value = Math.exp(-since * 1.6);
      this.title.u.hue.value = n * 0.17;
    }
    this.post.u.flashColor.value.set(0.9, 0.95, 1);
    // one-frame-ish negative strobe on every bar of the second half
    this.post.u.invert.value = lbar >= 4 && lbar - Math.floor(lbar) < 0.035 ? 1 : 0;
  }

  private outro(local: number, lbar: number, dt: number) {
    this.starTravel += dt * 0.06;
    this.stars.mesh.visible = true;
    this.stars.u.travel.value = this.starTravel;
    this.stars.u.alpha.value = 1;
    this.stars.u.warp.value = 0;
    this.stars.u.spin.value = local * -0.04;

    this.kefrens.mesh.visible = true;
    this.kefrens.u.alpha.value = smooth(0, 0.4, lbar) * (1 - smooth(6.5, 8, lbar));
    this.kefrens.u.top.value = 0.42;

    this.logo.mesh.visible = true;
    this.logo.u.y.value = 0.3;
    this.logo.u.w.value = 1.2;
    this.logo.u.sx.value = 1 + U.kick.value * 0.05;
    this.logo.u.sy.value = 1;
    this.logo.u.wobble.value = 0.01 + smooth(4, 8, lbar) * 0.04;
    this.logo.u.hue.value = 0;
    this.logo.u.grid.value = 420 - smooth(5, 8, lbar) * 360;
    this.logo.u.alpha.value = 1;

    this.spectrum.visible = true;
    this.spectrum.u.alpha.value = 1;
    this.spectrum.u.y.value = -0.47;

    this.scroller.visible = true;
    this.scroller.setMessage(this.msg.greets);
    this.scroller.u.size.value = 0.12;
    this.scroller.u.y.value = -0.2;
    this.scroller.u.amp.value = 0.08;
    this.scroller.u.freq.value = 3.5;
    this.scroller.u.speed.value = 2.5;
    this.scroller.u.rigid.value = 0;
    this.scroller.scrollAt(local, 10, U.viewAspect.value);

    if (lbar >= 4 && lbar < 6) this.typewriter(this.title, this.msg.thanks, 4 * BAR, local, 12);
    else if (lbar >= 6) this.typewriter(this.title, this.msg.again, 6 * BAR, local, 12);
    this.title.u.y.value = 0.05;
    this.title.u.size.value = 0.07;
    this.title.u.amp.value = 0.01;

    // fade to black so the loop restarts cleanly
    this.post.u.fade.value = 1 - smooth(7, 8, lbar);
  }
}
