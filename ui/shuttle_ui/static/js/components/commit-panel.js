/* The details of a selected commit (or of the working tree): who, when, the message, the files and the diff of each. */
import { html, useState, useEffect, useRef, useMemo } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { middleEllipsis, statusRank } from "../columns.js";
import { buildTree, filterFiles, flattenTree, STATUS_NAMES, totals } from "../filetree.js";
import { fullDate } from "../format.js";
import { parseRefs, relativeTime } from "../graph.js";
import { shortHash } from "../logic.js";
import { ContextMenu } from "./context-menu.js";
import { DiffView } from "./diff-view.js";
import { Splitter, useSize, useSplit } from "./splitter.js";
import { ResizableTable } from "./table.js";
import { Button, Input, Segmented } from "./ui.js";

const GROUPS = [["staged", "Staged"], ["unstaged", "Changes not staged"], ["untracked", "Untracked"]];
const GROUP_SOURCE = { staged: "staged", unstaged: "worktree", untracked: "untracked" };
const stored = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* not remembered */ } };
const filters = { worktree: "", commit: "" };        // what was typed in each panel's filter box, kept while you look elsewhere

const rowKey = f => (f.group || "") + "|" + f.path;
const base = path => path.slice(path.lastIndexOf("/") + 1);
const folder = path => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

let ruler;
const measure = text => { ruler = ruler || document.createElement("canvas").getContext("2d"); ruler.font = '12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; return ruler.measureText(text).width; };

function nameOf(file) {
  return file.old_path && base(file.old_path) !== base(file.path) ? base(file.old_path) + " → " + base(file.path) : base(file.path);
}

function Changes({ file }) {
  if (file.binary) return html`<span class="hint">binary</span>`;
  if (file.status === "?") return html`<span class="hint">new</span>`;
  const a = file.additions || 0, d = file.deletions || 0;
  if (a === null || d === null || (!a && !d)) return html`<span class="hint">${file.status === "R" ? "renamed" : "—"}</span>`;
  const share = Math.round((a / (a + d)) * 100);
  return html`<span class="changes"><span class="add">+${a}</span> <span class="del">−${d}</span><span class="bar" aria-hidden="true"><i class="bar-add" style=${{ width: share + "%" }}></i><i class="bar-del" style=${{ width: 100 - share + "%" }}></i></span></span>`;
}

function makeColumns({ worktree, onToggleStage, onCopyPath }) {
  const columns = [
    { key: "name", label: "Name", min: 130, width: 150, priority: 9, text: f => nameOf(f),
      render: f => html`<span class="fcell" style=${{ paddingLeft: (f.depth || 0) * 14 + "px" }}><span class=${"st st-" + (f.status === "?" ? "q" : f.status)} title=${STATUS_NAMES[f.status] || f.status}>${f.status}</span><span class="fname" title=${f.path + (f.old_path ? " (was " + f.old_path + ")" : "")}>${f.label || nameOf(f)}</span></span>` },
    { key: "status", label: "Status", min: 66, width: 84, priority: 2, text: f => STATUS_NAMES[f.status] || f.status, render: f => html`<span class="hint">${STATUS_NAMES[f.status] || f.status}</span>` },
    { key: "path", label: "Path", min: 80, width: 120, priority: 5, text: f => folder(f.path),
      render: (f, { width }) => {
        const dir = folder(f.path);
        const shown = middleEllipsis(dir, text => measure(text) <= width - 18);
        return html`<span class="fpath mono" title=${f.path + "\n(double click to copy)"} onDblClick=${e => { e.stopPropagation(); onCopyPath(f.path); }}>${shown}</span>`;
      } },
    { key: "changes", label: "Changes", min: 84, width: 110, priority: 4, align: "right", text: f => "+" + (f.additions || 0) + " −" + (f.deletions || 0), render: f => html`<${Changes} file=${f} />` },
  ];
  if (worktree) columns.push({ key: "staged", label: "Staged", min: 60, width: 66, priority: 6, align: "center", sortable: true, text: () => "Staged",
    render: f => html`<input type="checkbox" checked=${f.group === "staged"} aria-label=${(f.group === "staged" ? "Unstage " : "Stage ") + f.path} onClick=${e => e.stopPropagation()} onChange=${() => onToggleStage(f)} />` });
  return columns;
}

const ACCESSORS = {
  name: f => nameOf(f).toLowerCase(), status: f => statusRank(f.status), path: f => folder(f.path).toLowerCase(),
  changes: f => (f.additions || 0) + (f.deletions || 0), staged: f => (f.group === "staged" ? 0 : 1),
};

// The file the page asked for: its path in the group it was clicked in (or in any group when that one has changed meanwhile).
function pickFocus(files, focus) {
  if (!focus) return null;
  return files.find(f => f.path === focus.path && f.group === focus.group) || files.find(f => f.path === focus.path) || null;
}

export function CommitPanel({ repoId, selected, remotes, height, onSelectCommit, onClose, onCopy, actions }) {
  const worktree = selected.type === "worktree";
  const key = worktree ? "worktree" : selected.sha;
  const [details, setDetails] = useState({ loading: true });
  const [active, setActive] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [diff, setDiff] = useState({ loading: false });
  const [query, setQuery] = useState(filters[worktree ? "worktree" : "commit"]);
  const [mode, setMode] = useState(() => stored("shuttle.filemode", "list"));
  const [wrap, setWrap] = useState(() => stored("shuttle.diffwrap", false));
  const [split, setSplit] = useState(() => stored("shuttle.diffsplit", false));
  const [closed, setClosed] = useState(new Set());
  const [menu, setMenu] = useState(null);
  const cache = useRef(new Map());
  const body = useRef(null);
  const { width } = useSize(body);
  const filesSplit = useSplit("files", { initial: 460, min: 260, otherMin: 280, total: width });

  const kind = worktree ? "worktree" : "commit";
  const typeQuery = value => { filters[kind] = value; setQuery(value); };

  // ---- what is selected: a commit, or the working tree
  const load = () => {
    let alive = true;
    const request = worktree ? api("GET", "repos/" + repoId + "/worktree") : api("GET", "repos/" + repoId + "/commits/" + selected.sha);
    request.then(data => {
      if (!alive) return;
      const files = worktree ? GROUPS.flatMap(([g]) => (data[g] || []).map(f => ({ ...f, group: g }))) : data.files.map(f => ({ ...f, group: "" }));
      setDetails({ data, files });
      setActive(prev => (prev && files.find(f => rowKey(f) === rowKey(prev))) || pickFocus(files, selected.focus) || files[0] || null);
      setPicked(prev => new Set([...prev].filter(k => files.some(f => rowKey(f) === k))));
    }).catch(e => alive && setDetails({ error: e.message }));
    return () => { alive = false; };
  };
  useEffect(() => {
    setDetails({ loading: true }); setActive(null); setPicked(new Set()); setDiff({ loading: false }); setClosed(new Set()); cache.current = new Map();
    setQuery(filters[worktree ? "worktree" : "commit"]);
    return load();
  }, [repoId, key, selected.version]);

  // the Ship tab asks for a file while the panel is already open
  useEffect(() => {
    if (details.files && selected.focus) { const f = pickFocus(details.files, selected.focus); if (f) { setActive(f); setPicked(new Set([rowKey(f)])); } }
  }, [selected.focus]);

  // ---- the diff of the file that is picked
  useEffect(() => {
    if (!active) { setDiff({ loading: false }); return undefined; }
    const id = key + "|" + active.group + "|" + active.path + "|" + (selected.version || 0);
    if (cache.current.has(id)) { setDiff({ data: cache.current.get(id) }); return undefined; }
    let alive = true;
    setDiff({ loading: true });
    const source = worktree ? GROUP_SOURCE[active.group] : selected.sha;
    api("POST", "repos/" + repoId + "/diff", { source, path: active.path, old_path: active.old_path || undefined })
      .then(data => { cache.current.set(id, data); if (alive) setDiff({ data }); })
      .catch(e => alive && setDiff({ error: e.message }));
    return () => { alive = false; };
  }, [active && rowKey(active), key, selected.version]);

  useEffect(() => {
    const away = e => { if (e.key === "Escape" && !document.querySelector(".overlay, .ctx, .popover, .combo-list, .table-menu")) onClose(); };
    document.addEventListener("keydown", away);
    return () => document.removeEventListener("keydown", away);
  }, [onClose]);

  const files = details.files || [];
  const shown = useMemo(() => filterFiles(files, query), [details.files, query]);
  const toggleDir = path => { const next = new Set(closed); next.has(path) ? next.delete(path) : next.add(path); setClosed(next); };

  // the rows of the table: one section per group (a commit has one); in tree mode the folders are rows too
  const sections = useMemo(() => {
    const groups = worktree ? GROUPS.map(([g, label]) => ({ label, rows: shown.filter(f => f.group === g) })).filter(s => s.rows.length) : [{ label: "", rows: shown }];
    if (mode !== "tree") return groups;
    return groups.map(s => ({
      ...s, onToggleDir: row => toggleDir(row.path),
      rows: flattenTree(buildTree(s.rows), closed).map(({ node, depth }) => (node.dir ? { dir: true, name: node.name, path: node.path, depth, closed: closed.has(node.path), group: s.label } : { ...node.file, depth, label: node.name })),
    }));
  }, [shown, mode, closed, worktree]);
  const order = useMemo(() => sections.flatMap(s => s.rows.filter(r => !r.dir)), [sections]);
  const index = order.findIndex(f => active && rowKey(f) === rowKey(active));
  const go = delta => { if (order.length) { const f = order[Math.max(0, Math.min(order.length - 1, index < 0 ? 0 : index + delta))]; setActive(f); setPicked(new Set([rowKey(f)])); } };
  const keys = e => {
    if (e.target.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "j") { e.preventDefault(); go(1); } else if (e.key === "k") { e.preventDefault(); go(-1); }
  };

  const columns = useMemo(() => makeColumns({ worktree, onToggleStage: f => actions && actions.toggle([f]), onCopyPath: path => onCopy(path) }), [worktree, actions, onCopy]);
  const select = (keysSet, activeKey) => {
    setPicked(keysSet);
    const f = files.find(x => rowKey(x) === activeKey);
    if (f) setActive(f);
  };
  const chosen = files.filter(f => picked.has(rowKey(f)));
  const reveal = file => { setMode("tree"); store("shuttle.filemode", "tree"); setClosed(new Set()); setActive(file); setPicked(new Set([rowKey(file)])); };
  const openMenu = (x, y, row, rows) => {
    const unstaged = rows.some(f => f.group !== "staged");
    const many = rows.length > 1 ? " (" + rows.length + " files)" : "";
    const items = [{ label: "Open diff", run: () => { setActive(row); } }];
    if (worktree && actions) {
      if (unstaged) items.push({ label: "Stage" + many, run: () => actions.stage(rows.filter(f => f.group !== "staged")) });
      if (rows.some(f => f.group === "staged")) items.push({ label: "Unstage" + many, run: () => actions.unstage(rows.filter(f => f.group === "staged")) });
      items.push({ label: "Discard changes…" + many, run: () => actions.discard(rows) });
    }
    items.push("-", { label: "Copy path" + many, run: () => onCopy(rows.map(f => f.path).join("\n")) });
    if (mode !== "tree") items.push({ label: "Reveal in tree", run: () => reveal(row) });
    setMenu({ x, y, title: rows.length > 1 ? rows.length + " files" : row.path, items });
  };

  const data = details.data;
  const sum = totals(files);
  const counts = worktree ? GROUPS.map(([g, label]) => files.filter(f => f.group === g).length) : [];
  const refs = data && data.refs ? parseRefs(data.refs, remotes) : [];
  const footer = html`${sum.files} ${sum.files === 1 ? "file" : "files"}${worktree ? "" : html` · <span class="add">+${sum.additions}</span> <span class="del">−${sum.deletions}</span>`}${worktree ? ` · ${counts[0]} staged · ${counts[1]} unstaged · ${counts[2]} untracked` : ""}${query ? ` · ${shown.length} match${shown.length === 1 ? "" : "es"}` : ""}${chosen.length > 1 ? ` · ${chosen.length} selected` : ""}${data && data.files_truncated ? " · list cut" : ""}`;
  const emptyText = details.loading ? "Loading…" : files.length && !shown.length ? "No file matches the filter." : worktree ? "Nothing changed: the working tree is clean." : "This commit changes no file.";

  return html`<section class="detail" style=${{ height: height + "px" }} aria-label=${worktree ? "Working tree changes" : "Commit details"} onKeyDown=${keys}>
    <header class="detail-head">
      ${worktree ? html`<strong>Working tree</strong><span class="hint">${files.length} changed ${files.length === 1 ? "file" : "files"}, not committed yet</span>` : data ? html`
        <button type="button" class="sha" onClick=${() => onCopy(data.sha)} title="Copy the full commit id" aria-label=${"Copy commit id " + data.sha}><code>${shortHash(data.sha)}</code> <span aria-hidden="true">⧉</span></button>
        <span class="who" title=${data.email}>${data.author}${data.committer && data.committer !== data.author ? html` <span class="hint">(committed by ${data.committer})</span>` : null}</span>
        <span class="hint" title=${fullDate(data.time)}>${relativeTime(data.time)} · ${fullDate(data.time)}</span>
        ${refs.slice(0, 4).map(r => html`<span class=${"ref ref-" + r.kind + (r.current ? " ref-current" : "")} title=${r.name}>${r.name}</span>`)}
        ${refs.length > 4 ? html`<span class="ref" title=${refs.slice(4).map(r => r.name).join("\n")}>+${refs.length - 4} more</span>` : null}
        ${data.parents.length ? html`<span class="hint">${data.merge ? "Merge of" : "Parent"}</span>${data.parents.map(p => html`<button type="button" class="link mono" onClick=${() => onSelectCommit(p)} title="Go to this commit">${shortHash(p)}</button>`)}` : html`<span class="hint">root commit</span>`}`
        : html`<span class="hint">${details.error ? "" : "Loading…"}</span>`}
      <span class="grow"></span>
      <${Button} variant="ghost" size="icon" onClick=${onClose} aria-label="Close the details (Esc)" title="Close (Esc)">✕<//>
    </header>
    ${data && data.message ? html`<details class="detail-msg" open=${data.message.split("\n").length <= 6}><summary><strong>${data.message.split("\n")[0]}</strong></summary>${data.message.includes("\n") ? html`<pre>${data.message.split("\n").slice(1).join("\n").trim()}</pre>` : null}</details>` : null}
    ${data && data.merge ? html`<div class="detail-note">A merge commit: the files shown are what it changed compared with its first parent.</div>` : null}
    ${details.error ? html`<div class="diff-msg bad" role="alert">${details.error}</div>` : null}
    <div class="detail-body" ref=${body} style=${{ "--files-w": filesSplit.size + "px" }}>
      <div class="files-pane">
        <div class="files-tools">
          <${Input} placeholder="Filter files…" aria-label="Filter files" value=${query} onInput=${e => typeQuery(e.target.value)} />
          <${Segmented} value=${mode} onChange=${v => { setMode(v); store("shuttle.filemode", v); }} options=${[{ value: "list", label: "List" }, { value: "tree", label: "Tree" }]} />
        </div>
        <${ResizableTable} id=${worktree ? "worktree" : "commit"} label="Changed files" columns=${columns} sections=${sections} tree=${mode === "tree"} rowKey=${rowKey}
          selected=${picked} onSelect=${select} activeKey=${active ? rowKey(active) : null} onOpen=${f => setActive(f)} accessors=${ACCESSORS}
          onSpace=${rows => { if (worktree && actions && rows.length) actions.toggle(rows); }} onRowMenu=${openMenu} footer=${footer} empty=${emptyText} />
      </div>
      <${Splitter} split=${filesSplit} axis="x" grow=${1} label="Resize the file list" />
      <div class="diff-pane">
        <div class="diff-tools">
          <span class="diff-path mono" title=${active ? active.path : ""}>${active ? active.path : ""}</span>
          <span class="grow"></span>
          <${Button} variant="ghost" size="icon" onClick=${() => go(-1)} disabled=${index <= 0} aria-label="Previous file (k)" title="Previous file (k)">↑<//>
          <${Button} variant="ghost" size="icon" onClick=${() => go(1)} disabled=${index < 0 || index >= order.length - 1} aria-label="Next file (j)" title="Next file (j)">↓<//>
          <label class="check"><input type="checkbox" checked=${wrap} onChange=${e => { setWrap(e.target.checked); store("shuttle.diffwrap", e.target.checked); }} /> Wrap</label>
          <label class="check"><input type="checkbox" checked=${split} onChange=${e => { setSplit(e.target.checked); store("shuttle.diffsplit", e.target.checked); }} /> Side by side</label>
        </div>
        <div class="diff-scroll"><${DiffView} diff=${diff.data} loading=${diff.loading} error=${diff.error} path=${active && active.path} wrap=${wrap} split=${split} /></div>
      </div>
    </div>
    ${menu ? html`<${ContextMenu} menu=${menu} onClose=${() => setMenu(null)} />` : null}
  </section>`;
}
