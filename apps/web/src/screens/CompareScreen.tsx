import { useEffect, useState } from 'react';
import { forgetEnvelope } from '../audio/useAudioEnvelope';
import { openRecord, type ComparePair, type OpenedRecord } from '../db/library';
import type { ShooterRow } from '../db/schema';
import { ja } from '../i18n/ja';
import { CompareView } from './CompareView';

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
 * 「撃発ポイントの修正」「切り抜き範囲の修正」も、重ねたまま CompareView の中で行う。
 */
export function CompareScreen(props: Props) {
  const { shooters, pair, onPairChange, onGoLibrary, onRecordChanged } = props;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  /** 直したあとに読み直すための番号 */
  const [version, setVersion] = useState(0);
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

  // 凡例はボタンの下に、①と②を 1 行ずつ出す（スマートフォンで見切れないように。2026-10-14、開発者の決定）
  const back = (
    <>
      <div className="row nowrap">
        <button data-testid="compare-back" onClick={onGoLibrary}>
          {ja.compare.backToLibrary}
        </button>
      </div>
      {base && current && (
        <div className="small pair-lines" data-testid="compare-pair">
          <p>
            <span className="skeleton-key base" aria-hidden="true" />
            {ja.compare.pairBase(base.row.title)}
          </p>
          <p>
            <span className="skeleton-key current" aria-hidden="true" />
            {ja.compare.pairCurrent(current.row.title)}
          </p>
        </div>
      )}
    </>
  );

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
        // 2 件を選び直したときだけ作り直す。「決定」や動画の付け直しでは作り直さず、読み直した記録を渡す
        // （作り直すと 2 本の動画を読み直し、古い 2 本を手放す前に新しい 2 本がメモリに載るため）
        key={pairKey}
        base={base}
        current={current}
        onRecordsChanged={(ids) => {
          setVersion((v) => v + 1);
          ids.forEach(onRecordChanged);
        }}
        onVideoAttached={(role) => {
          // 覚えている包絡線を捨ててから、CompareView が付けた側だけ読み直す
          forgetEnvelope((role === 'base' ? base : current).row.id);
          setVersion((v) => v + 1);
        }}
      />
    </section>
  );
}
