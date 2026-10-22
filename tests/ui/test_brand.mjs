import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_URLS, AUTHOR, AUTHOR_SHORT, EXTERNAL, LINKS, PRODUCT, PROJECT_LINKS, TAGLINE, versionLine } from "../../ui/shuttle_ui/static/js/brand.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log("  ✔ " + name); };
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, "..", "..", "ui", "shuttle_ui", "static");

t("the author's links are exactly the three published ones", () => {
  assert.deepStrictEqual(Object.values(LINKS).map(l => [l.label, l.href]), [
    ["Website", "https://adityaoryza.my.id/en"],
    ["GitHub", "https://github.com/adityaoryza"],
    ["LinkedIn", "https://linkedin.com/in/adityaoryza"],
  ]);
  assert.strictEqual(AUTHOR, "Aditya Oryza Mahendra");
  assert.strictEqual(AUTHOR_SHORT, "Aditya Oryza");
});
t("the project links point at the repository", () => {
  for (const link of PROJECT_LINKS) assert.match(link.href, /^https:\/\/github\.com\/adityaoryza\/git-shuttle(\/|$)/, link.label);
  assert.deepStrictEqual(PROJECT_LINKS.map(l => l.label), ["Source code", "Report an issue", "License (MIT)", "Third-party notices"]);
});
t("links open in a new tab without opener or referrer", () => {
  assert.strictEqual(EXTERNAL.target, "_blank");
  assert.deepStrictEqual(EXTERNAL.rel.split(" ").sort(), ["noopener", "noreferrer"]);
});
t("every link is https and unique", () => {
  assert.ok(ALLOWED_URLS.every(u => u.startsWith("https://")));
  assert.strictEqual(new Set(ALLOWED_URLS).size, ALLOWED_URLS.length);
});
t("versionLine: the version when the server has said it, the name before", () => {
  assert.strictEqual(versionLine("0.1.2"), "git-shuttle 0.1.2");
  assert.strictEqual(versionLine(""), "git-shuttle");
  assert.strictEqual(versionLine(undefined), PRODUCT);
});
t("a tagline without hype", () => {
  assert.ok(TAGLINE.length < 90 && !/!|powerful|seamless|robust/i.test(TAGLINE));
});

// The page must not reach for the internet: every address in its own sources is one of the allowed links (or an XML namespace).
function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "vendor") sources(full, out); }
    else if (/\.(js|css|html|svg)$/.test(entry.name)) out.push(full);
  }
  return out;
}
t("no address outside the allowed links appears in the page sources", () => {
  const allowed = new Set(ALLOWED_URLS);
  const stray = [];
  for (const file of sources(staticDir)) {
    for (const url of fs.readFileSync(file, "utf8").match(/https?:\/\/[^\s"'`)<>]+/g) || []) {
      if (url === "http://www.w3.org/2000/svg" || allowed.has(url.replace(/[.,;]+$/, ""))) continue;
      stray.push(path.relative(staticDir, file) + " " + url);
    }
  }
  assert.deepStrictEqual(stray, []);
});
t("every brand image has an accessible name", () => {
  for (const file of fs.readdirSync(path.join(staticDir, "brand")).filter(f => f.endsWith(".svg"))) {
    const text = fs.readFileSync(path.join(staticDir, "brand", file), "utf8");
    assert.match(text, /<title>[^<]+<\/title>|aria-label="[^"]+"/, file);
  }
});
t("the brand image the page uses exists", () => {
  assert.ok(fs.existsSync(path.join(staticDir, "brand", "mark.svg")));
});
console.log("  " + n + " passed, 0 failed");
