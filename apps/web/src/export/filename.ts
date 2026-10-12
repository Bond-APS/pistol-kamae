// 書き出すファイルの名前（要件 9 章）。
//   記録：kamae_<射手名>_<YYYY-MM-DD_HHmm>.json（CSV も同じ形）
//   全件：kamae_すべて_<書き出し日時>.json
//   PNG：kamae_比較_<①のタイトル>_<②のタイトル>.png
// ファイル名に使えない文字は _ に置き換える。

import { parseLocalDateTime } from '@pistol-kamae/engine';
import { ja } from '../i18n/ja';

const PREFIX = 'kamae';
/** 1 つの部分（射手名・タイトル）の長さの上限。長すぎる名前は端末やアプリが扱えないことがある */
const PART_MAX_LENGTH = 40;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * ファイル名の 1 つの部分を整える。使えない文字（/ \ : * ? " < > |、制御文字）と、区切りに使う _ は _ に置き換え、
 * 前後の空白と . を除き、長すぎれば切る。空になれば '_'
 */
export function safeFilePart(text: string): string {
  const replaced = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  const cut =
    replaced.length > PART_MAX_LENGTH ? replaced.slice(0, PART_MAX_LENGTH).trim() : replaced;
  return cut === '' ? '_' : cut;
}

/** 'YYYY-MM-DDTHH:mm' → 'YYYY-MM-DD_HHmm'。日時として読めなければそのまま整えて返す */
export function fileDateTime(localDateTime: string): string {
  const d = parseLocalDateTime(localDateTime);
  if (!d) return safeFilePart(localDateTime);
  return `${String(d.year).padStart(4, '0')}-${pad(d.month)}-${pad(d.day)}_${pad(d.hour)}${pad(d.minute)}`;
}

/** 1 件の記録のファイル名（拡張子は 'json' か 'csv'） */
export function recordFileName(shooterName: string, shotAt: string, ext: 'json' | 'csv'): string {
  return `${PREFIX}_${safeFilePart(shooterName)}_${fileDateTime(shotAt)}.${ext}`;
}

/** 全件の JSON のファイル名 */
export function allRecordsFileName(exportedAt: string): string {
  return `${PREFIX}_${safeFilePart(ja.export.fileAll)}_${fileDateTime(exportedAt)}.json`;
}

/** 比較画面の PNG のファイル名 */
export function compareFileName(baseTitle: string, currentTitle: string): string {
  return `${PREFIX}_${safeFilePart(ja.export.fileCompare)}_${safeFilePart(baseTitle)}_${safeFilePart(currentTitle)}.png`;
}
