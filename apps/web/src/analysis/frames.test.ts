import type { LandmarkFrame } from '@pistol-kamae/engine';
import { describe, expect, it } from 'vitest';
import { frameIndexAt, seekTimeForFrame } from './frames';

const frames: LandmarkFrame[] = [0, 0.033, 0.067, 0.1].map((t) => ({
  timeSec: t,
  landmarks: null,
}));

describe('frameIndexAt', () => {
  it('その時刻を含むフレームを返す', () => {
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 0.02)).toBe(0);
    expect(frameIndexAt(frames, 0.033)).toBe(1);
    expect(frameIndexAt(frames, 0.05)).toBe(1);
    expect(frameIndexAt(frames, 0.0999)).toBe(3); // 許容誤差の範囲内
    expect(frameIndexAt(frames, 5)).toBe(3);
  });
  it('空なら -1', () => {
    expect(frameIndexAt([], 1)).toBe(-1);
  });
});

describe('seekTimeForFrame', () => {
  it('次のフレームとの中間を返す', () => {
    expect(seekTimeForFrame(frames, 0, 30)).toBeCloseTo(0.0165, 6);
    expect(seekTimeForFrame(frames, 1, 30)).toBeCloseTo(0.05, 6);
  });
  it('最後のフレームは fps から幅を決める', () => {
    expect(seekTimeForFrame(frames, 3, 30)).toBeCloseTo(0.1 + 1 / 60, 6);
  });
});
