import { parseLocalDateTime } from '@pistol-kamae/engine';
import type { RecordRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { Score } from './Score';
import { StoredImg } from './StoredImg';

interface Props {
  row: RecordRow;
  shooterName: string;
}

/**
 * 記録 1 件の見出し（小さい静止画・撮影日時・点数・射手名とメモ）。
 * ライブラリの一覧と、比較する記録を選ぶ一覧で使う。ボタンの中に入れるので span で組む。
 */
export function RecordSummary({ row, shooterName }: Props) {
  const date = parseLocalDateTime(row.shotAt);
  return (
    <>
      <StoredImg image={row.thumb} className="thumb" alt="" />
      <span className="lib-main">
        <span className="lib-line1">
          <span data-testid="lib-date">{date ? ja.record.dateTime(date) : row.shotAt}</span>
          <Score value={row.score} />
        </span>
        <span className="lib-line2" data-testid="lib-sub">
          {[shooterName, row.memo].filter((s) => s !== '').join('・')}
        </span>
      </span>
    </>
  );
}
