/** @jsxImportSource @opentui/solid */

import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { KeymapProvider } from "@opentui/keymap/solid";
import { RGBA } from "@opentui/core";
import { render } from "@opentui/solid";
// @ts-expect-error OpenTUI's runtime Solid entrypoint has no standalone declaration.
import { createRoot } from "solid-js/dist/solid.js";
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import type { FilePreview, ProjectSnapshot, ReviewSource } from "../contracts";
import { DEFAULT_PANEL_SETTINGS, type PanelSettings, type PanelSettingsStore } from "../settings";
import type { ReviewControllerState } from "../ui/review-controller";
import type { ReviewController } from "../ui/review-controller";
import { createFilesRouteBindings, createFilesRouteKeyHandler, filesRouteMouseTarget, FilesRoute } from "./files-route";
const theme = {
  primary: RGBA.fromHex("#ff00ff"), secondary: RGBA.fromHex("#aaaaaa"), accent: RGBA.fromHex("#00ffff"),
  error: RGBA.fromHex("#ff0000"), warning: RGBA.fromHex("#ffff00"), success: RGBA.fromHex("#00ff00"), info: RGBA.fromHex("#00aaff"),
  text: RGBA.fromHex("#ffffff"), textMuted: RGBA.fromHex("#888888"), selectedListItemText: RGBA.fromHex("#000000"),
  background: RGBA.fromHex("#000000"), backgroundPanel: RGBA.fromHex("#111111"), backgroundElement: RGBA.fromHex("#333333"), backgroundMenu: RGBA.fromHex("#222222"),
  border: RGBA.fromHex("#444444"), borderActive: RGBA.fromHex("#ff00ff"), borderSubtle: RGBA.fromHex("#222222"),
  diffAdded: RGBA.fromHex("#00ff00"), diffRemoved: RGBA.fromHex("#ff0000"), diffContext: RGBA.fromHex("#aaaaaa"), diffHunkHeader: RGBA.fromHex("#00ffff"),
  diffHighlightAdded: RGBA.fromHex("#00ff00"), diffHighlightRemoved: RGBA.fromHex("#ff0000"), diffAddedBg: RGBA.fromHex("#003300"), diffRemovedBg: RGBA.fromHex("#330000"), diffContextBg: RGBA.fromHex("#111111"), diffLineNumber: RGBA.fromHex("#777777"), diffAddedLineNumberBg: RGBA.fromHex("#003300"), diffRemovedLineNumberBg: RGBA.fromHex("#330000"),
  markdownText: RGBA.fromHex("#ffffff"), markdownHeading: RGBA.fromHex("#ffffff"), markdownLink: RGBA.fromHex("#ffffff"), markdownLinkText: RGBA.fromHex("#ffffff"), markdownCode: RGBA.fromHex("#ffffff"), markdownBlockQuote: RGBA.fromHex("#ffffff"), markdownEmph: RGBA.fromHex("#ffffff"), markdownStrong: RGBA.fromHex("#ffffff"), markdownHorizontalRule: RGBA.fromHex("#ffffff"), markdownListItem: RGBA.fromHex("#ffffff"), markdownListEnumeration: RGBA.fromHex("#ffffff"), markdownImage: RGBA.fromHex("#ffffff"), markdownImageText: RGBA.fromHex("#ffffff"), markdownCodeBlock: RGBA.fromHex("#ffffff"),
  syntaxComment: RGBA.fromHex("#888888"), syntaxKeyword: RGBA.fromHex("#ff00ff"), syntaxFunction: RGBA.fromHex("#00ffff"), syntaxVariable: RGBA.fromHex("#ffffff"), syntaxString: RGBA.fromHex("#00ff00"), syntaxNumber: RGBA.fromHex("#ffff00"), syntaxType: RGBA.fromHex("#00aaff"), syntaxOperator: RGBA.fromHex("#ffffff"), syntaxPunctuation: RGBA.fromHex("#ffffff"), thinkingOpacity: 1,
} as TuiThemeCurrent;

function snapshot(): ProjectSnapshot {
  const changes = new Map<string, { path: string; index: string; worktree: string; status: "M" }>([
    ["src/界.ts", { path: "src/界.ts", index: " ", worktree: "M", status: "M" }],
  ]);
  return {
    kind: "git", root: "/fixture", hasHead: true, allFiles: ["src/界.ts", "README.md"],
    workspaceChanges: changes, sessionChanges: changes,
    workspaceSummary: { files: 1, insertions: 2, deletions: 1 }, sessionSummary: { files: 1, insertions: 2, deletions: 1 },
    baselineEstablishedAt: Date.UTC(2026, 0, 2), truncated: false,
  };
}

const preview: FilePreview = { path: "src/界.ts", kind: "text", lines: ["const 界 = true;", "return 界;"], truncated: false };

function controlledSource(options: { readonly refresh?: Promise<ProjectSnapshot>; readonly preview?: Promise<FilePreview>; readonly watch?: (signal: AbortSignal) => Promise<void> } = {}): ReviewSource & { readonly signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  return {
    signals,
    preview: async (_path, { signal }) => { signals.push(signal); return options.preview === undefined ? preview : options.preview; },
    history: async () => ({ entries: [{ oid: "abc", shortOid: "abc", subject: "Initial", author: "A", authoredAt: 0 }], truncated: false }),
    commitDiff: async () => ({ oid: "abc", kind: "diff", lines: ["@@ -1 +1 @@", "-old", "+new"], truncated: false }),
    watch: async ({ signal }) => {
      signals.push(signal);
      if (options.watch !== undefined) return options.watch(signal);
      await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    },
    refresh: async ({ signal }) => { signals.push(signal); return options.refresh === undefined ? snapshot() : options.refresh; },
  };
}

function settingsStore(): PanelSettingsStore & { readonly flushed: () => number } {
  let value: PanelSettings = DEFAULT_PANEL_SETTINGS;
  let flushCount = 0;
  return {
    load: async () => value,
    saveTreeRatio: ratio => { value = { ...value, treeRatio: ratio }; },
    saveTreeCollapsed: collapsed => { value = { ...value, treeCollapsed: collapsed }; },
    saveHighlightTheme: highlightTheme => { value = { ...value, highlightTheme }; },
    saveDiffLayout: diffLayout => { value = { ...value, diffLayout }; },
    saveDiffContext: diffContext => { value = { ...value, diffContext }; },
    flush: async () => { flushCount += 1; },
    flushed: () => flushCount,
  };
}

function api(renderer: Awaited<ReturnType<typeof createTestRenderer>>["renderer"], modePushes: string[], copied: string[], toasts: unknown[], keymap: unknown): TuiPluginApi {
  return {
    mode: { current: () => "base", push: (mode: string) => { modePushes.push(mode); return () => modePushes.push("pop"); } },
    renderer,
    theme: { current: theme, selected: "default", has: () => true, set: () => true, install: async () => undefined, mode: () => "dark", ready: true },
    ui: { toast: (value: unknown) => toasts.push(value) },
    keymap,
  } as unknown as TuiPluginApi;
}

async function mount(width: number, height: number, source: ReviewSource, settings = settingsStore(), clipboard = true) {
  const setup = await createTestRenderer({ width, height });
  const layers: any[] = [];
  const keymap = { registerLayer: (layer: unknown) => { layers.push(layer); return () => undefined; } };
  const modePushes: string[] = [];
  const copied: string[] = [];
  const toasts: unknown[] = [];
  const rendererCopy = setup.renderer.copyToClipboardOSC52.bind(setup.renderer);
  const instance = api(setup.renderer, modePushes, copied, toasts, keymap);
  let disposeRoot = (): void => undefined;
  createRoot((dispose: () => void) => {
    disposeRoot = dispose;
    void render(() => <KeymapProvider keymap={keymap as never} children={(() => <FilesRoute api={instance} cwd="/fixture" settings={settings} createSource={() => source} onClose={() => modePushes.push("close")} />) as never} />, setup.renderer);
  });
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  await setup.renderOnce();
  await setup.flush();
  return { setup, layers, modePushes, copied, toasts, settings, rendererCopy, disposeRoot };
}

describe("FilesRoute", () => {
  test("renders split and narrow native panes", async () => {
    const wide = await mount(100, 20, controlledSource());
    const wideFrame = wide.setup.captureCharFrame();
    expect(wideFrame).toContain("Preview");
    expect(wideFrame.split("\n").some(line => line.includes("│"))).toBe(true);
    wide.setup.renderer.destroy();

    const narrow = await mount(79, 10, controlledSource());
    const narrowFrame = narrow.setup.captureCharFrame();
    expect(narrowFrame).toContain("Project [modified · workspace]");
    expect(narrowFrame).not.toContain("const 界 = true;");
    narrow.setup.renderer.destroy();
  });
  
  test("registered bindings dispatch route keyboard behavior through the production handler", async () => {
    const mounted = await mount(100, 20, controlledSource());
    expect(mounted.modePushes).toContain("pi-lazygit.files");
    const calls: string[] = [];
    const state = {
      focus: "tree", leftMode: "files", treeCollapsed: false, rows: [], selectedIndex: 0,
    };
    const fake = {
      state,
      setViewMode: (mode: string) => calls.push(`mode:${mode}`),
      movePrimarySelection: (delta: number) => calls.push(`move:${delta}`),
      toggleFocus: () => calls.push("focus"),
      resizeTree: (delta: number) => calls.push(`resize:${delta}`),
      toggleLeftMode: () => calls.push("history"),
      focusPreview: () => { state.focus = "preview"; calls.push("preview"); },
      focusTree: () => { state.focus = "tree"; calls.push("tree"); },
      setTreeCollapsed: () => calls.push("collapsed"),
      toggleDiffLayout: () => calls.push("diff"),
      cycleDiffContext: () => calls.push("context"),
      toggleScope: () => calls.push("scope"),
      collapseOrParent: () => calls.push("parent"),
      expandOrChild: () => calls.push("child"),
      openSelection: () => calls.push("open"),
      refresh: () => calls.push("refresh"),
      scrollPreviewHome: () => calls.push("home"),
      scrollPreviewEnd: () => calls.push("end"),
      scrollPreview: () => calls.push("scroll"),
    } as unknown as ReviewController;
    const handler = createFilesRouteKeyHandler({
      getController: () => fake,
      isDisposed: () => false,
      width: () => 100,
      viewportHeight: () => 10,
      clearSelection: () => undefined,
      scrollPreview: () => calls.push("scroll"),
      focusTreeOrClose: () => calls.push("escape"),
    });
    const bindings = createFilesRouteBindings(handler);
    const invoke = (key: string): void => bindings.find(binding => binding.key === key)?.cmd();
    invoke("a"); invoke("down"); invoke("tab"); invoke("]");
    expect(calls).toEqual(["mode:all", "move:1", "focus", "resize:1"]);
    state.leftMode = "log";
    invoke("g"); invoke("up"); invoke("enter");
    expect(calls.slice(-3)).toEqual(["history", "move:-1", "preview"]);
    mounted.setup.renderer.destroy();
  });
  test("cleanup aborts source work and flushes settings", async () => {
    const source = controlledSource();
    const mounted = await mount(100, 20, source);
    const signalCount = source.signals.length;
    mounted.disposeRoot();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(source.signals.some(signal => signal.aborted)).toBe(true);
    expect(source.signals.length).toBe(signalCount);
    expect(mounted.settings.flushed()).toBe(1);
  });
  test("copies preview mouse selections through OSC52 and warns on failure", async () => {
    const mounted = await mount(100, 20, controlledSource());
    await mounted.setup.waitForFrame(frame => frame.includes("const 界 = true;"));
    let copied = "";
    const renderer = mounted.setup.renderer as unknown as { copyToClipboardOSC52: (text: string) => boolean };
    renderer.copyToClipboardOSC52 = text => { copied = text; return true; };
    await mounted.setup.mockMouse.drag(55, 2, 66, 2);
    expect(copied).toContain("const");
    renderer.copyToClipboardOSC52 = () => false;
    await mounted.setup.mockMouse.drag(55, 2, 66, 2);
    expect(mounted.toasts.some(toast => typeof toast === "object" && toast !== null && "message" in toast && toast.message === "Terminal clipboard copy is unavailable.")).toBe(true);
    mounted.setup.renderer.destroy();
  });

  test("production mouse target helper routes divider, tree, and preview panes", () => {
    const state: { focus: "tree" | "preview"; treeRatio: number } = { focus: "tree", treeRatio: 0.3 };
    const routeState = state as unknown as ReviewControllerState;
    const mouse = (x: number) => ({ x, y: 2 } as never);
    expect(filesRouteMouseTarget(mouse(0), routeState, 100)).toBe("tree");
    state.focus = "preview";
    expect(filesRouteMouseTarget(mouse(99), routeState, 100)).toBe("preview");
    const divider = Array.from({ length: 100 }, (_, x) => x).find(x => filesRouteMouseTarget(mouse(x), routeState, 100) === "divider");
    expect(divider).toBeDefined();
  });

});
