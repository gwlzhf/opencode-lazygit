/** Host-neutral syntax palette names persisted by both panel hosts. */
export const HIGHLIGHT_THEMES = [
  { name: "pi", label: "Pi", ompName: undefined },
  { name: "catppuccin", label: "Catppuccin", ompName: "dark-catppuccin" },
  { name: "nord", label: "Nord", ompName: "dark-nord" },
  { name: "tokyo-night", label: "Tokyo Night", ompName: "dark-tokyo-night" },
] as const;

export type HighlightThemeName = (typeof HIGHLIGHT_THEMES)[number]["name"];

export const DEFAULT_HIGHLIGHT_THEME: HighlightThemeName = "pi";

export function getHighlightThemeLabel(name: HighlightThemeName): string {
  return HIGHLIGHT_THEMES.find(theme => theme.name === name)?.label ?? name;
}

export function isHighlightThemeName(value: unknown): value is HighlightThemeName {
  return HIGHLIGHT_THEMES.some(theme => theme.name === value);
}
