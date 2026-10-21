/* The theme button: system → light → dark. A small icon, with the state in its label. */
import { html, useState } from "../../vendor/preact-htm.js";
import { applyTheme, nextTheme, readTheme } from "../theme.js";
import { Button } from "./ui.js";

const Icon = ({ children }) => html`<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
const ICONS = {
  system: html`<${Icon}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><//>`,
  light: html`<${Icon}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /><//>`,
  dark: html`<${Icon}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /><//>`,
};

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => readTheme(localStorage));
  const change = () => { const next = nextTheme(theme); applyTheme(next, document.documentElement, localStorage); setTheme(next); };
  const label = "Theme: " + theme + (theme === "system" ? " (follows your system)" : "") + ". Click for " + nextTheme(theme) + ".";
  return html`<${Button} variant="ghost" size="icon" onClick=${change} aria-label=${label} title=${label} class="theme-btn">${ICONS[theme]}<//>`;
}
