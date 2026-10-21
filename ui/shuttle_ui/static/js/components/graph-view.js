/* The commit graph: one row per commit, lanes drawn as SVG, branch and tag labels beside the message. */
import { html, useMemo } from "../../vendor/preact-htm.js";
import { layout, parseRefs, relativeTime } from "../graph.js";
import { shortHash } from "../logic.js";

const ROW = 30, COL = 14, PAD = 12, RADIUS = 4.5;
const COLORS = ["#60a5fa", "#4ade80", "#f472b6", "#fbbf24", "#a78bfa", "#2dd4bf", "#fb923c", "#f87171"];
const colorOf = col => COLORS[col % COLORS.length];
const x = col => PAD + col * COL;

function Lanes({ row, width, head }) {
  const mid = ROW / 2;
  const lines = [];
  row.above.forEach((sha, c) => {
    if (sha !== null && sha !== row.sha && row.below[c] === sha) lines.push({ d: `M${x(c)} 0 V${ROW}`, color: colorOf(c) });
  });
  row.joins.forEach(c => lines.push({ d: c === row.col ? `M${x(c)} 0 V${mid}` : `M${x(c)} 0 C${x(c)} ${mid * 0.8} ${x(row.col)} ${mid * 0.2} ${x(row.col)} ${mid}`, color: colorOf(c) }));
  row.forks.forEach(f => lines.push({ d: f === row.col ? `M${x(row.col)} ${mid} V${ROW}` : `M${x(row.col)} ${mid} C${x(row.col)} ${mid + mid * 0.8} ${x(f)} ${mid + mid * 0.2} ${x(f)} ${ROW}`, color: colorOf(f) }));
  return html`<svg class="lanes" width=${PAD * 2 + width * COL} height=${ROW} aria-hidden="true">
    ${lines.map(l => html`<path d=${l.d} stroke=${l.color} stroke-width="2" fill="none" stroke-linecap="round" />`)}
    ${head ? html`<circle cx=${x(row.col)} cy=${mid} r=${RADIUS + 3} fill="none" stroke=${colorOf(row.col)} stroke-width="1.5" />` : null}
    <circle cx=${x(row.col)} cy=${mid} r=${RADIUS} fill=${row.parents > 1 ? "var(--background)" : colorOf(row.col)} stroke=${colorOf(row.col)} stroke-width="2" />
  </svg>`;
}

function Ref({ r }) {
  return html`<span class=${"ref ref-" + r.kind + (r.current ? " ref-current" : "")} title=${r.name}>${r.name}</span>`;
}

export function GraphView({ graph, changes, branch, loading }) {
  const data = useMemo(() => {
    const commits = (graph && graph.commits) || [];
    const { rows, width } = layout(commits);
    return { commits, rows, width };
  }, [graph]);
  const remotes = (graph && graph.remotes) || [];

  if (!graph && loading) return html`<div class="empty">Loading…</div>`;
  if (!data.commits.length) return html`<div class="empty">This repository has no commits yet.</div>`;
  return html`<div class="graph" role="list">
    ${changes > 0 ? html`<div class="row row-wip" role="listitem">
      <svg class="lanes" width=${PAD * 2 + data.width * COL} height=${ROW} aria-hidden="true"><circle cx=${x(0)} cy=${ROW / 2} r=${RADIUS} fill="none" stroke="var(--muted-foreground)" stroke-dasharray="2 2" stroke-width="2" /></svg>
      <span class="subject"><span class="ref ref-wip">working tree</span> ${changes} changed ${changes === 1 ? "file" : "files"}</span>
    </div>` : null}
    ${data.commits.map((c, i) => {
      const row = { ...data.rows[i], parents: c.parents.length };
      const refs = parseRefs(c.refs, remotes);
      const head = refs.some(r => r.current);
      return html`<div class=${"row" + (head ? " row-head" : "")} role="listitem" key=${c.sha}>
        <${Lanes} row=${row} width=${data.width} head=${head} />
        <span class="subject">${refs.map(r => html`<${Ref} r=${r} />`)}<span class="msg" title=${c.subject}>${c.subject}</span></span>
        <span class="meta">${c.author} · ${relativeTime(c.time)} · <code>${shortHash(c.sha)}</code></span>
      </div>`;
    })}
  </div>`;
}
