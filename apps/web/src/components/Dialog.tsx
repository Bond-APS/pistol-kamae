import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ja } from '../i18n/ja';

interface DialogProps {
  /** sheet：入力用（iPhone では全画面）、confirm：確認用（中央の小窓） */
  variant: 'sheet' | 'confirm';
  title: string;
  /** Esc キーなどで閉じようとしたとき */
  onCancel: () => void;
  testId?: string;
  children: ReactNode;
}

/**
 * ブラウザ標準の <dialog> を使った窓。開いている間、背後の画面は操作できない。
 * 背景を押しても閉じない（入力中の内容を誤って失わないため）。
 */
export function Dialog({ variant, title, onCancel, testId, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog ${variant}`}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

interface ConfirmProps {
  title: string;
  confirmLabel: string;
  /** 取り消せない操作（削除など）は赤い塗りにする */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
  children: ReactNode;
}

/**
 * 確認の窓。ボタンは縦に積み、一番下を必ず「キャンセル」にする
 * （同じ位置を続けて押しても、実行ではなくキャンセルに当たる）。
 */
export function ConfirmDialog(props: ConfirmProps) {
  const { title, confirmLabel, destructive, busy, onConfirm, onCancel, testId, children } = props;
  return (
    <Dialog variant="confirm" title={title} onCancel={onCancel} {...(testId ? { testId } : {})}>
      {children}
      <div className="stack">
        <button
          className={destructive ? 'danger-fill full' : 'primary full'}
          data-testid="confirm-ok"
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button className="full" data-testid="confirm-cancel" disabled={busy} onClick={onCancel}>
          {ja.common.cancel}
        </button>
      </div>
    </Dialog>
  );
}
