/** @jsxImportSource @opentui/solid */

// @ts-expect-error OpenTUI's bundled Solid runtime entrypoint has no standalone declaration.
import { ErrorBoundary } from "solid-js/dist/solid.js";
import { type JSX } from "@opentui/solid";
import type {
  TuiKV,
  TuiPluginApi,
  TuiPluginModule,
  TuiPlugin,
} from "@opencode-ai/plugin/tui";
import type { ReviewSource } from "../contracts";
import {
  clearSessionBaselines,
  createReviewSource,
  prepareSessionBaseline,
} from "../review-source";
import {
  type PanelSettingsStore,
} from "../settings";
import {
  FilesRoute,
  type FilesRouteProps,
} from "./files-route";
import { createOpenCodeSettingsStore } from "./settings";

export const OPEN_CODE_PLUGIN_ID = "pi-lazygit";
export const FILES_ROUTE = "pi-lazygit.files";
export const FILES_COMMAND = "pi-lazygit.files.open";

const FILES_TITLE = "Review project files and changes";
const UNAVAILABLE_MESSAGE = "Files review is unavailable until project paths finish syncing.";

export interface OpenCodePluginDependencies {
  readonly createReviewSource: (cwd: string) => ReviewSource;
  readonly prepareSessionBaseline: (cwd: string) => Promise<void>;
  readonly clearSessionBaselines: () => void;
  readonly createSettingsStore: (kv: TuiKV) => PanelSettingsStore;
  readonly renderFilesRoute: (props: FilesRouteProps) => JSX.Element;
}

const productionDependencies: OpenCodePluginDependencies = {
  createReviewSource,
  prepareSessionBaseline,
  clearSessionBaselines,
  createSettingsStore: createOpenCodeSettingsStore,
  renderFilesRoute: props => <FilesRoute {...props} />,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentDirectory(api: TuiPluginApi): string {
  return api.state.path.directory;
}

function routeErrorElement(message: string, api: TuiPluginApi): JSX.Element {
  try {
    return <text content={message} fg={api.theme.current.error} />;
  } catch {
    return message as unknown as JSX.Element;
  }
}

export function createOpenCodePlugin(
  dependencies: OpenCodePluginDependencies = productionDependencies,
): TuiPluginModule & { id: string } {
  const tui: TuiPlugin = async api => {
    let disposed = false;
    let routeOpened = false;
    let baselinesCleared = false;
    let baselineCwd: string | undefined;
    let baselineAttempt: Promise<void> | undefined;
    const settings = dependencies.createSettingsStore(api.kv);

    const ensureBaseline = (cwd: string): Promise<void> => {
      if (baselineCwd === cwd && baselineAttempt !== undefined) return baselineAttempt;
      baselineCwd = cwd;
      baselineAttempt = Promise.resolve()
        .then(() => dependencies.prepareSessionBaseline(cwd))
        .catch(error => {
          if (!disposed) {
            api.ui.toast({
              variant: "warning",
              message: `Unable to prepare the files review session baseline: ${errorMessage(error)}`,
            });
          }
        });
      return baselineAttempt;
    };
    const openFiles = async (): Promise<void> => {
      if (routeOpened || api.route.current.name === FILES_ROUTE) return;
      const cwd = currentDirectory(api);
      if (!api.state.ready || cwd.trim().length === 0) {
        api.ui.toast({ variant: "warning", message: UNAVAILABLE_MESSAGE });
        return;
      }
      await ensureBaseline(cwd);
      if (!disposed && !routeOpened && api.route.current.name !== FILES_ROUTE) {
        api.route.navigate(FILES_ROUTE);
        routeOpened = true;
      }
    };

    const reportRouteError = (error: unknown): JSX.Element => {
      const message = `Unable to open files review: ${errorMessage(error)}`;
      routeOpened = false;
      if (!disposed) {
        api.ui.toast({ variant: "error", message });
        api.route.navigate("home");
      }
      return routeErrorElement(message, api);
    };

    const renderRoute = (): JSX.Element => {
      const cwd = currentDirectory(api);
      try {
        const route = dependencies.renderFilesRoute({
          api,
          cwd,
          settings,
          createSource: dependencies.createReviewSource,
          onClose: () => {
            routeOpened = false;
            api.route.navigate("home");
          },
        });
        return <ErrorBoundary fallback={(error: unknown) => reportRouteError(error)}>{route}</ErrorBoundary>;
      } catch (error) {
        return reportRouteError(error);
      }
    };


    const unregisterLayer = api.keymap.registerLayer({
      commands: [{
        name: FILES_COMMAND,
        title: FILES_TITLE,
        category: "Plugin",
        namespace: "palette",
        slashName: "files",
        run: openFiles,
      }],
      bindings: [{ key: "alt+q", cmd: FILES_COMMAND, desc: FILES_TITLE }],
    });
    const unregisterRoute = api.route.register([{ name: FILES_ROUTE, render: renderRoute }]);
    api.lifecycle.onDispose(async () => {
      if (disposed) return;
      disposed = true;
      unregisterLayer();
      unregisterRoute();
      await settings.flush();
      if (!baselinesCleared) {
        baselinesCleared = true;
        dependencies.clearSessionBaselines();
      }
    });

    const cwd = currentDirectory(api);
    if (api.state.ready && cwd.trim().length > 0) void ensureBaseline(cwd);
  };

  return { id: OPEN_CODE_PLUGIN_ID, tui };
}

const productionPlugin = createOpenCodePlugin();
export default productionPlugin;
