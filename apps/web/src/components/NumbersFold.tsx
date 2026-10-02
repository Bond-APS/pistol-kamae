import { useId, type ReactNode } from 'react';
import { ja } from '../i18n/ja';
import { useShowNumbers } from './useShowNumbers';

interface Props {
  /** 見出し（例：撃発の瞬間の角度）。閉じていても出ている */
  title: string;
  testId: string;
  /** 角度の数値の表など。表示するときだけ描く */
  children: ReactNode;
}

/**
 * 角度の数値を、見出しのボタンを押したときだけ出す折りたたみ。
 * 既定は非表示（絵の比較が主で、数値は必要なときだけ見る）。開閉の状態は端末に覚えておき、全画面で共通にする。
 */
export function NumbersFold({ title, testId, children }: Props) {
  const [shown, toggle] = useShowNumbers();
  const bodyId = useId();
  return (
    <div className="numbers-fold" data-testid={testId} data-shown={shown}>
      <h3>
        <button
          className="full"
          data-testid={`${testId}-toggle`}
          aria-expanded={shown}
          aria-controls={bodyId}
          onClick={toggle}
        >
          <span aria-hidden="true">{shown ? '▾' : '▸'} </span>
          <span data-testid={`${testId}-title`}>{title}</span>
          <span className="numbers-hint">
            {shown ? ja.numbers.hintShown : ja.numbers.hintHidden}
          </span>
        </button>
      </h3>
      <div id={bodyId}>{shown && children}</div>
    </div>
  );
}
