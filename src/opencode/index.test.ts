import { describe, expect, test } from "bun:test";
import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { ReviewSource } from "../contracts";
import { DEFAULT_PANEL_SETTINGS, type PanelSettingsStore } from "../settings";
import productionPlugin, {
  FILES_COMMAND,
  FILES_ROUTE,
  OPEN_CODE_PLUGIN_ID,
  createOpenCodePlugin,
  type OpenCodePluginDependencies,
} from "./index";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function settingsStore() {
  let flushes = 0;
  const store: PanelSettingsStore & { readonly flushes: () => number } = {
    load: async () => DEFAULT_PANEL_SETTINGS,
    saveTreeRatio: () => undefined,
    saveTreeCollapsed: () => undefined,
    saveHighlightTheme: () => undefined,
    saveDiffLayout: () => undefined,
    saveDiffContext: () => undefined,
    flush: async () => { flushes += 1; },
    flushes: () => flushes,
  };
  return store;
}

function api(directory = "/workspace") {
  const layers: unknown[] = [];
  const routes: unknown[] = [];
  const navigations: Array<{ name: string; params?: Record<string, unknown> }> = [];
  const toasts: unknown[] = [];
  const disposers: Array<() => void | Promise<void>> = [];
  const value = {
    layers,
    routes,
    navigations,
    toasts,
    disposers,
    api: {
      state: { ready: true, path: { directory } },
      kv: { ready: true, get: <T>(_key: string, fallback?: T) => fallback as T, set: () => undefined },
      keymap: { registerLayer: (layer: unknown) => { layers.push(layer); return () => undefined; } },
      route: {
        current: { name: "home" },
        register: (definitions: unknown[]) => { routes.push(...definitions); return () => undefined; },
        navigate: (name: string, params?: Record<string, unknown>) => {
          navigations.push({ name, ...(params === undefined ? {} : { params }) });
          (value.api.route.current as { name: string }).name = name;
        },
      },
      theme: { current: { error: "error" } },
      ui: { toast: (toast: unknown) => { toasts.push(toast); } },
      lifecycle: { onDispose: (dispose: () => void | Promise<void>) => { disposers.push(dispose); return () => undefined; } },
    } as unknown as TuiPluginApi,
  };
  return value;
}

function dependencies(overrides: Partial<OpenCodePluginDependencies> = {}) {
  const settings = settingsStore();
  const source = {} as ReviewSource;
  const calls: string[] = [];
  const value: OpenCodePluginDependencies = {
    createReviewSource: cwd => { calls.push(`source:${cwd}`); return source; },
    prepareSessionBaseline: async cwd => { calls.push(`baseline:${cwd}`); },
    clearSessionBaselines: () => { calls.push("clear"); },
    createSettingsStore: () => settings,
    renderFilesRoute: () => "route" as never,
    ...overrides,
  };
  return { value, settings, calls };
}

async function activate(apiValue: TuiPluginApi, deps: OpenCodePluginDependencies) {
  const module = createOpenCodePlugin(deps);
  await module.tui(apiValue, undefined, {} as never);
  return module;
}


describe("OpenCode TUI plugin", () => {
  test("exports a production TUI module with the stable plugin id", () => {
    expect(productionPlugin.id).toBe(OPEN_CODE_PLUGIN_ID);
    expect(typeof productionPlugin.tui).toBe("function");
  });

  test("exports host identity and one palette command with a shared Alt+Q binding", async () => {
    const host = api();
    const setup = dependencies();
    await activate(host.api, setup.value);
    expect(OPEN_CODE_PLUGIN_ID).toBe("pi-lazygit");
    expect(host.layers).toHaveLength(1);
    const layer = host.layers[0] as { commands: Array<Record<string, unknown>>; bindings: Array<Record<string, unknown>> };
    expect(layer.commands).toEqual([expect.objectContaining({ name: FILES_COMMAND, title: "Review project files and changes", category: "Plugin", namespace: "palette", slashName: "files" })]);
    expect(layer.bindings).toEqual([{ key: "alt+q", cmd: FILES_COMMAND, desc: "Review project files and changes" }]);
    expect(host.routes).toEqual([expect.objectContaining({ name: FILES_ROUTE })]);
  });

  test("warns and does not navigate while project paths are unavailable", async () => {
    const host = api("");
    (host.api.state as { ready: boolean }).ready = false;
    const setup = dependencies();
    await activate(host.api, setup.value);
    const command = (host.layers[0] as { commands: Array<{ run: () => Promise<void> }> }).commands[0];
    await command.run();
    expect(host.toasts).toEqual([{ variant: "warning", message: "Files review is unavailable until project paths finish syncing." }]);
    expect(host.navigations).toEqual([]);
  });

  test("memoizes activation and first-navigation baseline, then navigates after success", async () => {
    const host = api("/workspace");
    const baseline = deferred<void>();
    let attempts = 0;
    const setup = dependencies({ prepareSessionBaseline: async cwd => { attempts += 1; setup.calls.push(`baseline:${cwd}`); await baseline.promise; } });
    await activate(host.api, setup.value);
    const command = (host.layers[0] as { commands: Array<{ run: () => Promise<void> }> }).commands[0];
    const opening = command.run();
    await Promise.resolve();
    expect(attempts).toBe(1);
    expect(host.navigations).toEqual([]);
    baseline.resolve();
    await opening;
    expect(host.navigations).toEqual([{ name: FILES_ROUTE }]);
    expect(attempts).toBe(1);
    await command.run();
    expect(host.navigations).toHaveLength(1);
  });

  test("warns baseline failure and still opens the route", async () => {
    const host = api();
    const setup = dependencies({ prepareSessionBaseline: async () => { throw new Error("Git unavailable"); } });
    await activate(host.api, setup.value);
    const command = (host.layers[0] as { commands: Array<{ run: () => Promise<void> }> }).commands[0];
    await command.run();
    expect(host.toasts).toEqual([{ variant: "warning", message: "Unable to prepare the files review session baseline: Git unavailable" }]);
    expect(host.navigations).toEqual([{ name: FILES_ROUTE }]);
  });

  test("route render passes current cwd and production dependencies", async () => {
    const host = api("/first");
    let props: Record<string, unknown> | undefined;
    const setup = dependencies({ renderFilesRoute: next => { props = next as unknown as Record<string, unknown>; return "route" as never; } });
    await activate(host.api, setup.value);
    const route = host.routes[0] as { render: () => unknown };
    expect(route.render()).toBeTruthy();
    expect(props).toEqual(expect.objectContaining({ api: host.api, cwd: "/first", settings: setup.settings }));
    expect(setup.calls).toEqual(["baseline:/first"]);
    (props?.createSource as (cwd: string) => ReviewSource)("/first");
    expect(setup.calls).toContain("source:/first");
  });

  test("recovers route construction errors by showing an error and returning home", async () => {
    const host = api();
    const setup = dependencies({ renderFilesRoute: () => { throw new Error("render failed"); } });
    await activate(host.api, setup.value);
    const route = host.routes[0] as { render: () => unknown };
    expect(route.render()).toBeTruthy();
    expect(host.navigations).toEqual([{ name: "home" }]);
    expect(host.toasts).toEqual([{ variant: "error", message: "Unable to open files review: render failed" }]);
  });

  test("flushes settings and clears baselines exactly once on lifecycle disposal", async () => {
    const host = api();
    const setup = dependencies();
    await activate(host.api, setup.value);
    expect(host.disposers).toHaveLength(1);
    await host.disposers[0]!();
    await host.disposers[0]!();
    expect(setup.settings.flushes()).toBe(1);
    expect(setup.calls.filter(call => call === "clear")).toHaveLength(1);
  });
});
