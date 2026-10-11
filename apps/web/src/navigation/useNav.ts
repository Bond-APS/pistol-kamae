import { useContext, useEffect, useLayoutEffect, useRef } from 'react';
import type { Nav, NavListener } from './history';
import { NavContext } from './navContext';

/** 画面の履歴（積む・戻す） */
export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('NavProvider is missing');
  return nav;
}

/**
 * 履歴の項目が知らされたときの処理を登録する。handler は毎回最新のものが呼ばれる
 * （段階などの状態を閉じ込めたまま古い handler が呼ばれないように）
 */
export function useNavListener(handler: NavListener) {
  const nav = useNav();
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  useEffect(() => nav.subscribe((entry, source) => ref.current(entry, source)), [nav]);
}
