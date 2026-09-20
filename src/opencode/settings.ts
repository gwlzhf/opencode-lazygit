import type { TuiKV } from "@opencode-ai/plugin/tui";
import {
  clampTreeRatio,
  DEFAULT_PANEL_SETTINGS,
  normalizePanelSettings,
  type PanelSettings,
  type PanelSettingsStore,
} from "../settings";
import {
  isDiffLayout,
  normalizeDiffContext,
  type DiffLayout,
} from "../contracts";
import { isHighlightThemeName, type HighlightThemeName } from "../highlight-theme";

export const OPEN_CODE_SETTINGS_KEY = "pi-lazygit.panel-settings";

/**
 * Store panel preferences in OpenCode's host-owned KV namespace.
 * Writes replace the complete normalized object so Pi and OpenCode schemas
 * remain interoperable even though their physical stores are separate.
 */
export function createOpenCodeSettingsStore(kv: TuiKV): PanelSettingsStore {
  let current: PanelSettings = DEFAULT_PANEL_SETTINGS;

  const save = (next: PanelSettings): void => {
    current = next;
    kv.set(OPEN_CODE_SETTINGS_KEY, current);
  };

  return {
    async load(): Promise<PanelSettings> {
      current = normalizePanelSettings(kv.get(OPEN_CODE_SETTINGS_KEY, DEFAULT_PANEL_SETTINGS));
      return current;
    },

    saveTreeRatio(ratio: number): void {
      const normalized = clampTreeRatio(ratio);
      if (normalized === undefined) return;
      save({ ...current, treeRatio: normalized });
    },

    saveTreeCollapsed(collapsed: boolean): void {
      if (typeof collapsed !== "boolean") return;
      save({ ...current, treeCollapsed: collapsed });
    },

    saveHighlightTheme(theme: HighlightThemeName): void {
      if (!isHighlightThemeName(theme)) return;
      save({ ...current, highlightTheme: theme });
    },

    saveDiffLayout(layout: DiffLayout): void {
      if (!isDiffLayout(layout)) return;
      save({ ...current, diffLayout: layout });
    },

    saveDiffContext(context: number): void {
      const normalized = normalizeDiffContext(context);
      if (normalized === undefined) return;
      save({ ...current, diffContext: normalized });
    },

    async flush(): Promise<void> {
      return Promise.resolve();
    },
  };
}
