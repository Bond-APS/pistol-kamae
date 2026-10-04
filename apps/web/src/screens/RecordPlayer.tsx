import {
  checkClip,
  clipContains,
  clipOf,
  metricsAtFrame,
  setShotMark,
  shotMarkOf,
  tiltDegOfRecord,
  type Clip,
} from '@pistol-kamae/engine';
import { useCallback, useMemo, useRef, useState } from 'react';
import { nearestFrameInRange, snapToFrame } from '../analysis/frames';
import { loudestTimeSec } from '../audio/envelope';
import { useAudioEnvelope } from '../audio/useAudioEnvelope';
import { MetricTable } from '../components/MetricTable';
import { SinglePlayer } from '../components/SinglePlayer';
import { useRecordVideoUrl } from '../components/useRecordVideoUrl';
import type { BarMarker, WaveSeries } from '../components/WaveBar';
import { overwriteRecordMarks, updateRecordClip, type OpenedRecord } from '../db/library';
import { ja } from '../i18n/ja';
import { captureShotImages } from '../video/capture';

/** play：動画を再生（止めると角度）、shot：撃発ポイントの修正、clip：切り抜き範囲の修正 */
export type PlayerMode = 'play' | 'shot' | 'clip';

interface Props {
  opened: OpenedRecord;
  mode: PlayerMode;
  /** 閉じる（詳細や比較画面へ戻る） */
  onClose: () => void;
  /** 撃発ポイントや範囲を書き換えたとき */
  onChanged: (id: number) => void;
  backLabel: string;
  /** 画面に出ているか。隠れたら再生を止める */
  active?: boolean;
}

const titleOf = (mode: PlayerMode): string =>
  mode === 'play' ? ja.library.play : mode === 'shot' ? ja.shot.fixTitle : ja.clip.fixTitle;

/**
 * ライブラリの 1 本の動画のプレイヤー。再生（角度の表示）、撃発ポイントの修正、切り抜き範囲の修正を 1 つの画面で受け持つ。
 * 比較画面の「撃発ポイントの修正」「切り抜き範囲の修正」からも開く。
 */
export function RecordPlayer({ opened, mode, onClose, onChanged, backLabel, active }: Props) {
  const { row, record } = opened;
  const { analysis } = record;
  const { frames, fps, durationSec } = analysis;
  const shot = shotMarkOf(record.marks)!;
  const savedClip = clipOf(record.clip, durationSec);

  const video = useRecordVideoUrl(row.id, 0);
  const envelope = useAudioEnvelope({ kind: 'record', recordId: row.id });
  const [clip, setClip] = useState<Clip>(savedClip);
  const [valueSec, setValueSec] = useState(shot.timeSec);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<
    'none' | 'saved' | 'failed' | 'shotOutsideClip' | 'invalidClip'
  >('none');
  const playerVideoRef = useRef<HTMLVideoElement | null>(null);
  const onVideo = useCallback((v: HTMLVideoElement | null) => {
    playerVideoRef.current = v;
  }, []);

  // 再生と撃発の修正は切り抜きの範囲の中、範囲の修正は動画の全体を動く
  const range = mode === 'clip' ? { startSec: 0, endSec: durationSec } : savedClip;
  const index = nearestFrameInRange(frames, valueSec, range.startSec, range.endSec);
  const frameSec = frames[index]?.timeSec ?? valueSec;
  const snap = (sec: number) => snapToFrame(frames, sec);
  /** 範囲の端はコマの時刻に吸着させ、動画の中に収め、1 コマ以上の長さを保つ */
  const setClipSnapped = (startSec: number, endSec: number) => {
    const s0 = Math.max(snap(startSec), 0);
    const e0 = Math.min(snap(endSec), durationSec);
    setClip(e0 - s0 >= 1 / fps ? { startSec: s0, endSec: e0 } : clip);
  };
  const waves: WaveSeries[] | undefined =
    envelope.state === 'ready'
      ? [{ key: 'audio', envelope: envelope.envelope, className: 'wave-single' }]
      : undefined;
  const loudest = useMemo(
    () =>
      envelope.state === 'ready' && mode === 'shot'
        ? loudestTimeSec(envelope.envelope, range.startSec, range.endSec)
        : null,
    [envelope, mode, range.startSec, range.endSec],
  );
  const markers: BarMarker[] = [{ key: 'shot', sec: shot.timeSec, label: ja.shot.marker }];
  if (loudest !== null && Math.abs(loudest - shot.timeSec) > 1 / fps) {
    markers.push({ key: 'loudest', sec: loudest, label: ja.shot.loudest });
  }

  const metrics = useMemo(
    () =>
      mode === 'play' && !playing
        ? metricsAtFrame(
            {
              frames,
              handedness: record.meta.handedness,
              imageWidth: analysis.width,
              imageHeight: analysis.height,
              tiltDeg: tiltDegOfRecord(record),
            },
            index,
          )
        : null,
    [mode, playing, frames, record, analysis, index],
  );

  const fixShot = async () => {
    const v = playerVideoRef.current;
    if (!v || busy) return;
    setBusy(true);
    setStatus('none');
    try {
      const images = await captureShotImages(v, analysis, frameSec);
      await overwriteRecordMarks(row.id, setShotMark(record.marks, frameSec), images);
      setStatus('saved');
      onChanged(row.id);
    } catch {
      setStatus('failed');
    }
    setBusy(false);
  };
  const fixClip = async () => {
    if (busy) return;
    const problem = checkClip(clip, durationSec, shot.timeSec);
    if (problem) {
      setStatus(problem);
      return;
    }
    setBusy(true);
    setStatus('none');
    try {
      const whole = clip.startSec <= 0 && clip.endSec >= durationSec;
      await updateRecordClip(row.id, whole ? null : clip);
      setStatus('saved');
      onChanged(row.id);
    } catch {
      setStatus('failed');
    }
    setBusy(false);
  };

  const relSec = frameSec - shot.timeSec;
  const timeLabel =
    Math.abs(relSec) < 1 / (2 * fps)
      ? ja.compare.atShot
      : relSec < 0
        ? ja.compare.beforeShot(-relSec)
        : ja.compare.afterShot(relSec);

  return (
    <section data-testid="record-player" data-mode={mode} data-record-id={row.id}>
      <div className="row nowrap">
        <button data-testid="player-back" onClick={onClose}>
          {backLabel}
        </button>
        <span className="small grow ellipsis" data-testid="player-title">
          {row.title}
        </span>
      </div>
      <h2>{titleOf(mode)}</h2>
      {mode === 'shot' && (
        <p className="muted small">
          {envelope.state === 'none' ? ja.shot.introNoAudio : ja.shot.intro}
        </p>
      )}
      {mode === 'clip' && <p className="muted small">{ja.clip.intro}</p>}

      {video.state === 'loading' && <p className="muted">{ja.library.loading}</p>}
      {video.state === 'none' && (
        <div className="notice" data-testid="player-no-video">
          <strong>{ja.library.needVideo}</strong>
        </div>
      )}
      {video.state === 'ready' && (
        <SinglePlayer
          videoUrl={video.url}
          analysis={analysis}
          startSec={range.startSec}
          endSec={range.endSec}
          valueSec={valueSec}
          onChange={setValueSec}
          {...(waves ? { waves } : {})}
          noAudio={envelope.state === 'none'}
          markers={markers}
          {...(mode === 'shot' ? { pointer: 'arrow' as const } : {})}
          {...(mode === 'clip'
            ? {
                handles: {
                  startSec: clip.startSec,
                  endSec: clip.endSec,
                  onChange: setClipSnapped,
                  snap,
                },
              }
            : {})}
          {...(mode === 'play'
            ? { transport: { rate, loop, onRate: setRate, onLoop: setLoop } }
            : {})}
          timeLabel={`${timeLabel}\u3000${ja.player.timeLabel(frameSec, index, frames.length)}`}
          onVideo={onVideo}
          onPlayingChange={setPlaying}
          active={active ?? true}
          testId="player"
        >
          {mode === 'clip' && (
            <div className="row nowrap">
              <button
                data-testid="clip-set-start"
                onClick={() => setClipSnapped(frameSec, Math.max(clip.endSec, frameSec + 1 / fps))}
              >
                {ja.clip.setStart}
              </button>
              <button
                data-testid="clip-set-end"
                onClick={() =>
                  setClipSnapped(Math.min(clip.startSec, frameSec - 1 / fps), frameSec)
                }
              >
                {ja.clip.setEnd}
              </button>
            </div>
          )}
        </SinglePlayer>
      )}

      {mode === 'play' && video.state === 'ready' && (
        <>
          <h3>{ja.player.angleTitle}</h3>
          {metrics ? (
            <MetricTable metrics={metrics} testId="player-table" />
          ) : (
            <p className="muted small" data-testid="player-table-playing">
              {playing ? ja.player.anglePlaying : ja.metricTable.noPerson}
            </p>
          )}
        </>
      )}

      {mode === 'shot' && video.state === 'ready' && (
        <button
          className="primary full"
          data-testid="shot-set"
          disabled={busy || !clipContains(record.clip, durationSec, frameSec)}
          onClick={() => void fixShot()}
        >
          {busy ? ja.shot.capturing : ja.shot.set}
        </button>
      )}
      {mode === 'clip' && video.state === 'ready' && (
        <>
          <p className="muted small num" data-testid="clip-length">
            {ja.clip.length(clip.endSec - clip.startSec, durationSec)}
          </p>
          <button
            className="primary full"
            data-testid="clip-confirm"
            disabled={busy}
            onClick={() => void fixClip()}
          >
            {ja.common.decide}
          </button>
        </>
      )}
      {status === 'saved' && (
        <p className="small" data-testid="player-saved">
          {ja.library.fixSaved}
        </p>
      )}
      {status === 'failed' && <p className="danger small">{ja.library.fixFailed}</p>}
      {status === 'shotOutsideClip' && (
        <p className="danger small" data-testid="clip-problem">
          {ja.clip.shotOutside}
        </p>
      )}
      {status === 'invalidClip' && <p className="danger small">{ja.clip.invalid}</p>}
    </section>
  );
}
