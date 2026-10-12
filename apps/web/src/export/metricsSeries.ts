// 角度時系列（切り抜きの範囲の中のコマごとの計測値）。JSON と CSV の書き出しに共通。
// 保存はしない（開くたびに計算する。要件 9 章）。書き出しのときだけ計算する。

import {
  clipOf,
  metricsAtFrame,
  shotMarkOf,
  tiltDegOfRecord,
  type MetricValues,
  type ShotRecord,
} from '@pistol-kamae/engine';
import { frameRange } from '../analysis/frames';

/** 1 コマ分 */
export interface MetricsRow {
  /** コマの番号（動画の先頭を 0。記録の frames の添え字） */
  frameIndex: number;
  /** 動画の媒体時刻（秒） */
  timeSec: number;
  /** 撃発を 0 とした時刻（秒）。撃発の前はマイナス */
  relSec: number;
  /** 計測値。人物を検出できなかったコマは null */
  values: MetricValues | null;
}

/** 切り抜きの範囲の中のコマの計測値。撃発マークがなければ空 */
export function metricsSeries(record: ShotRecord): MetricsRow[] {
  const shot = shotMarkOf(record.marks);
  if (!shot) return [];
  const { frames, width, height, durationSec } = record.analysis;
  const clip = clipOf(record.clip, durationSec);
  const { first, last } = frameRange(frames, clip.startSec, clip.endSec);
  const input = {
    frames,
    handedness: record.meta.handedness,
    imageWidth: width,
    imageHeight: height,
    tiltDeg: tiltDegOfRecord(record),
  };
  const rows: MetricsRow[] = [];
  for (let i = first; i <= last; i++) {
    // 範囲の中のコマは、計測できなくても行として残す（コマ番号が詰まらないように）
    const m = metricsAtFrame(input, i);
    const timeSec = m?.timeSec ?? frames[i]!.timeSec;
    rows.push({
      frameIndex: i,
      timeSec,
      relSec: timeSec - shot.timeSec,
      values: m?.values ?? null,
    });
  }
  return rows;
}
