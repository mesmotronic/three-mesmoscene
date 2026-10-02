# Welcome to the Mesmoscene

An Atari ST / Amiga style cracktro in your browser. It's built with three.js, WebGPU and TSL, and runs as a ~103 second loop with a synthesised soundtrack that drives every effect.

```sh
pnpm install
pnpm dev
```

Then open the URL Vite prints and click (or press Space) to start. Headphones are recommended. The demo contains flashing lights.

## Controls

| Key           | Touch              | Action                         |
| ------------- | ------------------ | ------------------------------ |
| Space         | Tap                | Pause / resume                 |
| →             | Swipe left         | Next part                      |
| ←             | Swipe right        | Previous part                  |
| F             | Swipe up / down    | Enter / exit fullscreen        |

On phones and tablets, tap anywhere on the loader to start. On screens narrower than 16:9 (a phone in portrait, for example), the 16:9 composition is fitted to the width. iPhone Safari doesn't allow web pages to go fullscreen, but **Add to Home Screen** runs the demo without browser chrome.

URL parameters:

| Parameter    | Effect                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------ |
| `?t=45`      | Start 45 seconds in                                                                        |
| `?hd`        | Render at device pixel ratio (the default is 1:1, which is chunkier and suits the CRT)     |
| `?silent`    | Skip audio (visuals run on a wall clock)                                                   |
| `?autostart` | Skip the start screen (browsers may block the audio)                                       |

## The show

130 BPM, 56 bars, seven parts:

| Bars  | Part          | Effects                                                                                      |
| ----- | ------------- | -------------------------------------------------------------------------------------------- |
| 0–7   | Intro         | Warp starfield, copper bars, typewriter text, chrome logo dropping on the boom, LED spectrum analyser |
| 8–15  | Plasma        | Palette-cycling plasma, raster-wobbling logo, sine scroller, copper bars when the clap kicks in |
| 16–23 | Boing         | The Amiga Boing Ball bouncing on every kick, orbiting vector bobs, bouncing-letter scroller |
| 24–31 | Tunnel        | Raymarched twisting tunnel, 32,768 GPU compute dots morphing into shapes and text, then exploding on the kick |
| 32–39 | Glenz         | Nested glenz vectors, XOR rotozoomer, twisters, sine scroller                                 |
| 40–47 | Metaballs     | Raymarched chrome metaballs reflecting a raster sky, a dot landscape and ring, words shouted on every clap |
| 48–55 | Outro         | Kefrens bars, greetings scroller, spectrum analyser, fade to black and loop                   |

All of it goes through one post pass: bloom, CRT curvature, scanlines, shadow mask, chromatic aberration, glitch tears, pixelate transitions and flashes.

## The music

The music is generated, not sampled, so it's free to use. `src/audio/synth.ts` is a small 4k-intro style softsynth: polyBLEP oscillators, a TPT state-variable filter, a 909-ish kit, an offbeat rave bass, an acid line, a supersaw lead, ProTracker-style 50 Hz chip arpeggios, pads, ping-pong delay, Freeverb and kick sidechain.

A Web Worker renders the whole song to PCM while the loader "depacks", then plays it as a seamless loop. The visuals read the same note data (`src/audio/song.ts`) and the audio output clock, so every hit lands on its frame.

## Code map

```
src/
  main.ts               boot, loader, clock, keyboard + touch actions
  gestures.ts           tap / swipe recogniser
  audio/song.ts         arrangement + patterns (shared by synth and visuals)
  audio/synth.ts        the softsynth
  audio/sync.ts         per-instrument event tracks -> envelopes for the visuals
  audio/player.ts       worker + WebAudio playback
  gfx/demo.ts           the director: timeline and choreography
  gfx/post.ts           bloom + CRT post pass (RenderPipeline)
  gfx/text.ts           bitmap font scrollers rendered in TSL
  gfx/shared.ts         music uniforms, palettes, full-screen layer helper
  gfx/fx/*              the effects
```

It needs a browser with WebGPU. three.js falls back to WebGL2 where WebGPU isn't available.

## Credits

The UI font is [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) by CodeMan38 (SIL Open Font License), bundled via `@fontsource/press-start-2p`.
