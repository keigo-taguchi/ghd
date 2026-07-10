/**
 * East Asian Width の簡易実装。全角=2セル・半角=1セル・結合文字=0セル。
 * 依存ゼロ方針のため Unicode 全表は持たず、CJK・かな・ハングル・全角記号・
 * 絵文字の主要レンジのみをカバーする（docs/SPEC.md §5）。
 */

const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals .. CJK Symbols
  [0x3041, 0x33ff], // ひらがな・カタカナ・CJK互換
  [0x3400, 0x4dbf], // CJK拡張A
  [0x4e00, 0x9fff], // CJK統合漢字
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // ハングル音節
  [0xf900, 0xfaff], // CJK互換漢字
  [0xfe30, 0xfe4f], // CJK互換形
  [0xff00, 0xff60], // 全角英数・記号
  [0xffe0, 0xffe6], // 全角記号
  [0x1f300, 0x1f64f], // 絵文字（Misc Symbols and Pictographs, Emoticons）
  [0x1f680, 0x1f6ff], // Transport
  [0x1f900, 0x1faff], // Supplemental Symbols
  [0x20000, 0x3fffd], // CJK拡張B以降
];

const ZERO_RANGES: readonly [number, number][] = [
  [0x0300, 0x036f], // 結合ダイアクリティカルマーク
  [0x200b, 0x200f], // ゼロ幅スペース類
  [0xfe00, 0xfe0f], // 異体字セレクタ
];

export function codePointWidth(cp: number): number {
  for (const [lo, hi] of ZERO_RANGES) if (cp >= lo && cp <= hi) return 0;
  for (const [lo, hi] of WIDE_RANGES) if (cp >= lo && cp <= hi) return 2;
  return 1;
}

/** 表示セル幅。サロゲートペアは for..of のコードポイント走査で正しく扱う。 */
export function stringWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += codePointWidth(ch.codePointAt(0)!);
  return w;
}

/**
 * 表示幅 maxWidth に収まるよう末尾を「…」で切り詰める。
 * コードポイント境界でのみ切るため、サロゲートペアや全角文字が半壊しない。
 */
export function truncate(s: string, maxWidth: number, ellipsis = "…"): string {
  if (maxWidth <= 0) return "";
  if (stringWidth(s) <= maxWidth) return s;
  const ellWidth = stringWidth(ellipsis);
  const budget = maxWidth - ellWidth;
  if (budget < 0) return "";
  let w = 0;
  let out = "";
  for (const ch of s) {
    const cw = codePointWidth(ch.codePointAt(0)!);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  return out + ellipsis;
}

/** 表示幅ベースの右パディング。すでに width 以上なら何もしない。 */
export function padEnd(s: string, width: number): string {
  const w = stringWidth(s);
  return w >= width ? s : s + " ".repeat(width - w);
}

/** 表示幅ベースの左パディング。 */
export function padStart(s: string, width: number): string {
  const w = stringWidth(s);
  return w >= width ? s : " ".repeat(width - w) + s;
}
