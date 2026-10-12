// バイト列（画像・音・動画）を JSON に入れるための文字への変換（base64）とその逆。
// 大きな動画でも 1 本の巨大な文字列を作らずに済むよう、切れ目をそろえた塊（チャンク）の列で返す。

/** 1 塊のバイト数。3 の倍数にして、塊ごとに base64 にしても継ぎ目に詰め物（=）が入らないようにする */
const ENCODE_CHUNK_BYTES = 3 * 65536;
/** 戻すときの 1 塊の文字数。4 の倍数（base64 は 4 文字で 3 バイト） */
const DECODE_CHUNK_CHARS = 4 * 65536;

/**
 * バイト列を base64 の文字列の塊として順に返す（つなげれば 1 本の base64）。
 * 生成器（1 つずつ作って渡す仕組み）なので、受け取る側が塊を Blob に移せば、文字列を全部同時に抱えずに済む
 */
export function* base64ChunksOf(bytes: ArrayBuffer): Generator<string> {
  const view = new Uint8Array(bytes);
  for (let offset = 0; offset < view.length; offset += ENCODE_CHUNK_BYTES) {
    const part = view.subarray(offset, Math.min(offset + ENCODE_CHUNK_BYTES, view.length));
    let binary = '';
    // 文字コード 0〜255 の文字の並びに直してから btoa に渡す（まとめて渡すと引数の数の上限に当たるので、小分けに）
    for (let i = 0; i < part.length; i += 8192) {
      binary += String.fromCharCode(...part.subarray(i, Math.min(i + 8192, part.length)));
    }
    yield btoa(binary);
  }
}

/** バイト列を base64 の文字列の塊の列にする（小さなものとテスト向け） */
export function encodeBase64Chunks(bytes: ArrayBuffer): string[] {
  return [...base64ChunksOf(bytes)];
}

/** バイト列を 1 本の base64 の文字列にする（小さなもの向け） */
export function encodeBase64(bytes: ArrayBuffer): string {
  return encodeBase64Chunks(bytes).join('');
}

/** base64 の文字列をバイト列に戻す。形が正しくなければ例外 */
export function decodeBase64(text: string): ArrayBuffer {
  // 空白を除く複製は、空白が含まれるときだけ作る（200 MB の動画の base64 を無駄に 2 本持たないため）
  const clean = /\s/.test(text) ? text.replace(/\s+/g, '') : text;
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw new Error('invalid base64');
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let written = 0;
  for (let offset = 0; offset < clean.length; offset += DECODE_CHUNK_CHARS) {
    const binary = atob(clean.slice(offset, offset + DECODE_CHUNK_CHARS));
    for (let i = 0; i < binary.length; i++) out[written++] = binary.charCodeAt(i);
  }
  return out.buffer;
}
