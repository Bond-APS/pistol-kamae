import { RECORD_FORMAT_VERSION } from '@pistol-kamae/engine';
import { describe, expect, it } from 'vitest';
import { buildOpenedRecord } from './openRecord';
import type { RecordDataRow, RecordRow, ShooterRow } from './schema';

const image = { bytes: new ArrayBuffer(4), type: 'image/jpeg' };
const point = { x: 1, y: 2, visibility: 1 };
const landmarks = {
  nose: point,
  rightEar: point,
  leftEar: point,
  rightShoulder: point,
  leftShoulder: point,
  rightHip: point,
  leftHip: point,
  rightWrist: point,
  leftWrist: point,
  rightAnkle: point,
  leftAnkle: point,
};
const analysis = {
  backendId: 'mediapipe-full-video',
  width: 640,
  height: 480,
  fps: 30,
  durationSec: 0.1,
  frames: [0, 1, 2].map((i) => ({ timeSec: i / 30, landmarks })),
};
const marks = [{ id: 'shot', kind: 'shot' as const, label: '', timeSec: 1 / 30 }];
const shooter: ShooterRow = { id: 1, name: '佐藤', handedness: 'right', createdAt: 1 };
const row: RecordRow = {
  id: 1,
  shooterId: 1,
  title: '題名',
  shotAt: '2026-09-21T10:00',
  score: null,
  memo: '',
  favorite: false,
  thumb: image,
  clipSec: 0.1,
  createdAt: 1,
  updatedAt: 1,
};
const data: RecordDataRow = {
  id: 1,
  formatVersion: RECORD_FORMAT_VERSION,
  analysis,
  marks,
  clip: null,
  level: null,
  still: image,
};

describe('buildOpenedRecord', () => {
  it('今の版の正しい中身なら開ける', () => {
    const result = buildOpenedRecord(row, data, shooter);
    expect(result.kind).toBe('open');
    if (result.kind === 'open') {
      expect(result.opened.record.meta.title).toBe('題名');
      expect(result.opened.record.formatVersion).toBe(RECORD_FORMAT_VERSION);
    }
  });
  it('中身がない・射手がいないときは「形が合わない」', () => {
    expect(buildOpenedRecord(row, undefined, shooter)).toMatchObject({
      kind: 'invalid',
      problem: 'noData',
    });
    expect(buildOpenedRecord(row, data, undefined)).toMatchObject({
      kind: 'invalid',
      problem: 'noShooter',
    });
  });
  it('形式の検査に落ちる中身（コマが 0 個）は「形が合わない」', () => {
    const broken = { ...data, analysis: { ...analysis, frames: [] } };
    expect(buildOpenedRecord(row, broken, shooter)).toMatchObject({
      kind: 'invalid',
      problem: 'invalidAnalysis',
    });
  });
  it('古い版（版 1・版 2）の中身は読み替えて開ける。題名は見出しの行のもの', () => {
    const v2 = { id: 1, formatVersion: 2, analysis, marks, level: null, still: image };
    const r2 = buildOpenedRecord(row, v2 as unknown as RecordDataRow, shooter);
    expect(r2.kind).toBe('open');
    if (r2.kind === 'open') {
      expect(r2.opened.record.clip).toBeNull();
      expect(r2.opened.record.meta.title).toBe('題名');
    }
    const v1 = { id: 1, formatVersion: 1, analysis, marks, still: image };
    expect(buildOpenedRecord(row, v1 as unknown as RecordDataRow, shooter).kind).toBe('open');
  });
  it('読み替えられない版は「形が合わない」', () => {
    const future = { ...data, formatVersion: 99 };
    expect(buildOpenedRecord(row, future, shooter)).toMatchObject({
      kind: 'invalid',
      problem: 'unsupportedVersion',
    });
  });
});
