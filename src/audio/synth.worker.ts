import { buildSong, SAMPLE_RATE } from './song';
import { renderSong } from './synth';

const ctx = self as unknown as { postMessage(msg: unknown, transfer?: Transferable[]): void };

self.onmessage = () => {
  const song = renderSong(buildSong(), SAMPLE_RATE, (p) => ctx.postMessage({ type: 'progress', p }));
  ctx.postMessage({ type: 'done', left: song.left, right: song.right, sampleRate: song.sampleRate }, [
    song.left.buffer,
    song.right.buffer,
  ]);
};
