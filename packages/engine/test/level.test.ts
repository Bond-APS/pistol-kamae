import { describe, expect, it } from 'vitest';
import type { CommonLandmarks, LandmarkFrame, Point } from '../src/landmarks/types';
import { metricsAtFrame } from '../src/metrics/atFrame';
import { applyAffine, rotationAbout } from '../src/normalize/affine';
import {
  applyLevel,
  checkLevelLine,
  levelInfo,
  levelTiltDeg,
  type LevelLine,
} from '../src/normalize/level';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });
const IMAGE = { width: 1000, height: 1000 };
const CENTER = { x: 500, y: 500 };

/** 長さ length、水平から deg 度（正＝右下がり）の線。(x, y) から引く */
function lineAt(x: number, y: number, length: number, deg: number): LevelLine {
  const rad = (deg * Math.PI) / 180;
  return { x1: x, y1: y, x2: x + length * Math.cos(rad), y2: y + length * Math.sin(rad) };
}

/** まっすぐ立った右利き射手。肩線・腰線は水平、体軸は鉛直 */
function upright(): CommonLandmarks {
  return {
    nose: p(500, 100),
    rightEar: p(500, 100),
    leftEar: p(520, 100),
    rightShoulder: p(400, 200),
    leftShoulder: p(600, 200),
    rightHip: p(440, 400),
    leftHip: p(560, 400),
    rightWrist: p(100, 200),
    leftWrist: p(620, 500),
    rightAnkle: p(400, 800),
    leftAnkle: p(600, 800),
  };
}

/** カメラが傾いていて、画面が時計回りに deg 度まわって写った状態にする */
function tilted(lm: CommonLandmarks, deg: number): CommonLandmarks {
  const m = rotationAbout(CENTER, deg);
  return Object.fromEntries(
    Object.entries(lm).map(([name, q]) => [name, applyAffine(m, q)]),
  ) as CommonLandmarks;
}

describe('levelInfo：線からカメラの傾きを求める', () => {
  it('水平に近い線は水平の基準。右下がりが正', () => {
    const down = levelInfo(lineAt(100, 900, 800, 2));
    expect(down?.kind).toBe('horizontal');
    expect(down?.tiltDeg).toBeCloseTo(2, 9);
    expect(down?.length).toBeCloseTo(800, 9);
    expect(levelInfo(lineAt(100, 900, 800, -1.5))?.tiltDeg).toBeCloseTo(-1.5, 9);
    expect(levelInfo(lineAt(100, 900, 800, 0))?.tiltDeg).toBeCloseTo(0, 9);
  });

  it('どちらの端から引いても同じ', () => {
    const line = lineAt(100, 900, 800, 2);
    const reversed = { x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1 };
    expect(levelInfo(reversed)?.tiltDeg).toBeCloseTo(2, 9);
    expect(levelInfo(reversed)?.kind).toBe('horizontal');
  });

  it('鉛直に近い線は鉛直の基準。鉛直からのずれがカメラの傾き', () => {
    // 鉛直なものが、時計回りに 2° まわって写っている（上端が右へ倒れている）
    const line = lineAt(500, 100, 800, 92);
    const info = levelInfo(line);
    expect(info?.kind).toBe('vertical');
    expect(info?.tiltDeg).toBeCloseTo(2, 9);
    const reversed = { x1: line.x2, y1: line.y2, x2: line.x1, y2: line.y1 };
    expect(levelInfo(reversed)?.tiltDeg).toBeCloseTo(2, 9);
    expect(levelInfo(lineAt(500, 100, 800, 88.5))?.tiltDeg).toBeCloseTo(-1.5, 9);
    // ぴったり鉛直（上から下、下から上）
    expect(levelInfo({ x1: 500, y1: 100, x2: 500, y2: 900 })?.tiltDeg).toBeCloseTo(0, 9);
    expect(levelInfo({ x1: 500, y1: 900, x2: 500, y2: 100 })?.tiltDeg).toBeCloseTo(0, 9);
  });

  it('同じカメラの傾きなら、水平の線でも鉛直の線でも同じ値になる', () => {
    const m = rotationAbout(CENTER, 3);
    const floor = [applyAffine(m, { x: 100, y: 900 }), applyAffine(m, { x: 900, y: 900 })];
    const pillar = [applyAffine(m, { x: 800, y: 100 }), applyAffine(m, { x: 800, y: 900 })];
    const toLine = ([a, b]: Array<{ x: number; y: number }>): LevelLine => ({
      x1: a!.x,
      y1: a!.y,
      x2: b!.x,
      y2: b!.y,
    });
    expect(levelInfo(toLine(floor))?.tiltDeg).toBeCloseTo(3, 9);
    expect(levelInfo(toLine(pillar))?.tiltDeg).toBeCloseTo(3, 9);
  });

  it('長さ 0 の線は null', () => {
    expect(levelInfo({ x1: 10, y1: 10, x2: 10, y2: 10 })).toBeNull();
  });
});

describe('checkLevelLine：使える線かどうか', () => {
  it('長い辺の 20% 未満は短すぎる', () => {
    expect(checkLevelLine(lineAt(100, 900, 199, 1), IMAGE)).toBe('tooShort');
    expect(checkLevelLine(lineAt(100, 900, 200, 1), IMAGE)).toBeNull();
    // 横長の画像では横の長さが基準
    expect(checkLevelLine(lineAt(100, 600, 250, 1), { width: 1280, height: 720 })).toBe('tooShort');
    expect(checkLevelLine({ x1: 5, y1: 5, x2: 5, y2: 5 }, IMAGE)).toBe('tooShort');
  });

  it('10° を超える傾きは受け付けない（水平・鉛直のどちらの基準でも）', () => {
    expect(checkLevelLine(lineAt(100, 500, 600, 10.5), IMAGE)).toBe('tooTilted');
    expect(checkLevelLine(lineAt(100, 500, 600, 9.5), IMAGE)).toBeNull();
    expect(checkLevelLine(lineAt(500, 100, 600, 79), IMAGE)).toBe('tooTilted');
    expect(checkLevelLine(lineAt(500, 100, 600, 81), IMAGE)).toBeNull();
    expect(checkLevelLine(lineAt(100, 100, 600, 45), IMAGE)).toBe('tooTilted');
  });

  it('線がない・使えない線なら、傾きは 0（補正しない）', () => {
    expect(levelTiltDeg(null, IMAGE)).toBe(0);
    expect(levelTiltDeg(lineAt(100, 900, 100, 3), IMAGE)).toBe(0);
    expect(levelTiltDeg(lineAt(100, 900, 600, 20), IMAGE)).toBe(0);
    expect(levelTiltDeg(lineAt(100, 900, 600, 3), IMAGE)).toBeCloseTo(3, 9);
  });
});

describe('applyLevel：カメラの傾きを打ち消す', () => {
  it('傾いて写った骨格を、元のまっすぐな位置に戻す', () => {
    const restored = applyLevel(tilted(upright(), 4), 4, IMAGE);
    for (const [name, q] of Object.entries(upright())) {
      expect(restored[name as keyof CommonLandmarks].x).toBeCloseTo(q.x, 6);
      expect(restored[name as keyof CommonLandmarks].y).toBeCloseTo(q.y, 6);
    }
  });

  it('画面の外にある点は visibility を 0 にする（中の点はそのまま）', () => {
    const lm = upright();
    lm.rightAnkle = p(400, 1010, 0.9);
    lm.leftAnkle = p(600, 990, 0.9);
    const out = applyLevel(lm, 2, IMAGE);
    expect(out.rightAnkle.visibility).toBe(0);
    expect(out.leftAnkle.visibility).toBe(0.9);
    expect(out.nose.visibility).toBe(1);
  });
});

describe('水平校正をした角度', () => {
  const frameOf = (lm: CommonLandmarks): LandmarkFrame[] => [{ timeSec: 0, landmarks: lm }];
  const base = { handedness: 'right' as const, imageWidth: 1000, imageHeight: 1000 };

  it('補正なしでは、カメラの傾きがそのまま角度に出る', () => {
    const m = metricsAtFrame({ ...base, frames: frameOf(tilted(upright(), 3)) }, 0);
    // 画面が時計回りに 3° → 画面左にある銃側の肩が上がって写る
    expect(m?.values?.shoulderTilt).toBeCloseTo(3, 6);
    expect(m?.values?.hipTilt).toBeCloseTo(3, 6);
    // 体軸は上が画面右（非銃側）へ倒れて写る
    expect(m?.values?.trunkTilt).toBeCloseTo(-3, 6);
  });

  it('補正すると、まっすぐ立った姿勢の角度（0°）に戻る', () => {
    const m = metricsAtFrame({ ...base, frames: frameOf(tilted(upright(), 3)), tiltDeg: 3 }, 0);
    expect(m?.values?.shoulderTilt).toBeCloseTo(0, 6);
    expect(m?.values?.hipTilt).toBeCloseTo(0, 6);
    expect(m?.values?.trunkTilt).toBeCloseTo(0, 6);
    expect(m?.values?.armElevation).toBeCloseTo(0, 6);
  });

  it('身体基準の角度と、長さの比（スタンス幅）は補正しても変わらない', () => {
    const frames = frameOf(tilted(upright(), 3));
    const raw = metricsAtFrame({ ...base, frames }, 0);
    const leveled = metricsAtFrame({ ...base, frames, tiltDeg: 3 }, 0);
    expect(leveled?.values?.armShoulderAngle).toBeCloseTo(raw!.values!.armShoulderAngle!, 6);
    expect(leveled?.values?.stanceWidth).toBeCloseTo(raw!.values!.stanceWidth!, 6);
  });

  it('左利きでも、補正するとまっすぐ立った姿勢の角度に戻る', () => {
    const m = metricsAtFrame(
      { ...base, handedness: 'left', frames: frameOf(tilted(upright(), -2)), tiltDeg: -2 },
      0,
    );
    expect(m?.values?.shoulderTilt).toBeCloseTo(0, 6);
    expect(m?.values?.trunkTilt).toBeCloseTo(0, 6);
  });

  it('画面の外にある足首は、補正で画面の中に入る位置へ回っても計測に使わない', () => {
    const lm = upright();
    // 足首が画面の下端から少し出ている。時計回りの補正で、画面右側の点は上へ動く
    lm.rightAnkle = p(400, 1003);
    lm.leftAnkle = p(900, 1003);
    const frames = frameOf(lm);
    const raw = metricsAtFrame({ ...base, frames }, 0);
    const leveled = metricsAtFrame({ ...base, frames, tiltDeg: -3 }, 0);
    expect(raw?.values?.stanceWidth).toBeNull();
    expect(leveled?.values?.stanceWidth).toBeNull();
    expect(leveled?.values?.shoulderTilt).not.toBeNull();
  });
});
