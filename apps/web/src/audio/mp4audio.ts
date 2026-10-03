// 動画ファイル（MP4 / MOV）から音声（AAC）だけを取り出し、ADTS 形式（音声プレイヤーが読める、
// ヘッダ付きの連なり）に包み直す。
// Safari の音声取り出し（decodeAudioData）は QuickTime 形式（MOV）の入れ物を読めないが、
// 取り出した AAC（ADTS）なら読める（2026-10-03、本物の Safari で確認）。Chrome も同じ道で読む。
// 動画の入れ物（ISO BMFF）は「箱」の入れ子で、音声の位置は moov → trak → mdia → minf → stbl の表にある。
// すべて端末の中で済み、ネットワークには出さない。

const SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

interface Box {
  type: string;
  /** 箱の中身（ヘッダを除く）の始まりと終わり（ファイル先頭からのバイト位置） */
  start: number;
  end: number;
}

/** 取り出した音声 */
export interface ExtractedAudio {
  /** ADTS 形式の AAC */
  adts: Uint8Array;
  /** 動画の時刻に対する音声の始まりのずれ（秒）。音声の時刻 ＝ 動画の時刻 − offsetSec */
  offsetSec: number;
  sampleRate: number;
  channels: number;
}

const ascii = (view: DataView, at: number): string =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );

/** 範囲の中の箱を順に列挙する */
function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = ascii(view, at + 4);
    let header = 8;
    if (size === 1) {
      // 64 ビットの大きさ（大きな mdat）。上位 32 ビットは 0 とみなす（4 GB 未満のファイル）
      if (at + 16 > end) return;
      size = view.getUint32(at + 8) * 2 ** 32 + view.getUint32(at + 12);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

function child(view: DataView, box: Box, type: string): Box | null {
  for (const b of boxes(view, box.start, box.end)) if (b.type === type) return b;
  return null;
}

function path(view: DataView, box: Box, ...types: string[]): Box | null {
  let cur: Box | null = box;
  for (const t of types) {
    cur = child(view, cur, t);
    if (!cur) return null;
  }
  return cur;
}

/** 「full box」（版と旗の 4 バイトが先頭に付く箱）の中身の始まり */
const fullBody = (box: Box): number => box.start + 4;

/** MPEG-4 の記述子の長さ（1〜4 バイト、上位ビットが続きの印） */
function descriptorLength(view: DataView, at: number): { length: number; next: number } {
  let length = 0;
  let next = at;
  for (let i = 0; i < 4; i++) {
    const b = view.getUint8(next++);
    length = (length << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return { length, next };
}

/** esds 箱から AudioSpecificConfig（符号の種類・標本化周波数・チャンネル数の 2 バイト以上）を取り出す */
function audioSpecificConfig(view: DataView, esds: Box): Uint8Array | null {
  let at = fullBody(esds);
  // ES_Descriptor（0x03）
  if (view.getUint8(at) !== 0x03) return null;
  at = descriptorLength(view, at + 1).next;
  const flags = view.getUint8(at + 2);
  at += 3;
  if (flags & 0x80) at += 2; // streamDependenceFlag
  if (flags & 0x40) at += 1 + view.getUint8(at); // URL_Flag
  if (flags & 0x20) at += 2; // OCRstreamFlag
  // DecoderConfigDescriptor（0x04）
  if (view.getUint8(at) !== 0x04) return null;
  at = descriptorLength(view, at + 1).next;
  at += 13; // objectTypeIndication(1) streamType(1) bufferSizeDB(3) maxBitrate(4) avgBitrate(4)
  // DecoderSpecificInfo（0x05）
  if (view.getUint8(at) !== 0x05) return null;
  const { length, next } = descriptorLength(view, at + 1);
  if (length < 2 || next + length > esds.end) return null;
  return new Uint8Array(view.buffer, view.byteOffset + next, length);
}

interface AacConfig {
  objectType: number;
  rateIndex: number;
  channels: number;
}

function parseAsc(asc: Uint8Array): AacConfig | null {
  let objectType = asc[0]! >> 3;
  const rateIndex = ((asc[0]! & 0x07) << 1) | (asc[1]! >> 7);
  let channels = (asc[1]! >> 3) & 0x0f;
  if (objectType === 31 || rateIndex === 15) return null; // 拡張形式は扱わない
  // HE-AAC（SBR 付き、5・29）は、ADTS では中身の AAC-LC として書き、再生側が自動で見分ける
  if (objectType > 4) objectType = 2;
  if (objectType === 0) objectType = 2;
  if (rateIndex >= SAMPLE_RATES.length) return null;
  if (channels === 0 || channels > 7) channels = 2;
  return { objectType, rateIndex, channels };
}

/** 1 つの音声サンプル（AAC の 1 フレーム）に付ける 7 バイトのヘッダ */
function adtsHeader(cfg: AacConfig, payloadLength: number, out: Uint8Array, at: number): void {
  const frameLength = payloadLength + 7;
  out[at] = 0xff;
  out[at + 1] = 0xf1; // MPEG-4、レイヤ 0、誤り検出なし
  out[at + 2] = ((cfg.objectType - 1) << 6) | (cfg.rateIndex << 2) | (cfg.channels >> 2);
  out[at + 3] = ((cfg.channels & 0x03) << 6) | (frameLength >> 11);
  out[at + 4] = (frameLength >> 3) & 0xff;
  out[at + 5] = ((frameLength & 0x07) << 5) | 0x1f;
  out[at + 6] = 0xfc;
}

/** サンプルの大きさの表（stsz） */
function sampleSizes(view: DataView, stsz: Box): number[] {
  const at = fullBody(stsz);
  const uniform = view.getUint32(at);
  const count = view.getUint32(at + 4);
  const sizes: number[] = new Array(count);
  for (let i = 0; i < count; i++)
    sizes[i] = uniform !== 0 ? uniform : view.getUint32(at + 8 + i * 4);
  return sizes;
}

/** かたまり（chunk）の位置の表（stco / co64） */
function chunkOffsets(view: DataView, stbl: Box): number[] | null {
  const stco = child(view, stbl, 'stco');
  if (stco) {
    const at = fullBody(stco);
    const count = view.getUint32(at);
    return Array.from({ length: count }, (_, i) => view.getUint32(at + 4 + i * 4));
  }
  const co64 = child(view, stbl, 'co64');
  if (!co64) return null;
  const at = fullBody(co64);
  const count = view.getUint32(at);
  return Array.from(
    { length: count },
    (_, i) => view.getUint32(at + 4 + i * 8) * 2 ** 32 + view.getUint32(at + 8 + i * 8),
  );
}

/** かたまりごとのサンプル数の表（stsc）を、かたまり番号 → サンプル数 に展開する */
function samplesPerChunk(view: DataView, stsc: Box, chunkCount: number): number[] {
  const at = fullBody(stsc);
  const count = view.getUint32(at);
  const entries = Array.from({ length: count }, (_, i) => ({
    first: view.getUint32(at + 4 + i * 12), // 1 始まり
    samples: view.getUint32(at + 8 + i * 12),
  }));
  const result: number[] = new Array(chunkCount).fill(0);
  for (let e = 0; e < entries.length; e++) {
    const from = entries[e]!.first - 1;
    const to = e + 1 < entries.length ? entries[e + 1]!.first - 1 : chunkCount;
    for (let c = from; c < to && c < chunkCount; c++) result[c] = entries[e]!.samples;
  }
  return result;
}

/**
 * 編集リスト（elst）から、動画の時刻に対する音声の始まりのずれを求める。
 * 先頭の「空の編集」はその長さだけ音声が遅れて始まり、最初の編集の media_time は音声の先頭を切り落とす。
 */
function editOffsetSec(
  view: DataView,
  trak: Box,
  movieTimescale: number,
  mediaTimescale: number,
): number {
  const elst = path(view, trak, 'edts', 'elst');
  if (!elst) return 0;
  const version = view.getUint8(elst.start);
  let at = fullBody(elst);
  const count = view.getUint32(at);
  at += 4;
  let offset = 0;
  for (let i = 0; i < count; i++) {
    let segment: number;
    let media: number;
    if (version === 1) {
      segment = view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4);
      media = Number(view.getBigInt64(at + 8));
      at += 20;
    } else {
      segment = view.getUint32(at);
      media = view.getInt32(at + 4);
      at += 12;
    }
    if (media === -1) {
      offset += segment / movieTimescale;
      continue;
    }
    offset -= media / mediaTimescale;
    break;
  }
  return offset;
}

/**
 * 動画ファイルから音声（AAC）を取り出す。音声がない、または AAC でない・形が読めないときは null。
 * 入力は読み込んだファイルのバイト列そのもの（コピーしない）。
 */
export function extractAacAudio(file: ArrayBuffer): ExtractedAudio | null {
  const view = new DataView(file);
  const top: Box = { type: '', start: 0, end: file.byteLength };
  const moov = child(view, top, 'moov');
  if (!moov) return null;
  const mvhd = child(view, moov, 'mvhd');
  const movieTimescale = mvhd
    ? view.getUint32(fullBody(mvhd) + (view.getUint8(mvhd.start) === 1 ? 16 : 8))
    : 1000;

  for (const trak of boxes(view, moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(view, trak, 'mdia');
    if (!mdia) continue;
    const hdlr = child(view, mdia, 'hdlr');
    if (!hdlr || ascii(view, fullBody(hdlr) + 4) !== 'soun') continue;
    const stbl = path(view, mdia, 'minf', 'stbl');
    const stsd = stbl && child(view, stbl, 'stsd');
    if (!stbl || !stsd) continue;
    const entry = child(view, { type: '', start: fullBody(stsd) + 4, end: stsd.end }, 'mp4a');
    if (!entry) continue;
    // 音声の説明（版によって長さが違う）の後ろにある esds を、名前で探す
    let esds: Box | null = null;
    for (let at = entry.start + 28; at + 8 <= entry.end; at++) {
      if (ascii(view, at + 4) === 'esds') {
        const size = view.getUint32(at);
        if (size >= 8 && at + size <= entry.end)
          esds = { type: 'esds', start: at + 8, end: at + size };
        break;
      }
    }
    if (!esds) continue;
    const asc = audioSpecificConfig(view, esds);
    const cfg = asc && parseAsc(asc);
    if (!cfg) continue;

    const stsz = child(view, stbl, 'stsz');
    const stsc = child(view, stbl, 'stsc');
    const offsets = chunkOffsets(view, stbl);
    if (!stsz || !stsc || !offsets) continue;
    const sizes = sampleSizes(view, stsz);
    const perChunk = samplesPerChunk(view, stsc, offsets.length);

    const total = sizes.reduce((s, n) => s + n + 7, 0);
    const adts = new Uint8Array(total);
    let out = 0;
    let sample = 0;
    for (let c = 0; c < offsets.length && sample < sizes.length; c++) {
      let at = offsets[c]!;
      for (let i = 0; i < perChunk[c]! && sample < sizes.length; i++, sample++) {
        const size = sizes[sample]!;
        if (at + size > file.byteLength) return null;
        adtsHeader(cfg, size, adts, out);
        adts.set(new Uint8Array(file, at, size), out + 7);
        out += 7 + size;
        at += size;
      }
    }
    if (sample !== sizes.length) return null;

    const mdhd = child(view, mdia, 'mdhd');
    const mediaTimescale = mdhd
      ? view.getUint32(fullBody(mdhd) + (view.getUint8(mdhd.start) === 1 ? 16 : 8))
      : SAMPLE_RATES[cfg.rateIndex]!;
    return {
      adts: adts.subarray(0, out),
      offsetSec: editOffsetSec(view, trak, movieTimescale, mediaTimescale),
      sampleRate: SAMPLE_RATES[cfg.rateIndex]!,
      channels: cfg.channels,
    };
  }
  return null;
}
