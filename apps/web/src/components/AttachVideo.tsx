import type { RecordAnalysis } from '@pistol-kamae/engine';
import { useRef, useState } from 'react';
import { setRecordVideo } from '../db/library';
import { ja } from '../i18n/ja';
import { loadVideo, releaseVideo } from '../video/load';

interface Props {
  recordId: number;
  /** 記録の解析結果。選んだ動画がこの記録のものかを、大きさと長さで確かめる */
  analysis: RecordAnalysis;
  onAttached: () => void;
  testId: string;
}

/**
 * 動画の長さがこれ以上違えば、別の動画とみなす（秒）。
 * 同じファイルなら長さはぴったり同じになるので、狭くしてある（1 フレームは約 0.033 秒）。
 */
const DURATION_TOLERANCE_SEC = 0.05;

type Status = 'idle' | 'busy' | 'mismatch' | 'unsupported' | 'failed';

/**
 * 動画本体のない記録（仕様変更の前に保存した記録、保存に失敗した記録）に、あとから動画を付けるボタン。
 * 記録を作ったときと同じ動画ファイルを選んでもらう。
 */
export function AttachVideo({ recordId, analysis, onAttached, testId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('idle');

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setStatus('busy');
    let video: HTMLVideoElement;
    try {
      video = await loadVideo(file);
    } catch {
      setStatus('unsupported');
      return;
    }
    const same =
      video.videoWidth === analysis.width &&
      video.videoHeight === analysis.height &&
      Math.abs(video.duration - analysis.durationSec) < DURATION_TOLERANCE_SEC;
    releaseVideo(video);
    if (!same) {
      setStatus('mismatch');
      return;
    }
    try {
      await setRecordVideo(recordId, { bytes: await file.arrayBuffer(), type: file.type });
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
      {status === 'mismatch' && (
        <p className="danger small" data-testid={`${testId}-error`}>
          {ja.video.mismatch}
        </p>
      )}
      {status === 'unsupported' && (
        <p className="danger small" data-testid={`${testId}-error`}>
          {ja.load.unsupportedTitle}
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
