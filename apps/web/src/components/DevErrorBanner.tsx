import { useEffect, useState } from 'react';
import { ja } from '../i18n/ja';

/**
 * 開発サーバ限定：ブラウザの開発者ツールが使えない端末（iPhone など）で
 * エラー内容を画面に出すための表示。公開ビルドでは描画しない。
 */
export function DevErrorBanner() {
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const push = (message: string) => setErrors((prev) => [...prev.slice(-9), message]);
    const onError = (e: ErrorEvent) =>
      push(`${e.message} (${e.filename?.split('/').pop() ?? ''}:${e.lineno})`);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason;
      push(r instanceof Error ? `${r.name}: ${r.message}` : String(r));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (!import.meta.env.DEV || errors.length === 0) return null;
  return (
    <div className="dev-errors">
      <div className="row">
        <strong>{ja.devErrors.title}</strong>
        <button onClick={() => setErrors([])}>{ja.devErrors.clear}</button>
      </div>
      {errors.map((m, i) => (
        <pre key={i}>{m}</pre>
      ))}
    </div>
  );
}
