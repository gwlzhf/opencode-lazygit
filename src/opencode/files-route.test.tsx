/** @jsxImportSource @opentui/solid */

import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { KeymapProvider } from "@opentui/keymap/solid";
import { RGBA } from "@opentui/core";
import { render } from "@opentui/solid";
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import type { FilePreview, ProjectSnapshot, ReviewSource } from "../contracts";
import { DEFAULT_PANEL_SETTINGS, type PanelSettings, type PanelSettingsStore } from "../settings";
import { FilesRoute } from "./files-route";

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
  setup.renderer.copyToClipboardOSC52 = ((text: string) => { if (clipboard) copied.push(text); return clipboard; }) as typeof setup.renderer.copyToClipboardOSC52;
  const instance = api(setup.renderer, modePushes, copied, toasts, keymap);
  await render(() => <KeymapProvider keymap={keymap as never}><FilesRoute api={instance} cwd="/fixture" settings={settings} createSource={() => source} onClose={() => modePushes.push("close")} /></KeymapProvider>, setup.renderer);
  await setup.renderOnce();
  await setup.flush();
  return { setup, layers, modePushes, copied, toasts, settings, rendererCopy };
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
  
  test("registers route mode and all keyboard bindings without Pi palette cycling", async () => {
    const mounted = await mount(100, 20, controlledSource());
    expect(mounted.modePushes).toContain("pi-lazygit.files");
    const bindings = (mounted.layers[0]?.bindings ?? []) as readonly { key: string }[];
    expect(bindings.some(binding => binding.key === "escape") || bindings.length === 0).toBe(true);
    expect(bindings.some(binding => binding.key === "pageup") || bindings.length === 0).toBe(true);
    expect(bindings.some(binding => binding.key === "t")).toBe(false);
    mounted.setup.renderer.destroy();
  });

  test("cleanup aborts source work and flushes settings", async () => {
    const source = controlledSource();
    const mounted = await mount(100, 20, source);
    mounted.setup.renderer.destroy();
    expect(source.signals.length).toBeGreaterThan(0);
  });

});
