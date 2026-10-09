import type { RecordAnalysis } from '@pistol-kamae/engine';
import { useRef, useState } from 'react';
import { storeEnvelopeFromFile } from '../audio/useAudioEnvelope';
import { setRecordVideo } from '../db/library';
import { ja } from '../i18n/ja';
import { VIDEO_MAX_BYTES, VIDEO_MAX_MB } from '../video/limits';
import { isNoDuration, loadVideo, releaseVideo } from '../video/load';

interface Props {
  recordId: number;
  /** 記録の解析結果。選んだ動画がこの記録のものかを、大きさと長さで確かめる */
  analysis: RecordAnalysis;
  onAttached: () => void;
  testId: string;
}

/**
 * 動画の長さがこれ以上違えば、別の動画とみなす（秒）。
 * 同じファイルなら長さは同じになるが、端末が選ぶたびに書き出し直す場合のわずかな違いは許す。
 */
const DURATION_TOLERANCE_SEC = 0.2;

type Status = 'idle' | 'busy' | 'tooLarge' | 'mismatch' | 'unsupported' | 'noDuration' | 'failed';

/** 選んだ動画の大きさと長さ（違ったときに見せる） */
interface Picked {
  width: number;
  height: number;
  durationSec: number;
}

/**
 * 動画本体のない記録（仕様変更の前に保存した記録、保存に失敗した記録、大きすぎた記録）に、あとから動画本体を
 * 保存し直すボタン「動画ファイルを選び直す」。記録を作ったときと同じ動画ファイルを選んでもらう。
 */
export function AttachVideo({ recordId, analysis, onAttached, testId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [picked, setPicked] = useState<Picked | null>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    // 保存の流れと同じ上限。超える動画は読まずに断る（丸ごとメモリに載せる前に）
    if (file.size > VIDEO_MAX_BYTES) {
      setStatus('tooLarge');
      return;
    }
    setStatus('busy');
    let video: HTMLVideoElement;
    try {
      video = await loadVideo(file);
    } catch (e) {
      setStatus(isNoDuration(e) ? 'noDuration' : 'unsupported');
      return;
    }
    const same =
      video.videoWidth === analysis.width &&
      video.videoHeight === analysis.height &&
      Math.abs(video.duration - analysis.durationSec) < DURATION_TOLERANCE_SEC;
    setPicked({ width: video.videoWidth, height: video.videoHeight, durationSec: video.duration });
    releaseVideo(video);
    if (!same) {
      setStatus('mismatch');
      return;
    }
    try {
      await setRecordVideo(recordId, { bytes: await file.arrayBuffer(), type: file.type });
      // 音のグラフも、このファイルの必要な部分だけ読んで記録に写す（あとで動画本体を読み直さないため）。
      // 写せなくても動画は付いているので、失敗にはしない（次に開いたときに計算する）
      await storeEnvelopeFromFile(file, recordId).catch(() => {});
      setStatus('idle');
      onAttached();
    } catch {
      setStatus('failed');
    }
  };

  return (
    <>
      <button
        className="full"
        data-testid={testId}
        disabled={status === 'busy'}
        onClick={() => inputRef.current?.click()}
      >
        {status === 'busy' ? ja.video.attaching : ja.video.attach}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        data-testid={`${testId}-file`}
        onChange={(e) => {
          void onPick(e.target.files?.[0]);
          // 同じファイルを選び直しても反応するように、選択を消しておく
          e.target.value = '';
        }}
      />
      {status === 'tooLarge' && (
        <p className="danger small" data-testid={`${testId}-error`}>
          {ja.video.tooLarge(VIDEO_MAX_MB)}
        </p>
      )}
      {status === 'mismatch' && (
        <p className="danger small" data-testid={`${testId}-error`}>
          {ja.video.mismatch}
          {picked && (
            <>
              <br />
              {ja.video.mismatchDetail(
                analysis.width,
                analysis.height,
                analysis.durationSec,
                picked.width,
                picked.height,
                picked.durationSec,
              )}
            </>
          )}
        </p>
      )}
      {status === 'unsupported' && (
        <p className="danger small" data-testid={`${testId}-error`}>
          {ja.load.unsupportedTitle}
        </p>
      )}
      {status === 'noDuration' && (
        <p className="danger small" data-testid={`${testId}-error`}>
          {ja.load.noDurationTitle}
        </p>
      )}
      {status === 'failed' && (
        <p className="danger small" data-testid={`${testId}-error`}>
          {ja.video.failed}
        </p>
      )}
    </>
  );
}
