import { describe, expect, it } from 'vitest';
import { formatDiff, formatMetric } from './formatMetric';

describe('formatMetric：表示の桁に丸めてから符号を決める（最終-18）', () => {
  it('−0.04° は「+0.0°」（角度表と差分表で同じ）', () => {
    expect(formatMetric('shoulderTilt', -0.04)).toBe('+0.0°');
    expect(formatMetric('shoulderTilt', 0.04)).toBe('+0.0°');
    expect(formatMetric('shoulderTilt', -0.06)).toBe('−0.1°');
    expect(formatMetric('shoulderTilt', 1.26)).toBe('+1.3°');
  });
  it('比の負は全角の「−」', () => {
    expect(formatMetric('stanceWidth', -0.123)).toBe('−0.12');
    expect(formatMetric('stanceWidth', -0.004)).toBe('0.00');
    expect(formatMetric('stanceWidth', 0.5)).toBe('0.50');
  });
  it('差：丸めて 0 なら符号なし、負は全角の「−」', () => {
    expect(formatDiff('shoulderTilt', -0.04)).toBe('0.0°');
    expect(formatDiff('shoulderTilt', -0.6)).toBe('−0.6°');
    expect(formatDiff('hipLateralOffset', -0.004)).toBe('0.00');
    expect(formatDiff('hipLateralOffset', -0.03)).toBe('−0.03');
  });
});
