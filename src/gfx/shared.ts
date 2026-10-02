import * as THREE from 'three/webgpu';
import {
  cos,
  dot,
  float,
  fract,
  mix,
  positionGeometry,
  sin,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node } from 'three/webgpu';

export type F = Node<'float'> | number;
export type V2 = Node<'vec2'>;
export type V3 = Node<'vec3'>;
export type V4 = Node<'vec4'>;

/** Global, music-driven uniforms shared by every effect. */
export const U = {
  time: uniform(0), // song time in seconds
  beat: uniform(0), // song position in beats (float)
  kick: uniform(0), // envelopes 0..1
  snare: uniform(0),
  hat: uniform(0),
  crash: uniform(0),
  bass: uniform(0),
  lead: uniform(0),
  leadNote: uniform(0), // 0..1 pitch of current lead note
  arp: uniform(0),
  aspect: uniform(16 / 9),
  // screens narrower than 16:9 (phones in portrait) fit the 16:9 composition to their width
  fit: uniform(1), // min(1, aspect / DESIGN_ASPECT)
  viewAspect: uniform(16 / 9), // width of the visible area in layout units (height = 1)
  win: uniform(0), // Atari ST border: 0 = fullscreen, 1 = squeezed into a bordered 320x200 box
  res: uniform(new THREE.Vector2(1280, 720)),
};

// ---------------------------------------------------------------- helpers

/** Inigo Quilez cosine palette. */
export const pal = (t: F, a: V3, b: V3, c: V3, d: V3): V3 =>
  a.add(b.mul(cos(c.mul(t).add(d).mul(6.28318))));

/** Demoscene rainbow. */
export const rainbow = (t: F): V3 =>
  pal(t, vec3(0.5, 0.5, 0.5), vec3(0.5, 0.5, 0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.33, 0.67));

/** Hot copper: black -> red -> orange -> yellow -> white-ish. */
export const copper = (t: F): V3 =>
  pal(t, vec3(0.5, 0.5, 0.5), vec3(0.5, 0.5, 0.5), vec3(1.0, 0.7, 0.4), vec3(0.0, 0.15, 0.2));

/** Amiga-ish neon: magenta, cyan, purple. */
export const neon = (t: F): V3 =>
  pal(t, vec3(0.55, 0.4, 0.6), vec3(0.45, 0.4, 0.4), vec3(1.0, 1.0, 1.0), vec3(0.85, 0.1, 0.55));

export const rot2 = (p: V2, a: F): V2 => {
  const c = cos(a);
  const s = sin(a);
  return vec2(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)));
};

export const hash12 = (p: V2): Node<'float'> => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));

export const DESIGN_ASPECT = 16 / 9;

/** The Atari ST's low-res picture: 320x200 (1.6:1) inside a border, extra room at the bottom for a lower-border scroller. */
export const ST_BOX = { h: 0.68, aspect: 1.6, cy: 0.07 };

/**
 * Centered layout coords: y in [-0.5, 0.5] (more when fitting a narrow screen), x scaled by aspect.
 * Windowed layers shrink into the ST box as U.win goes to 1; pass false to stay full screen
 * (e.g. a scroller running in the border).
 */
export const screenP = (windowed = true): V2 => {
  const p = uv().sub(0.5).mul(vec2(U.aspect, 1)).div(U.fit);
  if (!windowed) return p;
  const scale = mix(float(1), float(ST_BOX.h), U.win);
  return p.sub(vec2(0, U.win.mul(ST_BOX.cy))).div(scale);
};

// ---------------------------------------------------------------- layers

export interface LayerOptions {
  order: number;
  transparent?: boolean;
  blending?: THREE.Blending;
}

/**
 * A full-screen quad that lives inside the main scene, so it can be layered
 * with 3D objects and still go through the single post-processing pass.
 */
export function screenLayer(color: V3 | V4, opts: LayerOptions): THREE.Mesh {
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.vertexNode = vec4(positionGeometry.xy, 0, 1);
  mat.transparent = !!opts.transparent; // a vec4 colour's alpha becomes the layer's opacity
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.blending = opts.blending ?? (opts.transparent ? THREE.NormalBlending : THREE.NoBlending);
  mat.colorNode = color;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.order;
  return mesh;
}
