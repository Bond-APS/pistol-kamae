import { ja } from '../i18n/ja';

/** 速さと繰り返しの設定（親が持つ） */
export interface Transport {
  rate: number;
  loop: boolean;
  onRate: (rate: number) => void;
  onLoop: (loop: boolean) => void;
}

const PLAYBACK_RATES = [1, 0.5, 0.25] as const;

interface Props {
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  canPlay?: boolean;
  transport?: Transport;
  /** すべての操作を止める（静止画を作っている間など） */
  disabled?: boolean;
  testId: string;
}

/** ◀1 コマ／▶ 再生／1 コマ▶ と、速さ・繰り返し（渡されたとき） */
export function TransportControls(props: Props) {
  const { playing, transport } = props;
  const disabled = props.disabled === true;
  return (
    <>
      <div className="row nowrap transport">
        <button
          data-testid={`${props.testId}-prev`}
          disabled={disabled || !props.canPrev}
          onClick={props.onPrev}
        >
          {ja.player.prevFrame}
        </button>
        <button
          className="primary grow"
          data-testid={`${props.testId}-play`}
          disabled={disabled || props.canPlay === false}
          onClick={playing ? props.onPause : props.onPlay}
        >
          {playing ? ja.player.pause : ja.player.play}
        </button>
        <button
          data-testid={`${props.testId}-next`}
          disabled={disabled || !props.canNext}
          onClick={props.onNext}
        >
          {ja.player.nextFrame}
        </button>
      </div>
      {/* 再生ボタンの下に左寄せで繰り返し、その下に「再生速度」と速さのボタン（2026-10-14、開発者の決定） */}
      {transport && (
        <div className="row nowrap transport">
          <button
            className="chip"
            data-testid={`${props.testId}-loop`}
            aria-pressed={transport.loop}
            disabled={disabled}
            onClick={() => transport.onLoop(!transport.loop)}
          >
            {ja.player.loop}
          </button>
        </div>
      )}
      {transport && (
        <div className="row nowrap transport">
          <span className="small" id={`${props.testId}-rate-title`}>
            {ja.player.rateTitle}
          </span>
          <div
            className="seg grow"
            role="group"
            aria-labelledby={`${props.testId}-rate-title`}
            data-testid={`${props.testId}-rate`}
          >
            {PLAYBACK_RATES.map((r) => (
              <button
                key={r}
                data-testid={`${props.testId}-rate-${r * 100}`}
                aria-pressed={transport.rate === r}
                disabled={disabled}
                onClick={() => transport.onRate(r)}
              >
                {ja.player.rate(r)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
