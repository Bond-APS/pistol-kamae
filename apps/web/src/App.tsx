import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from './analysis/runAnalysis';
import { DevErrorBanner } from './components/DevErrorBanner';
import {
  EMPTY_PAIR,
  getComparePair,
  getLastShooterId,
  listShooters,
  setComparePair,
  setLastShooterId,
  type ComparePair,
} from './db/library';
import type { ShooterRow } from './db/schema';
import { ja } from './i18n/ja';
import { CompareScreen } from './screens/CompareScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { NoiseScreen } from './screens/NoiseScreen';
import { SaveScreen } from './screens/SaveScreen';

/** 入口は 2 つ。比較はライブラリから入る（タブではない）。ノイズ測定は開発用で、?noise=1 のときだけ */
type Tab = 'save' | 'library' | 'noise';
type View = Tab | 'compare';

// 開発サーバ限定の自動テストモード（?autotest=1）。公開ビルドでは読み込まない
const AutoTest = import.meta.env.DEV ? lazy(() => import('./dev/AutoTest')) : null;
const params = new URLSearchParams(window.location.search);
const autoTestRequested = import.meta.env.DEV && params.has('autotest');
const TABS: Tab[] = params.has('noise') ? ['save', 'library', 'noise'] : ['save', 'library'];

export function App() {
  const [view, setView] = useState<View>('save');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [shooters, setShooters] = useState<ShooterRow[]>([]);
  /** 起動時の射手の一覧を読み終えたか（読み終える前に「射手を登録」を出さないため） */
  const [shootersReady, setShootersReady] = useState(false);
  const [shooterId, setShooterId] = useState<number | null>(null);
  const [dbFailed, setDbFailed] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  // 比較する 2 件（①基準・②比較）。端末に覚えておき、次に開いたときも同じ 2 件を出す
  const [pair, setPair] = useState<ComparePair>(EMPTY_PAIR);
  /** ライブラリの一覧を読み直してもらうための番号（保存・修正のたびに増やす） */
  const [libraryVersion, setLibraryVersion] = useState(0);
  // 推定に使う video 要素。読込画面が作り、推定が終わったら解放する
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const reloadShooters = useCallback(async () => {
    try {
      setShooters(await listShooters());
    } catch {
      setDbFailed(true);
    }
  }, []);

  // 起動時：射手の一覧を読み、前回の射手と比較の 2 件を選んでおく
  useEffect(() => {
    void (async () => {
      try {
        const [list, lastId, lastPair] = await Promise.all([
          listShooters(),
          getLastShooterId(),
          getComparePair(),
        ]);
        setShooters(list);
        setShooterId((current) => current ?? lastId);
        setPair(lastPair);
      } catch {
        setDbFailed(true);
      }
      setShootersReady(true);
    })();
  }, []);

  // 選択中の射手。前回の射手が見つからなければ最初の 1 人
  const shooter = shooters.find((s) => s.id === shooterId) ?? shooters[0] ?? null;
  const handedness = shooter?.handedness ?? 'right';

  const changeShooter = useCallback((id: number) => {
    setShooterId(id);
    void setLastShooterId(id).catch(() => {});
  }, []);

  const changeView = useCallback((v: View) => {
    setView(v);
    window.scrollTo(0, 0);
  }, []);
  const [newRequest, setNewRequest] = useState(0);
  const goLoad = useCallback(() => {
    setNewRequest((n) => n + 1);
    changeView('save');
  }, [changeView]);
  const goLibrary = useCallback(() => changeView('library'), [changeView]);
  const goCompare = useCallback(() => changeView('compare'), [changeView]);

  const changePair = useCallback((next: ComparePair) => {
    setPair(next);
    void setComparePair(next).catch(() => {});
  }, []);
  const bumpLibrary = useCallback(() => setLibraryVersion((v) => v + 1), []);
  const onRecordDeleted = useCallback(
    (id: number) => {
      bumpLibrary();
      // 比較に選んでいた記録が削除されたら、選び直しの状態に戻す
      if (pair.baseId === id || pair.currentId === id) {
        changePair({
          baseId: pair.baseId === id ? null : pair.baseId,
          currentId: pair.currentId === id ? null : pair.currentId,
        });
      }
    },
    [pair, changePair, bumpLibrary],
  );

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

  const tab: Tab | null = view === 'compare' ? null : view;

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
            onClick={() => changeView(t)}
          >
            {ja.tabs[t]}
            {t === 'save' && unsaved && (
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
        {/* 保存の流れは隠すだけにして、処理状態を保つ */}
        <div hidden={view !== 'save'}>
          <SaveScreen
            active={view === 'save'}
            videoRef={videoRef}
            shooters={shooters}
            shootersReady={shootersReady}
            shooter={shooter}
            onShooterChange={changeShooter}
            onShootersChanged={reloadShooters}
            onUnsavedChange={setUnsaved}
            onResultChange={setResult}
            newRequest={newRequest}
            onGoLibrary={goLibrary}
            onSaved={bumpLibrary}
          />
        </div>
        {/* ライブラリも隠すだけにして、絞り込みの状態を保つ */}
        <div hidden={view !== 'library'}>
          <LibraryScreen
            active={view === 'library'}
            version={libraryVersion}
            shooters={shooters}
            onShootersChanged={reloadShooters}
            onGoLoad={goLoad}
            onRecordChanged={bumpLibrary}
            onRecordDeleted={onRecordDeleted}
            pair={pair}
            onPairChange={changePair}
            onCompare={goCompare}
          />
        </div>
        {view === 'compare' && (
          <CompareScreen
            shooters={shooters}
            pair={pair}
            onPairChange={changePair}
            onGoLibrary={goLibrary}
            onRecordChanged={bumpLibrary}
          />
        )}
        {view === 'noise' && (
          <NoiseScreen result={result} handedness={handedness} onGoLoad={goLoad} />
        )}
      </div>
    </main>
  );
}
