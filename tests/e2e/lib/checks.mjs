/* Checks that apply to every screen: colour contrast, horizontal overflow, page errors. */

const lum = rgb => {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// Text that is visible and has less than `min` contrast with its background.
export async function lowContrast(page, min = 4.5) {
  const found = await page.evaluate(() => {
    const out = [];
    // color-mix() comes back as color(srgb 0.9 0.9 0.9 / 0.5): the numbers are 0 to 1, not 0 to 255
    const parse = c => { const m = c.match(/[\d.]+/g).map(Number); const k = c.startsWith("color(") ? 255 : 1; return { r: m[0] * k, g: m[1] * k, b: m[2] * k, a: m.length > 3 ? m[3] : 1 }; };
    // the colour behind an element: translucent layers are blended over what is behind them
    const background = el => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      }
      let base = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
      while (layers.length) { const top = layers.pop(); base = { r: top.r * top.a + base.r * (1 - top.a), g: top.g * top.a + base.g * (1 - top.a), b: top.b * top.a + base.b * (1 - top.a), a: 1 }; }
      return "rgb(" + Math.round(base.r) + ", " + Math.round(base.g) + ", " + Math.round(base.b) + ")";
    };
    for (const el of document.querySelectorAll("button, .badge, .ref, .hint, .meta, .msg, label, strong, a, input, select, .section, .lead, .toast-title, .toast-detail, .toast-action")) {
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      const text = (el.textContent || el.placeholder || "").trim();
      if (!text || el.disabled) continue;
      out.push({ text: text.slice(0, 30), fg: getComputedStyle(el).color, bg: background(el), cls: String(el.className).slice(0, 40) });
    }
    return out;
  });
  return found.map(x => ({ ...x, ratio: ratio(x.fg, x.bg) })).filter(x => x.ratio < min);
}

export const overflowsHorizontally = page => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

export function collectErrors(page) {
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  return errors;
}
