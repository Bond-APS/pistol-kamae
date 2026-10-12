// JSON の書き出しと読み取り（要件 9 章、2026-10-12 の決定）。
// 外側の形：{ app, exportVersion, exportedAt, records: [...] }。1 件でも全件でも同じ形。
// 1 件は engine の保存形式（ShotRecord、射手名と利き手を含む）に、静止画 2 枚・音のグラフ・動画本体（任意）・
// 角度時系列（範囲の中のコマ。読込では無視して計算し直す）を足したもの。
// 動画は base64 で埋め込む。別の入れ物（ZIP）だと新しいライブラリが要るため。

import {
  checkShotRecord,
  upgradeShotRecord,
  type MetricValues,
  type RecordProblem,
  type ShotRecord,
} from '@pistol-kamae/engine';
import type { AudioEnvelope } from '../audio/envelope';
import type { VideoSource } from '../db/library';
import type { StoredImage } from '../db/schema';
import { base64ChunksOf, decodeBase64, encodeBase64 } from './base64';
import { metricsSeries, type MetricsRow } from './metricsSeries';

export const EXPORT_APP = 'pistol-kamae';
/** 外側の形の版番号。形を変えたら上げ、古い版を読むときの変換を足す */
export const EXPORT_FORMAT_VERSION = 1;

/** 画像・動画のバイト列（base64） */
export interface ExportedBytes {
  type: string;
  base64: string;
}

/** 音の大きさのグラフ（包絡線）。values は 0〜1 */
export interface ExportedAudio {
  binSec: number;
  offsetSec: number;
  durationSec: number;
  values: number[];
}

export interface ExportedMetricsRow {
  frameIndex: number;
  timeSec: number;
  relSec: number;
  values: MetricValues | null;
}

/**
 * 読み取った 1 件の記録。画像と動画は読み取りのときにバイト列へ戻してある
 * （base64 の文字列を持ち続けないため。動画込みの JSON は文字列だけで動画の 1.3 倍の大きさになる）
 */
export interface ExportedRecord {
  record: ShotRecord;
  still: StoredImage;
  thumb: StoredImage;
  /** 音のグラフ。音声がない動画は values が空、計算していなければ null */
  audio: ExportedAudio | null;
  /** 動画本体。「記録だけ」で書き出したときは null */
  video: StoredImage | null;
}

export interface ExportFile {
  app: typeof EXPORT_APP;
  exportVersion: number;
  /** 書き出した日時（端末の現地時刻 'YYYY-MM-DDTHH:mm'） */
  exportedAt: string;
  records: ExportedRecord[];
}

/** 書き出す 1 件の材料 */
export interface ExportItem {
  record: ShotRecord;
  still: StoredImage;
  thumb: StoredImage;
  audio: AudioEnvelope | null;
  /** 動画本体。含めないときは null */
  video: VideoSource | null;
}

const toExportedBytes = (image: StoredImage): ExportedBytes => ({
  type: image.type,
  base64: encodeBase64(image.bytes),
});

/** 音のグラフの値は 0〜1 なので、小数 4 桁に丸めて書く（大きさを抑える。グラフと「音の山」には十分） */
const toExportedAudio = (audio: AudioEnvelope): ExportedAudio => ({
  binSec: audio.binSec,
  offsetSec: audio.offsetSec,
  durationSec: audio.durationSec,
  values: Array.from(audio.values, (v) => Math.round(v * 10000) / 10000),
});

const toExportedMetrics = (rows: MetricsRow[]): ExportedMetricsRow[] =>
  rows.map((r) => ({
    frameIndex: r.frameIndex,
    timeSec: r.timeSec,
    relSec: r.relSec,
    values: r.values,
  }));

/**
 * 書き出す JSON を Blob（ファイルの中身）として組み立てる。
 * 動画の base64 は塊ごとに Blob へ移し、巨大な 1 本の文字列も、塊の文字列の山も作らない（iPhone のメモリを抑える）
 */
export function buildExportBlob(items: ExportItem[], exportedAt: string): Blob {
  const parts: (string | Blob)[] = [];
  const head = { app: EXPORT_APP, exportVersion: EXPORT_FORMAT_VERSION, exportedAt };
  // 先頭の { と app などを書き、records の配列を開く
  parts.push(JSON.stringify(head).slice(0, -1), ',"records":[');
  items.forEach((item, i) => {
    if (i > 0) parts.push(',');
    const body = {
      record: item.record,
      still: toExportedBytes(item.still),
      thumb: toExportedBytes(item.thumb),
      audio: item.audio ? toExportedAudio(item.audio) : null,
      metrics: toExportedMetrics(metricsSeries(item.record)),
    };
    // 末尾の } を外して、動画の項目を続ける
    parts.push(JSON.stringify(body).slice(0, -1));
    if (item.video) {
      parts.push(',"video":{"type":', JSON.stringify(item.video.type), ',"base64":"');
      for (const chunk of base64ChunksOf(item.video.bytes)) parts.push(new Blob([chunk]));
      parts.push('"}}');
    } else {
      parts.push(',"video":null}');
    }
  });
  parts.push(']}');
  return new Blob(parts, { type: 'application/json' });
}

export type ParseProblem = 'notJson' | 'notKamae' | 'unsupportedVersion' | 'noRecords';

/** 読み取った結果。records は形式の検査を通ったもの、skipped は通らなかった件数 */
export type ParseResult =
  { kind: 'ok'; file: ExportFile; skipped: number } | { kind: 'problem'; problem: ParseProblem };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isBytes(v: unknown): v is ExportedBytes {
  return isObject(v) && typeof v.type === 'string' && typeof v.base64 === 'string';
}

function isAudio(v: unknown): v is ExportedAudio {
  return (
    isObject(v) &&
    isFiniteNumber(v.binSec) &&
    v.binSec > 0 &&
    isFiniteNumber(v.offsetSec) &&
    isFiniteNumber(v.durationSec) &&
    Array.isArray(v.values) &&
    v.values.every(isFiniteNumber)
  );
}

/** base64 の文字列をバイト列に戻す。形が正しくなければ null */
function decodeBytes(bytes: ExportedBytes): StoredImage | null {
  try {
    return { type: bytes.type, bytes: decodeBase64(bytes.base64) };
  } catch {
    return null;
  }
}

/**
 * 1 件を検査し、engine の保存形式は古い版なら今の版に直す。通らなければ null。
 * 画像と動画はここでバイト列に戻す（返したあと、読み取った元の文字列は手放せる）
 */
export function parseExportedRecord(
  value: unknown,
): { record: ExportedRecord; problem: null } | { record: null; problem: RecordProblem | 'shape' } {
  if (!isObject(value)) return { record: null, problem: 'shape' };
  const upgraded = upgradeShotRecord(value.record);
  const problem = checkShotRecord(upgraded);
  if (problem) return { record: null, problem };
  if (!isBytes(value.still) || !isBytes(value.thumb)) return { record: null, problem: 'shape' };
  if (value.audio !== null && value.audio !== undefined && !isAudio(value.audio)) {
    return { record: null, problem: 'shape' };
  }
  if (value.video !== null && value.video !== undefined && !isBytes(value.video)) {
    return { record: null, problem: 'shape' };
  }
  const still = decodeBytes(value.still);
  const thumb = decodeBytes(value.thumb);
  const video = value.video ? decodeBytes(value.video) : null;
  if (!still || !thumb || (value.video && !video)) return { record: null, problem: 'shape' };
  return {
    record: {
      record: upgraded as ShotRecord,
      still,
      thumb,
      audio: (value.audio as ExportedAudio | null | undefined) ?? null,
      video,
    },
    problem: null,
  };
}

/** JSON の文字列を読み取る。形式の検査に落ちた記録は飛ばし、その件数を返す */
export function parseExportText(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'problem', problem: 'notJson' };
  }
  if (!isObject(value) || value.app !== EXPORT_APP) return { kind: 'problem', problem: 'notKamae' };
  if (!isFiniteNumber(value.exportVersion) || value.exportVersion > EXPORT_FORMAT_VERSION) {
    return { kind: 'problem', problem: 'unsupportedVersion' };
  }
  if (!Array.isArray(value.records)) return { kind: 'problem', problem: 'noRecords' };
  const records: ExportedRecord[] = [];
  let skipped = 0;
  for (const item of value.records) {
    const parsed = parseExportedRecord(item);
    if (parsed.record) records.push(parsed.record);
    else skipped++;
  }
  if (records.length === 0) return { kind: 'problem', problem: 'noRecords' };
  return {
    kind: 'ok',
    file: {
      app: EXPORT_APP,
      exportVersion: value.exportVersion,
      exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
      records,
    },
    skipped,
  };
}

/** 音のグラフを、記録に保存する形に戻す */
export function decodeAudio(audio: ExportedAudio): AudioEnvelope {
  return {
    values: Float32Array.from(audio.values),
    binSec: audio.binSec,
    offsetSec: audio.offsetSec,
    durationSec: audio.durationSec,
  };
}
