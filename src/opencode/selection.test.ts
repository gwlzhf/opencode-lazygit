import { describe, expect, test } from "bun:test";
import {
  orderSelection,
  sanitizeCopiedText,
  selectedSpans,
  selectionText,
  sliceByColumns,
  visibleWidth,
  type PreviewSelection,
} from "./selection";

function selection(anchorRow: number, anchorCol: number, headRow: number, headCol: number): PreviewSelection {
  return { anchor: { row: anchorRow, col: anchorCol }, head: { row: headRow, col: headCol } };
}

describe("OpenCode selection", () => {
  test("orders backwards drags by row and column", () => {
    expect(orderSelection(selection(2, 4, 0, 2))).toEqual({
      start: { row: 0, col: 2 },
      end: { row: 2, col: 4 },
    });
  });

  test("includes the pointer cell and trims row-end padding", () => {
    expect(selectionText(["1 alpha   ", "2 bravo   ", "3 charlie "], selection(0, 2, 0, 6), 10)).toBe("alpha");
    expect(selectionText(["1 alpha   ", "2 bravo   ", "3 charlie "], selection(0, 0, 0, 9), 10)).toBe("1 alpha");
  });

  test("keeps whole rows between drag endpoints", () => {
    expect(selectionText(["1 alpha   ", "2 bravo   ", "3 charlie "], selection(0, 2, 2, 4), 10)).toBe("alpha\n2 bravo\n3 cha");
  });

  test("strips terminal controls before copying", () => {
    expect(sanitizeCopiedText("\u001b[31mhello\u001b[0m\u001b]52;c;bad\u0007")).toBe("hello");
    expect(selectionText(["\u001b[31m1 alpha\u001b[0m"], selection(0, 2, 0, 6), 10)).toBe("alpha");
  });

  test("slices Unicode by terminal columns without splitting a wide cell", () => {
    expect(visibleWidth("a界b")).toBe(4);
    expect(sliceByColumns("a界b", 1, 2)).toBe("界");
    expect(selectionText(["a界b  "], selection(0, 1, 0, 2), 6)).toBe("界");
  });
  test("preserves tab indentation and treats joined emoji as one cell", () => {
    expect(sanitizeCopiedText("\titem")).toBe("    item");
    expect(visibleWidth("👩‍💻x")).toBe(3);
    expect(selectionText(["👩‍💻x"], selection(0, 0, 0, 1), 4)).toBe("👩‍💻");
  });

  test("exposes inclusive spans for native styling", () => {
    expect(selectedSpans(selection(0, 2, 2, 1), 3, 8)).toEqual([
      { row: 0, from: 2, to: 8 },
      { row: 1, from: 0, to: 8 },
      { row: 2, from: 0, to: 2 },
    ]);
  });
});
