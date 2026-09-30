// 保存形式の検査。保存する前と、読み出したあと（将来は JSON の読込でも）に使う。

import { LANDMARK_NAMES, type LandmarkFrame, type Point } from '../landmarks/types';
import { shotMarkOf } from '../marks/operations';
import type { Mark } from '../marks/types';
import { metricsAtTime, type FrameMetrics } from '../metrics/atFrame';
import { checkLevelLine, levelTiltDeg, type LevelLine } from '../normalize/level';
import { parseLocalDateTime } from './dateTime';
import { isValidScore } from './score';
import { normalizeShooterName } from './shooter';
import {
  RECORD_FORMAT_VERSION,
  type RecordAnalysis,
  type RecordMeta,
  type ShotRecord,
} from './types';

export type RecordProblem =
  | 'notObject'
  | 'unsupportedVersion'
  | 'invalidAnalysis'
  | 'invalidMarks'
  | 'noShotMark'
  | 'invalidLevel'
  | 'invalidMeta';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPositive = (v: unknown): v is number => isFiniteNumber(v) && v > 0;

function isPoint(v: unknown): v is Point {
  return isObject(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.visibility);
}

function isFrame(v: unknown): v is LandmarkFrame {
  if (!isObject(v) || !isFiniteNumber(v.timeSec)) return false;
  const lm = v.landmarks;
  if (lm === null) return true;
  return isObject(lm) && LANDMARK_NAMES.every((name) => isPoint(lm[name]));
}

function isAnalysis(v: unknown): v is RecordAnalysis {
  return (
    isObject(v) &&
    typeof v.backendId === 'string' &&
    isPositive(v.width) &&
    isPositive(v.height) &&
    isPositive(v.fps) &&
    isPositive(v.durationSec) &&
    Array.isArray(v.frames) &&
    v.frames.length > 0 &&
    v.frames.every(isFrame)
  );
}

function isMark(v: unknown): v is Mark {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    (v.kind === 'shot' || v.kind === 'custom') &&
    typeof v.label === 'string' &&
    isFiniteNumber(v.timeSec)
  );
}

function isLevelLine(v: unknown): v is LevelLine {
  return (
    isObject(v) &&
    isFiniteNumber(v.x1) &&
    isFiniteNumber(v.y1) &&
    isFiniteNumber(v.x2) &&
    isFiniteNumber(v.y2)
  );
}

function isMeta(v: unknown): v is RecordMeta {
  return (
    isObject(v) &&
    typeof v.shotAt === 'string' &&
    parseLocalDateTime(v.shotAt) !== null &&
    typeof v.shooterName === 'string' &&
    normalizeShooterName(v.shooterName) === v.shooterName &&
    (v.handedness === 'right' || v.handedness === 'left') &&
    isValidScore(v.score) &&
    typeof v.memo === 'string' &&
    typeof v.favorite === 'boolean'
  );
}

/** 保存形式として正しいかを調べる。問題がなければ null、あれば最初に見つかった問題 */
export function checkShotRecord(value: unknown): RecordProblem | null {
  if (!isObject(value)) return 'notObject';
  if (value.formatVersion !== RECORD_FORMAT_VERSION) return 'unsupportedVersion';
  if (!isAnalysis(value.analysis)) return 'invalidAnalysis';
  if (!Array.isArray(value.marks) || !value.marks.every(isMark)) return 'invalidMarks';
  const marks = value.marks as Mark[];
  if (marks.filter((m) => m.kind === 'shot').length !== 1) return 'noShotMark';
  if (new Set(marks.map((m) => m.id)).size !== marks.length) return 'invalidMarks';
  // 線は形だけを検査する。長さや傾きの閾値は将来変えることがあり、閾値に合わない線は
  // levelTiltDeg が「補正しない」として扱うので、記録が開けなくなることはない
  if (value.level !== null && !isLevelLine(value.level)) return 'invalidLevel';
  if (!isMeta(value.meta)) return 'invalidMeta';
  return null;
}

/**
 * 古い版の記録を今の版に直す。直せない形なら、そのまま返す（あとの検査で落ちる）。
 * 版 1 → 2：水平校正の線を「なし」として足す。
 */
export function upgradeShotRecord(value: unknown): unknown {
  if (isObject(value) && value.formatVersion === 1) {
    return { ...value, formatVersion: 2, level: null };
  }
  return value;
}

/** 記録のカメラの傾き（度）。水平校正の線がない、または使えない線なら 0 */
export function tiltDegOfRecord(record: ShotRecord): number {
  return levelTiltDeg(record.level, record.analysis);
}

/** 記録の水平校正の線が、今の基準（長さ・傾き）で使えるか。線がなければ false */
export function hasUsableLevel(record: ShotRecord): boolean {
  return record.level !== null && checkLevelLine(record.level, record.analysis) === null;
}

/** 記録の撃発フレームの計測値（水平校正の線があれば補正済み）。撃発マークがなければ null */
export function shotMetricsOfRecord(record: ShotRecord): FrameMetrics | null {
  const shot = shotMarkOf(record.marks);
  if (!shot) return null;
  return metricsAtTime(
    {
      frames: record.analysis.frames,
      handedness: record.meta.handedness,
      imageWidth: record.analysis.width,
      imageHeight: record.analysis.height,
      tiltDeg: tiltDegOfRecord(record),
    },
    shot.timeSec,
  );
}
