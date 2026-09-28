import { describe, expect, it } from 'vitest';
import type { CommonLandmarks, Point } from '../src/landmarks/types';
import { computeMetrics } from '../src/metrics/compute';
import { mirrorX, toSided } from '../src/normalize/handedness';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });
const WIDTH = 1000;

/** 右利き射手（銃側＝右半身が画面左）。銃側の肩を少し上げてある。 */
const rightHander: CommonLandmarks = {
  nose: p(500, 100),
  leftEar: p(520, 100),
  rightEar: p(480, 100),
  leftShoulder: p(600, 200),
  rightShoulder: p(400, 180),
  leftHip: p(560, 400),
  rightHip: p(440, 400),
  leftWrist: p(620, 500),
  rightWrist: p(100, 180),
  leftAnkle: p(600, 800),
  rightAnkle: p(400, 800),
};

/** 同じ姿勢を鏡に映した左利き射手（銃側＝左半身が画面右） */
const leftHander: CommonLandmarks = {
  nose: p(500, 100),
  leftEar: p(520, 100),
  rightEar: p(480, 100),
  leftShoulder: p(600, 180),
  rightShoulder: p(400, 200),
  leftHip: p(560, 400),
  rightHip: p(440, 400),
  leftWrist: p(900, 180),
  rightWrist: p(380, 500),
  leftAnkle: p(600, 800),
  rightAnkle: p(400, 800),
};

describe('toSided', () => {
  it('右利きは右半身が銃側になり、座標は変わらない', () => {
    const s = toSided(rightHander, 'right', WIDTH);
    expect(s.gunShoulder).toEqual(rightHander.rightShoulder);
    expect(s.offShoulder).toEqual(rightHander.leftShoulder);
    expect(s.gunWrist).toEqual(rightHander.rightWrist);
  });

  it('左利きは x を反転し、左半身が銃側になる', () => {
    const s = toSided(leftHander, 'left', WIDTH);
    // 左肩 (600,180) → 反転で (400,180)
    expect(s.gunShoulder).toEqual(p(400, 180));
    expect(s.offShoulder).toEqual(p(600, 200));
    expect(s.gunWrist).toEqual(p(100, 180));
  });

  it('鏡像の左利きと右利きは同じ計測値になる', () => {
    const mr = computeMetrics(toSided(rightHander, 'right', WIDTH));
    const ml = computeMetrics(toSided(leftHander, 'left', WIDTH));
    expect(mr.shoulderTilt).toBeCloseTo(5.71, 2);
    for (const key of Object.keys(mr) as (keyof typeof mr)[]) {
      expect(ml[key]).toBeCloseTo(mr[key]!, 6);
    }
  });

  it('右利きの動画を左利き扱いにすると傾きの符号が反転する', () => {
    const correct = computeMetrics(toSided(rightHander, 'right', WIDTH));
    const wrong = computeMetrics(toSided(rightHander, 'left', WIDTH));
    expect(wrong.shoulderTilt).toBeCloseTo(-correct.shoulderTilt!, 6);
  });
});

describe('mirrorX', () => {
  it('2 回反転すると元に戻る', () => {
    expect(mirrorX(mirrorX(leftHander, WIDTH), WIDTH)).toEqual(leftHander);
  });
});
