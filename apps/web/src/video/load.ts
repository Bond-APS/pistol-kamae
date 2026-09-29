const METADATA_TIMEOUT_MS = 30_000;

/** video 要素を作って、メタ情報が読めるまで待つ。再生できない形式なら例外 */
export async function loadVideo(file: Blob): Promise<HTMLVideoElement> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    // iOS Safari はメタ情報の読込がいつまでも終わらないことがあるため、時間切れを設ける
    const timer = setTimeout(() => reject(new Error('metadata timeout')), METADATA_TIMEOUT_MS);
    v.addEventListener(
      'loadedmetadata',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    v.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new Error('unsupported'));
      },
      { once: true },
    );
    // 一部のブラウザ（iOS Safari）は明示的に load() を呼ばないと読み始めない
    v.load();
  });
  if (v.videoWidth === 0 || v.videoHeight === 0) throw new Error('unsupported');
  return v;
}

export function releaseVideo(v: HTMLVideoElement | null): void {
  if (!v) return;
  v.pause();
  URL.revokeObjectURL(v.src);
  v.removeAttribute('src');
  v.load();
}
