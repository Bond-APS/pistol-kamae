import type { RecordRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { StoredImg } from './StoredImg';

interface Props {
  row: RecordRow;
  shooterName: string;
}

/**
 * 動画 1 本の見出し（小さい静止画・タイトル・射手名と長さとメモ）。
 * ライブラリの一覧で使う。ボタンの中に入れるので span で組む。
 */
export function RecordSummary({ row, shooterName }: Props) {
  return (
    <>
      <StoredImg image={row.thumb} className="thumb" alt="" />
      <span className="lib-main">
        <span className="lib-line1">
          <span data-testid="lib-title">{row.title}</span>
        </span>
        <span className="lib-line2" data-testid="lib-sub">
          {ja.record.subLine(shooterName, row.clipSec, row.memo)}
        </span>
      </span>
    </>
  );
}
