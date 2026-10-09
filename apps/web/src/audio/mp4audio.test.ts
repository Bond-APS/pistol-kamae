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

/** 小さな MP4 を手で組み立てる部品（レビューの再現スクリプトと同じ作り） */
const u32 = (n: number): number[] => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return [...b];
};
const str = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, body: number[]): number[] => [
  ...u32(8 + body.length),
  ...str(type),
  ...body,
];
const full = (type: string, body: number[]): number[] => box(type, [0, 0, 0, 0, ...body]);

interface Crafted {
  /** stsz の中身（一律の大きさ、個数、大きさの表） */
  stsz: number[];
  /** stco の中身（個数、位置） */
  stco?: number[];
  /** stsc の中身（個数、項目） */
  stsc?: number[];
  /** elst の中身（個数、項目）。省略すると編集リストなし */
  elst?: number[];
  /** mdat の中身（音声の実体） */
  mdat?: number[];
}

/** 音声トラック 1 本の MP4 を作る（moov のあとに mdat）。stco を省略すると、かたまりの位置は mdat の中身の先頭 */
function craft(c: Crafted): ArrayBuffer {
  const asc = [0x12, 0x10]; // AAC-LC、44.1 kHz、2 ch
  const dsi = [0x05, asc.length, ...asc];
  const dcd = [0x04, 13 + dsi.length, 0x40, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...dsi];
  const esd = [0x03, 3 + dcd.length, 0, 1, 0, ...dcd];
  const mp4a = box('mp4a', [...new Array<number>(28).fill(0), ...full('esds', esd)]);
  const stsd = full('stsd', [...u32(1), ...mp4a]);
  const build = (mdatBodyAt: number) => {
    // stco を省略すると、かたまり 1 つが mdat の中身の先頭を指す
    const stco = full('stco', c.stco ?? [...u32(1), ...u32(mdatBodyAt)]);
    const stbl = box('stbl', [
      ...stsd,
      ...full('stsz', c.stsz),
      // stsc を省略すると、かたまり 1 つにサンプルが全部入る（数は sizes の長さで打ち切られる）
      ...full('stsc', c.stsc ?? [...u32(1), ...u32(1), ...u32(1_000_000), ...u32(1)]),
      ...stco,
    ]);
    const hdlr = full('hdlr', [...u32(0), ...str('soun'), ...new Array<number>(12).fill(0), 0]);
    const mdhd = full('mdhd', [...u32(0), ...u32(0), ...u32(44100), ...u32(0), 0, 0, 0, 0]);
    const mdia = box('mdia', [...mdhd, ...hdlr, ...box('minf', stbl)]);
    const edts = c.elst ? box('edts', full('elst', c.elst)) : [];
    const trak = box('trak', [...edts, ...mdia]);
    const mvhd = full('mvhd', [
      ...u32(0),
      ...u32(0),
      ...u32(1000),
      ...u32(0),
      ...new Array<number>(80).fill(0),
    ]);
    return box('moov', [...mvhd, ...trak]);
  };
  const moovLength = build(0).length;
  const moov = build(moovLength + 8);
  return new Uint8Array([...moov, ...box('mdat', c.mdat ?? [])]).buffer;
}

describe('壊れた MP4 でメモリを使い果たさない', () => {
  it('stsz の個数が約 43 億（一律 100 バイト）でも、すぐに null になる', () => {
    const started = performance.now();
    expect(extractAacAudio(craft({ stsz: [...u32(100), ...u32(0xffffffff)] }))).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('一律 1 バイトで、個数が上限を超えていれば null', () => {
    expect(extractAacAudio(craft({ stsz: [...u32(1), ...u32(30_000_000)] }))).toBeNull();
  });
  it('一律の大きさ：中身がファイルに収まれば取り出せ、収まらなければ null（同じ構造で個数だけ違う）', () => {
    const ok = extractAacAudio(craft({ stsz: [...u32(1), ...u32(5)], mdat: [1, 2, 3, 4, 5] }));
    expect(ok).not.toBeNull();
    expect(payloads(ok!.adts).map((p) => [...p])).toEqual([[1], [2], [3], [4], [5]]);
    // 1000 バイト × 1000 個 ＝ 1 MB は、数百バイトのファイルに収まらない
    expect(extractAacAudio(craft({ stsz: [...u32(1000), ...u32(1000)] }))).toBeNull();
  });
  it('stsc のかたまり番号が増えていなければ null（展開のループが膨らむ細工）', () => {
    const stsz = [...u32(0), ...u32(2), ...u32(3), ...u32(2)];
    const stsc = [...u32(2), ...u32(1), ...u32(1), ...u32(1), ...u32(1), ...u32(1), ...u32(1)];
    expect(extractAacAudio(craft({ stsz, stsc, mdat: [1, 2, 3, 4, 5] }))).toBeNull();
    const zero = [...u32(1), ...u32(0), ...u32(2), ...u32(1)];
    expect(extractAacAudio(craft({ stsz, stsc: zero, mdat: [1, 2, 3, 4, 5] }))).toBeNull();
  });
  it('一律でない stsz の個数が箱に入らなければ null', () => {
    expect(
      extractAacAudio(craft({ stsz: [...u32(0), ...u32(1000), ...u32(3), ...u32(2)] })),
    ).toBeNull();
  });
  it('一律でない大きさの合計がファイルより大きければ null', () => {
    expect(
      extractAacAudio(craft({ stsz: [...u32(0), ...u32(2), ...u32(0xffffffff), ...u32(2)] })),
    ).toBeNull();
  });
  it('stco・stsc の個数が箱に入らなければ null', () => {
    const stsz = [...u32(0), ...u32(2), ...u32(3), ...u32(2)];
    expect(extractAacAudio(craft({ stsz, stco: [...u32(1000), ...u32(0)] }))).toBeNull();
    expect(
      extractAacAudio(craft({ stsz, stsc: [...u32(1000), ...u32(1), ...u32(2), ...u32(1)] })),
    ).toBeNull();
  });
  it('正しい小さなファイルからは、サンプルの数だけ ADTS のフレームを取り出せる', () => {
    const audio = extractAacAudio(
      craft({ stsz: [...u32(0), ...u32(2), ...u32(3), ...u32(2)], mdat: [1, 2, 3, 4, 5] }),
    );
    expect(audio).not.toBeNull();
    expect(payloads(audio!.adts).map((p) => [...p])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(audio!.sampleRate).toBe(44100);
    expect(audio!.channels).toBe(2);
  });
  it('elst の個数が箱より多くても、入る分だけ読んで音声の始まりのずれを求める', () => {
    const audio = extractAacAudio(
      craft({
        stsz: [...u32(0), ...u32(2), ...u32(3), ...u32(2)],
        mdat: [1, 2, 3, 4, 5],
        // 個数 1000 と書いてあるが、項目は 1 つ（空の編集 500 ms）だけ
        elst: [...u32(1000), ...u32(500), ...u32(0xffffffff), ...u32(0x00010000)],
      }),
    );
    expect(audio).not.toBeNull();
    expect(audio!.offsetSec).toBeCloseTo(0.5, 6);
  });
});
