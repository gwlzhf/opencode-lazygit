/**
 * Preview selection helpers for the native OpenTUI route.
 *
 * Unlike the Pi view, OpenTUI receives plain text and paints selected spans with
 * host theme colors. Clipboard text is sanitized here so neither terminal
 * control sequences nor row padding can escape the plugin.
 */

/** A point inside the preview viewport (0-based row and terminal column). */
export interface SelectionPoint {
  readonly row: number;
  readonly col: number;
}

/** A drag in progress or finished, in preview viewport coordinates. */
export interface PreviewSelection {
  readonly anchor: SelectionPoint;
  readonly head: SelectionPoint;
}

/** A selected terminal-column span for native OpenTUI painting. */
export interface SelectionSpan {
  readonly row: number;
  readonly from: number;
  readonly to: number;
}

/** Order drag endpoints so `start` precedes `end` in reading order. */
export function orderSelection(selection: PreviewSelection): {
  readonly start: SelectionPoint;
  readonly end: SelectionPoint;
} {
  const { anchor, head } = selection;
  const headFirst = head.row < anchor.row || (head.row === anchor.row && head.col < anchor.col);
  return headFirst ? { start: head, end: anchor } : { start: anchor, end: head };
}

/** Whether the drag never left its origin cell. */
export function isEmptySelection(selection: PreviewSelection): boolean {
  return selection.anchor.row === selection.head.row && selection.anchor.col === selection.head.col;
}

export function sanitizeCopiedText(text: string): string {
  return text
    .replaceAll("\t", "    ")
    .replace(/(?:\u001b\]|\u009d)[\s\S]*?(?:\u0007|\u001b\\|\u009c)/gu, "")
    .replace(/(?:\u001bP|\u001b_|\u0090|\u0098)[\s\S]*?(?:\u001b\\|\u009c)/gu, "")
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\u001b[ -/]*[0-~]/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "");
}

function codePointWidth(codePoint: number): number {
  // Combining marks, variation selectors and zero-width joiners occupy no cell.
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x0483 && codePoint <= 0x0489)
    || (codePoint >= 0x0591 && codePoint <= 0x05bd)
    || (codePoint >= 0x0610 && codePoint <= 0x061a)
    || (codePoint >= 0x064b && codePoint <= 0x065f)
    || (codePoint >= 0x0670 && codePoint <= 0x0670)
    || (codePoint >= 0x06d6 && codePoint <= 0x06ed)
    || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
    || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
    || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
    || codePoint === 0x200d
  ) return 0;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  // East Asian wide/full-width ranges and emoji presentation symbols.
  if (
    codePoint >= 0x1100 && (
      codePoint <= 0x115f
      || codePoint === 0x2329 || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
      || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff00 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
      || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
      || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )
  ) return 2;
  return 1;
}

interface CharacterCell {
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

type GraphemeSegmenter = {
  segment(text: string): Iterable<{ readonly segment: string }>;
};

const segmenter = (() => {
  const intlRuntime = Intl as unknown as {
    Segmenter?: new (locales?: string | string[], options?: { granularity: "grapheme" }) => GraphemeSegmenter;
  };
  const ctor = intlRuntime.Segmenter;
  return ctor === undefined ? undefined : new ctor(undefined, { granularity: "grapheme" });
})();
function graphemes(text: string): readonly string[] {
  if (segmenter === undefined) return Array.from(text);
  return Array.from(segmenter.segment(text), item => item.segment);
}

function graphemeWidth(grapheme: string): number {
  const codePoints = Array.from(grapheme, character => character.codePointAt(0) ?? 0);
  const emoji = codePoints.some(codePoint => codePoint >= 0x1f000 && codePoint <= 0x1faff);
  const keycap = codePoints.includes(0x20e3);
  const emojiPresentation = codePoints.includes(0xfe0f) && codePoints.some(codePoint => codePoint >= 0x2300);
  const regionalPair = codePoints.filter(codePoint => codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff).length >= 2;
  if (emoji || keycap || emojiPresentation || regionalPair) return 2;
  return codePoints.reduce((width, codePoint) => width + codePointWidth(codePoint), 0);
}

function cells(text: string): readonly CharacterCell[] {
  const result: CharacterCell[] = [];
  let column = 0;
  for (const grapheme of graphemes(text)) {
    const width = graphemeWidth(grapheme);
    if (width <= 0) {
      if (result.length > 0) {
        const previous = result[result.length - 1]!;
        result[result.length - 1] = { ...previous, text: previous.text + grapheme };
      }
      continue;
    }
    result.push({ text: grapheme, from: column, to: column + width });
    column += width;
  }
  return result;
}

/** Visible terminal width, accounting for Unicode wide and combining chars. */
export function visibleWidth(text: string): number {
  return cells(sanitizeCopiedText(text)).at(-1)?.to ?? 0;
}

/** Slice a string by terminal columns, retaining cells that overlap the range. */
export function sliceByColumns(text: string, from: number, width: number): string {
  if (width <= 0) return "";
  const start = Math.max(0, Math.floor(from));
  const end = start + Math.max(0, Math.floor(width));
  return cells(sanitizeCopiedText(text))
    .filter(cell => cell.to > start && cell.from < end)
    .map(cell => cell.text)
    .join("");
}

function rowRange(
  selection: PreviewSelection,
  row: number,
  width: number,
): { readonly from: number; readonly to: number } | undefined {
  const { start, end } = orderSelection(selection);
  if (row < start.row || row > end.row) return undefined;
  const from = row === start.row ? Math.max(0, start.col) : 0;
  // The pointer cell is part of the selection, so the end is inclusive.
  const to = row === end.row ? Math.min(width, Math.max(0, end.col) + 1) : width;
  return to <= from ? undefined : { from, to };
}

/** Expose selected spans for native OpenTUI styling. */
export function selectedSpans(
  selection: PreviewSelection,
  rowCount: number,
  width: number,
): readonly SelectionSpan[] {
  if (isEmptySelection(selection) || rowCount <= 0 || width <= 0) return [];
  const { start, end } = orderSelection(selection);
  const spans: SelectionSpan[] = [];
  for (let row = Math.max(0, start.row); row <= Math.min(rowCount - 1, end.row); row += 1) {
    const range = rowRange(selection, row, width);
    if (range !== undefined) spans.push({ row, ...range });
  }
  return spans;
}

/** Alias useful to callers that describe the result as ranges. */
export const selectionSpans = selectedSpans;

/** Plain source text covered by a drag, one sanitized row per line. */
export function selectionText(
  rows: readonly string[],
  selection: PreviewSelection,
  width: number,
): string {
  if (isEmptySelection(selection) || width <= 0) return "";
  const { start, end } = orderSelection(selection);
  const parts: string[] = [];
  for (let row = Math.max(0, start.row); row <= Math.min(rows.length - 1, end.row); row += 1) {
    const range = rowRange(selection, row, width);
    const line = rows[row];
    if (range === undefined || line === undefined) {
      parts.push("");
      continue;
    }
    parts.push(sliceByColumns(line, range.from, range.to - range.from).trimEnd());
  }
  while (parts.length > 0 && parts.at(-1) === "") parts.pop();
  return parts.join("\n");
}
