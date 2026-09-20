import {
  DEFAULT_DIFF_CONTEXT,
  DEFAULT_DIFF_LAYOUT,
  DEFAULT_TREE_RATIO,
  isDiffLayout,
  normalizeDiffContext,
  TREE_MAX_RATIO,
  TREE_MIN_RATIO,
  type DiffLayout,
} from "./contracts";
import {
  DEFAULT_HIGHLIGHT_THEME,
  isHighlightThemeName,
  type HighlightThemeName,
} from "./highlight-theme";

/** Panel preferences that outlive a single OMP session. */
export interface PanelSettings {
  readonly treeRatio: number;
  readonly treeCollapsed: boolean;
  readonly highlightTheme: HighlightThemeName;
  readonly diffLayout: DiffLayout;
  readonly diffContext: number;
}

/** Storage for {@link PanelSettings}; each host owns its persistence policy. */
export interface PanelSettingsStore {
  load(): Promise<PanelSettings>;
  saveTreeRatio(ratio: number): void;
  saveTreeCollapsed(collapsed: boolean): void;
  saveHighlightTheme(theme: HighlightThemeName): void;
  saveDiffLayout(layout: DiffLayout): void;
  saveDiffContext(context: number): void;
  flush(): Promise<void>;
}


export const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  treeRatio: DEFAULT_TREE_RATIO,
  treeCollapsed: false,
  highlightTheme: DEFAULT_HIGHLIGHT_THEME,
  diffLayout: DEFAULT_DIFF_LAYOUT,
  diffContext: DEFAULT_DIFF_CONTEXT,
};

/** Clamp a stored or reported ratio into the supported range, or reject it. */
export function clampTreeRatio(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(TREE_MIN_RATIO, Math.min(TREE_MAX_RATIO, value));
}


/**
 * Normalize persisted host settings while preserving each field independently.
 * Unknown or malformed fields use the same defaults as the file-backed store.
 */
export function normalizePanelSettings(value: unknown): PanelSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_PANEL_SETTINGS;
  const candidate = value as {
    treeRatio?: unknown;
    treeCollapsed?: unknown;
    highlightTheme?: unknown;
    diffLayout?: unknown;
    diffContext?: unknown;
  };
  return {
    treeRatio: clampTreeRatio(candidate.treeRatio) ?? DEFAULT_PANEL_SETTINGS.treeRatio,
    treeCollapsed: typeof candidate.treeCollapsed === "boolean"
      ? candidate.treeCollapsed
      : DEFAULT_PANEL_SETTINGS.treeCollapsed,
    highlightTheme: isHighlightThemeName(candidate.highlightTheme)
      ? candidate.highlightTheme
      : DEFAULT_PANEL_SETTINGS.highlightTheme,
    diffLayout: isDiffLayout(candidate.diffLayout)
      ? candidate.diffLayout
      : DEFAULT_PANEL_SETTINGS.diffLayout,
    diffContext: normalizeDiffContext(candidate.diffContext) ?? DEFAULT_PANEL_SETTINGS.diffContext,
  };
}


