// 段階⑥：書き出し・読込の、画面から切り離した部品の単体テスト。
// CSV の見出し・行・空欄・丸め、ファイル名の置き換え、JSON の往復（組み立て → 読み取りで同じ記録に戻る）、
// 読込の方針（射手の引き当て・利き手の食い違い・重複）。

import {
  METRIC_IDS,
  RECORD_FORMAT_VERSION,
  SHOT_MARK_ID,
  type CommonLandmarks,
  type LandmarkFrame,
  type Point,
  type ShotRecord,
} from '@pistol-kamae/engine';
import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64, encodeBase64Chunks } from './base64';
import { buildCsv, CSV_BOM, csvHeader } from './csv';
import {
  allRecordsFileName,
  compareFileName,
  fileDateTime,
  recordFileName,
  safeFilePart,
} from './filename';
import { planImport } from './importPlan';
import {
  buildExportBlob,
  decodeAudio,
  EXPORT_APP,
  EXPORT_FORMAT_VERSION,
  parseExportText,
  type ExportItem,
} from './json';
import { metricsSeries } from './metricsSeries';

const p = (x: number, y: number, visibility = 1): Point => ({ x, y, visibility });

/** まっすぐ立った右利き射手（記録のテストと同じ形）。gunShoulderY で銃側の肩だけを上下 */
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

const FPS = 30;
/** 6 コマ。3 コマ目は人物なし */
const frames: LandmarkFrame[] = [0, 1, 2, 3, 4, 5].map((i) => ({
  timeSec: i / FPS,
  landmarks: i === 2 ? null : standing(200 - i * 5),
  ...(i % 2 === 0 ? { exact: true } : {}),
}));

function record(over: Partial<ShotRecord['meta']> = {}): ShotRecord {
  return {
    formatVersion: RECORD_FORMAT_VERSION,
    analysis: {
      backendId: 'mediapipe-full-video',
      width: 1000,
      height: 1000,
      fps: FPS,
      durationSec: 0.2,
      frames,
    },
    marks: [{ id: SHOT_MARK_ID, kind: 'shot', label: '撃発', timeSec: 3 / FPS }],
    // 2 コマ目〜5 コマ目（番号 1〜4）
    clip: { startSec: 1 / FPS, endSec: 4 / FPS },
    level: null,
    meta: {
      title: '試し撃ち',
      shotAt: '2026-10-05T14:20',
      shooterName: '山田',
      handedness: 'right',
      score: 10.3,
      memo: 'メモ',
      favorite: true,
      ...over,
    },
  };
}

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
const textOf = (bytes: ArrayBuffer): string => new TextDecoder().decode(bytes);

describe('ファイル名', () => {
  it('使えない文字を _ に置き換え、前後の空白と . を除く', () => {
    expect(safeFilePart(' a/b\\c:d*e?f"g<h>i|j ')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(safeFilePart('..名前.. ')).toBe('名前');
    expect(safeFilePart('   ')).toBe('_');
    expect(safeFilePart('x'.repeat(60))).toHaveLength(40);
  });
  it('撮影日時は YYYY-MM-DD_HHmm', () => {
    expect(fileDateTime('2026-10-05T14:20')).toBe('2026-10-05_1420');
    expect(fileDateTime('2026-10-05T14:20:33')).toBe('2026-10-05_1420');
    expect(fileDateTime('不正')).toBe('不正');
  });
  it('記録・全件・比較の形', () => {
    expect(recordFileName('山田', '2026-10-05T14:20', 'json')).toBe(
      'kamae_山田_2026-10-05_1420.json',
    );
    expect(recordFileName('山田', '2026-10-05T14:20', 'csv')).toBe(
      'kamae_山田_2026-10-05_1420.csv',
    );
    expect(allRecordsFileName('2026-10-12T09:05')).toBe('kamae_すべて_2026-10-12_0905.json');
    expect(compareFileName('2026-10-05 14:20', '良い/日')).toBe(
      'kamae_比較_2026-10-05 14_20_良い_日.png',
    );
  });
});

describe('角度時系列', () => {
  it('切り抜きの範囲の中のコマだけ。撃発を 0 とした時刻', () => {
    const rows = metricsSeries(record());
    expect(rows.map((r) => r.frameIndex)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => Math.round(r.relSec * FPS))).toEqual([-2, -1, 0, 1]);
    expect(rows[1]!.values).toBeNull();
    expect(rows[0]!.values?.shoulderTilt).not.toBeNull();
  });
  it('範囲なし（全体）なら全コマ', () => {
    expect(metricsSeries({ ...record(), clip: null })).toHaveLength(6);
  });
});

describe('CSV', () => {
  it('BOM 付き、CRLF、見出しは 2 列＋9 項目（単位付き）', () => {
    const csv = buildCsv(record());
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    // 末尾の改行のあとは空
    expect(lines.at(-1)).toBe('');
    expect(lines).toHaveLength(1 + 4 + 1);
    const header = lines[0]!.split(',');
    expect(header).toEqual(csvHeader());
    expect(header).toHaveLength(2 + METRIC_IDS.length);
    expect(header[0]).toBe('コマ番号');
    expect(header[2]).toBe('(a) 肩線の傾き（水平基準）〔°〕');
    expect(header.at(-1)).toBe('(j) 手首と顔の水平距離（体幹長比）〔比〕');
  });
  it('コマ番号は範囲の先頭を 1。人物のないコマは空欄。角度は 0.1°、比は 0.01 の桁', () => {
    const lines = buildCsv(record()).slice(1).trimEnd().split('\r\n').slice(1);
    const cells = lines.map((l) => l.split(','));
    expect(cells.map((c) => c[0])).toEqual(['1', '2', '3', '4']);
    expect(cells.map((c) => c[1])).toEqual(['-0.067', '-0.033', '0.000', '0.033']);
    // 2 行目（番号 2）は人物なし：9 項目すべて空欄
    expect(cells[1]!.slice(2)).toEqual(Array(9).fill(''));
    // 角度（小数 1 桁）と比（小数 2 桁）
    expect(cells[0]![2]).toMatch(/^-?\d+\.\d$/);
    expect(cells[0]!.at(-1)).toMatch(/^-?\d+\.\d\d$/);
  });
});

describe('base64', () => {
  it('往復で同じバイト列。塊をつなげても同じ', () => {
    const bytes = new Uint8Array(3 * 65536 * 2 + 1000).map((_, i) => (i * 7 + 3) % 256);
    const chunks = encodeBase64Chunks(bytes.buffer);
    expect(chunks.length).toBe(3);
    expect(chunks.join('')).toBe(encodeBase64(bytes.buffer));
    expect(new Uint8Array(decodeBase64(chunks.join('')))).toEqual(bytes);
    expect(textOf(decodeBase64(encodeBase64(bytesOf('あいう'))))).toBe('あいう');
  });
  it('長さが合わない・使えない文字は例外', () => {
    expect(() => decodeBase64('abc')).toThrow();
    expect(() => decodeBase64('ab$=')).toThrow();
  });
});

function item(over: Partial<ExportItem> = {}): ExportItem {
  return {
    record: record(),
    still: { bytes: bytesOf('STILL'), type: 'image/jpeg' },
    thumb: { bytes: bytesOf('THUMB'), type: 'image/jpeg' },
    audio: {
      values: Float32Array.from([0, 0.5, 1]),
      binSec: 0.01,
      offsetSec: 0.02,
      durationSec: 0.03,
    },
    video: null,
    ...over,
  };
}

describe('JSON の往復', () => {
  it('組み立て → 読み取りで、記録・静止画・音のグラフ・動画が戻る', async () => {
    const video = { bytes: bytesOf('VIDEO-BYTES'), type: 'video/mp4' };
    const blob = buildExportBlob(
      [item({ video }), item({ record: record({ title: '2 本目' }) })],
      '2026-10-12T09:05',
    );
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    const raw = JSON.parse(text);
    expect(raw.app).toBe(EXPORT_APP);
    expect(raw.exportVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(raw.exportedAt).toBe('2026-10-12T09:05');
    expect(raw.records).toHaveLength(2);
    // 角度時系列が入っている（範囲の中の 4 コマ）
    expect(raw.records[0].metrics).toHaveLength(4);
    expect(raw.records[0].metrics[2].relSec).toBeCloseTo(0, 6);

    const parsed = parseExportText(text);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind !== 'ok') return;
    expect(parsed.skipped).toBe(0);
    const [first, second] = parsed.file.records;
    expect(first!.record).toEqual(record());
    expect(second!.record.meta.title).toBe('2 本目');
    expect(textOf(first!.still.bytes)).toBe('STILL');
    expect(first!.thumb.type).toBe('image/jpeg');
    expect(textOf(first!.video!.bytes)).toBe('VIDEO-BYTES');
    expect(first!.video!.type).toBe('video/mp4');
    expect(second!.video).toBeNull();
    const audio = decodeAudio(first!.audio!);
    expect(Array.from(audio.values)).toEqual([0, 0.5, 1]);
    expect(audio).toMatchObject({ binSec: 0.01, offsetSec: 0.02, durationSec: 0.03 });
  });
  it('音声なし（空の包絡線）と、音のグラフなし（null）を区別して戻す', async () => {
    const blob = buildExportBlob(
      [
        item({
          audio: { values: new Float32Array(0), binSec: 0.01, offsetSec: 0, durationSec: 0 },
        }),
        item({ audio: null }),
      ],
      '2026-10-12T09:05',
    );
    const parsed = parseExportText(await blob.text());
    if (parsed.kind !== 'ok') throw new Error(parsed.problem);
    expect(parsed.file.records[0]!.audio?.values).toEqual([]);
    expect(parsed.file.records[1]!.audio).toBeNull();
  });
  it('古い版の記録（版 2）は今の版に読み替える', async () => {
    const blob = buildExportBlob([item()], '2026-10-12T09:05');
    const raw = JSON.parse(await blob.text());
    const r = raw.records[0].record;
    delete r.clip;
    delete r.meta.title;
    r.formatVersion = 2;
    const parsed = parseExportText(JSON.stringify(raw));
    if (parsed.kind !== 'ok') throw new Error(parsed.problem);
    const got = parsed.file.records[0]!.record;
    expect(got.formatVersion).toBe(RECORD_FORMAT_VERSION);
    expect(got.clip).toBeNull();
    expect(got.meta.title).toBe('2026-10-05 14:20');
  });
  it('形式の合わない記録は飛ばして件数を返す。全部だめなら noRecords', async () => {
    const blob = buildExportBlob([item(), item()], '2026-10-12T09:05');
    const raw = JSON.parse(await blob.text());
    raw.records[1].record.marks = [];
    raw.records.push({ record: raw.records[0].record });
    const parsed = parseExportText(JSON.stringify(raw));
    if (parsed.kind !== 'ok') throw new Error(parsed.problem);
    expect(parsed.file.records).toHaveLength(1);
    expect(parsed.skipped).toBe(2);
    raw.records = [raw.records[1]];
    expect(parseExportText(JSON.stringify(raw))).toEqual({ kind: 'problem', problem: 'noRecords' });
  });
  it('JSON でない・別のアプリ・新しい版は理由を返す', () => {
    expect(parseExportText('{')).toEqual({ kind: 'problem', problem: 'notJson' });
    expect(parseExportText('{"app":"other"}')).toEqual({ kind: 'problem', problem: 'notKamae' });
    expect(parseExportText(`{"app":"${EXPORT_APP}","exportVersion":99,"records":[]}`)).toEqual({
      kind: 'problem',
      problem: 'unsupportedVersion',
    });
    expect(parseExportText(`{"app":"${EXPORT_APP}","exportVersion":1}`)).toEqual({
      kind: 'problem',
      problem: 'noRecords',
    });
  });
});

describe('読込の方針', () => {
  const known = [{ name: '山田', handedness: 'right' as const }];
  it('射手を名前で引き当て、いなければ新規。利き手が違えば食い違い', () => {
    const plan = planImport(
      [
        record(),
        record({ shooterName: '佐藤', handedness: 'left' }),
        // 同じ射手の別の記録（撮影日時が違う）。利き手がファイルの中で混じっていても、最初のものを使う
        record({ handedness: 'left', shotAt: '2026-10-06T10:00' }),
      ],
      known,
      [],
    );
    expect(plan.shooters).toHaveLength(2);
    expect(plan.shooters[0]).toMatchObject({ name: '山田', registered: known[0], conflict: false });
    expect(plan.shooters[1]).toMatchObject({ name: '佐藤', registered: null, conflict: false });
    expect(plan.duplicates).toEqual([]);
    const conflict = planImport([record({ handedness: 'left' })], known, []);
    expect(conflict.shooters[0]).toMatchObject({ handedness: 'left', conflict: true });
  });
  it('撮影日時・射手名・動画の長さが同じなら重複', () => {
    const plan = planImport(
      [record(), record({ shotAt: '2026-10-05T14:21' }), record({ shooterName: '佐藤' })],
      known,
      [
        { shooterName: '山田', shotAt: '2026-10-05T14:20', durationSec: 0.2 },
        { shooterName: '佐藤', shotAt: '2026-10-05T14:20', durationSec: 5 },
      ],
    );
    expect(plan.duplicates).toEqual([0]);
  });
  it('同じファイルの中に同じ記録が 2 回あれば、2 回目は重複', () => {
    const plan = planImport([record(), record(), record({ title: '別名でも同じ' })], known, []);
    expect(plan.duplicates).toEqual([1, 2]);
  });
  it('壊れた base64 の画像は形式の問題として飛ばす', async () => {
    const blob = buildExportBlob([item()], '2026-10-12T09:05');
    const raw = JSON.parse(await blob.text());
    raw.records[0].still.base64 = 'ab$=';
    expect(parseExportText(JSON.stringify(raw))).toEqual({ kind: 'problem', problem: 'noRecords' });
  });
});
