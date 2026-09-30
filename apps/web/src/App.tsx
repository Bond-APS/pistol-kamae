import type { Mark } from '@pistol-kamae/engine';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from './analysis/runAnalysis';
import { DevErrorBanner } from './components/DevErrorBanner';
import { VideoPlayer } from './components/VideoPlayer';
import { getLastShooterId, getRecordRow, listShooters, setLastShooterId } from './db/library';
import type { ShooterRow } from './db/schema';
import { ja } from './i18n/ja';
import { hasUnsavedMarks, type SavedState } from './library/savedState';
import { LibraryScreen } from './screens/LibraryScreen';
import { LoadScreen } from './screens/LoadScreen';
import { MarkScreen } from './screens/MarkScreen';
import { NoiseScreen } from './screens/NoiseScreen';

type Tab = 'load' | 'mark' | 'library' | 'noise';
const TABS: Tab[] = ['load', 'mark', 'library', 'noise'];
/** プレイヤー（動画）を出す画面 */
const PLAYER_TABS: ReadonlySet<Tab> = new Set(['load', 'mark']);

// 開発サーバ限定の自動テストモード（?autotest=1）。公開ビルドでは読み込まない
const AutoTest = import.meta.env.DEV ? lazy(() => import('./dev/AutoTest')) : null;
const autoTestRequested =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('autotest');

export function App() {
  const [tab, setTab] = useState<Tab>('load');
  const [shooters, setShooters] = useState<ShooterRow[]>([]);
  const [shooterId, setShooterId] = useState<number | null>(null);
  const [dbFailed, setDbFailed] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [fileDate, setFileDate] = useState<Date | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [saved, setSaved] = useState<SavedState | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  // video 要素もプレイヤーも 1 つだけ作り、読込画面とマーク画面で共有する。
  // Safari は video 要素を画面の別の場所へ移し替えると、その後のシークが終わらなくなるため、
  // 一度置いたら動かさない（並び順と表示・非表示は CSS で切り替える）
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const reloadShooters = useCallback(async () => {
    try {
      setShooters(await listShooters());
    } catch {
      setDbFailed(true);
    }
  }, []);

  // 起動時：射手の一覧を読み、前回の射手を選んでおく
  useEffect(() => {
    void (async () => {
      try {
        const [list, lastId] = await Promise.all([listShooters(), getLastShooterId()]);
        setShooters(list);
        setShooterId((current) => current ?? lastId);
      } catch {
        setDbFailed(true);
      }
    })();
  }, []);

  // 選択中の射手。前回の射手が見つからなければ最初の 1 人
  const shooter = shooters.find((s) => s.id === shooterId) ?? shooters[0] ?? null;
  const handedness = shooter?.handedness ?? 'right';

  const changeShooter = useCallback((id: number) => {
    setShooterId(id);
    void setLastShooterId(id).catch(() => {});
  }, []);

  // 動画を選び直す・推定をやり直すと、マークと保存先の対応は消える
  const onResult = useCallback((r: AnalysisResult | null, date: Date | null) => {
    setResult(r);
    setFileDate(date);
    setMarks([]);
    setSaved(null);
    setFrameIndex(0);
  }, []);

  const changeTab = useCallback((t: Tab) => {
    // プレイヤーのない画面へ移るときは、見えないまま再生が続かないよう止める
    if (!PLAYER_TABS.has(t)) videoRef.current?.pause();
    setTab(t);
    window.scrollTo(0, 0);
  }, []);
  const goLoad = useCallback(() => changeTab('load'), [changeTab]);
  const goMark = useCallback(() => changeTab('mark'), [changeTab]);
  const goLibrary = useCallback(() => changeTab('library'), [changeTab]);

  const onSaved = useCallback(
    (s: SavedState) => {
      setSaved(s);
      // 保存時に射手を替えたら、以後の角度表もその射手の利き手で出す
      changeShooter(s.fields.shooterId);
    },
    [changeShooter],
  );

  // ライブラリ側で、いま読み込んでいる解析の保存先が編集・削除されたときに合わせる
  const onRecordChanged = useCallback((id: number) => {
    void getRecordRow(id).then((row) => {
      if (!row) return;
      setSaved((s) =>
        s && s.recordId === id
          ? {
              ...s,
              fields: {
                shooterId: row.shooterId,
                shotAt: row.shotAt,
                score: row.score,
                memo: row.memo,
                favorite: row.favorite,
              },
            }
          : s,
      );
    });
  }, []);
  const onRecordDeleted = useCallback((id: number) => {
    setSaved((s) => (s && s.recordId === id ? null : s));
  }, []);

  if (AutoTest && autoTestRequested) {
    return (
      <main className="app">
        <DevErrorBanner />
        <Suspense fallback={null}>
          <AutoTest />
        </Suspense>
      </main>
    );
  }

  const unsaved = hasUnsavedMarks(marks, saved);

  return (
    <main className="app">
      <header>
        <h1>{ja.app.title}</h1>
        {import.meta.env.DEV && <p className="muted small">{ja.app.stageNote}</p>}
      </header>

      <DevErrorBanner />
      {dbFailed && (
        <div className="notice err" data-testid="db-failed">
          <strong>{ja.app.dbUnavailable}</strong>
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={tab === t ? 'tab active' : 'tab'}
            data-testid={`tab-${t}`}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => changeTab(t)}
          >
            {ja.tabs[t]}
            {t === 'mark' && unsaved && (
              <span
                className="status-dot"
                data-testid="unsaved-dot"
                aria-label={ja.tabs.unsavedAria}
              >
                ●
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="screens">
        {/* 読込画面は隠すだけにして、処理状態を保つ */}
        <div hidden={tab !== 'load'}>
          <LoadScreen
            videoRef={videoRef}
            shooters={shooters}
            shooter={shooter}
            onShooterChange={changeShooter}
            onShootersChanged={reloadShooters}
            result={result}
            onResult={onResult}
            hasUnsaved={unsaved}
            onGoMark={goMark}
          />
        </div>
        {tab === 'mark' && (
          <MarkScreen
            videoRef={videoRef}
            result={result}
            frameIndex={frameIndex}
            shooters={shooters}
            shooter={shooter}
            marks={marks}
            onMarksChange={setMarks}
            fileDate={fileDate}
            saved={saved}
            onSaved={onSaved}
            onShootersChanged={reloadShooters}
            onGoLoad={goLoad}
            onGoLibrary={goLibrary}
          />
        )}
        {/* ライブラリも隠すだけにして、絞り込みの状態を保つ */}
        <div hidden={tab !== 'library'}>
          <LibraryScreen
            active={tab === 'library'}
            shooters={shooters}
            onShootersChanged={reloadShooters}
            onGoLoad={goLoad}
            onRecordChanged={onRecordChanged}
            onRecordDeleted={onRecordDeleted}
          />
        </div>
        {tab === 'noise' && (
          <NoiseScreen result={result} handedness={handedness} onGoLoad={goLoad} />
        )}
        {result && (
          <div
            className={tab === 'mark' ? 'player-slot player-first' : 'player-slot'}
            hidden={!PLAYER_TABS.has(tab)}
          >
            <VideoPlayer videoRef={videoRef} result={result} onFrameIndex={setFrameIndex} />
          </div>
        )}
      </div>
    </main>
  );
}
