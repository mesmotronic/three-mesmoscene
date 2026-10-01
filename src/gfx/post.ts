// One post pass to rule them all: bloom, CRT curvature, scanlines, shadow mask,
// chromatic aberration, pixelation transitions, line glitches, flashes and fades.

import * as THREE from 'three/webgpu';
import {
  Fn,
  PI,
  abs,
  dot,
  float,
  floor,
  fract,
  hash,
  length,
  max,
  mix,
  pass,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { U, hash12 } from './shared';

export class Post {
  readonly pipeline: THREE.RenderPipeline;
  readonly u = {
    flash: uniform(0),
    flashColor: uniform(new THREE.Vector3(1, 1, 1)),
    fade: uniform(1),
    pixel: uniform(1),
    ca: uniform(0.003),
    curve: uniform(0.12),
    scan: uniform(0.35),
    noise: uniform(0.04),
    glitch: uniform(0),
    shake: uniform(new THREE.Vector2()),
    bloom: uniform(1),
    invert: uniform(0),
  };

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const u = this.u;
    const scenePass = pass(scene, camera);
    const sceneTex = scenePass.getTextureNode('output');
    const bloomPass = bloom(sceneTex, 0.55, 0.3, 0.78);
    // runtime API is getTextureNode(); the r186 typings still call it getTexture()
    const bloomTex = (bloomPass as unknown as { getTextureNode(): THREE.TextureNode }).getTextureNode();

    const output = Fn(() => {
      const uv0 = uv();
      const c = uv0.sub(0.5);
      const r2 = dot(c, c);
      // barrel distortion, scaled so the corners just touch the bezel
      const cd = c.mul(float(1).add(r2.mul(u.curve))).div(float(1).add(u.curve.mul(0.25)));
      const uvd = cd.add(0.5).add(u.shake).toVar();

      // horizontal line glitch (VHS / sync loss)
      const row = floor(uvd.y.mul(48));
      const g = hash(row.add(floor(U.time.mul(24)).mul(57)));
      const tear = step(float(1).sub(u.glitch.mul(0.35)), g).mul(hash(row.add(3.7)).sub(0.5)).mul(0.12).mul(u.glitch);
      uvd.assign(vec2(uvd.x.add(tear), uvd.y));

      // pixelation for transitions
      const px = max(u.pixel, 1);
      const uvq = floor(uvd.mul(U.res).div(px)).add(0.5).mul(px).div(U.res);
      const uvs = select(u.pixel.greaterThan(1.01), uvq, uvd);

      // chromatic aberration grows toward the edges
      const ca = c.mul(u.ca.add(u.glitch.mul(0.01)));
      const r = sceneTex.sample(uvs.add(ca)).r;
      const gg = sceneTex.sample(uvs).g;
      const b = sceneTex.sample(uvs.sub(ca)).b;
      let col = vec3(r, gg, b).add(bloomTex.sample(uvs).rgb.mul(u.bloom));
      col = mix(col, vec3(1).sub(col), u.invert);

      // scanlines + aperture grille
      const scan = sin(uvd.y.mul(U.res.y).mul(PI).div(1.5)).mul(0.5).add(0.5);
      col = col.mul(mix(float(1), scan.mul(0.4).add(0.6), u.scan));
      const sub = fract(uv0.x.mul(U.res.x).div(3));
      const mask = vec3(
        smoothstep(0.66, 0.0, abs(sub.sub(0.17))),
        smoothstep(0.66, 0.0, abs(sub.sub(0.5))),
        smoothstep(0.66, 0.0, abs(sub.sub(0.83))),
      );
      col = col.mul(mix(vec3(1), mask.mul(0.5).add(0.75), 0.25));

      // vignette + rounded bezel
      const vig = smoothstep(0.95, 0.25, length(c.mul(vec2(1.0, 1.15))));
      col = col.mul(mix(float(0.45), float(1.0), vig));
      const e = vec2(0.5).sub(abs(uvd.sub(0.5)));
      const bezel = smoothstep(0.0, 0.006, e.x).mul(smoothstep(0.0, 0.006, e.y));
      col = col.mul(bezel);

      // film grain, flashes, fades
      const n = hash12(floor(uv0.mul(U.res)).add(fract(U.time.mul(13.7)).mul(100)));
      col = col.add(n.sub(0.5).mul(u.noise));
      col = mix(col, u.flashColor, u.flash);
      return vec4(col.mul(u.fade), 1);
    });

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false; // palette colours are authored in display space
    this.pipeline.outputNode = output();
  }

  render() {
    this.pipeline.render();
  }
}
