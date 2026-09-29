import type { Handedness, Mark } from '@pistol-kamae/engine';
import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import type { AnalysisResult } from './analysis/runAnalysis';
import { DevErrorBanner } from './components/DevErrorBanner';
import { ja } from './i18n/ja';
import { LoadScreen } from './screens/LoadScreen';
import { MarkScreen } from './screens/MarkScreen';
import { NoiseScreen } from './screens/NoiseScreen';

type Tab = 'load' | 'mark' | 'noise';
const TABS: Tab[] = ['load', 'mark', 'noise'];

// 開発サーバ限定の自動テストモード（?autotest=1）。公開ビルドでは読み込まない
const AutoTest = import.meta.env.DEV ? lazy(() => import('./dev/AutoTest')) : null;
const autoTestRequested =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('autotest');

export function App() {
  const [tab, setTab] = useState<Tab>('load');
  const [handedness, setHandedness] = useState<Handedness>('right');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  // video 要素は 1 つだけ作り、表示中の画面のプレイヤーに移して使う
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 動画を選び直す・推定をやり直すと、マークは消える（保存は段階③）
  const onResult = useCallback((r: AnalysisResult | null) => {
    setResult(r);
    setMarks([]);
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

  return (
    <main className="app">
      <header>
        <h1>{ja.app.title}</h1>
        <p className="muted small">{ja.app.stageNote}</p>
      </header>

      <DevErrorBanner />

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={tab === t ? 'tab active' : 'tab'}
            data-testid={`tab-${t}`}
            onClick={() => setTab(t)}
          >
            {ja.tabs[t]}
          </button>
        ))}
      </nav>

      {/* 読込画面は隠すだけにして、動画と処理状態を保つ */}
      <div hidden={tab !== 'load'}>
        <LoadScreen
          videoRef={videoRef}
          active={tab === 'load'}
          handedness={handedness}
          onHandednessChange={setHandedness}
          result={result}
          onResult={onResult}
        />
      </div>
      {tab === 'mark' && (
        <MarkScreen
          videoRef={videoRef}
          result={result}
          handedness={handedness}
          marks={marks}
          onMarksChange={setMarks}
        />
      )}
      {tab === 'noise' && <NoiseScreen result={result} handedness={handedness} />}
    </main>
  );
}
