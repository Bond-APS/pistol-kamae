import { describe, expect, it } from 'vitest';
import type { MetricValues } from '../src/metrics/types';
import { computeNoiseStats, seriesStats } from '../src/noise/stats';

describe('seriesStats', () => {
  it('平均・標準偏差（不偏）・最小・最大を返す', () => {
    const s = seriesStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.count).toBe(8);
    expect(s.mean).toBeCloseTo(5, 6);
    expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 6);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
  });

  it('null は数えない', () => {
    const s = seriesStats([1, null, 3]);
    expect(s.count).toBe(2);
    expect(s.mean).toBeCloseTo(2, 6);
  });

  it('値がなければすべて null、1 個なら sd だけ null', () => {
    expect(seriesStats([]).mean).toBeNull();
    const one = seriesStats([5]);
    expect(one.mean).toBe(5);
    expect(one.sd).toBeNull();
  });
});

describe('computeNoiseStats', () => {
  it('項目ごとに統計をまとめる', () => {
    const base: MetricValues = {
      shoulderTilt: 0,
      hipTilt: 0,
      trunkTilt: 0,
      neckTilt: null,
      armElevation: 0,
      armShoulderAngle: 0,
      hipLateralOffset: 0,
      stanceWidth: 1,
      wristFaceDistance: 1,
    };
    const frames = [
      { ...base, shoulderTilt: 1 },
      { ...base, shoulderTilt: 3 },
    ];
    const n = computeNoiseStats(frames);
    expect(n.shoulderTilt.mean).toBeCloseTo(2, 6);
    expect(n.shoulderTilt.sd).toBeCloseTo(Math.SQRT2, 6);
    expect(n.neckTilt.count).toBe(0);
    expect(n.stanceWidth.sd).toBeCloseTo(0, 6);
  });
});
