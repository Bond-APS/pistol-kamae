// 解析中に画面が消えないよう、ブラウザに頼む（Wake Lock。iPhone は iOS 16.4 以降で使える）。
// 使えないブラウザや、低電力モードなどで断られたときは何もしない。
// 画面が隠れると自動で解除されるので、戻ってきたときにまだ必要なら頼み直す。

interface WakeLockLike {
  request: (type: 'screen') => Promise<{ release: () => Promise<void> }>;
}

/** 画面を消さないよう頼み始める。返った関数を呼ぶとやめる */
export function keepScreenAwake(): () => void {
  const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  if (!wakeLock) return () => {};
  let active = true;
  let sentinel: { release: () => Promise<void> } | null = null;
  /** 頼んでいる最中か（隠れて戻ったときに二重に頼まないため） */
  let requesting = false;
  const request = async () => {
    if (!active || sentinel || requesting || document.visibilityState !== 'visible') return;
    requesting = true;
    try {
      const got = await wakeLock.request('screen');
      // 頼んでいる間にやめていたら、すぐ解放する
      if (!active || sentinel) await got.release();
      else sentinel = got;
    } catch {
      // 断られたときは諦める（画面が消えても解析は続く）
    } finally {
      requesting = false;
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void request();
    else sentinel = null; // 隠れると自動で解除される
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  void request();
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    void sentinel?.release().catch(() => {});
    sentinel = null;
  };
}
