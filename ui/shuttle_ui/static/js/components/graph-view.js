/* The commit graph as a table: branch and tag labels, the lanes, the message, author, date and commit id, each in a column that can be
 * resized, moved, hidden and sorted (components/table.js). The lanes are SVG per row; they line up because every row is the same height. */
import { html, useMemo } from "../../vendor/preact-htm.js";
import { absoluteTime, graphRows, hueOf, initials, isoTime, relativeTime } from "../graph.js";
import { shortHash } from "../logic.js";
import { ExternalLink } from "./links.js";
import { ResizableTable } from "./table.js";
import { Skeleton } from "./ui.js";

const ROW = 30, COL = 14, PAD = 12, RADIUS = 4.5;
const COLORS = ["#60a5fa", "#4ade80", "#f472b6", "#fbbf24", "#a78bfa", "#2dd4bf", "#fb923c", "#f87171"];
const colorOf = col => COLORS[col % COLORS.length];
const x = col => PAD + col * COL;

function Lanes({ row, width, head, flat }) {
  const mid = ROW / 2;
  const lines = [];
  if (!flat) {     // sorted by something else than the history: the lines would lie, only the dot is drawn
    row.above.forEach((sha, c) => {
      if (sha !== null && sha !== row.sha && row.below[c] === sha) lines.push({ d: `M${x(c)} 0 V${ROW}`, color: colorOf(c) });
    });
    row.joins.forEach(c => lines.push({ d: c === row.col ? `M${x(c)} 0 V${mid}` : `M${x(c)} 0 C${x(c)} ${mid * 0.8} ${x(row.col)} ${mid * 0.2} ${x(row.col)} ${mid}`, color: colorOf(c) }));
    row.forks.forEach(f => lines.push({ d: f === row.col ? `M${x(row.col)} ${mid} V${ROW}` : `M${x(row.col)} ${mid} C${x(row.col)} ${mid + mid * 0.8} ${x(f)} ${mid + mid * 0.2} ${x(f)} ${ROW}`, color: colorOf(f) }));
  }
  const cx = flat ? PAD : x(row.col);
  return html`<svg class="lanes" width=${PAD * 2 + width * COL} height=${ROW} aria-hidden="true">
    ${lines.map(l => html`<path d=${l.d} stroke=${l.color} stroke-width="2" fill="none" stroke-linecap="round" />`)}
    ${head ? html`<circle cx=${cx} cy=${mid} r=${RADIUS + 3} fill="none" stroke=${colorOf(flat ? 0 : row.col)} stroke-width="1.5" />` : null}
    <circle cx=${cx} cy=${mid} r=${RADIUS} fill=${row.parents > 1 ? "var(--background)" : colorOf(flat ? 0 : row.col)} stroke=${colorOf(flat ? 0 : row.col)} stroke-width="2" />
  </svg>`;
}

// the number of a task: the title when the pointer is on it, and a click opens the task itself (a new tab) when the add-on gave its address
export const TaskBadge = ({ id, title, link }) => {
  const web = /^https?:\/\//.test(link || "");
  const tip = "Task #" + id + (title ? ": " + title : "") + (web ? "\nClick to open the task" : "");
  return web
    ? html`<${ExternalLink} href=${link} class="task-badge task-badge-link" title=${tip} onClick=${e => e.stopPropagation()} onDblClick=${e => e.stopPropagation()}>#${id}<//>`
    : html`<span class="task-badge" title=${tip}>#${id}</span>`;
};
const Ref = ({ r, task }) => html`<span class=${"ref ref-" + r.kind + (r.current ? " ref-current" : "")} title=${r.name}>${r.name}${task ? html`<${TaskBadge} id=${task.id} title=${task.title} link=${task.link} />` : null}</span>`;
const Person = ({ name, email, showEmail }) => html`<span class="person" title=${(name || "") + (email ? " <" + email + ">" : "")}>
  <span class="avatar" style=${{ "--hue": hueOf(name) }} aria-hidden="true">${initials(name)}</span><span class="person-name">${name}</span>${showEmail && email ? html`<span class="person-email">${email}</span>` : null}</span>`;

function makeColumns({ width, onCopy, hidden, filtered, tasks }) {
  // a remote branch (origin/feature/x) is for the task of its local branch
  const taskOfRef = r => (tasks && tasks.branches ? tasks.branches[r.kind === "remote" ? r.name.replace(/^[^/]+\//, "") : r.name] : null);
  const natural = PAD * 2 + width * COL;
  const visibleRefs = (row, all) => all.filter(r => r.current || !hidden || !hidden.has((r.kind === "remote" ? "refs/remotes/" : "refs/heads/") + r.name));
  return [
    { key: "refs", label: "Branch / Tag", min: 90, width: 180, priority: 7, sortable: false,
      render: row => (row.wip ? html`<span class="ref ref-wip">working tree</span>` : (() => {
        const refs = visibleRefs(row, row.refs);
        return html`${refs.slice(0, 3).map(r => html`<${Ref} r=${r} task=${taskOfRef(r)} />`)}${refs.length > 3 ? html`<span class="ref" title=${refs.slice(3).map(r => r.name).join("\n")}>+${refs.length - 3}</span>` : null}`;
      })()),
      text: row => (row.wip ? "working tree" : row.refs.slice(0, 3).map(r => r.name).join(" ")) },
    { key: "graph", label: "Graph", min: 56, max: Math.max(natural, 56), width: Math.min(natural, 200), priority: 8, required: true, sortable: false, fit: () => natural,
      render: (row, ctx) => (row.wip
        ? html`<svg class="lanes" width=${natural} height=${ROW} aria-hidden="true"><circle cx=${PAD} cy=${ROW / 2} r=${RADIUS} fill="none" stroke="var(--muted-foreground)" stroke-dasharray="2 2" stroke-width="2" /></svg>`
        : html`<${Lanes} row=${{ ...row.lane, sha: row.commit.sha }} width=${width} head=${row.refs.some(r => r.current)} flat=${!!ctx.sort || filtered} />`) },
    { key: "message", label: "Message", min: 140, width: 360, priority: 9, required: true, flex: true, sortable: false,
      render: row => (row.wip ? html`<span class="msg">${row.changes} changed ${row.changes === 1 ? "file" : "files"}</span>`
        : html`${tasks && tasks.commits && tasks.commits[row.commit.sha] ? (([a, id]) => html`<${TaskBadge} id=${id} title=${((tasks.tasks || {})[a + ":" + id] || {}).title} link=${((tasks.tasks || {})[a + ":" + id] || {}).link} />`)(tasks.commits[row.commit.sha]) : null}<span class="msg" title=${row.commit.subject + (row.commit.body ? "\n\n" + row.commit.body : "")}>${row.commit.subject}</span>`),
      text: row => (row.wip ? "" : row.commit.subject) },
    { key: "author", label: "Author", min: 90, width: 150, priority: 3, sortable: true,
      render: (row, ctx) => (row.wip ? null : html`<${Person} name=${row.commit.author} email=${row.commit.email} showEmail=${ctx.opts.email} />`),
      text: row => (row.wip ? "" : row.commit.author + "    ") },
    { key: "date", label: "Date", min: 80, width: 112, priority: 5, sortable: true,
      render: (row, ctx) => (row.wip ? null : html`<time class="when" dateTime=${isoTime(row.commit.time)} title=${isoTime(row.commit.time) + (ctx.opts.dates === "absolute" ? "\n" + relativeTime(row.commit.time) : "\n" + absoluteTime(row.commit.time))}>${ctx.opts.dates === "absolute" ? absoluteTime(row.commit.time) : relativeTime(row.commit.time)}</time>`),
      text: row => (row.wip ? "" : absoluteTime(row.commit.time)) },
    { key: "sha", label: "SHA", min: 64, width: 84, priority: 4, sortable: false,
      render: row => (row.wip ? null : html`<button type="button" class="sha-cell mono" title=${"Copy " + row.commit.sha} aria-label=${"Copy the commit id " + row.commit.sha}
        onClick=${e => { e.stopPropagation(); onCopy(row.commit.sha); }} onDblClick=${e => e.stopPropagation()}>${shortHash(row.commit.sha)}</button>`),
      text: row => (row.wip ? "" : shortHash(row.commit.sha)) },
    { key: "committer", label: "Committer", min: 90, width: 140, priority: 1, sortable: true, hiddenByDefault: true,
      render: (row, ctx) => (row.wip ? null : html`<${Person} name=${row.commit.committer} email=${row.commit.committer_email} showEmail=${ctx.opts.email} />`),
      text: row => (row.wip ? "" : row.commit.committer + "    ") },
    { key: "refcount", label: "Refs", min: 48, width: 56, priority: 1, align: "right", sortable: true, hiddenByDefault: true,
      render: row => (row.wip ? null : row.refs.length || ""), text: row => (row.wip ? "" : String(row.refs.length)) },
  ];
}

const ACCESSORS = {
  author: row => (row.wip ? "" : row.commit.author.toLowerCase()), committer: row => (row.wip ? "" : row.commit.committer.toLowerCase()),
  date: row => (row.wip ? Infinity : row.commit.time), refcount: row => (row.wip ? 0 : row.refs.length),
};

const matches = (row, q, tasks) => row.wip || [row.commit.subject, row.commit.author, row.commit.sha, ...row.refs.map(r => r.name), (tasks && tasks.commits && tasks.commits[row.commit.sha] || [])[1] || ""].join(" ").toLowerCase().includes(q);

// a row is for a task when its commit is, or one of its branches is
const inTask = (row, tasks, key) => row.wip || !key || !tasks
  || (tasks.commits && (tasks.commits[row.commit.sha] || []).join(":") === key)
  || row.refs.some(r => { const b = tasks.branches && tasks.branches[r.kind === "remote" ? r.name.replace(/^[^/]+\//, "") : r.name]; return b && b.addon + ":" + b.id === key; });

export function GraphView({ graph, changes, loading, onMenu, hidden, selected, onSelect, onOpen, fresh, onCopy, filter, tasks, taskFilter, onClearTask }) {
  const needle = (filter || "").trim().toLowerCase();
  const narrowed = !!needle || !!taskFilter;
  const all = useMemo(() => graphRows((graph && graph.commits) || [], (graph && graph.remotes) || [], changes), [graph, changes]);
  const data = useMemo(() => (narrowed ? { ...all, rows: all.rows.filter(r => matches(r, needle, tasks) && inTask(r, tasks, taskFilter)) } : all), [all, needle, tasks, taskFilter]);
  const columns = useMemo(() => makeColumns({ width: data.width, onCopy, hidden, filtered: narrowed, tasks }), [data.width, onCopy, hidden, narrowed, tasks]);
  if (!graph) return html`<${Skeleton} rows=${12} />`;
  if (!all.rows.length) return html`<div class="empty">This repository has no commits yet.</div>`;
  const selectedKey = selected ? (selected.type === "worktree" ? "worktree" : selected.sha) : null;
  const choose = (set, active) => { if (active !== undefined && active !== null) onSelect(active === "worktree" ? { type: "worktree" } : { type: "commit", sha: active }); };
  return html`<${ResizableTable} id="graph" label="Commits" columns=${columns} sections=${[{ rows: data.rows }]} rowKey=${r => r.key} selected=${new Set(selectedKey ? [selectedKey] : [])} onSelect=${choose} activeKey=${selectedKey}
    reorderable accessors=${ACCESSORS} class="graph" onOpen=${row => !row.wip && onOpen(row.commit, row.refs)}
    onRowMenu=${(px, py, row) => !row.wip && onMenu(px, py, row.commit, row.refs.filter(r => r.current || !hidden || !hidden.has((r.kind === "remote" ? "refs/remotes/" : "refs/heads/") + r.name)))}
    rowClass=${row => ["row", row.wip && "row-wip", !row.wip && row.refs.some(r => r.current) && "row-head", fresh && !row.wip && fresh.has(row.commit.sha) && "row-new", selectedKey === row.key && "row-selected"].filter(Boolean).join(" ")}
    rowAttrs=${row => (row.wip ? { title: "Show the changes of the working tree" } : { "data-sha": row.commit.sha })}
    tools=${({ sort, clearSort }) => (narrowed ? html`<div class="table-note" role="status">${data.rows.filter(r => !r.wip).length} of ${all.rows.filter(r => !r.wip).length} commits ${taskFilter && !needle ? "are for the task" : "match" + (needle ? " “" + filter.trim() + "”" : "")}: the graph lines are hidden while the list is narrowed.${taskFilter ? html` <button type="button" class="link" onClick=${() => onClearTask && onClearTask()}>Show all tasks</button>` : ""}</div>` : sort ? html`<div class="table-note" role="status">Sorted by ${sort.key}: the graph lines are hidden because the order is no longer the history. <button type="button" class="link" onClick=${clearSort}>Back to the graph order</button></div>` : null)}
    menuExtras=${({ opts, setOpt }) => html`<div class="menu-group"><span class="hint">Date</span>
      <label class="check"><input type="radio" name="dates" checked=${opts.dates !== "absolute"} onChange=${() => setOpt("dates", "relative")} /> Relative (3 days ago)</label>
      <label class="check"><input type="radio" name="dates" checked=${opts.dates === "absolute"} onChange=${() => setOpt("dates", "absolute")} /> Date and time</label>
      <label class="check"><input type="checkbox" checked=${!!opts.email} onChange=${e => setOpt("email", e.target.checked)} /> Show the e-mail of authors</label></div>`}
    empty=${narrowed ? "No commit matches." : "No commits"} />`;
}
