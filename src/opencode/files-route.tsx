/** @jsxImportSource @opentui/solid */

// @ts-expect-error OpenTUI's bundled Solid runtime entrypoint has no standalone declaration.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js/dist/solid.js";
import { type MouseEvent } from "@opentui/core";
import { Dynamic } from "@opentui/solid";
import { useTerminalDimensions } from "@opentui/solid";
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { useBindings } from "@opentui/keymap/solid";
import {
  DIFF_CONTEXT_LEVELS,
  TREE_MAX_RATIO,
  TREE_MIN_COLUMNS,
  TREE_MIN_RATIO,
  diffContextLabel,
  type ChangeSummary,
  type CommitDiffPreview,
  type FilePreview,
  type GitLogEntry,
  type ProjectSnapshot,
  type ReviewSource,
  type ViewMode,
} from "../contracts";
import { type TreeRow } from "../model/tree";
import {
  DEFAULT_PANEL_SETTINGS,
  type PanelSettingsStore,
} from "../settings";
import { diffGutterWidth, parseUnifiedDiff, type DiffRow } from "../ui/diff-view";
import {
  ReviewController,
  type LeftMode,
  type PanelFocus,
  type ReviewControllerState,
} from "../ui/review-controller";
import {
  isEmptySelection,
  orderSelection,
  sanitizeCopiedText,
  selectedSpans,
  selectionText,
  sliceByColumns,
  visibleWidth,
  type PreviewSelection,
  type SelectionPoint,
  type SelectionSpan,
} from "./selection";

const WIDE_LAYOUT_MINIMUM = 80;
const WHEEL_STEP = 3;
const BODY_TOP = 1;
const FOOTER_ROWS = 1;
const SPLIT_DIFF_MINIMUM_WIDTH = 40;

export interface FilesRouteProps {
  readonly api: TuiPluginApi;
  readonly cwd: string;
  readonly settings: PanelSettingsStore;
  readonly createSource: (cwd: string) => ReviewSource;
  readonly onClose: () => void;
}

type ThemeTokens = TuiThemeCurrent;

function safeText(value: string): string {
  return sanitizeCopiedText(value).replaceAll("\n", " ");
}

function summaryFor(snapshot: ProjectSnapshot | undefined, scope: ReviewControllerState["scope"]): ChangeSummary {
  if (snapshot === undefined) return { files: 0, insertions: 0, deletions: 0 };
  return snapshot.kind === "filesystem"
    ? { files: snapshot.allFiles.length, insertions: 0, deletions: 0 }
    : scope === "workspace" ? snapshot.workspaceSummary : snapshot.sessionSummary;
}

function isWide(width: number, state: ReviewControllerState | undefined): boolean {
  return state !== undefined && !state.treeCollapsed && width >= WIDE_LAYOUT_MINIMUM;
}

function treeWidth(width: number, ratio: number): number {
  const available = Math.max(0, Math.floor(width) - 3);
  const maximum = Math.floor(available * TREE_MAX_RATIO);
  const minimum = Math.min(maximum, TREE_MIN_COLUMNS);
  return Math.max(minimum, Math.min(maximum, Math.round(available * Math.max(TREE_MIN_RATIO, Math.min(TREE_MAX_RATIO, ratio)))));
}

function previewTitle(state: ReviewControllerState | undefined): string {
  if (state === undefined) return "Preview";
  if (state.leftMode === "log") {
    const entry = state.logSelectedIndex >= 0 ? state.history?.entries[state.logSelectedIndex] : undefined;
    if (entry === undefined) return "Commit preview";
    if (state.commitDiffLoading) return `Loading commit: ${safeText(entry.shortOid)}`;
    return state.commitDiff?.kind === "error" ? `Error: ${safeText(entry.shortOid)}` : `Commit: ${safeText(entry.shortOid)}`;
  }
  const selected = state.rows[state.selectedIndex];
  const path = state.previewPath ?? (selected?.node.kind === "file" ? selected.node.path : undefined);
  if (path === undefined) return "Preview";
  if (state.previewLoading) return `Loading: ${safeText(path)}`;
  switch (state.preview?.kind) {
    case "diff": return `Diff: ${safeText(path)}`;
    case "binary": return `Binary: ${safeText(path)}`;
    case "error": return `Error: ${safeText(path)}`;
    default: return `File: ${safeText(path)}`;
  }
}

function treeTitle(state: ReviewControllerState | undefined): string {
  if (state?.leftMode === "log") return "History";
  if (state?.snapshot?.kind === "filesystem") return "Project [filesystem]";
  return `Project [${state?.viewMode ?? "modified"} · ${state?.scope ?? "workspace"}]`;
}

function statusColor(status: string | undefined, theme: ThemeTokens): ThemeTokens["text"] {
  if (status === "A") return theme.success;
  if (status === "D" || status === "U") return theme.error;
  if (status === undefined) return theme.text;
  return theme.warning;
}

export function diffColor(kind: string, theme: ThemeTokens): ThemeTokens["text"] {
  if (kind === "add") return theme.diffAdded;
  if (kind === "remove") return theme.diffRemoved;
  if (kind === "hunk") return theme.diffHunkHeader;
  return theme.diffContext;
}

type PreviewLine = {
  readonly text: string;
  readonly kind: "context" | "add" | "remove" | "hunk";
  readonly right?: PreviewLine;
};

function splitDiffText(cell: { readonly number: number | undefined; readonly text: string }, gutter: number): string {
  const number = cell.number === undefined ? " ".repeat(gutter) : String(cell.number).padStart(gutter, " ");
  return `${number} ${cell.text}`;
}

function diffCellKind(kind: string): PreviewLine["kind"] {
  if (kind === "add" || kind === "remove" || kind === "hunk") return kind;
  return "context";
}

function previewLines(value: FilePreview | CommitDiffPreview | undefined, state: ReviewControllerState, width: number): readonly PreviewLine[] {
  if (value === undefined || value.kind !== "diff") return (value?.lines ?? []).map(text => ({ text, kind: "context" }));
  if (state.diffLayout !== "split" || width < SPLIT_DIFF_MINIMUM_WIDTH) {
    return value.lines.map(text => ({ text, kind: text.startsWith("@@") ? "hunk" : text.startsWith("+") && !text.startsWith("+++") ? "add" : text.startsWith("-") && !text.startsWith("---") ? "remove" : "context" }));
  }
  const rows = parseUnifiedDiff(value.lines);
  if (rows === undefined) return value.lines.map(text => ({ text, kind: "context" }));
  const gutter = diffGutterWidth(rows);
  return rows.map(row => {
    if (row.kind === "pair") {
      return {
        text: splitDiffText(row.left, gutter),
        kind: diffCellKind(row.left.kind),
        right: { text: splitDiffText(row.right, gutter), kind: diffCellKind(row.right.kind) },
      };
    }
    return { text: row.text, kind: row.kind === "hunk" ? "hunk" : "context" };
  });
}

function selectionPieces(line: string, span: SelectionSpan | undefined, width: number): readonly [string, string, string] {
  const plain = safeText(line);
  if (span === undefined) return [plain, "", ""];
  const before = sliceByColumns(plain, 0, span.from);
  const selected = sliceByColumns(plain, span.from, span.to - span.from);
  const after = sliceByColumns(plain, span.to, Math.max(0, width - span.to));
  return [before, selected, after];
}

export function createFilesRouteBindings(handleKey: (key: string) => void) {
  return [
    { key: "up", cmd: () => handleKey("up") }, { key: "down", cmd: () => handleKey("down") },
    { key: "left", cmd: () => handleKey("left") }, { key: "right", cmd: () => handleKey("right") },
    { key: "j", cmd: () => handleKey("j") }, { key: "k", cmd: () => handleKey("k") },
    { key: "h", cmd: () => handleKey("h") }, { key: "l", cmd: () => handleKey("l") },
    { key: "enter", cmd: () => handleKey("enter") }, { key: "tab", cmd: () => handleKey("tab") },
    { key: "shift+tab", cmd: () => handleKey("shift+tab") }, { key: "[", cmd: () => handleKey("[") },
    { key: "]", cmd: () => handleKey("]") }, { key: "ctrl+left", cmd: () => handleKey("ctrl+left") },
    { key: "ctrl+right", cmd: () => handleKey("ctrl+right") }, { key: "\\", cmd: () => handleKey("\\") },
    { key: "ctrl+b", cmd: () => handleKey("ctrl+b") }, { key: "d", cmd: () => handleKey("d") },
    { key: "c", cmd: () => handleKey("c") }, { key: "m", cmd: () => handleKey("m") },
    { key: "a", cmd: () => handleKey("a") }, { key: "s", cmd: () => handleKey("s") },
    { key: "g", cmd: () => handleKey("g") }, { key: "f5", cmd: () => handleKey("f5") },
    { key: "r", cmd: () => handleKey("r") }, { key: "pageup", cmd: () => handleKey("pageup") },
    { key: "pagedown", cmd: () => handleKey("pagedown") }, { key: "home", cmd: () => handleKey("home") },
    { key: "end", cmd: () => handleKey("end") }, { key: "escape", cmd: () => handleKey("escape") },
  ];
}

export interface FilesRouteInputContext {
  readonly getController: () => ReviewController | undefined;
  readonly isDisposed: () => boolean;
  readonly width: () => number;
  readonly viewportHeight: () => number;
  readonly clearSelection: () => void;
  readonly scrollPreview: (delta: number) => void;
  readonly focusTreeOrClose: () => void;
}
export function createFilesRouteKeyHandler(context: FilesRouteInputContext): (key: string) => void {
  return (key: string): void => {
    const active = context.getController();
    const state = active?.state;
    if (context.isDisposed() || active === undefined || state === undefined) return;
    if (key === "f5" || key === "r") { context.clearSelection(); active.refresh(); return; }
    if (key === "escape") { context.focusTreeOrClose(); return; }
    if (key === "tab" || key === "shift+tab") {
      if (state.treeCollapsed) { context.clearSelection(); active.setTreeCollapsed(false); } else active.toggleFocus();
      return;
    }
    if (key === "\\" || key === "ctrl+b") { context.clearSelection(); active.setTreeCollapsed(!state.treeCollapsed); return; }
    if (key === "d") { context.clearSelection(); active.toggleDiffLayout(); return; }
    if (key === "c") { context.clearSelection(); active.cycleDiffContext(); return; }
    if (key === "[" || key === "ctrl+left") { active.resizeTree(-1, context.width()); return; }
    if (key === "]" || key === "ctrl+right") { active.resizeTree(1, context.width()); return; }
    if (key === "g") { context.clearSelection(); active.toggleLeftMode(); return; }
    if (state.focus === "preview") {
      if (key === "left" || key === "h") active.focusTree();
      else if (key === "home") { active.scrollPreviewHome(context.viewportHeight()); context.clearSelection(); }
      else if (key === "end") { active.scrollPreviewEnd(context.viewportHeight()); context.clearSelection(); }
      else if (key === "up" || key === "k") context.scrollPreview(-1);
      else if (key === "down" || key === "j") context.scrollPreview(1);
      else if (key === "pageup") context.scrollPreview(-context.viewportHeight());
      else if (key === "pagedown") context.scrollPreview(context.viewportHeight());
      return;
    }
    if (state.leftMode === "log") {
      if (key === "up" || key === "k") active.movePrimarySelection(-1);
      else if (key === "down" || key === "j") active.movePrimarySelection(1);
      else if (key === "enter" || key === "right" || key === "l") active.focusPreview();
      return;
    }
    if (key === "a" && state.leftMode === "files") { context.clearSelection(); active.setViewMode("all"); return; }
    if (key === "m" && state.leftMode === "files") { context.clearSelection(); active.setViewMode("modified"); return; }
    if (key === "s" && state.leftMode === "files") { context.clearSelection(); active.toggleScope(); return; }
    if (key === "up" || key === "k") { context.clearSelection(); active.movePrimarySelection(-1); return; }
    if (key === "down" || key === "j") { context.clearSelection(); active.movePrimarySelection(1); return; }
    if (key === "left" || key === "h") { context.clearSelection(); active.collapseOrParent(); return; }
    if (key === "right" || key === "l") {
      context.clearSelection();
      const selected = state.rows[state.selectedIndex];
      if (selected?.node.kind === "file") active.focusPreview(); else active.expandOrChild();
      return;
    }
    if (key === "enter") { context.clearSelection(); active.openSelection(); }
  };
}

export type FilesRouteMouseTarget = "divider" | "tree" | "preview" | "ignore";

export function filesRouteMouseTarget(event: MouseEvent, state: ReviewControllerState, width: number): FilesRouteMouseTarget {
  const wide = isWide(width, state);
  const left = wide ? treeWidth(width, state.treeRatio) : 0;
  if (wide && event.x === left) return "divider";
  if (wide && event.x < left || !wide && state.focus === "tree") return "tree";
  if (!wide && state.focus !== "preview") return "ignore";
  return "preview";
}
export function copyFilesRouteSelection(
  selection: PreviewSelection | undefined,
  rows: readonly string[],
  width: number,
  copyToClipboard: (text: string) => boolean,
  warn: () => void,
): string | undefined {
  if (selection === undefined || isEmptySelection(selection)) return undefined;
  const text = selectionText(rows, selection, width);
  if (!copyToClipboard(text)) {
    warn();
    return undefined;
  }
  const lines = text.split("\n").length;
  return `copied ${lines} ${lines === 1 ? "line" : "lines"}`;
}
export function filesRoutePreviewPoint(event: MouseEvent, state: ReviewControllerState, width: number, viewportHeight: number): SelectionPoint | undefined {
  const wide = isWide(width, state);
  const left = wide ? treeWidth(width, state.treeRatio) : 0;
  if (wide && event.x <= left) return undefined;
  if (!wide && state.focus !== "preview") return undefined;
  const previewWidth = Math.max(0, (wide ? width - left : width) - 2);
  const col = event.x - (wide ? left + 1 : 1);
  const row = event.y - BODY_TOP;
  if (row < 0 || row >= viewportHeight || col < 0 || col >= previewWidth) return undefined;
  return { row, col };
}

export interface FilesRouteMouseContext {
  readonly getController: () => ReviewController | undefined;
  readonly isDisposed: () => boolean;
  readonly width: () => number;
  readonly viewportHeight: () => number;
  readonly treeOffset: () => number;
  readonly logOffset: () => number;
  readonly getSelection: () => PreviewSelection | undefined;
  readonly setSelection: (selection: PreviewSelection | undefined) => void;
  readonly isSelectionDrag: () => boolean;
  readonly setSelectionDrag: (active: boolean) => void;
  readonly isDividerDrag: () => boolean;
  readonly setDividerDrag: (active: boolean) => void;
  readonly clearSelection: () => void;
  readonly bumpRevision: () => void;
  readonly copySelection: () => void;
}

export function createFilesRouteMouseHandlers(context: FilesRouteMouseContext): {
  readonly onMouseDown: (event: MouseEvent) => void;
  readonly onMouseDrag: (event: MouseEvent) => void;
  readonly onMouseUp: () => void;
} {
  return {
    onMouseDown: (event: MouseEvent): void => {
      const active = context.getController();
      const state = active?.state;
      if (context.isDisposed() || active === undefined || state === undefined) return;
      const width = context.width();
      const target = filesRouteMouseTarget(event, state, width);
      const bodyRow = event.y - BODY_TOP;
      if (target === "divider") {
        context.clearSelection();
        context.setDividerDrag(true);
        return;
      }
      if (target === "tree") {
        context.clearSelection();
        active.focusTree();
        const index = (state.leftMode === "log" ? context.logOffset() : context.treeOffset()) + bodyRow;
        active.selectPrimary(index);
        return;
      }
      if (target === "ignore") return;
      const point = filesRoutePreviewPoint(event, state, width, context.viewportHeight());
      if (point === undefined) return;
      active.focusPreview();
      context.clearSelection();
      context.setSelectionDrag(true);
      context.setSelection({ anchor: point, head: point });
      context.bumpRevision();
    },
    onMouseDrag: (event: MouseEvent): void => {
      const active = context.getController();
      const state = active?.state;
      if (context.isDisposed() || active === undefined || state === undefined) return;
      const width = context.width();
      if (context.isDividerDrag() && isWide(width, state)) {
        active.setTreeColumns(event.x, width);
        return;
      }
      const selection = context.getSelection();
      if (!context.isSelectionDrag() || selection === undefined) return;
      const point = filesRoutePreviewPoint(event, state, width, context.viewportHeight());
      if (point === undefined) return;
      context.setSelection({ anchor: selection.anchor, head: point });
      context.bumpRevision();
    },
    onMouseUp: (): void => {
      if (context.isSelectionDrag()) context.copySelection();
      context.setSelectionDrag(false);
      context.setDividerDrag(false);
    },
  };
}

export function FilesRoute(props: FilesRouteProps) {

  const dimensions = useTerminalDimensions();
  const [revision, setRevision] = createSignal(0);
  let controller: ReviewController | undefined;
  let disposed = false;
  let popMode: (() => void) | undefined;
  let selection: PreviewSelection | undefined;
  let selectionDrag = false;
  let dividerDrag = false;
  let copyNotice: string | undefined;
  let treeOffset = 0;
  let logOffset = 0;
  let lastPreview: FilePreview | CommitDiffPreview | undefined;
  let lastPreviewPath: string | undefined;

  const currentState = (): ReviewControllerState | undefined => {
    revision();
    return controller?.state;
  };

  const clearSelection = (): void => {
    selection = undefined;
    selectionDrag = false;
    copyNotice = undefined;
  };

  const viewportHeight = (): number => Math.max(1, dimensions().height - BODY_TOP - FOOTER_ROWS - 1);
  const scrollPreview = (delta: number): void => {
    const active = controller;
    const before = active?.state.previewScroll;
    active?.scrollPreview(delta, viewportHeight());
    if (active?.state.previewScroll !== before) clearSelection();
  };

  const focusTreeOrClose = (): void => {
    const active = controller;
    if (active?.state.focus === "preview") active.focusTree();
    else props.onClose();
  };
  const handleKey = createFilesRouteKeyHandler({
    getController: () => controller,
    isDisposed: () => disposed,
    width: () => dimensions().width,
    viewportHeight,
    clearSelection,
    scrollPreview,
    focusTreeOrClose,
  });

  useBindings(() => ({
    priority: 100,
    bindings: createFilesRouteBindings(handleKey),
  }));


  const copySelection = (): void => {
    const state = controller?.state;
    if (state === undefined) return;
    const width = isWide(dimensions().width, state)
      ? Math.max(0, dimensions().width - treeWidth(dimensions().width, state.treeRatio) - 2)
      : Math.max(0, dimensions().width - 2);
    const rows = buildPreviewLines(state, width).map(line => previewLineText(line));
    const notice = copyFilesRouteSelection(
      selection,
      rows,
      width,
      text => props.api.renderer.copyToClipboardOSC52(text),
      () => props.api.ui.toast({ variant: "warning", message: "Terminal clipboard copy is unavailable." }),
    );
    if (notice === undefined) return;
    copyNotice = notice;
    setRevision((value: number) => value + 1);
  };
  const mouseHandlers = createFilesRouteMouseHandlers({
    getController: () => controller,
    isDisposed: () => disposed,
    width: () => dimensions().width,
    viewportHeight,
    treeOffset: () => treeOffset,
    logOffset: () => logOffset,
    getSelection: () => selection,
    setSelection: value => { selection = value; },
    isSelectionDrag: () => selectionDrag,
    setSelectionDrag: value => { selectionDrag = value; },
    isDividerDrag: () => dividerDrag,
    setDividerDrag: value => { dividerDrag = value; },
    clearSelection,
    bumpRevision: () => setRevision((value: number) => value + 1),
    copySelection,
  });
  const onMouseDown = mouseHandlers.onMouseDown;
  const onMouseDrag = mouseHandlers.onMouseDrag;
  const onMouseUp = mouseHandlers.onMouseUp;




  const onMouseScroll = (event: MouseEvent): void => {
    const active = controller;
    const state = active?.state;
    if (disposed || active === undefined || state === undefined || event.scroll === undefined) return;
    const width = dimensions().width;
    const left = isWide(width, state) ? treeWidth(width, state.treeRatio) : 0;
    if ((isWide(width, state) && event.x < left) || (!isWide(width, state) && state.focus === "tree")) {
      clearSelection();
      active.movePrimarySelection(event.scroll.direction === "down" ? WHEEL_STEP : -WHEEL_STEP);
    } else {
      const delta = event.scroll.direction === "down" ? WHEEL_STEP : -WHEEL_STEP;
      scrollPreview(delta);
    }
  };

  const buildPreviewLines = (state: ReviewControllerState, width: number): readonly PreviewLine[] => {
    controller?.setPreviewWidth(width);
    const value = state.leftMode === "log" ? state.commitDiff : state.preview;
    const lines = previewLines(value, state, width);
    const first = Math.max(0, Math.min(state.previewScroll, Math.max(0, lines.length - viewportHeight())));
    return lines.slice(first, first + viewportHeight());
  };

  const previewLineText = (line: PreviewLine): string => line.right === undefined ? line.text : `${line.text}  │  ${line.right.text}`;
  const renderTextLine = (line: PreviewLine, index: number, width: number) => {
    const text = previewLineText(line);
    const span = selection === undefined ? undefined : selectedSpans(selection, index + 1, width).find(item => item.row === index);
    const theme = props.api.theme.current;
    if (line.right !== undefined) {
      const separator = "  │  ";
      const leftSelected = span !== undefined && span.from < visibleWidth(line.text) && span.to > 0;
      const rightStart = visibleWidth(line.text) + visibleWidth(separator);
      const rightSelected = span !== undefined && span.to > rightStart;
      return <text>
        <span style={{ fg: diffColor(line.kind, theme), bg: leftSelected ? theme.backgroundElement : undefined }}>{safeText(line.text)}</span>
        <span style={{ fg: theme.diffContext }}>{separator}</span>
        <span style={{ fg: diffColor(line.right.kind, theme), bg: rightSelected ? theme.backgroundElement : undefined }}>{safeText(line.right.text)}</span>
      </text>;
    }
    const [before, selected, after] = selectionPieces(text, span, width);
    if (span !== undefined) return <text>
      <span style={{ fg: diffColor(line.kind, theme) }}>{before}</span>
      <span style={{ fg: theme.selectedListItemText, bg: theme.backgroundElement }}>{selected}</span>
      <span style={{ fg: diffColor(line.kind, theme) }}>{after}</span>
    </text>;
    return <text content={safeText(text)} fg={diffColor(line.kind, theme)} />;
  };

  const renderPreview = (state: ReviewControllerState | undefined, width: number) => {
    const theme = props.api.theme.current;
    if (state === undefined) return <text content="Loading project files…" fg={theme.primary} />;
    const value = state.leftMode === "log" ? state.commitDiff : state.preview;
    if (state.leftMode === "log" && state.commitDiffLoading && value === undefined) return <text content="Loading commit preview…" fg={theme.primary} />;
    if (state.leftMode !== "log" && state.previewLoading && value === undefined) return <text content="Loading preview…" fg={theme.primary} />;
    if (value === undefined) return <text content={state.leftMode === "log" ? "Select a commit to preview" : "Select a file to preview"} fg={theme.textMuted} />;
    if (value.kind === "binary") return <>
      <text content="Binary file" fg={theme.warning} />
      <Show when={value.byteSize !== undefined}><text content={`${value.byteSize!.toLocaleString("en-US")} bytes`} fg={theme.textMuted} /></Show>
    </>;
    if (value.kind === "error") return <text content={`Error: ${safeText(value.error ?? "Unable to load file")}`} fg={theme.error} />;
    const lines = buildPreviewLines(state, width);
    return <For each={lines}>{(line: PreviewLine, index: () => number) => renderTextLine(line, index(), width)}</For>;
  };

  const renderTree = (state: ReviewControllerState | undefined, width: number) => {
    const theme = props.api.theme.current;
    if (state === undefined) return <text content="Loading project files…" fg={theme.primary} />;
    if (state.leftMode === "log") {
      if (state.historyLoading && state.history === undefined) return <text content="Loading history…" fg={theme.primary} />;
      if (state.historyError !== undefined) return <text content={`Error: ${safeText(state.historyError)}`} fg={theme.error} />;
      const entries = state.history?.entries ?? [];
      if (entries.length === 0) return <text content="No commits found" fg={theme.textMuted} />;
      if (state.logSelectedIndex < logOffset) logOffset = state.logSelectedIndex;
      if (state.logSelectedIndex >= logOffset + viewportHeight()) logOffset = state.logSelectedIndex - viewportHeight() + 1;
      return <For each={entries.slice(logOffset, logOffset + viewportHeight())}>{(entry: GitLogEntry, offset: () => number) => {
        const index = logOffset + offset();
        const selected = index === state.logSelectedIndex;
        return <text content={`${selected ? ">" : " "} ${safeText(entry.shortOid)} ${safeText(entry.subject)}`} fg={selected && state.focus === "tree" ? theme.primary : theme.text} />;
      }}</For>;
    }
    if (state.snapshot === undefined) return <text content={state.refreshError === undefined ? "Loading project files…" : `Error: ${safeText(state.refreshError)}`} fg={state.refreshError === undefined ? theme.primary : theme.error} />;
    if (state.rows.length === 0) {
      const message = state.snapshot.kind === "filesystem" ? "No project files found" : state.viewMode === "modified" ? `No ${state.scope} changes — press a for all files` : "No project files found";
      return <text content={message} fg={theme.textMuted} />;
    }
    if (state.selectedIndex < treeOffset) treeOffset = state.selectedIndex;
    if (state.selectedIndex >= treeOffset + viewportHeight()) treeOffset = state.selectedIndex - viewportHeight() + 1;
    return <For each={state.rows.slice(treeOffset, treeOffset + viewportHeight())}>{(row: TreeRow, offset: () => number) => {
      const index = treeOffset + offset();
      const selected = index === state.selectedIndex;
      const node = row.node;
      const cursor = selected ? ">" : " ";
      const indent = "  ".repeat(row.depth);
      const text = node.kind === "directory"
        ? `${cursor} ${indent}${row.expanded ? "▼" : "▶"} ${safeText(node.name)}/`
        : `${cursor} ${indent}${node.status ?? " "}  ${safeText(node.name)}`;
      return <text content={text} fg={selected && state.focus === "tree" ? theme.primary : statusColor(node.status, theme)} />;
    }}</For>;
  };

  const footer = (state: ReviewControllerState | undefined): string => {
    if (state === undefined) return "loading";
    const project = state.snapshot;
    const summary = summaryFor(project, state.scope);
    const pieces: string[] = [];
    if (state.leftMode === "log" && state.commitDiff?.truncated) pieces.push("commit preview truncated");
    else if (state.leftMode === "log" && state.history?.truncated) pieces.push("history truncated");
    else if (state.preview?.truncated) pieces.push("preview truncated");
    else if (project?.truncated) pieces.push("listing truncated");
    if (project?.kind === "filesystem") pieces.push("filesystem", `${summary.files} ${summary.files === 1 ? "file" : "files"}`);
    else pieces.push(state.viewMode, state.scope, `+${summary.insertions} -${summary.deletions}`, `${summary.files} ${summary.files === 1 ? "file" : "files"}`);
    if (state.refreshLoading) pieces.push("refreshing");
    else if (state.refreshError !== undefined) pieces.push(`error: ${safeText(state.refreshError)}`);
    else if (state.watchError !== undefined) pieces.push(`watch error: ${safeText(state.watchError)}`);
    else if (state.leftMode === "log" && state.historyLoading) pieces.push("loading history");
    else if (state.leftMode === "log" && state.commitDiffLoading) pieces.push("loading commit");
    else if (state.previewLoading) pieces.push("loading preview");
    else if (project?.baselineEstablishedAt !== undefined) pieces.push(`baseline ${new Date(project.baselineEstablishedAt).toISOString()}`);
    if (copyNotice !== undefined) pieces.push(copyNotice);
    const activePreview = state.leftMode === "log" ? state.commitDiff : state.preview;
    if (activePreview?.kind === "diff") pieces.push(`${state.diffLayout} diff`, `ctx ${diffContextLabel(state.diffContext)}`);
    return pieces.join(" · ");
  };

  const source = props.createSource(props.cwd);
  controller = new ReviewController({
    cwd: props.cwd,
    source,
    treeRatio: DEFAULT_PANEL_SETTINGS.treeRatio,
    onTreeRatioChange: props.settings.saveTreeRatio,
    treeCollapsed: DEFAULT_PANEL_SETTINGS.treeCollapsed,
    onTreeCollapsedChange: props.settings.saveTreeCollapsed,
    diffLayout: DEFAULT_PANEL_SETTINGS.diffLayout,
    onDiffLayoutChange: props.settings.saveDiffLayout,
    diffContext: DEFAULT_PANEL_SETTINGS.diffContext,
    onDiffContextChange: props.settings.saveDiffContext,
    highlightTheme: DEFAULT_PANEL_SETTINGS.highlightTheme,
    onHighlightThemeChange: props.settings.saveHighlightTheme,
    onChange: () => {
      if (disposed) return;
      setRevision(controller?.state.revision ?? 0);
      props.api.renderer.requestRender();
    },
  });
  onMount(async () => {
    popMode = props.api.mode.push("pi-lazygit.files");
    controller?.start();
    setRevision(controller?.state.revision ?? 0);
    let restored = DEFAULT_PANEL_SETTINGS;
    try {
      restored = await props.settings.load();
    } catch {
      restored = DEFAULT_PANEL_SETTINGS;
    }
    if (disposed || controller === undefined) return;
    if (restored.treeCollapsed !== controller.state.treeCollapsed) controller.setTreeCollapsed(restored.treeCollapsed);
    if (restored.diffLayout !== controller.state.diffLayout) controller.toggleDiffLayout();
    while (restored.diffContext !== controller.state.diffContext) controller.cycleDiffContext();
    if (restored.highlightTheme !== controller.state.highlightTheme) controller.setHighlightTheme(restored.highlightTheme);
    if (restored.treeRatio !== controller.state.treeRatio) {
      const available = Math.max(0, dimensions().width - 3);
      controller.setTreeColumns(Math.round(available * restored.treeRatio), dimensions().width);
    }
  });

  onCleanup(() => {
    disposed = true;
    controller?.dispose();
    controller = undefined;
    popMode?.();
    popMode = undefined;
    void props.settings.flush();
  });

  const renderBody = () => {
    const state = currentState();
    const width = dimensions().width;
    if (state?.preview !== lastPreview || state?.commitDiff !== lastPreview || state?.previewPath !== lastPreviewPath) {
      selection = undefined;
      selectionDrag = false;
      lastPreview = state?.leftMode === "log" ? state.commitDiff : state?.preview;
      lastPreviewPath = state?.previewPath;
    }
    const wide = isWide(width, state);
    const left = wide ? treeWidth(width, state!.treeRatio) : width;
    const previewWidth = wide ? Math.max(0, width - left - 2) : Math.max(0, width - 2);
    return <box flexDirection="row" flexGrow={1} width="100%" onMouseDown={onMouseDown} onMouseDrag={onMouseDrag} onMouseUp={onMouseUp} onMouseDragEnd={onMouseUp} onMouseScroll={onMouseScroll}>
      <Show when={wide} fallback={<box width="100%" height="100%" border borderStyle="single" borderColor={props.api.theme.current.borderActive} title={state?.focus === "preview" ? previewTitle(state!) : treeTitle(state)} overflow="hidden">
        <Show when={state?.focus === "preview"} fallback={renderTree(state, Math.max(0, width - 2))}>{renderPreview(state, previewWidth)}</Show>
      </box>}>
        <box width={left} height="100%" border borderStyle="single" borderColor={state?.focus === "tree" ? props.api.theme.current.borderActive : props.api.theme.current.border} title={treeTitle(state)} overflow="hidden">
          {renderTree(state, Math.max(0, left - 2))}
        </box>
        <box flexGrow={1} height="100%" border borderStyle="single" borderColor={state?.focus === "preview" ? props.api.theme.current.borderActive : props.api.theme.current.border} title={previewTitle(state!)} overflow="hidden">
          {renderPreview(state, previewWidth)}
        </box>
      </Show>
    </box>;
  };

  const renderFooter = () => <box height={1} width="100%" overflow="hidden"><text content={footer(currentState())} fg={props.api.theme.current.textMuted} /></box>;

  return <box width="100%" height="100%" flexDirection="column" backgroundColor={props.api.theme.current.background}>
    <Dynamic component={() => renderBody()} />
    <Dynamic component={() => renderFooter()} />
  </box>;
}
