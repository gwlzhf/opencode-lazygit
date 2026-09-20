import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as nodePath from "node:path";
import { isDiffLayout, normalizeDiffContext, type DiffLayout } from "./contracts";
import {
  isHighlightThemeName,
  type HighlightThemeName,
} from "./highlight-theme";
import {
  clampTreeRatio,
  DEFAULT_PANEL_SETTINGS,
  normalizePanelSettings,
  type PanelSettings,
  type PanelSettingsStore,
} from "./settings";

const SETTINGS_FILE = "pi-lazygit.json";
const WRITE_DELAY_MS = 400;

async function settingsPath(): Promise<string> {
  // Imported lazily: only the Pi persistence path needs the coding-agent host.
  const { getAgentDir } = await import("@oh-my-pi/pi-coding-agent");
  return nodePath.join(getAgentDir(), SETTINGS_FILE);
}

/**
 * Panel settings persisted as JSON under the OMP agent directory. Every read
 * and write failure degrades to the defaults: the panel is a review tool and
 * must open even when its preferences file is missing or corrupt.
 */
export function createPanelSettingsStore(
  resolvePath: () => Promise<string> = settingsPath,
): PanelSettingsStore {
  let current: PanelSettings = DEFAULT_PANEL_SETTINGS;
  let dirty = false;
  let writeChain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const write = async (value: PanelSettings): Promise<void> => {
    try {
      const file = await resolvePath();
      await mkdir(nodePath.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(value, undefined, 2)}\n`, "utf8");
    } catch {
      // Preferences are best-effort; a read-only or unwritable config dir is
      // not worth interrupting a review session for.
    }
  };

  const writeNow = (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!dirty) return writeChain;

    const value = current;
    dirty = false;
    writeChain = writeChain.then(() => write(value));
    return writeChain;
  };

  const scheduleWrite = (): void => {
    dirty = true;
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void writeNow();
    }, WRITE_DELAY_MS);
    timer.unref?.();
  };

  return {
    async load(): Promise<PanelSettings> {
      try {
        current = normalizePanelSettings(JSON.parse(await readFile(await resolvePath(), "utf8")));
        return current;
      } catch {
        current = DEFAULT_PANEL_SETTINGS;
        return current;
      }
    },

    saveTreeRatio(ratio: number): void {
      const clamped = clampTreeRatio(ratio);
      if (clamped === undefined) return;
      current = { ...current, treeRatio: clamped };
      scheduleWrite();
    },

    saveTreeCollapsed(collapsed: boolean): void {
      if (typeof collapsed !== "boolean") return;
      current = { ...current, treeCollapsed: collapsed };
      scheduleWrite();
    },

    saveHighlightTheme(theme: HighlightThemeName): void {
      if (!isHighlightThemeName(theme)) return;
      current = { ...current, highlightTheme: theme };
      scheduleWrite();
    },

    saveDiffLayout(layout: DiffLayout): void {
      if (!isDiffLayout(layout)) return;
      current = { ...current, diffLayout: layout };
      scheduleWrite();
    },

    saveDiffContext(context: number): void {
      const normalized = normalizeDiffContext(context);
      if (normalized === undefined) return;
      current = { ...current, diffContext: normalized };
      scheduleWrite();
    },

    async flush(): Promise<void> {
      do {
        await writeNow();
      } while (dirty);
    },
  };
}
