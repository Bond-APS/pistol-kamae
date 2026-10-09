// 音声の取り出しを、実際の iPhone の動画（e2e/videos、git 管理外）で確かめる。
// ffmpeg（あれば）が取り出した ADTS と、ヘッダを除いた中身が一致することを見る。
// 動画がない環境では飛ばす。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { byteSource, extractAacAudio, extractAacAudioFrom } from './mp4audio';

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
  it('音声のないファイル、動画でないものは null', async () => {
    expect(await extractAacAudio(new ArrayBuffer(0))).toBeNull();
    expect(
      await extractAacAudio(new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]).buffer),
    ).toBeNull();
    const silent = join(videosDir, 'motion.mp4');
    if (existsSync(silent)) {
      const bytes = readFileSync(silent);
      expect(
        await extractAacAudio(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        ),
      ).toBeNull();
    }
  });

  it.skipIf(available.length === 0)('iPhone の MOV から AAC を取り出せる', async () => {
    for (const file of available) {
      const bytes = readFileSync(file);
      const audio = await extractAacAudio(
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

  it.skipIf(available.length === 0 || !hasFfmpeg())(
    'ffmpeg が取り出した中身と一致する',
    async () => {
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
        const audio = await extractAacAudio(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        const actual = payloads(audio!.adts);
        expect(actual.length, file).toBe(expected.length);
        for (let i = 0; i < expected.length; i += 97) {
          expect(
            Buffer.from(actual[i]!).equals(Buffer.from(expected[i]!)),
            `${file} frame ${i}`,
          ).toBe(true);
        }
      }
    },
  );
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
  /** mdat を moov の前に置く（iPhone の MOV と同じ並び） */
  mdatFirst?: boolean;
  /** mdat の見出しを 64 ビットの大きさ（size=1）にする */
  mdat64?: boolean;
  /** moov の大きさを 0（ファイルの末尾まで）にする。mdatFirst と組み合わせる */
  moovSizeZero?: boolean;
  /** ファイルの先頭に置く箱（バイト列）。かたまりの位置はその分ずらす */
  prefix?: number[];
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
  const body = c.mdat ?? [];
  const mdatHeader = c.mdat64 ? 16 : 8;
  const prefix = c.prefix ?? [];
  const mdatBox = c.mdat64
    ? [...u32(1), ...str('mdat'), ...u32(0), ...u32(mdatHeader + body.length), ...body]
    : box('mdat', body);
  if (c.mdatFirst) {
    const moov = build(prefix.length + mdatHeader);
    if (c.moovSizeZero) moov.splice(0, 4, ...u32(0));
    return new Uint8Array([...prefix, ...mdatBox, ...moov]).buffer;
  }
  const moovLength = build(0).length;
  const moov = build(prefix.length + moovLength + mdatHeader);
  return new Uint8Array([...prefix, ...moov, ...mdatBox]).buffer;
}

describe('壊れた MP4 でメモリを使い果たさない', () => {
  it('stsz の個数が約 43 億（一律 100 バイト）でも、すぐに null になる', async () => {
    const started = performance.now();
    expect(await extractAacAudio(craft({ stsz: [...u32(100), ...u32(0xffffffff)] }))).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('一律 1 バイトで、個数が上限を超えていれば null', async () => {
    expect(await extractAacAudio(craft({ stsz: [...u32(1), ...u32(30_000_000)] }))).toBeNull();
  });
  it('一律の大きさ：中身がファイルに収まれば取り出せ、収まらなければ null（同じ構造で個数だけ違う）', async () => {
    const ok = await extractAacAudio(
      craft({ stsz: [...u32(1), ...u32(5)], mdat: [1, 2, 3, 4, 5] }),
    );
    expect(ok).not.toBeNull();
    expect(payloads(ok!.adts).map((p) => [...p])).toEqual([[1], [2], [3], [4], [5]]);
    // 1000 バイト × 1000 個 ＝ 1 MB は、数百バイトのファイルに収まらない
    expect(await extractAacAudio(craft({ stsz: [...u32(1000), ...u32(1000)] }))).toBeNull();
  });
  it('stsc のかたまり番号が増えていなければ null（展開のループが膨らむ細工）', async () => {
    const stsz = [...u32(0), ...u32(2), ...u32(3), ...u32(2)];
    const stsc = [...u32(2), ...u32(1), ...u32(1), ...u32(1), ...u32(1), ...u32(1), ...u32(1)];
    expect(await extractAacAudio(craft({ stsz, stsc, mdat: [1, 2, 3, 4, 5] }))).toBeNull();
    const zero = [...u32(1), ...u32(0), ...u32(2), ...u32(1)];
    expect(await extractAacAudio(craft({ stsz, stsc: zero, mdat: [1, 2, 3, 4, 5] }))).toBeNull();
  });
  it('一律でない stsz の個数が箱に入らなければ null', async () => {
    expect(
      await extractAacAudio(craft({ stsz: [...u32(0), ...u32(1000), ...u32(3), ...u32(2)] })),
    ).toBeNull();
  });
  it('一律でない大きさの合計がファイルより大きければ null', async () => {
    expect(
      await extractAacAudio(craft({ stsz: [...u32(0), ...u32(2), ...u32(0xffffffff), ...u32(2)] })),
    ).toBeNull();
  });
  it('stco・stsc の個数が箱に入らなければ null', async () => {
    const stsz = [...u32(0), ...u32(2), ...u32(3), ...u32(2)];
    expect(await extractAacAudio(craft({ stsz, stco: [...u32(1000), ...u32(0)] }))).toBeNull();
    expect(
      await extractAacAudio(craft({ stsz, stsc: [...u32(1000), ...u32(1), ...u32(2), ...u32(1)] })),
    ).toBeNull();
  });
  it('正しい小さなファイルからは、サンプルの数だけ ADTS のフレームを取り出せる', async () => {
    const audio = await extractAacAudio(
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
  it('elst の個数が箱より多くても、入る分だけ読んで音声の始まりのずれを求める', async () => {
    const audio = await extractAacAudio(
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

describe('必要な部分だけを読む', () => {
  /** 読んだ範囲を数える読み手（ファイルの代わり） */
  const counting = (buffer: ArrayBuffer) => {
    const reads: [number, number][] = [];
    const src = byteSource(buffer);
    return {
      reads,
      src: {
        size: src.size,
        read: (start: number, end: number) => {
          reads.push([start, end]);
          return src.read(start, end);
        },
      },
    };
  };
  it('箱の表と音声の実体だけを読み、大きな mdat の残りと末尾の free は読まない', async () => {
    // 音声 5 バイトのあとに、動画のつもりの 1 MB と、末尾に空の箱 free 2 MB
    const filler = new Array<number>(1024 * 1024).fill(0);
    const bytes = new Uint8Array(
      craft({
        stsz: [...u32(0), ...u32(2), ...u32(3), ...u32(2)],
        mdat: [1, 2, 3, 4, 5, ...filler],
      }),
    );
    const free = box('free', [...filler, ...filler]);
    const file = new Uint8Array(bytes.length + free.length);
    file.set(bytes);
    file.set(free, bytes.length);
    const { reads, src } = counting(file.buffer);
    const audio = await extractAacAudioFrom(src);
    expect(audio).not.toBeNull();
    expect(payloads(audio!.adts).map((p) => [...p])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    const total = reads.reduce((s, [a, b]) => s + (b - a), 0);
    // 読んだ合計は、箱の見出し（16 バイト × 数個）＋ moov（数百バイト）＋ 音声 5 バイト。ファイル（3 MB 超）よりはるかに小さい
    expect(total).toBeLessThan(2048);
    expect(file.byteLength).toBeGreaterThan(3 * 1024 * 1024);
  });
  it('Blob（ファイル）からも、バイト列と同じ音声を取り出せる', async () => {
    const buffer = craft({
      stsz: [...u32(0), ...u32(2), ...u32(3), ...u32(2)],
      mdat: [1, 2, 3, 4, 5],
    });
    const fromBlob = await extractAacAudio(new Blob([buffer]));
    const fromBuffer = await extractAacAudio(buffer);
    expect(fromBlob).not.toBeNull();
    expect([...fromBlob!.adts]).toEqual([...fromBuffer!.adts]);
    expect(fromBlob!.offsetSec).toBe(fromBuffer!.offsetSec);
  });
  const SAMPLES = { stsz: [...u32(0), ...u32(2), ...u32(3), ...u32(2)], mdat: [1, 2, 3, 4, 5] };
  const expectSamples = (audio: Awaited<ReturnType<typeof extractAacAudio>>) => {
    expect(audio).not.toBeNull();
    expect(payloads(audio!.adts).map((p) => [...p])).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  };
  it('moov が mdat の後ろにある（iPhone の MOV の並び）ファイルでも、mdat を飛び越えて moov に着く', async () => {
    expectSamples(await extractAacAudio(craft({ ...SAMPLES, mdatFirst: true })));
  });
  it('mdat の見出しが 64 ビットの大きさでも、moov の前後どちらでも読める', async () => {
    expectSamples(await extractAacAudio(craft({ ...SAMPLES, mdat64: true })));
    expectSamples(await extractAacAudio(craft({ ...SAMPLES, mdat64: true, mdatFirst: true })));
  });
  it('最後の箱の大きさが 0（ファイルの末尾まで）でも読める', async () => {
    expectSamples(
      await extractAacAudio(craft({ ...SAMPLES, mdatFirst: true, moovSizeZero: true })),
    );
  });
  it('先頭に小さな箱が多すぎるファイルは、moov を探すのをやめて null', async () => {
    const many = Array.from({ length: 70 }, () => box('free', [])).flat();
    expect(await extractAacAudio(craft({ ...SAMPLES, prefix: many }))).toBeNull();
    const few = Array.from({ length: 10 }, () => box('free', [])).flat();
    expectSamples(await extractAacAudio(craft({ ...SAMPLES, prefix: few })));
  });
  it('moov が見つからない・箱の大きさが壊れているファイルは null', async () => {
    // 先頭の箱の大きさがファイルより大きい
    expect(
      await extractAacAudio(new Uint8Array([0, 0, 1, 0, 0x66, 0x72, 0x65, 0x65]).buffer),
    ).toBeNull();
    // free だけで moov がない
    expect(await extractAacAudio(new Uint8Array(box('free', [0, 0, 0, 0])).buffer)).toBeNull();
  });
  it.skipIf(available.length === 0)(
    'iPhone の MOV を Blob として部分的に読んでも、丸ごと読んだときと同じ',
    async () => {
      for (const file of available) {
        const bytes = readFileSync(file);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const { reads, src } = counting(buffer);
        const partial = await extractAacAudioFrom(src);
        const whole = await extractAacAudio(buffer);
        expect(partial, file).not.toBeNull();
        expect(partial!.adts.length).toBe(whole!.adts.length);
        expect(Buffer.from(partial!.adts).equals(Buffer.from(whole!.adts))).toBe(true);
        const total = reads.reduce((s, [a, b]) => s + (b - a), 0);
        // 読んだ合計は、ファイル（30 MB 超）の 1 割未満（音声は 1 MB 程度、moov は数百 KB）
        expect(total, file).toBeLessThan(buffer.byteLength / 10);
        // 回数も、かたまり（30 秒の iPhone の動画で 50〜70 個）を超えない
        expect(reads.length, file).toBeLessThan(200);
      }
    },
  );
});
