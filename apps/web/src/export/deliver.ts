// 書き出したファイルの受け渡し（要件 9 章、2026-10-12 の決定）。
// 共有シート（Web Share API でファイルを共有できる端末）が使えれば共有シート、使えなければダウンロード
// （a[download]。iPhone の Safari では「ファイル」に保存される）に自動で切り替える。外へは送らない。

/**
 * needsGesture：共有シートは「ボタンを押した直後」でないと開けない（iPhone の Safari）。中身を作るのに時間がかかって
 * 開けなかったときはこれを返し、画面に「共有する」ボタンを出して、押した直後にもう一度渡す
 */
export type DeliverResult = 'shared' | 'downloaded' | 'cancelled' | 'needsGesture';

/**
 * ダウンロードした一時 URL を手放すまでの時間。すぐ手放すとブラウザが保存を始める前に消える。
 * iPhone はダウンロードの確認を出すので、しばらく放置しても押せるよう長めに取る
 */
const REVOKE_DELAY_MS = 10 * 60_000;

function canShareFile(file: File): boolean {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  try {
    return typeof nav.share === 'function' && nav.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * ファイルを端末に渡す。共有シートを閉じた（やめた）ときは 'cancelled'。
 * 共有シートが開けなかったとき（押してから時間が経った、端末が対応していない）はダウンロードに切り替える
 */
export async function deliverFile(blob: Blob, name: string): Promise<DeliverResult> {
  const file = new File([blob], name, { type: blob.type });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // 操作の直後でないため開けなかった：押し直してもらう
      if (
        e instanceof DOMException &&
        (e.name === 'NotAllowedError' || e.name === 'InvalidStateError')
      ) {
        return 'needsGesture';
      }
      // それ以外（端末が対応していないなど）：ダウンロードへ
    }
  }
  download(blob, name);
  return 'downloaded';
}
