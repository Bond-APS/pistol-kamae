import { ja } from '../i18n/ja';
import type { SaveStep } from '../screens/SaveScreen';

const STEPS: Array<{ key: Exclude<SaveStep, 'done'>; label: string }> = [
  { key: 'open', label: ja.steps.open },
  { key: 'clip', label: ja.steps.clip },
  { key: 'shot', label: ja.steps.shot },
  { key: 'form', label: ja.steps.save },
];

/** 保存の流れの 4 段階を示す帯。今の段階は青、終えた段階は緑 */
export function StepBar({ step }: { step: SaveStep }) {
  const current = step === 'done' ? STEPS.length : STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="steps" data-testid="steps" aria-label={ja.steps.aria}>
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          className={i === current ? 'on' : i < current ? 'done' : ''}
          aria-current={i === current ? 'step' : undefined}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}
