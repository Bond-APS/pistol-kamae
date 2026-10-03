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
import {
  checkClip,
  clipContains,
  clipDurationSec,
  clipOf,
  commonWindow,
  shotWindow,
} from '../src/record/clip';
import { defaultTitle, normalizeMemo, normalizeTitle } from '../src/record/title';
import { RECORD_FORMAT_VERSION, type ShotRecord } from '../src/record/types';
import {
  checkShotRecord,
  hasUsableLevel,
  shotMetricsOfRecord,
  tiltDegOfRecord,
  upgradeShotRecord,
} from '../src/record/validate';

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
    clip: null,
    level: null,
    meta: {
      title: '2026-09-30 14:05',
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
    expect(checkShotRecord({ ...record(), formatVersion: 1 })).toBe('unsupportedVersion');
    expect(checkShotRecord({ ...record(), formatVersion: 4 })).toBe('unsupportedVersion');
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

  it('水平校正の線は、なし（null）か、2 点の形であること', () => {
    // 画像は 1000×1000。長さ 600、傾き約 1.9° の線
    const ok = { ...record(), level: { x1: 200, y1: 900, x2: 800, y2: 920 } };
    expect(checkShotRecord(ok)).toBeNull();
    // 項目そのものがない（版 1 の形のまま）
    const missing: Partial<ShotRecord> = record();
    delete missing.level;
    expect(checkShotRecord(missing)).toBe('invalidLevel');
    expect(checkShotRecord({ ...record(), level: { x1: 0, y1: 0 } })).toBe('invalidLevel');
  });

  it('長さや傾きの基準に合わない線は、記録は開けるが補正には使わない', () => {
    // 短すぎる線（長さ 100 は長い辺の 20% 未満）と、傾きすぎの線（約 27°）
    for (const level of [
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 0, y1: 0, x2: 600, y2: 300 },
    ]) {
      const r: ShotRecord = { ...record(), level };
      expect(checkShotRecord(r)).toBeNull();
      expect(hasUsableLevel(r)).toBe(false);
      expect(tiltDegOfRecord(r)).toBe(0);
    }
    expect(hasUsableLevel(record())).toBe(false);
    expect(hasUsableLevel({ ...record(), level: { x1: 200, y1: 900, x2: 800, y2: 920 } })).toBe(
      true,
    );
  });

  it('版 1・版 2 の記録は、線なし・範囲なし・タイトルは撮影日時として今の版に直せる', () => {
    const v2: Record<string, unknown> = { ...record(), formatVersion: 2 };
    delete v2.clip;
    v2.meta = { ...(v2.meta as object) };
    delete (v2.meta as Record<string, unknown>).title;
    const v1: Record<string, unknown> = { ...v2, formatVersion: 1 };
    delete v1.level;
    for (const old of [v1, v2]) {
      expect(checkShotRecord(old)).toBe('unsupportedVersion');
      const upgraded = upgradeShotRecord(old);
      expect(checkShotRecord(upgraded)).toBeNull();
      expect(upgraded).toEqual(record());
    }
    // 今の版はそのまま
    expect(upgradeShotRecord(record())).toEqual(record());
    expect(upgradeShotRecord(null)).toBeNull();
  });

  it('切り抜きの範囲は、なし（null）か、動画の中に収まり撃発ポイントを含む区間であること', () => {
    // 撃発は 1/30 秒、動画は 0.1 秒
    expect(checkShotRecord({ ...record(), clip: { startSec: 0.02, endSec: 0.08 } })).toBeNull();
    expect(checkShotRecord({ ...record(), clip: { startSec: 0, endSec: 0.1 } })).toBeNull();
    const missing: Record<string, unknown> = { ...record() };
    delete missing.clip;
    expect(checkShotRecord(missing)).toBe('invalidClip');
    expect(checkShotRecord({ ...record(), clip: { startSec: 0 } })).toBe('invalidClip');
    expect(checkShotRecord({ ...record(), clip: { startSec: -0.01, endSec: 0.08 } })).toBe(
      'invalidClip',
    );
    expect(checkShotRecord({ ...record(), clip: { startSec: 0, endSec: 0.11 } })).toBe(
      'invalidClip',
    );
    expect(checkShotRecord({ ...record(), clip: { startSec: 0.05, endSec: 0.05 } })).toBe(
      'invalidClip',
    );
    expect(checkShotRecord({ ...record(), clip: { startSec: 0.05, endSec: 0.09 } })).toBe(
      'shotOutsideClip',
    );
  });

  it('タイトルは空でなく、前後に空白がなく、60 字以内であること', () => {
    for (const title of ['', ' 題名', '題名 ', 'あ'.repeat(61)]) {
      const r = record();
      r.meta = { ...r.meta, title };
      expect(checkShotRecord(r)).toBe('invalidMeta');
    }
    const r = record();
    r.meta = { ...r.meta, title: 'あ'.repeat(60) };
    expect(checkShotRecord(r)).toBeNull();
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

  it('水平校正の線があれば、カメラの傾きの分だけ補正した角度が出る', () => {
    const r = record();
    // 右下がり 3° の線（水平なものが右下がりに写っている）
    const rad = (3 * Math.PI) / 180;
    r.level = { x1: 200, y1: 900, x2: 200 + 600 * Math.cos(rad), y2: 900 + 600 * Math.sin(rad) };
    expect(tiltDegOfRecord(r)).toBeCloseTo(3, 6);
    // 肩線は、非銃側（画面右）が下がって写っている分だけ銃側が上がって見えていた → 補正で 3° 減る
    expect(shotMetricsOfRecord(r)?.values?.shoulderTilt).toBeCloseTo(5.71 - 3, 2);
    // 左利きとして扱うと符号が逆
    r.meta.handedness = 'left';
    expect(shotMetricsOfRecord(r)?.values?.shoulderTilt).toBeCloseTo(-(5.71 - 3), 2);
    expect(tiltDegOfRecord(record())).toBe(0);
  });
});

describe('タイトルとメモ', () => {
  it('初期値のタイトルは撮影日時。日時が不正なら空', () => {
    expect(defaultTitle('2026-10-03T14:25')).toBe('2026-10-03 14:25');
    expect(defaultTitle('2026-10-03')).toBe('');
  });

  it('タイトルは前後の空白を除く。空と 60 字超は null', () => {
    expect(normalizeTitle(' 10/1 の良かった 1 発 ')).toBe('10/1 の良かった 1 発');
    expect(normalizeTitle('   ')).toBeNull();
    expect(normalizeTitle('あ'.repeat(60))).toHaveLength(60);
    expect(normalizeTitle('あ'.repeat(61))).toBeNull();
  });

  it('メモは空でもよく、100 字超は null', () => {
    expect(normalizeMemo('  ')).toBe('');
    expect(normalizeMemo('あ'.repeat(100))).toHaveLength(100);
    expect(normalizeMemo('あ'.repeat(101))).toBeNull();
  });
});

describe('切り抜きの範囲', () => {
  it('範囲なし（null）は動画の全体', () => {
    expect(clipOf(null, 14)).toEqual({ startSec: 0, endSec: 14 });
    expect(clipDurationSec(null, 14)).toBe(14);
    expect(clipDurationSec({ startSec: 1.8, endSec: 7 }, 14)).toBeCloseTo(5.2);
    expect(clipContains(null, 14, 13.9)).toBe(true);
    expect(clipContains({ startSec: 1.8, endSec: 7 }, 14, 1.8)).toBe(true);
    expect(clipContains({ startSec: 1.8, endSec: 7 }, 14, 7.01)).toBe(false);
  });

  it('範囲の検査：動画の中に収まり、開始＜終了、撃発を含む', () => {
    expect(checkClip(null, 14)).toBeNull();
    expect(checkClip({ startSec: 1.8, endSec: 7 }, 14, 3.4)).toBeNull();
    expect(checkClip({ startSec: 1.8, endSec: 7 }, 14, 1.8)).toBeNull();
    expect(checkClip({ startSec: -1, endSec: 7 }, 14)).toBe('invalidClip');
    expect(checkClip({ startSec: 1, endSec: 14.5 }, 14)).toBe('invalidClip');
    expect(checkClip({ startSec: 7, endSec: 7 }, 14)).toBe('invalidClip');
    expect(checkClip({ startSec: NaN, endSec: 7 }, 14)).toBe('invalidClip');
    expect(checkClip({ startSec: 1.8, endSec: 7 }, 14, 7.5)).toBe('shotOutsideClip');
    expect(checkClip(null, 14, 15)).toBe('shotOutsideClip');
  });

  it('撃発を 0 とした前後の長さと、2 本に共通する区間（短い方に合わせる）', () => {
    const a = shotWindow({ startSec: 1.8, endSec: 7 }, 14, 3.4);
    expect(a.beforeSec).toBeCloseTo(1.6);
    expect(a.afterSec).toBeCloseTo(3.6);
    const b = shotWindow(null, 6, 4);
    expect(b).toEqual({ beforeSec: 4, afterSec: 2 });
    const common = commonWindow(a, b);
    expect(common.beforeSec).toBeCloseTo(1.6);
    expect(common.afterSec).toBeCloseTo(2);
    // 壊れた値でも負にはならない
    expect(commonWindow({ beforeSec: -1, afterSec: 1 }, b)).toEqual({ beforeSec: 0, afterSec: 1 });
  });
});
