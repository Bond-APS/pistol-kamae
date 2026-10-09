const METADATA_TIMEOUT_MS = 30_000;

/**
 * video 要素を作って、メタ情報が読めるまで待つ。再生できない形式なら例外。
 * signal（中断の合図）で待ちをやめられる。失敗したときは、作った video と一時 URL を手放す
 */
export async function loadVideo(file: Blob, signal?: AbortSignal): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      // iOS Safari はメタ情報の読込がいつまでも終わらないことがあるため、時間切れを設ける
      const timer = setTimeout(() => finish(new Error('metadata timeout')), METADATA_TIMEOUT_MS);
      const onAbort = () => finish(new Error('aborted'));
      const finish = (error: Error | null) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      v.addEventListener('loadedmetadata', () => finish(null), { once: true });
      v.addEventListener('error', () => finish(new Error('unsupported')), { once: true });
      // 一部のブラウザ（iOS Safari）は明示的に load() を呼ばないと読み始めない
      v.load();
    });
    if (v.videoWidth === 0 || v.videoHeight === 0) throw new Error('unsupported');
    return v;
  } catch (e) {
    releaseVideo(v);
    throw e;
  }
}

export function releaseVideo(v: HTMLVideoElement | null): void {
  if (!v) return;
  v.pause();
  URL.revokeObjectURL(v.src);
  v.removeAttribute('src');
  v.load();
}
