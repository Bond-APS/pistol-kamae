import type { LandmarkFrame } from '@pistol-kamae/engine';
import { describe, expect, it } from 'vitest';
import type { AudioEnvelope } from '../audio/envelope';
import { peakShot, shiftShot, shotFrameDelta } from './shotEdit';

// 30 fps、3 秒（0.0, 0.033…, 2.967）
const frames: LandmarkFrame[] = Array.from({ length: 90 }, (_, i) => ({
  timeSec: i / 30,
  landmarks: null,
}));
const whole = { startSec: 0, endSec: 3 };

/** 10 ms ごとの音の大きさ。peaks に書いた時刻だけ音がある */
function envelopeWith(peaks: Array<{ sec: number; value: number }>, offsetSec = 0): AudioEnvelope {
  const values = new Float32Array(300);
  for (const p of peaks) values[Math.round((p.sec - offsetSec) / 0.01)] = p.value;
  return { values, binSec: 0.01, offsetSec, durationSec: 3 };
}

describe('shiftShot', () => {
  it('1 コマ早く・遅く動かす', () => {
    expect(shiftShot(frames, 1, -1, whole)).toBeCloseTo(29 / 30, 6);
    expect(shiftShot(frames, 1, 1, whole)).toBeCloseTo(31 / 30, 6);
  });
  it('切り抜きの範囲の外へは出ない', () => {
    const clip = { startSec: 1, endSec: 2 };
    expect(shiftShot(frames, 1, -1, clip)).toBeCloseTo(1, 6);
    expect(shiftShot(frames, 2, 1, clip)).toBeCloseTo(2, 6);
  });
  it('動画の最初と最後のコマでは、それ以上動かない', () => {
    expect(shiftShot(frames, 0, -1, whole)).toBe(0);
    expect(shiftShot(frames, 89 / 30, 1, whole)).toBeCloseTo(89 / 30, 6);
  });
});

describe('peakShot', () => {
  it('前後 1 秒の中で音が最大の時点に、いちばん近いコマへ移す', () => {
    // 1.36 秒の山（中央は 1.365 秒）にいちばん近いコマは 41 番（1.367 秒）
    const env = envelopeWith([{ sec: 1.36, value: 1 }]);
    expect(peakShot(env, frames, 1, whole)).toBeCloseTo(41 / 30, 6);
  });
  it('前後 1 秒の外にある大きい音（隣の射座など）は使わない', () => {
    const env = envelopeWith([
      { sec: 1.2, value: 0.4 },
      { sec: 2.5, value: 1 },
    ]);
    expect(peakShot(env, frames, 1, whole)).toBeCloseTo(36 / 30, 6);
  });
  it('音声の始まりのずれ（offsetSec）を含めた動画の時刻で探す', () => {
    const env = envelopeWith([{ sec: 1.5, value: 1 }], 0.2);
    expect(peakShot(env, frames, 1, whole)).toBeCloseTo(45 / 30, 6);
  });
  it('山が切り抜きの範囲の外なら、範囲の中だけで探す', () => {
    const env = envelopeWith([
      { sec: 0.6, value: 1 },
      { sec: 1.1, value: 0.3 },
    ]);
    expect(peakShot(env, frames, 1, { startSec: 0.8, endSec: 2 })).toBeCloseTo(33 / 30, 6);
  });
  it('その範囲に音がなければ null（範囲の外に音があっても）', () => {
    expect(peakShot(envelopeWith([]), frames, 1, whole)).toBeNull();
    expect(peakShot(envelopeWith([{ sec: 2.5, value: 1 }]), frames, 1, whole)).toBeNull();
  });
  it('同じ大きさの山が 2 つあれば、早いほうを選ぶ（保存の流れの「音の最大」と同じ決め方）', () => {
    const env = envelopeWith([
      { sec: 0.9, value: 0.8 },
      { sec: 1.3, value: 0.8 },
    ]);
    expect(peakShot(env, frames, 1, whole)).toBeCloseTo(27 / 30, 6);
  });
});

describe('shotFrameDelta', () => {
  it('動かしたコマ数（遅くが正）', () => {
    expect(shotFrameDelta(frames, 1, 41 / 30)).toBe(11);
    expect(shotFrameDelta(frames, 1, 29 / 30)).toBe(-1);
    expect(shotFrameDelta(frames, 1, 1)).toBe(0);
  });
});
