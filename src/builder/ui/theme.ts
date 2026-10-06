/* ---------------------------------------------------------------------
   ONE SWITCH, ONE WORLD.

   Day/night is a single fact about the document, held on <html data-theme>.
   Two controls write it — the header toggle on the document pages and the
   NIGHT button in the story HUD — and both read the same value back, so the
   world never disagrees with itself: flipping the sky over the meadow also
   turns the paper to charcoal, and returning to a document page finds it
   already dark.

   The attribute is authoritative rather than React state because it must be
   correct BEFORE React exists — see the inline script in layout.tsx, which
   sets it during head parse to kill the white flash on a dark-mode reload.

   Storage failures are swallowed on purpose: private-mode Safari throws on
   localStorage.setItem, and a themed page that throws is worse than a page
   that forgets your preference.
--------------------------------------------------------------------- */

export type Theme = "light" | "dark";

export const THEME_KEY = "aura-theme";
export const THEME_EVENT = "aura-theme-change";

/** The theme currently painted, straight off the element. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Paint a theme and remember it. Safe to call with the value already set. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — preference is not persisted, page still works */
  }
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

/** Subscribe to changes from any control. Returns an unsubscribe. */
export function onThemeChange(fn: (t: Theme) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<Theme>).detail);
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
}

/** The exact source the inline no-flash script runs. Kept here so the
 *  resolution order lives in one file: explicit choice → OS preference. */
export const NO_FLASH_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_KEY}');var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;
