/* One file's diff: line numbers on both sides, hunks, colours, optional split view and syntax colours. */
import { html, useMemo } from "../../vendor/preact-htm.js";
import { headerNotes, parseDiff, splitRows } from "../diff.js";
import { formatSize } from "../format.js";
import { highlightLine, languageOf } from "../highlight.js";
import { cn } from "./ui.js";

const MARK = { add: "+", del: "−", ctx: " ", note: "" };

function Code({ text, lang }) {
  const pieces = highlightLine(text, lang);
  return html`${pieces.map(p => (p.kind ? html`<span class=${"tok-" + p.kind}>${p.text}</span>` : p.text))}`;
}

function UnifiedRow({ row, lang }) {
  return html`<div class=${cn("dl", "dl-" + row.type)}>
    <span class="ln" aria-hidden="true">${row.old ?? ""}</span><span class="ln" aria-hidden="true">${row.new ?? ""}</span>
    <span class="dm" aria-hidden="true">${MARK[row.type]}</span>
    <span class="dc">${row.type === "note" ? html`<em>${row.text}</em>` : html`<${Code} text=${row.text} lang=${lang} />`}</span>
  </div>`;
}

function Side({ row, side, lang }) {
  if (!row) return html`<div class="dl dl-empty"><span class="ln"></span><span class="dm"></span><span class="dc"></span></div>`;
  const no = side === "left" ? row.old : row.new;
  return html`<div class=${cn("dl", "dl-" + row.type)}><span class="ln" aria-hidden="true">${no ?? ""}</span><span class="dm" aria-hidden="true">${MARK[row.type]}</span>
    <span class="dc">${row.type === "note" ? html`<em>${row.text}</em>` : html`<${Code} text=${row.text} lang=${lang} />`}</span></div>`;
}

export function DiffView({ diff, loading, error, path, wrap, split }) {
  const parsed = useMemo(() => (diff && diff.text ? parseDiff(diff.text) : null), [diff]);
  const lang = languageOf(path || "");
  if (loading) return html`<div class="diff-msg">Loading the diff…</div>`;
  if (error) return html`<div class="diff-msg bad" role="alert">${error}</div>`;
  if (!diff) return html`<div class="diff-msg">Select a file to see its changes.</div>`;
  if (diff.binary) return html`<div class="diff-msg">Binary file: its content is not shown.</div>`;
  if (diff.note) return html`<div class="diff-msg">${diff.note[0].toUpperCase() + diff.note.slice(1)}.</div>`;
  if (!parsed || !parsed.hunks.length) {
    const notes = parsed ? headerNotes(parsed.header) : [];
    return html`<div class="diff-msg">${notes.length ? notes.join(" · ") + ". " : ""}No line changes to show${diff.size === 0 ? " (empty file)" : ""}.</div>`;
  }
  const notes = headerNotes(parsed.header);
  return html`<div class=${cn("diff", wrap && "wrap", split && "sbs")}>
    ${notes.length ? html`<div class="diff-notes">${notes.join(" · ")}</div>` : null}
    ${diff.truncated ? html`<div class="diff-trunc" role="status">This diff is long: only the first ${parsed.hunks.reduce((n, h) => n + h.rows.length, 0)} lines are shown (${formatSize(diff.size)} read). Use git on the command line for the rest.</div>` : null}
    ${parsed.hunks.map(h => html`<div class="hunk">
      <div class="hunk-head"><code>${(/^@@ [^@]*@@/.exec(h.header) || [h.header])[0]}</code>${h.section ? html` <span class="hunk-sec">${h.section}</span>` : null}</div>
      ${split
        ? splitRows(h.rows).map(pair => html`<div class="dpair"><${Side} row=${pair.left} side="left" lang=${lang} /><${Side} row=${pair.right} side="right" lang=${lang} /></div>`)
        : h.rows.map(row => html`<${UnifiedRow} row=${row} lang=${lang} />`)}
    </div>`)}
  </div>`;
}
