import { formatScore } from '@pistol-kamae/engine';
import { ja } from '../i18n/ja';

interface Props {
  value: number | null;
  /** 開いた記録の見出し用に大きく出す */
  big?: boolean;
}

/** 点数。数値に単位「点」を付ける。未入力は「—」とグレー */
export function Score({ value, big }: Props) {
  const size = big ? ' big' : '';
  if (value === null) {
    return (
      <span className={`score none${size}`} aria-label={ja.record.scoreNone}>
        {ja.metricTable.na}
      </span>
    );
  }
  return (
    <span className={`score${size}`}>
      {formatScore(value)}
      <small>{ja.record.scoreUnit}</small>
    </span>
  );
}
