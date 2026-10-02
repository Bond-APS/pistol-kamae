import { useCallback, useSyncExternalStore } from 'react';

// 角度の数値（角度表・差分表）を表示するかどうか。既定は非表示で、ボタンで出す。
// 選んだ状態は端末に覚えておき、どの画面でも同じにする（数値を見たい人は、毎回押さずに済む）。

const STORAGE_KEY = 'kamae.showNumbers';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // プライベートブラウズなどで保存の機能が使えないときは、既定（非表示）にする
    return false;
  }
}

/** 覚えられなかったとき（保存の機能が使えない）に、この画面を開いている間だけ保つ値 */
let fallback: boolean | null = null;
const current = (): boolean => fallback ?? read();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** [表示するか, 切り替える] */
export function useShowNumbers(): [boolean, () => void] {
  const shown = useSyncExternalStore(subscribe, current);
  const toggle = useCallback(() => {
    const next = !current();
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      fallback = null;
    } catch {
      fallback = next;
    }
    // 書き込みは成功したのに読み出せない環境への保険
    if (read() !== next) fallback = next;
    for (const listener of listeners) listener();
  }, []);
  return [shown, toggle];
}
