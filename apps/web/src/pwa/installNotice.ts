// 初回の案内（要件 5 章 11、段階⑦）：ホーム画面に追加していないときに出す案内の、出す・出さないの判断と、端末への記憶。
// 画面から切り離した計算の部分。

const STORAGE_KEY = 'kamae.installNoticeClosed';

/** ホーム画面から開いている（アドレス欄のない画面）か */
export function isStandalone(win: {
  matchMedia?: (q: string) => { matches: boolean };
  navigator: object;
}): boolean {
  // iPhone の Safari だけが持つ印（標準の型にはない）
  if ((win.navigator as { standalone?: unknown }).standalone === true) return true;
  try {
    return win.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

/** iPhone・iPad か（iPad は Mac と名乗るので、触れる点の数で見分ける） */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** 案内を出すか：ホーム画面から開いておらず、「閉じる」を押していない */
export function shouldShowInstallNotice(standalone: boolean, closed: boolean): boolean {
  return !standalone && !closed;
}

export function readInstallNoticeClosed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeInstallNoticeClosed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // 保存の機能が使えないときは、この画面を開いている間だけ閉じる
  }
}
