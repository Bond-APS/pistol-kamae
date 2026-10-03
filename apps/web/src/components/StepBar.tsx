import { ja } from '../i18n/ja';
import type { SaveStep } from '../screens/SaveScreen';

type ShownStep = Exclude<SaveStep, 'done'>;

const STEPS: ShownStep[] = ['shooter', 'video', 'clip', 'shot', 'form'];

/**
 * 保存の流れの 5 段階を示す帯。今の段階は青、終えた段階は緑。
 * 帯には短い名前を並べ（iPhone の幅に 5 つ収めるため）、その下に今の段階の正式な名前を出す
 */
export function StepBar({ step }: { step: SaveStep }) {
  const current = step === 'done' ? STEPS.length : STEPS.indexOf(step);
  return (
    <>
      <ol className="steps" data-testid="steps" aria-label={ja.steps.aria}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={i === current ? 'on' : i < current ? 'done' : ''}
            aria-current={i === current ? 'step' : undefined}
          >
            {ja.steps.short[s]}
          </li>
        ))}
      </ol>
      {step !== 'done' && (
        <h2 className="step-title" data-testid="step-title">
          {ja.steps.title[step]}
        </h2>
      )}
    </>
  );
}
