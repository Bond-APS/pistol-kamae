import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/compute';
import type { SidedLandmarks } from '../src/normalize/handedness';
import type { Point } from '../src/landmarks/types';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });

/**
 * 基準となる「まっすぐ立った右利き射手」。画素座標、y は下向き。
 * 銃側（右半身）は画面左（x が小さい側）。体幹長は 200。
 */
function upright(overrides: Partial<SidedLandmarks> = {}): SidedLandmarks {
  return {
    nose: p(500, 100),
    gunEar: p(500, 100), // 肩中心の真上
    offEar: p(520, 100),
    gunShoulder: p(400, 200),
    offShoulder: p(600, 200),
    gunHip: p(440, 400),
    offHip: p(560, 400),
    gunWrist: p(100, 200), // 水平に伸ばした腕
    offWrist: p(620, 500),
    gunAnkle: p(400, 800),
    offAnkle: p(600, 800),
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('まっすぐ立ち、腕を水平に伸ばした姿勢はすべて 0 か基準値', () => {
    const m = computeMetrics(upright());
    expect(m.shoulderTilt).toBeCloseTo(0, 6);
    expect(m.hipTilt).toBeCloseTo(0, 6);
    expect(m.trunkTilt).toBeCloseTo(0, 6);
    expect(m.neckTilt).toBeCloseTo(0, 6);
    expect(m.armElevation).toBeCloseTo(0, 6);
    expect(m.armShoulderAngle).toBeCloseTo(0, 6);
    expect(m.hipLateralOffset).toBeCloseTo(0, 6);
    expect(m.stanceWidth).toBeCloseTo(1, 6); // 足首間 200 ÷ 体幹長 200
    expect(m.wristFaceDistance).toBeCloseTo((500 - 100) / 200, 6);
  });

  it('(a) 肩線：銃側の肩が上がると正', () => {
    // 銃側肩を 20px 上げる。横 200、縦 20 → atan(20/200) = 5.71°
    const m = computeMetrics(upright({ gunShoulder: p(400, 180) }));
    expect(m.shoulderTilt).toBeCloseTo(5.71, 2);
  });

  it('(a) 肩線：銃側の肩が下がると負', () => {
    const m = computeMetrics(upright({ gunShoulder: p(400, 220) }));
    expect(m.shoulderTilt).toBeCloseTo(-5.71, 2);
  });

  it('(b) 腰線：銃側の腰が上がると正', () => {
    // 横 120、縦 12 → 5.71°
    const m = computeMetrics(upright({ gunHip: p(440, 388) }));
    expect(m.hipTilt).toBeCloseTo(5.71, 2);
  });

  it('(c) 体軸：肩中心が銃側（画面左）へ寄ると正', () => {
    // 両肩を 20px 左へ。腰中心 (500,400) → 肩中心 (480,200)：atan(20/200) = 5.71°
    const m = computeMetrics(upright({ gunShoulder: p(380, 200), offShoulder: p(580, 200) }));
    expect(m.trunkTilt).toBeCloseTo(5.71, 2);
  });

  it('(c) 体軸：非銃側へ寄ると負', () => {
    const m = computeMetrics(upright({ gunShoulder: p(420, 200), offShoulder: p(620, 200) }));
    expect(m.trunkTilt).toBeCloseTo(-5.71, 2);
  });

  it('(d) 首：顔が銃側へ寄ると正、耳が見えなければ鼻で代替', () => {
    // 肩中心 (500,200)。耳 (400,100)：atan(100/100) = 45°
    const m1 = computeMetrics(upright({ gunEar: p(400, 100) }));
    expect(m1.neckTilt).toBeCloseTo(45, 6);
    // 耳が見えない → 鼻 (500,100) を使う → 0°
    const m2 = computeMetrics(upright({ gunEar: p(400, 100, 0.1) }));
    expect(m2.neckTilt).toBeCloseTo(0, 6);
  });

  it('(f) 腕：手首が上がると正', () => {
    // 肩 (400,200) → 手首 (100,200-300)：横 300、縦 300 → 45°
    const m = computeMetrics(upright({ gunWrist: p(100, -100) }));
    expect(m.armElevation).toBeCloseTo(45, 6);
  });

  it('(g) 腕と肩線：肩線が傾いてもその分を差し引く', () => {
    // 肩線 +5.71°、腕 45° → 差 39.29°
    const m = computeMetrics(upright({ gunShoulder: p(400, 180), gunWrist: p(100, 180 - 300) }));
    expect(m.armElevation).toBeCloseTo(45, 6);
    expect(m.armShoulderAngle).toBeCloseTo(45 - 5.71, 2);
  });

  it('(h) 腰中心の横ずれ：腰が銃側（画面左）へずれると正', () => {
    // 足首を 40px 右へ（＝腰が相対的に銃側へ）。足首中心 540、腰中心 500 → 40/200 = 0.2
    const m = computeMetrics(upright({ gunAnkle: p(440, 800), offAnkle: p(640, 800) }));
    expect(m.hipLateralOffset).toBeCloseTo(0.2, 6);
  });

  it('(i) スタンス幅：足首間距離 ÷ 体幹長', () => {
    const m = computeMetrics(upright({ gunAnkle: p(350, 800), offAnkle: p(650, 800) }));
    expect(m.stanceWidth).toBeCloseTo(1.5, 6);
  });

  it('visibility が閾値未満の点を使う項目は null になり、他の項目は影響を受けない', () => {
    const m = computeMetrics(upright({ gunWrist: p(100, 200, 0.3) }));
    expect(m.armElevation).toBeNull();
    expect(m.armShoulderAngle).toBeNull();
    expect(m.wristFaceDistance).toBeNull();
    expect(m.shoulderTilt).toBeCloseTo(0, 6);
  });

  it('閾値は変更できる', () => {
    const m = computeMetrics(upright({ gunWrist: p(100, 200, 0.3) }), {
      visibilityThreshold: 0.2,
    });
    expect(m.armElevation).toBeCloseTo(0, 6);
  });

  it('体幹が見えなければ体幹長を使う比率はすべて null', () => {
    const m = computeMetrics(upright({ gunHip: p(440, 400, 0) }));
    expect(m.trunkTilt).toBeNull();
    expect(m.hipLateralOffset).toBeNull();
    expect(m.stanceWidth).toBeNull();
    expect(m.wristFaceDistance).toBeNull();
    expect(m.shoulderTilt).toBeCloseTo(0, 6);
  });
});
