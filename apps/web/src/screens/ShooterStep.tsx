import { useState } from 'react';
import { ShooterDialog } from '../components/ShooterDialog';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';

/** 射手の選択肢のうち「新しい射手を登録」を表す値 */
const ADD_SHOOTER = 'add';

interface Props {
  shooters: ShooterRow[];
  /** 射手の一覧を読み終えたか。読み終えるまでは、登録済みの人に「射手を登録」を見せないよう何も出さない */
  ready: boolean;
  /** 選択中の射手。まだ誰も登録されていなければ null */
  shooter: ShooterRow | null;
  onShooterChange: (shooterId: number) => void;
  onShootersChanged: () => Promise<void>;
  /** 動画の指定へ進む */
  onNext: () => void;
}

/**
 * 「動画の保存」の最初の段階：射手の選択（登録・編集もここで行う）。
 * 射手は利き手（角度の符号）に関わるので、動画を選ぶ前に決める（2026-10-03、開発者の決定）。
 */
export function ShooterStep(props: Props) {
  const { shooters, shooter } = props;
  const [dialog, setDialog] = useState<'add' | 'edit' | null>(null);

  if (!props.ready) return <section data-testid="shooter-step" aria-busy="true" />;

  return (
    <section data-testid="shooter-step">
      <div className="field">
        <span id="shooter-label">{ja.shooter.stepIntro}</span>
        {shooter ? (
          <div className="row nowrap tight">
            <select
              className="grow"
              data-testid="shooter-select"
              aria-labelledby="shooter-label"
              value={shooter.id}
              onChange={(e) => {
                if (e.target.value === ADD_SHOOTER) setDialog('add');
                else props.onShooterChange(Number(e.target.value));
              }}
            >
              {shooters.map((s) => (
                <option key={s.id} value={s.id}>
                  {ja.shooter.option(s.name, s.handedness)}
                </option>
              ))}
              <option value={ADD_SHOOTER}>{ja.shooter.addOption}</option>
            </select>
            <button data-testid="shooter-edit" onClick={() => setDialog('edit')}>
              {ja.shooter.edit}
            </button>
          </div>
        ) : (
          <>
            <button
              className="full"
              data-testid="shooter-register"
              onClick={() => setDialog('add')}
            >
              {ja.shooter.registerFirst}
            </button>
            <span>{ja.shooter.requiredHint}</span>
          </>
        )}
      </div>

      <div className="row">
        <button
          className="primary full"
          data-testid="shooter-next"
          disabled={!shooter}
          onClick={props.onNext}
        >
          {ja.shooter.next}
        </button>
      </div>

      {dialog && (
        <ShooterDialog
          shooters={shooters}
          {...(dialog === 'edit' && shooter ? { editing: shooter } : {})}
          onCancel={() => setDialog(null)}
          onDone={(id) => {
            void props.onShootersChanged().then(() => {
              props.onShooterChange(id);
              setDialog(null);
            });
          }}
        />
      )}
    </section>
  );
}
