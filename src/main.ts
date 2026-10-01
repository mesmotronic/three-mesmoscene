import * as THREE from 'three/webgpu';
import '@fontsource/press-start-2p/latin-400.css';
import './style.css';
import { Demo } from './gfx/demo';
import { Player, renderInWorker, type RenderedAudio } from './audio/player';
import { BAR, DURATION, SECTIONS } from './audio/song';
import { attachGestures } from './gestures';

const params = new URLSearchParams(location.search);
const startAt = parseFloat(params.get('t') ?? '0') || 0;
const silent = params.has('silent');
const autostart = params.has('autostart');

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const ui = {
  loader: $<HTMLDivElement>('#loader'),
  bar: $<HTMLDivElement>('#bar > div'),
  status: $<HTMLDivElement>('#status'),
  start: $<HTMLDivElement>('#start'),
  hint: $<HTMLDivElement>('#hint'),
  osd: $<HTMLDivElement>('#osd'),
  progress(p: number, label: string) {
    this.bar.style.width = `${Math.round(p * 100)}%`;
    this.status.textContent = `${label} ${Math.round(p * 100)}%`;
  },
};

async function main() {
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(params.has('hd') ? Math.min(devicePixelRatio, 2) : 1);
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 1);
  document.body.prepend(renderer.domElement);
  await renderer.init();
  const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WEBGPU' : 'WEBGL2 FALLBACK';

  const demo = new Demo(renderer);
  const resize = () => {
    renderer.setSize(innerWidth, innerHeight);
    demo.resize(innerWidth, innerHeight, renderer.getPixelRatio());
  };
  addEventListener('resize', resize);
  resize();

  // depack the module (softsynth in a worker) while we warm up every shader
  let synthP = 0;
  let warmP = 0;
  const report = () => ui.progress(silent ? warmP : synthP * 0.75 + warmP * 0.25, 'DEPACKING');
  const audioPromise: Promise<RenderedAudio | null> = silent
    ? Promise.resolve(null)
    : renderInWorker((p) => {
        synthP = p;
        report();
      });

  for (let i = 0; i < SECTIONS.length; i++) {
    const s = SECTIONS[i];
    for (const off of [0.6, s.bars * BAR * 0.6]) {
      demo.update(s.bar * BAR + off, 1 / 60, null);
      demo.render();
      await new Promise((r) => requestAnimationFrame(r));
    }
    warmP = (i + 1) / SECTIONS.length;
    report();
  }
  const audio = await audioPromise;
  ui.progress(1, 'READY');

  // ------------------------------------------------------------- clock
  let player: Player | null = null;
  let clockBase = performance.now();
  let clockOffset = startAt;
  let paused = false;
  let pausedAt = 0;
  let frozen: number | null = null;

  const songTime = () => {
    if (frozen !== null) return frozen;
    if (paused) return pausedAt;
    if (player) return player.time();
    return clockOffset + (performance.now() - clockBase) / 1000;
  };
  const seek = (t: number) => {
    t = ((t % DURATION) + DURATION) % DURATION;
    if (paused) {
      pausedAt = t;
      return;
    }
    if (player) void player.start(t);
    else {
      clockOffset = t;
      clockBase = performance.now();
    }
  };

  // ------------------------------------------------------------- actions (keyboard + touch)
  let osdTimer = 0;
  const osd = (text: string, sticky = false) => {
    ui.osd.textContent = text;
    ui.osd.classList.add('show');
    ui.osd.classList.toggle('sticky', sticky);
    clearTimeout(osdTimer);
    if (!sticky) osdTimer = window.setTimeout(() => ui.osd.classList.remove('show'), 1200);
  };
  const partLabel = (i: number) => `PART ${i + 1}/${SECTIONS.length} ${SECTIONS[i].name.toUpperCase()}`;
  const sectionAt = (t: number) => {
    let si = 0;
    for (let i = 0; i < SECTIONS.length; i++) if (t / BAR >= SECTIONS[i].bar) si = i;
    return si;
  };

  const togglePause = () => {
    if (!paused) {
      pausedAt = songTime();
      paused = true;
      if (player) void player.ctx.suspend();
      osd('PAUSED', true);
      ui.hint.classList.add('show');
    } else {
      paused = false;
      if (player) void player.start(pausedAt);
      else {
        clockOffset = pausedAt;
        clockBase = performance.now();
      }
      osd('PLAY');
      ui.hint.classList.remove('show');
    }
  };
  const nextPart = () => {
    const n = (sectionAt(songTime()) + 1) % SECTIONS.length;
    seek(SECTIONS[n].bar * BAR);
    osd(`${partLabel(n)} >>`, paused);
  };
  const prevPart = () => {
    const t = songTime();
    const si = sectionAt(t);
    // first bar of a part jumps to the previous part, otherwise restart this one
    const back = t / BAR - SECTIONS[si].bar < 1 ? si - 1 : si;
    const n = (back + SECTIONS.length) % SECTIONS.length;
    seek(SECTIONS[n].bar * BAR);
    osd(`<< ${partLabel(n)}`, paused);
  };

  type FullscreenDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  type FullscreenEl = HTMLElement & { webkitRequestFullscreen?: () => void };
  const doc = document as FullscreenDoc;
  const isFullscreen = () => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  const enterFullscreen = () => {
    const el = document.documentElement as FullscreenEl;
    if (isFullscreen()) return;
    if (el.requestFullscreen && document.fullscreenEnabled) void el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    // iPhone Safari has no element fullscreen; a home screen web app runs chrome-less instead
    else osd('ADD TO HOME SCREEN FOR FULLSCREEN');
  };
  const exitFullscreen = () => {
    if (!isFullscreen()) return;
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
    else doc.webkitExitFullscreen?.();
  };

  // hooks for automated capture / debugging
  Object.assign(window, {
    __demo: {
      setTime: (t: number | null) => (frozen = t),
      time: () => songTime(),
      audio: () => (player ? { ctxTime: player.ctx.currentTime, state: player.ctx.state, outputLatency: player.ctx.outputLatency } : null),
      sections: SECTIONS.map((s) => ({ ...s, time: s.bar * BAR })),
      backend,
    },
  });

  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = frozen !== null ? 1 / 60 : Math.min(0.1, (now - last) / 1000);
    last = now;
    demo.update(songTime(), paused ? 0 : dt, player ? player.spectrum() : null);
    demo.render();
  };

  const start = async () => {
    ui.loader.onclick = null;
    removeEventListener('keydown', keyStart);
    ui.loader.classList.add('gone');
    document.body.classList.add('on');
    if (audio) {
      // iOS mutes Web Audio when the ring/silent switch is on unless we ask for playback
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
      player = new Player(audio);
      await player.start(startAt);
    } else {
      clockBase = performance.now();
      clockOffset = startAt;
    }
    last = performance.now();
    renderer.setAnimationLoop(frame);
    ui.hint.classList.add('show');
    setTimeout(() => !paused && ui.hint.classList.remove('show'), 6000);
  };
  const keyStart = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      void start();
    }
  };

  const running = () => document.body.classList.contains('on');

  addEventListener('keydown', (e) => {
    if (!running()) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    } else if (e.code === 'ArrowRight') nextPart();
    else if (e.code === 'ArrowLeft') prevPart();
    else if (e.code === 'KeyF') {
      if (isFullscreen()) exitFullscreen();
      else enterFullscreen();
    }
  });

  // tap = pause, swipe left/right = next/previous part, swipe up/down = fullscreen on/off
  attachGestures(window, {
    enabled: running,
    tap: togglePause,
    swipe: (dir) => {
      if (dir === 'left') nextPart();
      else if (dir === 'right') prevPart();
      else if (dir === 'up') enterFullscreen();
      else exitFullscreen();
    },
  });

  ui.status.textContent = `${backend} READY`;
  ui.start.classList.add('ready');
  if (autostart) {
    void start();
  } else {
    // click or tap anywhere on the loader
    ui.loader.onclick = () => void start();
    addEventListener('keydown', keyStart);
  }
}

main().catch((err) => {
  console.error(err);
  ui.status.textContent = `GURU MEDITATION #${String(err?.message ?? err).toUpperCase()}`;
  document.body.classList.add('guru');
});
