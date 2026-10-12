import { ja } from '../i18n/ja';
import type { ExportStatus } from '../export/useExport';

interface Props {
  status: ExportStatus;
  /** ready（共有シートを押し直してもらう）のとき、「共有する」を押したら呼ぶ */
  onShare: () => void;
  testId: string;
}

/** 書き出しの状態の 1 行（書き出しています…／準備できました＋「共有する」／✓ 書き出しました／！ 書き出せませんでした） */
export function ExportStatusLine({ status, onShare, testId }: Props) {
  if (status === 'idle') return null;
  if (status === 'ready') {
    return (
      <div className="row nowrap" data-testid={testId} data-status={status} role="status">
        <span className="small grow">{ja.export.ready}</span>
        <button className="primary" data-testid={`${testId}-share`} onClick={onShare}>
          {ja.export.share}
        </button>
      </div>
    );
  }
  const text =
    status === 'busy' ? ja.export.busy : status === 'done' ? ja.export.done : ja.export.failed;
  return (
    <p
      className={status === 'failed' ? 'danger small' : 'muted small'}
      data-testid={testId}
      data-status={status}
      role="status"
    >
      {text}
    </p>
  );
}
