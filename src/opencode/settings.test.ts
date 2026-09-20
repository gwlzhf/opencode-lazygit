import { describe, expect, test } from "bun:test";
import { DEFAULT_PANEL_SETTINGS, normalizePanelSettings } from "../settings";
import { createOpenCodeSettingsStore, OPEN_CODE_SETTINGS_KEY } from "./settings";

function kv(initial: unknown = DEFAULT_PANEL_SETTINGS) {
  let value = initial;
  const writes: Array<{ key: string; value: unknown }> = [];
  return {
    ready: true,
    writes,
    get<T>(key: string, fallback?: T): T {
      expect(key).toBe(OPEN_CODE_SETTINGS_KEY);
      return (value === undefined ? fallback : value) as T;
    },
    set(key: string, next: unknown): void {
      writes.push({ key, value: next });
      value = next;
    },
  };
}

describe("OpenCode panel settings", () => {
  test("normalizes the KV value and preserves independent defaults", async () => {
    const storage = kv({ treeRatio: 0.8, treeCollapsed: true, highlightTheme: "nord", diffLayout: "split", diffContext: 25 });
    const store = createOpenCodeSettingsStore(storage);
    expect(await store.load()).toEqual({
      ...DEFAULT_PANEL_SETTINGS,
      treeRatio: 0.3,
      treeCollapsed: true,
      highlightTheme: "nord",
      diffLayout: "split",
      diffContext: 25,
    });
  });

  test("writes one complete replacement immediately for each preference", async () => {
    const storage = kv();
    const store = createOpenCodeSettingsStore(storage);
    await store.load();
    store.saveTreeRatio(0.2);
    store.saveTreeCollapsed(true);
    store.saveHighlightTheme("nord");
    store.saveDiffLayout("split");
    store.saveDiffContext(10);
    expect(storage.writes).toEqual([
      { key: OPEN_CODE_SETTINGS_KEY, value: { ...DEFAULT_PANEL_SETTINGS, treeRatio: 0.2 } },
      { key: OPEN_CODE_SETTINGS_KEY, value: { ...DEFAULT_PANEL_SETTINGS, treeRatio: 0.2, treeCollapsed: true } },
      { key: OPEN_CODE_SETTINGS_KEY, value: { ...DEFAULT_PANEL_SETTINGS, treeRatio: 0.2, treeCollapsed: true, highlightTheme: "nord" } },
      { key: OPEN_CODE_SETTINGS_KEY, value: { ...DEFAULT_PANEL_SETTINGS, treeRatio: 0.2, treeCollapsed: true, highlightTheme: "nord", diffLayout: "split" } },
      { key: OPEN_CODE_SETTINGS_KEY, value: { ...DEFAULT_PANEL_SETTINGS, treeRatio: 0.2, treeCollapsed: true, highlightTheme: "nord", diffLayout: "split", diffContext: 10 } },
    ]);
    await expect(store.flush()).resolves.toBeUndefined();
  });

  test("normalizer returns defaults for non-settings values", () => {
    expect(normalizePanelSettings(null)).toEqual(DEFAULT_PANEL_SETTINGS);
    expect(normalizePanelSettings({ treeRatio: "wide", treeCollapsed: "yes", highlightTheme: "bad", diffLayout: "columns", diffContext: 7 })).toEqual(DEFAULT_PANEL_SETTINGS);
  });
});

