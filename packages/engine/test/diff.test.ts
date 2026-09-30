import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFF_FACTORS,
  DEFAULT_NOISE_WIDTHS,
  compareMetrics,
  roundMetric,
} from '../src/metrics/diff';
import { METRIC_IDS, type MetricValues } from '../src/metrics/types';

function values(patch: Partial<MetricValues> = {}): MetricValues {
  return {
    shoulderTilt: 12.4,
    hipTilt: 3.1,
    trunkTilt: -9.8,
    neckTilt: 17.2,
    armElevation: 12.3,
    armShoulderAngle: -0.1,
    hipLateralOffset: 0.04,
    stanceWidth: 0.92,
    wristFaceDistance: 1.42,
    ...patch,
  };
}

describe('roundMetric：表示の桁に丸める', () => {
  it('角度は小数 1 桁、比は小数 2 桁', () => {
    expect(roundMetric('shoulderTilt', 12.449)).toBe(12.4);
    expect(roundMetric('shoulderTilt', 12.451)).toBe(12.5);
    expect(roundMetric('stanceWidth', 0.924)).toBe(0.92);
    expect(roundMetric('stanceWidth', 0.926)).toBe(0.93);
  });

  it('−0 にはならない', () => {
    expect(Object.is(roundMetric('shoulderTilt', -0.04), 0)).toBe(true);
  });
});

describe('compareMetrics：基準と今回の差', () => {
  it('差は「今回 − 基準」', () => {
    const d = compareMetrics(values(), values({ shoulderTilt: 13.6, trunkTilt: -10.5 }));
    expect(d.shoulderTilt).toEqual({ base: 12.4, current: 13.6, diff: 1.2, level: 'large' });
    expect(d.trunkTilt.diff).toBe(-0.7);
    expect(d.hipTilt.diff).toBe(0);
  });

  it('表に出る数字どうしで引き算が合う（丸めてから差を取る）', () => {
    // 丸める前の差は 0.62 だが、表示は 12.4 と 13.1 なので、差は 0.7 と出す
    const d = compareMetrics(values({ shoulderTilt: 12.44 }), values({ shoulderTilt: 13.06 }));
    expect(d.shoulderTilt.base).toBe(12.4);
    expect(d.shoulderTilt.current).toBe(13.1);
    expect(d.shoulderTilt.diff).toBe(0.7);
  });

  it('既定では、角度は 0.6° 以上でやや差あり、0.9° 以上で差あり', () => {
    const levelOf = (diff: number) =>
      compareMetrics(values({ shoulderTilt: 10 }), values({ shoulderTilt: 10 + diff })).shoulderTilt
        .level;
    expect(levelOf(0.5)).toBe('none');
    expect(levelOf(0.6)).toBe('notable');
    expect(levelOf(-0.6)).toBe('notable');
    expect(levelOf(0.8)).toBe('notable');
    expect(levelOf(0.9)).toBe('large');
    expect(levelOf(-2)).toBe('large');
    expect(DEFAULT_NOISE_WIDTHS.shoulderTilt * DEFAULT_DIFF_FACTORS.notable).toBeCloseTo(0.6, 9);
  });

  it('腕と肩線のなす角は 0.8° と 1.2°、比は 0.02 と 0.03 が境目', () => {
    const arm = (diff: number) =>
      compareMetrics(values({ armShoulderAngle: 0 }), values({ armShoulderAngle: diff }))
        .armShoulderAngle.level;
    expect(arm(0.7)).toBe('none');
    expect(arm(0.8)).toBe('notable');
    expect(arm(1.2)).toBe('large');
    const ratio = (diff: number) =>
      compareMetrics(values({ stanceWidth: 0.9 }), values({ stanceWidth: 0.9 + diff })).stanceWidth
        .level;
    expect(ratio(0.01)).toBe('none');
    expect(ratio(0.02)).toBe('notable');
    expect(ratio(-0.03)).toBe('large');
  });

  it('どちらかが計測できない項目は、差が null で色も付かない', () => {
    const d = compareMetrics(values(), values({ stanceWidth: null }));
    expect(d.stanceWidth).toEqual({ base: 0.92, current: null, diff: null, level: 'none' });
    const both = compareMetrics(values({ neckTilt: null }), values({ neckTilt: null }));
    expect(both.neckTilt).toEqual({ base: null, current: null, diff: null, level: 'none' });
  });

  it('揺れの幅と倍数は上書きできる', () => {
    const widths = { ...DEFAULT_NOISE_WIDTHS, shoulderTilt: 1 };
    const d = compareMetrics(values({ shoulderTilt: 10 }), values({ shoulderTilt: 11.5 }), {
      noiseWidths: widths,
      factors: { notable: 1, large: 2 },
    });
    expect(d.shoulderTilt.level).toBe('notable');
  });

  it('全項目を返す', () => {
    expect(Object.keys(compareMetrics(values(), values())).sort()).toEqual([...METRIC_IDS].sort());
  });
});
