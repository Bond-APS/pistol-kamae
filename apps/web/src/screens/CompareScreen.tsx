import { useEffect, useState } from 'react';
import { forgetEnvelope } from '../audio/useAudioEnvelope';
import { openRecord, type ComparePair, type OpenedRecord } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { CompareView, type Role } from './CompareView';
import { RecordPlayer, type PlayerMode } from './RecordPlayer';

interface Props {
  shooters: ShooterRow[];
  /** 比べる 2 件（①基準・②比較）。App が持ち、端末に覚えておく */
  pair: ComparePair;
  onPairChange: (pair: ComparePair) => void;
  onGoLibrary: () => void;
  /** 撃発ポイントや範囲を直したとき（ライブラリの一覧を読み直してもらう） */
  onRecordChanged: (id: number) => void;
}

/** 読み込んだ 2 件。どの 2 件を読んだ結果かを一緒に持つ（選び直した直後に前の結果を出さないため） */
interface Loaded {
  key: string;
  base: OpenedRecord | null;
  current: OpenedRecord | null;
}

/**
 * 比較画面：ライブラリで選んだ①基準と②比較を読み込み、動画を重ねる。
 * ここでは読み込みと案内を受け持ち、図とバーは CompareView が受け持つ。
 * 「撃発ポイントの修正」「切り抜き範囲の修正」は、どちらかの動画のプレイヤー（RecordPlayer）を開く。
 */
export function CompareScreen(props: Props) {
  const { shooters, pair, onPairChange, onGoLibrary, onRecordChanged } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  /** 直したあとに読み直すための番号 */
  const [version, setVersion] = useState(0);
  const [fixing, setFixing] = useState<{ role: Role; mode: PlayerMode } | null>(null);
  /** どの 2 件を読んだか。直したあとの読み直し（version）では、読み終わるまで前の内容を出し続ける */
  const pairKey = `${pair.baseId}:${pair.currentId}`;

  // 射手の名前や利き手が直されたときも読み直す（角度は利き手から計算し直す）
  useEffect(() => {
    let alive = true;
    const open = (id: number | null) => (id === null ? Promise.resolve(null) : openRecord(id));
    void Promise.all([open(pair.baseId), open(pair.currentId)]).then(
      ([base, current]) => {
        if (!alive) return;
        setLoaded({ key: pairKey, base, current });
        // 選んでいた記録が削除されたなどで開けなければ、選び直しの状態に戻す
        const lostBase = pair.baseId !== null && base === null;
        const lostCurrent = pair.currentId !== null && current === null;
        if (lostBase || lostCurrent) {
          setMissing(true);
          onPairChange({
            baseId: lostBase ? null : pair.baseId,
            currentId: lostCurrent ? null : pair.currentId,
          });
        }
      },
      () => {
        if (alive) setLoaded({ key: pairKey, base: null, current: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [pair, pairKey, version, shooters, onPairChange]);

  const ready = loaded !== null && loaded.key === pairKey;
  const base = ready ? loaded.base : null;
  const current = ready ? loaded.current : null;

  const back = (
    <div className="row nowrap">
      <button data-testid="compare-back" onClick={onGoLibrary}>
        {ja.compare.backToLibrary}
      </button>
      {base && current && (
        <span className="small grow ellipsis" data-testid="compare-pair">
          <span className="skeleton-key base" aria-hidden="true" />
          {ja.compare.pairLine(base.row.title, current.row.title)}
        </span>
      )}
    </div>
  );

  if (fixing && base && current) {
    const opened = fixing.role === 'base' ? base : current;
    return (
      <RecordPlayer
        key={`${opened.row.id}:${fixing.mode}`}
        opened={opened}
        mode={fixing.mode}
        backLabel={ja.compare.backToCompare}
        onClose={() => setFixing(null)}
        onChanged={(id) => {
          setVersion((v) => v + 1);
          onRecordChanged(id);
        }}
      />
    );
  }

  if (!ready) {
    return (
      <section data-testid="compare">
        {back}
        <p className="muted">{ja.compare.loading}</p>
      </section>
    );
  }

  if (!base || !current) {
    return (
      <section data-testid="compare">
        {back}
        {missing && (
          <div className="notice err" data-testid="compare-missing">
            <strong>{ja.compare.notFound}</strong>
          </div>
        )}
        <p>{ja.compare.notChosen}</p>
        <button className="primary full" data-testid="compare-go-library" onClick={onGoLibrary}>
          {ja.compare.goLibrary}
        </button>
      </section>
    );
  }

  return (
    <section data-testid="compare">
      {back}
      {base.shooter.handedness !== current.shooter.handedness && (
        <div className="notice" data-testid="compare-handedness">
          <strong>{ja.compare.handednessTitle}</strong>
          <p className="small">
            {ja.compare.handednessBody(base.shooter.name, base.shooter.handedness)}
          </p>
        </div>
      )}
      {base.record.analysis.backendId !== current.record.analysis.backendId && (
        <div className="notice" data-testid="compare-backend">
          <strong>{ja.compare.backendTitle}</strong>
          <p className="small">{ja.compare.backendBody}</p>
        </div>
      )}
      <CompareView
        key={`${pairKey}:${version}`}
        base={base}
        current={current}
        onFix={(role, mode) => setFixing({ role, mode })}
        onClipsChanged={() => {
          setVersion((v) => v + 1);
          onRecordChanged(pair.baseId ?? 0);
        }}
        onVideoAttached={(role) => {
          forgetEnvelope((role === 'base' ? base : current).row.id);
          setVersion((v) => v + 1);
        }}
      />
    </section>
  );
}
