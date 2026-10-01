// Touch gestures for phones and tablets: tap and four-way swipes.
// Mouse input is ignored so desktop clicks don't pause the demo by accident.

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export interface GestureHandlers {
  enabled(): boolean;
  tap(): void;
  swipe(dir: SwipeDirection): void;
}

export function attachGestures(target: Window | HTMLElement, h: GestureHandlers) {
  let start: { id: number; x: number; y: number; t: number } | null = null;
  let multiTouch = false;

  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !h.enabled()) return;
    if (start) {
      // a second finger: this is a pinch or similar, not one of ours
      multiTouch = true;
      return;
    }
    multiTouch = false;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  };

  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dt = performance.now() - start.t;
    start = null;
    if (multiTouch) return;

    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const minSwipe = Math.max(40, Math.min(innerWidth, innerHeight) * 0.08);
    if (dt < 800 && Math.max(ax, ay) >= minSwipe) {
      // must be clearly horizontal or clearly vertical
      if (ax > ay * 1.4) h.swipe(dx < 0 ? 'left' : 'right');
      else if (ay > ax * 1.4) h.swipe(dy < 0 ? 'up' : 'down');
      return;
    }
    if (ax < 16 && ay < 16 && dt < 400) h.tap();
  };

  const cancel = (e: PointerEvent) => {
    if (start && e.pointerId === start.id) start = null;
  };

  const el = target as HTMLElement;
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
}
