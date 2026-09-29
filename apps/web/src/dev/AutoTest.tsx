// 開発サーバ限定の自動テストモード。公開ビルドには含めない（App.tsx で DEV のときだけ読み込む）。
// 使い方：http://localhost:5173/?autotest=1&video=/_test/sample.mov&start=4.7&end=8.5
//   video     同じ開発サーバ上の動画の場所（既定 /_test/sample.mov）
//   start/end ノイズを集計する区間（秒）。省略すれば全フレーム
//   backends  カンマ区切りのモデル名。省略すれば全モデル
// 動画の読込から各モデルでの姿勢推定・ノイズ集計までを順番に実行し、結果を画面と
// window.__autotest に出す。文言は検証用のため i18n には入れていない。

import { METRIC_IDS, type NoiseStats } from '@pistol-kamae/engine';
import { useEffect, useRef, useState } from 'react';
import { noiseStatsOf, type TimeRange } from '../analysis/metrics';
import { runAnalysis, type AnalysisTiming } from '../analysis/runAnalysis';
import { BACKEND_CHOICES, backendConfigOf, type BackendChoice } from '../config/backends';
import { loadVideo } from '../video/load';
import { estimateFrameRate } from '../video/seek';

interface BackendResult {
  backend: string;
  backendId?: string;
  frames?: number;
  detected?: number;
  /** 正確なフレーム時刻（requestVideoFrameCallback）が取れたか */
  timing?: AnalysisTiming;
  notes?: string[];
  stats?: NoiseStats;
  statsCount?: number;
  error?: string;
}

interface AutoTestReport {
  done: boolean;
  userAgent: string;
  visibility: string;
  video?: { url: string; width: number; height: number; durationSec: number; fps: number | null };
  range?: TimeRange;
  results: BackendResult[];
  fatal?: string;
}

declare global {
  interface Window {
    __autotest?: AutoTestReport;
  }
}

const fmt = (v: number | null | undefined, d = 2) => (v == null ? '—' : v.toFixed(d));

export default function AutoTest() {
  const [report, setReport] = useState<AutoTestReport | null>(null);
  const [progress, setProgress] = useState('準備中…');
  const [sent, setSent] = useState<'none' | 'ok' | 'failed'>('none');
  const [finished, setFinished] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('video') ?? '/_test/sample.mov';
    const start = params.get('start');
    const end = params.get('end');
    const range: TimeRange | undefined =
      start !== null || end !== null
        ? { startSec: Number(start ?? 0), endSec: end !== null ? Number(end) : Infinity }
        : undefined;
    const reportToServer = params.has('report');
    const label = params.get('label') ?? 'run';
    const nextUrl = params.get('next');
    // 同じ端末の 1 本目と 2 本目の結果を結び付けるための番号（時刻から作る）
    const sessionId = params.get('session') ?? Date.now().toString(36);
    const requested = params.get('backends')?.split(',') as BackendChoice[] | undefined;
    const backends = requested?.filter((b) => BACKEND_CHOICES.includes(b)) ?? BACKEND_CHOICES;

    const current: AutoTestReport = {
      done: false,
      userAgent: navigator.userAgent,
      visibility: document.visibilityState,
      results: [],
      ...(range ? { range } : {}),
    };
    const publish = () => {
      window.__autotest = { ...current, results: [...current.results] };
      setReport(window.__autotest);
      if (!reportToServer) return;
      // 開発サーバ（同じ Wi-Fi 内の Mac）へ数値だけを送る。動画とランドマークは含まない
      void fetch('/__autotest/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, sessionId, ...window.__autotest }),
      }).then(
        (r) => setSent(r.ok ? 'ok' : 'failed'),
        () => setSent('failed'),
      );
    };

    void (async () => {
      try {
        setProgress(`動画を取得中：${videoUrl}`);
        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`動画を取得できません（${res.status}）`);
        const video = await loadVideo(await res.blob());
        // 画面に表示しておく（表示中でないとフレーム時刻の通知が来ないブラウザがある）
        video.style.width = '160px';
        boxRef.current?.appendChild(video);
        setProgress('フレームレートを推定中…');
        const fps = await estimateFrameRate(video);
        current.video = {
          url: videoUrl,
          width: video.videoWidth,
          height: video.videoHeight,
          durationSec: video.duration,
          fps,
        };
        publish();

        for (const backend of backends) {
          const entry: BackendResult = { backend };
          try {
            const result = await runAnalysis({
              video,
              config: backendConfigOf(backend),
              fps: fps ?? 30,
              signal: new AbortController().signal,
              onPreparing: () => setProgress(`${backend}：モデルを読込中…`),
              onProgress: (done, total) =>
                setProgress(`${backend}：${done} / 約 ${total} フレーム`),
            });
            const stats = noiseStatsOf(result, 'right', range);
            Object.assign(entry, {
              backendId: result.backendId,
              frames: result.frames.length,
              detected: result.frames.filter((f) => f.landmarks).length,
              timing: result.timing,
              notes: result.notes,
              stats,
              statsCount: stats.shoulderTilt.count,
            });
          } catch (e) {
            entry.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
          }
          current.results.push(entry);
          publish();
        }
      } catch (e) {
        current.fatal = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
      current.done = true;
      publish();
      if (nextUrl && nextUrl.startsWith('/') && !current.fatal) {
        setProgress('1 本目が完了。2 本目へ進みます…');
        const sep = nextUrl.includes('?') ? '&' : '?';
        setTimeout(() => window.location.assign(`${nextUrl}${sep}session=${sessionId}`), 1500);
        return;
      }
      setProgress('完了');
      setFinished(true);
    })();
  }, []);

  return (
    <section>
      <h2>自動テスト（開発サーバ限定）</h2>
      {finished ? (
        <p className="autotest-done">
          すべて完了しました。{sent === 'ok' ? '結果は Mac に届きました。' : ''}
          この画面は閉じて構いません。
        </p>
      ) : (
        <p>自動で進みます。画面を消さず、このままお待ちください（数分）。</p>
      )}
      {sent === 'failed' && (
        <p className="danger">結果を Mac に送れませんでした。この画面を撮影して送ってください。</p>
      )}
      <p data-testid="autotest-progress">{progress}</p>
      <div ref={boxRef} />
      {report?.fatal && <p className="danger">{report.fatal}</p>}
      {report?.video && (
        <p className="muted small">
          {report.video.width}×{report.video.height}、{report.video.durationSec.toFixed(1)} 秒、推定{' '}
          {fmt(report.video.fps, 2)} fps／表示状態 {report.visibility}
        </p>
      )}
      {report && report.results.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>モデル</th>
              <th>処理秒</th>
              <th>推定 ms</th>
              <th>取出 ms</th>
              {METRIC_IDS.slice(0, 3).map((id) => (
                <th key={id}>{id} SD</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.results.map((r) => (
              <tr key={r.backend}>
                <td>{r.backend}</td>
                {r.error ? (
                  <td colSpan={6} className="danger">
                    {r.error}
                  </td>
                ) : (
                  <>
                    <td className="num">{fmt((r.timing?.totalMs ?? 0) / 1000, 1)}</td>
                    <td className="num">
                      {fmt((r.timing?.inferenceMs ?? 0) / (r.frames || 1), 0)}
                    </td>
                    <td className="num">{fmt((r.timing?.seekMs ?? 0) / (r.frames || 1), 0)}</td>
                    {METRIC_IDS.slice(0, 3).map((id) => (
                      <td key={id} className="num">
                        {fmt(r.stats?.[id].sd)}
                      </td>
                    ))}
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
