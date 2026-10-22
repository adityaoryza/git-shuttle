import { ratio } from "../lib/checks.mjs";

// The list that a select opens is drawn by the browser from the colours of its options: they must be readable, in both themes.
async function optionColours(page) {
  return page.evaluate(() => [...document.querySelectorAll("select")].filter(s => s.offsetParent).map(s => {
    const o = s.querySelector("option");
    const style = getComputedStyle(o);
    return { label: (s.getAttribute("aria-label") || s.closest("label")?.innerText || s.className).slice(0, 40), fg: style.color, bg: style.backgroundColor, scheme: getComputedStyle(s).colorScheme };
  }));
}

export const scenarios = {
  async "selects: the options are readable and the select is in the theme of the page"(t) {
    t.demo.git(["stash", "-u", "-q"]);
    for (const scheme of ["dark", "light"]) {
      const page = await t.page({ colorScheme: scheme });
      const screens = [
        async () => {},
        async () => { await page.getByRole("button", { name: "Settings" }).click(); await page.getByRole("dialog", { name: /Settings/ }).waitFor(); },
        async () => { await page.waitForTimeout(150); await page.keyboard.press("Escape"); await page.getByRole("tab", { name: "Release" }).click(); await page.locator(".release-groups .group").first().waitFor(); await page.locator(".release details.advanced summary").click(); },
      ];
      let seen = 0;
      for (const go of screens) {
        await go();
        for (const found of await optionColours(page)) {
          seen++;
          const transparent = /rgba\(0, 0, 0, 0\)|transparent/.test(found.bg);
          t.ok(`${scheme}: ${found.label}: the options have a background of their own`, !transparent, found.bg);
          t.ok(`${scheme}: ${found.label}: the options are readable (>= 4.5:1)`, !transparent && ratio(found.fg, found.bg) >= 4.5, `${found.fg} on ${found.bg}`);
          t.ok(`${scheme}: ${found.label}: the select is drawn in the ${scheme} theme`, found.scheme.includes(scheme), found.scheme);
        }
      }
      t.ok(`${scheme}: there were selects to look at`, seen >= 3, seen);
    }
  },
};
