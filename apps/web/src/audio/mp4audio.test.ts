// 音声の取り出しを、実際の iPhone の動画（e2e/videos、git 管理外）で確かめる。
// ffmpeg（あれば）が取り出した ADTS と、ヘッダを除いた中身が一致することを見る。
// 動画がない環境では飛ばす。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractAacAudio } from './mp4audio';

const videosDir = join(__dirname, '..', '..', 'e2e', 'videos');
const videos = ['friend-good-1.mov', 'sample.mov'].map((f) => join(videosDir, f));
const available = videos.filter((f) => existsSync(f));

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** ADTS から、7 バイトのヘッダを除いた音声の中身だけを取り出す */
function payloads(adts: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at + 7 <= adts.length) {
    const length = ((adts[at + 3]! & 0x03) << 11) | (adts[at + 4]! << 3) | (adts[at + 5]! >> 5);
    out.push(adts.subarray(at + 7, at + length));
    at += length;
  }
  return out;
}

describe('動画ファイルからの音声の取り出し', () => {
  it('音声のないファイル、動画でないものは null', () => {
    expect(extractAacAudio(new ArrayBuffer(0))).toBeNull();
    expect(extractAacAudio(new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]).buffer)).toBeNull();
    const silent = join(videosDir, 'motion.mp4');
    if (existsSync(silent)) {
      const bytes = readFileSync(silent);
      expect(
        extractAacAudio(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      ).toBeNull();
    }
  });

  it.skipIf(available.length === 0)('iPhone の MOV から AAC を取り出せる', () => {
    for (const file of available) {
      const bytes = readFileSync(file);
      const audio = extractAacAudio(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      expect(audio, file).not.toBeNull();
      expect(audio!.sampleRate).toBeGreaterThanOrEqual(8000);
      expect(audio!.channels).toBeGreaterThanOrEqual(1);
      // 先頭が ADTS の同期語
      expect(audio!.adts[0]).toBe(0xff);
      expect(audio!.adts[1]! & 0xf0).toBe(0xf0);
      // 1 フレーム 1024 標本なので、長さがおおよそ動画の長さになる
      const frames = payloads(audio!.adts).length;
      const sec = (frames * 1024) / audio!.sampleRate;
      expect(sec).toBeGreaterThan(5);
      expect(Math.abs(audio!.offsetSec)).toBeLessThan(0.5);
    }
  });

  it.skipIf(available.length === 0 || !hasFfmpeg())('ffmpeg が取り出した中身と一致する', () => {
    for (const file of available) {
      const out = join(tmpdir(), `kamae-audio-${Date.now()}.aac`);
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-i',
        file,
        '-vn',
        '-map',
        '0:a:0',
        '-c:a',
        'copy',
        out,
      ]);
      const expected = payloads(new Uint8Array(readFileSync(out)));
      const bytes = readFileSync(file);
      const audio = extractAacAudio(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      )!;
      const actual = payloads(audio.adts);
      expect(actual.length, file).toBe(expected.length);
      for (let i = 0; i < expected.length; i += 97) {
        expect(
          Buffer.from(actual[i]!).equals(Buffer.from(expected[i]!)),
          `${file} frame ${i}`,
        ).toBe(true);
      }
    }
  });
});
