/**
 * Terminal display width for plain (escape-free) text. markdrip lays text
 * out before styling it, so this module only ever measures plain strings.
 * Widths follow what mainstream terminals render: East Asian Wide and
 * Fullwidth are 2 columns, emoji presentation is 2, combining marks and
 * zero-width code points are 0, everything else is 1. Grapheme clusters
 * (ZWJ families, flags, skin tones) are measured as a unit.
 */

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Ranges rendered 2 columns wide (East Asian W/F + common emoji blocks). */
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo leading consonants
  [0x2e80, 0x303e], // CJK Radicals .. CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana .. CJK Compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Misc Symbols and Pictographs, Emoticons
  [0x1f680, 0x1f6ff], // Transport and Map
  [0x1f900, 0x1f9ff], // Supplemental Symbols and Pictographs
  [0x1fa70, 0x1faff], // Symbols and Pictographs Extended-A
  [0x20000, 0x2fffd], // CJK Extension B..
  [0x30000, 0x3fffd],
];

/** Zero-width: combining marks, format controls, ZWJ/ZWNJ, variation selectors. */
const ZERO: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xe0100, 0xe01ef],
];

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (cp < r[0]) hi = mid - 1;
    else if (cp > r[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Width of a single code point, ignoring cluster context. */
function codePointWidth(cp: number): number {
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0; // controls measure 0
  if (inRanges(cp, ZERO)) return 0;
  if (inRanges(cp, WIDE)) return 2;
  return 1;
}

/** Display width of one grapheme cluster. */
export function graphemeWidth(cluster: string): number {
  // VS16 forces emoji presentation → 2 columns (e.g. umbrella + U+FE0F).
  if (cluster.includes("\uFE0F")) return 2;
  let w = 0;
  for (const ch of cluster) {
    const cw = codePointWidth(ch.codePointAt(0)!);
    if (cw > w) w = cw;
    if (w === 2) break;
  }
  return w;
}

/** Display width of a plain string (no ANSI escapes expected). */
export function stringWidth(text: string): number {
  let w = 0;
  for (const s of seg.segment(text)) w += graphemeWidth(s.segment);
  return w;
}

/** Split a plain string into grapheme clusters. */
export function graphemes(text: string): string[] {
  const out: string[] = [];
  for (const s of seg.segment(text)) out.push(s.segment);
  return out;
}
