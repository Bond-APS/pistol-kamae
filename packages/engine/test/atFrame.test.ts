import { describe, expect, it } from 'vitest';
import { frameIndexAt } from '../src/landmarks/frames';
import type { CommonLandmarks, LandmarkFrame, Point } from '../src/landmarks/types';
import { metricsAtFrame, metricsAtTime } from '../src/metrics/atFrame';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });

const WIDTH = 1000;

/**
 * まっすぐ立った右利き射手（射手自身の左右で指定）。
 * カメラはへそ側にあるので、右半身は画面左（x が小さい側）に写る。
 * gunShoulderY を変えると銃側（右）の肩だけが上下する。
 */
function rightHanded(gunShoulderY = 200): CommonLandmarks {
  return {
    nose: p(500, 100),
    rightEar: p(500, 100),
    leftEar: p(520, 100),
    rightShoulder: p(400, gunShoulderY),
    leftShoulder: p(600, 200),
    rightHip: p(440, 400),
    leftHip: p(560, 400),
    rightWrist: p(100, 200),
    leftWrist: p(620, 500),
    rightAnkle: p(400, 800),
    leftAnkle: p(600, 800),
  };
}

/** 上の姿勢を左右反転した左利き射手（銃側＝左半身が画面右に写る） */
function leftHanded(gunShoulderY = 200): CommonLandmarks {
  const r = rightHanded(gunShoulderY);
  const flip = (q: Point) => p(WIDTH - q.x, q.y, q.visibility);
  return {
    nose: flip(r.nose),
    leftEar: flip(r.rightEar),
    rightEar: flip(r.leftEar),
    leftShoulder: flip(r.rightShoulder),
    rightShoulder: flip(r.leftShoulder),
    leftHip: flip(r.rightHip),
    rightHip: flip(r.leftHip),
    leftWrist: flip(r.rightWrist),
    rightWrist: flip(r.leftWrist),
    leftAnkle: flip(r.rightAnkle),
    rightAnkle: flip(r.leftAnkle),
  };
}

// 30fps の 4 フレーム。0 番は水平、1 番は銃側の肩が 20px 上、2 番は人物未検出、3 番は 20px 下
const frames: LandmarkFrame[] = [
  { timeSec: 0, landmarks: rightHanded() },
  { timeSec: 1 / 30, landmarks: rightHanded(180) },
  { timeSec: 2 / 30, landmarks: null },
  { timeSec: 3 / 30, landmarks: rightHanded(220) },
];
const input = { frames, handedness: 'right' as const, imageWidth: WIDTH };

describe('metricsAtFrame', () => {
  it('指定したフレームの角度を返す', () => {
    // 横 200、縦 20 → atan(20/200) = 5.71°
    const m = metricsAtFrame(input, 1);
    expect(m?.frameIndex).toBe(1);
    expect(m?.timeSec).toBeCloseTo(1 / 30, 9);
    expect(m?.values?.shoulderTilt).toBeCloseTo(5.71, 2);
    expect(metricsAtFrame(input, 0)?.values?.shoulderTilt).toBeCloseTo(0, 6);
    expect(metricsAtFrame(input, 3)?.values?.shoulderTilt).toBeCloseTo(-5.71, 2);
  });

  it('人物未検出のフレームは values が null', () => {
    const m = metricsAtFrame(input, 2);
    expect(m).not.toBeNull();
    expect(m?.values).toBeNull();
  });

  it('範囲外・整数でない番号は null', () => {
    expect(metricsAtFrame(input, -1)).toBeNull();
    expect(metricsAtFrame(input, 4)).toBeNull();
    expect(metricsAtFrame(input, 1.5)).toBeNull();
    expect(metricsAtFrame({ ...input, frames: [] }, 0)).toBeNull();
  });

  it('左利きは左右反転して、右利きと同じ値になる', () => {
    const left = metricsAtFrame(
      {
        frames: [{ timeSec: 0, landmarks: leftHanded(180) }],
        handedness: 'left',
        imageWidth: WIDTH,
      },
      0,
    );
    const right = metricsAtFrame(input, 1);
    expect(left?.values?.shoulderTilt).toBeCloseTo(5.71, 2);
    expect(left?.values).toEqual(
      Object.fromEntries(
        Object.entries(right!.values!).map(([k, v]) => [
          k,
          v === null ? null : expect.closeTo(v, 9),
        ]),
      ),
    );
  });

  it('visibility の閾値を渡せる', () => {
    const lm = rightHanded();
    lm.rightWrist = p(100, 200, 0.3);
    const one = { frames: [{ timeSec: 0, landmarks: lm }], handedness: 'right' as const };
    expect(metricsAtFrame({ ...one, imageWidth: WIDTH }, 0)?.values?.armElevation).toBeNull();
    expect(
      metricsAtFrame({ ...one, imageWidth: WIDTH, options: { visibilityThreshold: 0.2 } }, 0)
        ?.values?.armElevation,
    ).toBeCloseTo(0, 6);
  });
});

describe('metricsAtTime', () => {
  it('その時刻を含むフレームの角度を返す', () => {
    // フレーム 1 は 1/30 秒〜2/30 秒を受け持つ。真ん中の時刻で引く
    expect(metricsAtTime(input, 1.5 / 30)?.frameIndex).toBe(1);
    // マークはフレームの開始時刻で保存する。境界ぴったりでもそのフレームになる
    expect(metricsAtTime(input, 3 / 30)?.frameIndex).toBe(3);
    expect(metricsAtTime(input, 1 / 30)?.values?.shoulderTilt).toBeCloseTo(5.71, 2);
  });

  it('動画の前後にはみ出した時刻は端のフレーム', () => {
    expect(metricsAtTime(input, -1)?.frameIndex).toBe(0);
    expect(metricsAtTime(input, 99)?.frameIndex).toBe(3);
  });

  it('フレームがなければ null', () => {
    expect(metricsAtTime({ ...input, frames: [] }, 0)).toBeNull();
  });
});

describe('frameIndexAt', () => {
  it('フレームがなければ -1', () => {
    expect(frameIndexAt([], 0)).toBe(-1);
  });
});
