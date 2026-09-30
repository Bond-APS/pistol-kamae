import { describe, expect, it } from 'vitest';
import type { CommonLandmarks, LandmarkFrame, Point } from '../src/landmarks/types';
import { addCustomMark, setShotMark } from '../src/marks/operations';
import {
  normalizeLocalDateTime,
  parseLocalDateTime,
  toLocalDateTime,
} from '../src/record/dateTime';
import { formatScore, isValidScore, parseScore } from '../src/record/score';
import { hasShooterName, normalizeShooterName } from '../src/record/shooter';
import { RECORD_FORMAT_VERSION, type ShotRecord } from '../src/record/types';
import { checkShotRecord, shotMetricsOfRecord } from '../src/record/validate';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });

/** まっすぐ立った右利き射手。gunShoulderY を変えると銃側（右）の肩だけが上下する */
function standing(gunShoulderY = 200): CommonLandmarks {
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

const frames: LandmarkFrame[] = [
  { timeSec: 0, landmarks: standing() },
  { timeSec: 1 / 30, landmarks: standing(180) },
  { timeSec: 2 / 30, landmarks: null },
];

function record(): ShotRecord {
  return {
    formatVersion: RECORD_FORMAT_VERSION,
    analysis: {
      backendId: 'mediapipe-full-video',
      width: 1000,
      height: 1000,
      fps: 30,
      durationSec: 0.1,
      frames,
    },
    marks: addCustomMark(setShotMark([], 1 / 30), { id: 'c1', label: '振り上げ開始', timeSec: 0 }),
    meta: {
      shotAt: '2026-09-30T14:05',
      shooterName: '山田',
      handedness: 'right',
      score: 10.3,
      memo: '',
      favorite: false,
    },
  };
}

describe('点数の入力', () => {
  it('空欄は未入力（null）', () => {
    expect(parseScore('')).toEqual({ ok: true, value: null });
    expect(parseScore('   ')).toEqual({ ok: true, value: null });
  });

  it('整数と小数 1 桁を受け付ける', () => {
    expect(parseScore('10')).toEqual({ ok: true, value: 10 });
    expect(parseScore('10.3')).toEqual({ ok: true, value: 10.3 });
    expect(parseScore('0')).toEqual({ ok: true, value: 0 });
    expect(parseScore('10.9')).toEqual({ ok: true, value: 10.9 });
    expect(parseScore(' 9.5 ')).toEqual({ ok: true, value: 9.5 });
  });

  it('小数点のカンマと全角の数字も受け付ける', () => {
    expect(parseScore('10,5')).toEqual({ ok: true, value: 10.5 });
    expect(parseScore('１０．５')).toEqual({ ok: true, value: 10.5 });
  });

  it('0〜10.9 の外は範囲外', () => {
    expect(parseScore('11')).toEqual({ ok: false, reason: 'outOfRange' });
    expect(parseScore('105')).toEqual({ ok: false, reason: 'outOfRange' });
    expect(parseScore('11.0')).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('数値でないもの、小数 2 桁以上、負の数は受け付けない', () => {
    for (const text of ['abc', '10.35', '-1', '1e1', '10.', '.5', '1 0']) {
      expect(parseScore(text)).toEqual({ ok: false, reason: 'notNumber' });
    }
  });

  it('保存できる点数かどうか', () => {
    expect(isValidScore(null)).toBe(true);
    expect(isValidScore(10.9)).toBe(true);
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(11)).toBe(false);
    expect(isValidScore(-0.1)).toBe(false);
    expect(isValidScore(10.35)).toBe(false);
    expect(isValidScore(NaN)).toBe(false);
    expect(isValidScore('10')).toBe(false);
  });

  it('表示は入力どおり（10 を 10.0 に変えない）', () => {
    expect(formatScore(10)).toBe('10');
    expect(formatScore(10.3)).toBe('10.3');
    expect(formatScore(9.1)).toBe('9.1');
  });
});

describe('撮影日時', () => {
  it('Date を現地時刻の文字列に直す（秒は切り捨て）', () => {
    expect(toLocalDateTime(new Date(2026, 8, 30, 14, 5, 59))).toBe('2026-09-30T14:05');
    expect(toLocalDateTime(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04');
  });

  it('文字列を分解し、曜日を求める', () => {
    // 2026 年 9 月 30 日は水曜日
    expect(parseLocalDateTime('2026-09-30T14:05')).toEqual({
      year: 2026,
      month: 9,
      day: 30,
      hour: 14,
      minute: 5,
      weekday: 3,
    });
    // 2026 年 8 月 29 日は土曜日
    expect(parseLocalDateTime('2026-08-29T15:40')?.weekday).toBe(6);
  });

  it('秒が付いていても受け付け、保存用には秒を落とす', () => {
    expect(parseLocalDateTime('2026-09-30T14:05:33')?.minute).toBe(5);
    expect(normalizeLocalDateTime('2026-09-30T14:05:33')).toBe('2026-09-30T14:05');
    expect(normalizeLocalDateTime('2026-09-30T14:05')).toBe('2026-09-30T14:05');
  });

  it('形式が違う、存在しない日時は null', () => {
    for (const text of [
      '',
      '2026-09-30',
      '2026/09/30 14:05',
      '2026-02-30T10:00',
      '2026-13-01T10:00',
      '2026-09-30T24:00',
      '2026-09-30T10:60',
    ]) {
      expect(parseLocalDateTime(text)).toBeNull();
      expect(normalizeLocalDateTime(text)).toBeNull();
    }
  });

  it('うるう年の 2 月 29 日は受け付ける', () => {
    expect(parseLocalDateTime('2028-02-29T10:00')).not.toBeNull();
    expect(parseLocalDateTime('2026-02-29T10:00')).toBeNull();
  });
});

describe('射手名', () => {
  it('前後の空白を除く。空と長すぎる名前は null', () => {
    expect(normalizeShooterName('  山田 ')).toBe('山田');
    expect(normalizeShooterName('   ')).toBeNull();
    expect(normalizeShooterName('あ'.repeat(30))).toBe('あ'.repeat(30));
    expect(normalizeShooterName('あ'.repeat(31))).toBeNull();
  });

  it('同じ名前は 1 人まで（前後の空白は無視）', () => {
    const shooters = [{ name: '山田' }, { name: '佐藤' }];
    expect(hasShooterName(shooters, ' 山田 ')).toBe(true);
    expect(hasShooterName(shooters, '鈴木')).toBe(false);
    expect(hasShooterName(shooters, '')).toBe(false);
  });

  it('編集中の射手自身の名前は重複とみなさない', () => {
    const shooters = [{ name: '山田' }, { name: '佐藤' }];
    expect(hasShooterName(shooters, '山田', '山田')).toBe(false);
    expect(hasShooterName(shooters, '佐藤', '山田')).toBe(true);
  });
});

describe('保存形式の検査', () => {
  it('正しい記録は問題なし', () => {
    expect(checkShotRecord(record())).toBeNull();
  });

  it('JSON にして戻しても同じ内容で、問題なし', () => {
    const restored: unknown = JSON.parse(JSON.stringify(record()));
    expect(restored).toEqual(record());
    expect(checkShotRecord(restored)).toBeNull();
  });

  it('点数とメモが空でもよい', () => {
    const r = record();
    r.meta.score = null;
    expect(checkShotRecord(r)).toBeNull();
  });

  it('オブジェクトでなければ notObject', () => {
    expect(checkShotRecord(null)).toBe('notObject');
    expect(checkShotRecord('x')).toBe('notObject');
  });

  it('版番号が違えば unsupportedVersion', () => {
    expect(checkShotRecord({ ...record(), formatVersion: 2 })).toBe('unsupportedVersion');
    expect(checkShotRecord({ ...record(), formatVersion: undefined })).toBe('unsupportedVersion');
  });

  it('解析結果が壊れていれば invalidAnalysis', () => {
    const noFrames = record();
    noFrames.analysis.frames = [];
    expect(checkShotRecord(noFrames)).toBe('invalidAnalysis');

    const badPoint = JSON.parse(JSON.stringify(record())) as ShotRecord;
    // 関節が 1 つ欠けている
    delete (badPoint.analysis.frames[0]!.landmarks as Partial<CommonLandmarks>).nose;
    expect(checkShotRecord(badPoint)).toBe('invalidAnalysis');

    expect(checkShotRecord({ ...record(), analysis: { ...record().analysis, width: 0 } })).toBe(
      'invalidAnalysis',
    );
  });

  it('撃発マークがない、または 2 つあれば noShotMark', () => {
    const none = record();
    none.marks = none.marks.filter((m) => m.kind !== 'shot');
    expect(checkShotRecord(none)).toBe('noShotMark');

    const two = record();
    two.marks = [...two.marks, { id: 'shot2', kind: 'shot', label: '', timeSec: 0 }];
    expect(checkShotRecord(two)).toBe('noShotMark');
  });

  it('マークの形が違う、id が重複していれば invalidMarks', () => {
    expect(checkShotRecord({ ...record(), marks: [{ id: 'shot' }] })).toBe('invalidMarks');
    const dup = record();
    dup.marks = [...dup.marks, { id: 'c1', kind: 'custom', label: '別の名前', timeSec: 0 }];
    expect(checkShotRecord(dup)).toBe('invalidMarks');
  });

  it('メタ情報が不正なら invalidMeta', () => {
    const cases: Array<Partial<ShotRecord['meta']>> = [
      { shotAt: '2026-09-30' },
      { shooterName: '' },
      { shooterName: ' 山田' },
      { score: 11 },
      { score: 10.35 },
      { handedness: 'both' as never },
    ];
    for (const patch of cases) {
      const r = record();
      r.meta = { ...r.meta, ...patch };
      expect(checkShotRecord(r)).toBe('invalidMeta');
    }
  });
});

describe('記録の撃発フレームの角度', () => {
  it('撃発マークの時刻のフレームから計算する', () => {
    const m = shotMetricsOfRecord(record());
    expect(m?.frameIndex).toBe(1);
    // 銃側の肩が 20px 上、肩幅 200px → atan(20/200) ≒ 5.71°
    expect(m?.values?.shoulderTilt).toBeCloseTo(5.71, 2);
  });

  it('利き手を変えると、同じ座標から符号が逆の角度が出る', () => {
    const r = record();
    r.meta.handedness = 'left';
    expect(shotMetricsOfRecord(r)?.values?.shoulderTilt).toBeCloseTo(-5.71, 2);
  });

  it('撃発マークがなければ null', () => {
    const r = record();
    r.marks = [];
    expect(shotMetricsOfRecord(r)).toBeNull();
  });
});
