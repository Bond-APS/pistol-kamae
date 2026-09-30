import { describe, expect, it } from 'vitest';
import { fromMediaPipe } from '../src/landmarks/fromMediaPipe';

describe('fromMediaPipe', () => {
  it('正規化座標を画素座標に変換し、決められた番号の点を拾う', () => {
    const lms = Array.from({ length: 33 }, (_, i) => ({
      x: i / 100,
      y: i / 200,
      visibility: i / 33,
    }));
    const c = fromMediaPipe(lms, 1000, 2000);
    expect(c).not.toBeNull();
    // 左肩は 11 番
    expect(c!.leftShoulder).toEqual({ x: 110, y: 110, visibility: 11 / 33 });
    // 右足首は 28 番
    expect(c!.rightAnkle.x).toBeCloseTo(280, 6);
  });

  it('点数が足りなければ null', () => {
    expect(fromMediaPipe([], 100, 100)).toBeNull();
  });

  it('visibility がなければ 0 とみなす', () => {
    const lms = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
    expect(fromMediaPipe(lms, 100, 100)!.nose.visibility).toBe(0);
  });
});
