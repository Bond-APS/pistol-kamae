// CSV（角度時系列）の書き出し（要件 9 章、2026-10-12 の決定）。
// 切り抜きの範囲の中のコマだけ。列は、コマ番号（範囲の先頭を 1）・時刻（撃発を 0 とした秒）・9 項目。
// 計測できないところは空欄。BOM 付き UTF-8（Excel で文字化けしないため）、改行は CRLF。

import {
  METRIC_DECIMALS,
  METRIC_IDS,
  METRIC_UNITS,
  roundMetric,
  type ShotRecord,
} from '@pistol-kamae/engine';
import { ja } from '../i18n/ja';
import { metricsSeries } from './metricsSeries';

/** UTF-8 の BOM（ファイルの先頭に置く印。Excel が文字コードを判別できる） */
export const CSV_BOM = '﻿';

/** 1 つの欄。カンマ・引用符・改行を含むときは引用符で囲む */
function cell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 列の見出し */
export function csvHeader(): string[] {
  return [
    ja.export.csvFrame,
    ja.export.csvTime,
    ...METRIC_IDS.map((id) => `${ja.metrics[id]}${ja.export.csvUnit(METRIC_UNITS[id])}`),
  ];
}

/** 記録の角度時系列を CSV の文字列にする（BOM 付き） */
export function buildCsv(record: ShotRecord): string {
  const lines = [csvHeader().map(cell).join(',')];
  metricsSeries(record).forEach((row, n) => {
    const cells = [
      String(n + 1),
      row.relSec.toFixed(3),
      ...METRIC_IDS.map((id) => {
        const v = row.values?.[id];
        return v === null || v === undefined
          ? ''
          : roundMetric(id, v).toFixed(METRIC_DECIMALS[METRIC_UNITS[id]]);
      }),
    ];
    lines.push(cells.map(cell).join(','));
  });
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
