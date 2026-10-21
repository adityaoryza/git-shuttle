/* The details of a selected commit (or of the working tree): who, when, the message, the files and the diff of each. Read only. */
import { html, useState, useEffect, useRef, useMemo } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { buildTree, filterFiles, flattenTree, orderedFiles, sameFile, totals } from "../filetree.js";
import { fullDate } from "../format.js";
import { parseRefs, relativeTime } from "../graph.js";
import { shortHash } from "../logic.js";
import { DiffView } from "./diff-view.js";
import { FileRow } from "./file-row.js";
import { Button, Input, Segmented, cn } from "./ui.js";

const GROUPS = [["staged", "Staged"], ["unstaged", "Changes not staged"], ["untracked", "Untracked"]];
const GROUP_SOURCE = { staged: "staged", unstaged: "worktree", untracked: "untracked" };
const MIN_HEIGHT = 160;
const stored = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* not remembered */ } };

function FileList({ files, mode, closed, toggleDir, active, onPick }) {
  if (mode === "tree") {
    const rows = flattenTree(buildTree(files), closed);
    return html`${rows.map(({ node, depth }) => node.dir
      ? html`<button type="button" class="frow dir" style=${{ paddingLeft: 8 + depth * 14 + "px" }} aria-expanded=${!closed.has(node.path)} onClick=${() => toggleDir(node.path)}><span class="caret">${closed.has(node.path) ? "▸" : "▾"}</span><span class="fname mono">${node.name}/</span></button>`
      : html`<${FileRow} file=${node.file} depth=${depth} label=${node.name} active=${sameFile(active, node.file)} onPick=${onPick} />`)}`;
  }
  return html`${files.map(f => html`<${FileRow} file=${f} active=${sameFile(active, f)} onPick=${onPick} />`)}`;
}

// The file the page asked for: its path in the group it was clicked in (or in any group when that one has changed meanwhile).
function pickFocus(files, focus) {
  if (!focus) return null;
  return files.find(f => f.path === focus.path && f.group === focus.group) || files.find(f => f.path === focus.path) || null;
}

export function CommitPanel({ repoId, selected, remotes, onSelectCommit, onClose, onCopy }) {
  const key = selected.type === "worktree" ? "worktree" : selected.sha;
  const [details, setDetails] = useState({ loading: true });
  const [active, setActive] = useState(null);
  const [diff, setDiff] = useState({ loading: false });
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState(() => stored("shuttle.filemode", "list"));
  const [wrap, setWrap] = useState(() => stored("shuttle.diffwrap", false));
  const [split, setSplit] = useState(() => stored("shuttle.diffsplit", false));
  const [closed, setClosed] = useState(new Set());
  const [height, setHeight] = useState(() => stored("shuttle.detailheight", 360));
  const cache = useRef(new Map());
  const root = useRef(null);

  // ---- what is selected: a commit, or the working tree
  useEffect(() => {
    let alive = true;
    setDetails({ loading: true }); setActive(null); setDiff({ loading: false }); setQuery(""); setClosed(new Set()); cache.current = new Map();
    const load = selected.type === "worktree" ? api("GET", "repos/" + repoId + "/worktree") : api("GET", "repos/" + repoId + "/commits/" + selected.sha);
    load.then(data => {
      if (!alive) return;
      const files = selected.type === "worktree"
        ? GROUPS.flatMap(([g]) => (data[g] || []).map(f => ({ ...f, group: g })))
        : data.files.map(f => ({ ...f, group: "" }));
      setDetails({ data, files });
      if (files.length) setActive(pickFocus(files, selected.focus) || files[0]);
    }).catch(e => alive && setDetails({ error: e.message }));
    return () => { alive = false; };
  }, [repoId, key]);

  // the Ship tab asks for a file while the panel is already open
  useEffect(() => {
    if (details.files && selected.focus) { const f = pickFocus(details.files, selected.focus); if (f) setActive(f); }
  }, [selected.focus]);

  // ---- the diff of the file that is picked
  useEffect(() => {
    if (!active) return;
    const id = key + "|" + active.group + "|" + active.path;
    if (cache.current.has(id)) { setDiff({ data: cache.current.get(id) }); return; }
    let alive = true;
    setDiff({ loading: true });
    const source = selected.type === "worktree" ? GROUP_SOURCE[active.group] : selected.sha;
    api("POST", "repos/" + repoId + "/diff", { source, path: active.path, old_path: active.old_path || undefined })
      .then(data => { cache.current.set(id, data); if (alive) setDiff({ data }); })
      .catch(e => alive && setDiff({ error: e.message }));
    return () => { alive = false; };
  }, [active, key]);

  useEffect(() => {
    const away = e => { if (e.key === "Escape" && !document.querySelector(".overlay, .ctx, .popover, .combo-list")) onClose(); };
    document.addEventListener("keydown", away);
    return () => document.removeEventListener("keydown", away);
  }, [onClose]);

  const files = (details.files || []);
  const shown = useMemo(() => filterFiles(files, query), [details.files, query]);
  const order = useMemo(() => {
    if (selected.type !== "worktree") return orderedFiles(shown, mode);
    return GROUPS.flatMap(([g]) => orderedFiles(shown.filter(f => f.group === g), mode));
  }, [shown, mode, selected.type]);
  const index = order.findIndex(f => sameFile(f, active));
  const go = delta => { if (order.length) setActive(order[Math.max(0, Math.min(order.length - 1, (index < 0 ? 0 : index + delta)))]); };
  const keys = e => {
    if (e.target.tagName === "INPUT" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); go(1); }
    else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); go(-1); }
  };

  // ---- the handle: drag it (or use the arrow keys on it) to give the graph or the details more room
  const resize = h => { const max = Math.round(window.innerHeight * 0.85); const v = Math.max(MIN_HEIGHT, Math.min(max, h)); setHeight(v); store("shuttle.detailheight", v); };
  const drag = e => {
    e.preventDefault();
    const startY = e.clientY, startH = height;
    const move = ev => resize(startH + (startY - ev.clientY));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const data = details.data;
  const sum = totals(files);
  const refs = data && data.refs ? parseRefs(data.refs, remotes) : [];
  const toggleDir = path => { const next = new Set(closed); next.has(path) ? next.delete(path) : next.add(path); setClosed(next); };

  return html`<section class="detail" style=${{ height: height + "px" }} aria-label=${selected.type === "worktree" ? "Working tree changes" : "Commit details"} ref=${root} onKeyDown=${keys}>
    <div class="detail-handle" role="separator" aria-orientation="horizontal" aria-label="Resize the details" aria-valuenow=${height} tabIndex="0" onPointerDown=${drag}
      onKeyDown=${e => { if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); resize(height + 40); } else if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); resize(height - 40); } }}></div>
    <header class="detail-head">
      ${selected.type === "worktree" ? html`<strong>Working tree</strong><span class="hint">${files.length} changed ${files.length === 1 ? "file" : "files"}, not committed yet</span>` : data ? html`
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
    <div class="detail-body">
      <div class="files-pane">
        <div class="files-tools">
          <${Input} placeholder="Filter files…" aria-label="Filter files" value=${query} onInput=${e => setQuery(e.target.value)} />
          <${Segmented} value=${mode} onChange=${v => { setMode(v); store("shuttle.filemode", v); }} options=${[{ value: "list", label: "List" }, { value: "tree", label: "Tree" }]} />
        </div>
        <div class="files-sum hint">${sum.files} ${sum.files === 1 ? "file" : "files"}${selected.type === "worktree" ? "" : html` <span class="add">+${sum.additions}</span> <span class="del">−${sum.deletions}</span>`}${query ? ` · ${shown.length} match` : ""}${data && data.files_truncated ? " · list cut" : ""}</div>
        <div class="files" role="listbox" aria-label="Changed files">
          ${details.loading ? html`<p class="hint pad">Loading…</p>` : null}
          ${!details.loading && !files.length && !details.error ? html`<p class="hint pad">${selected.type === "worktree" ? "Nothing changed." : "No file changes in this commit."}</p>` : null}
          ${selected.type === "worktree"
            ? GROUPS.map(([g, label]) => { const list = shown.filter(f => f.group === g); return list.length ? html`<div class="fgroup">${label} <span class="count">${list.length}</span></div><${FileList} files=${list} mode=${mode} closed=${closed} toggleDir=${toggleDir} active=${active} onPick=${setActive} />` : null; })
            : html`<${FileList} files=${shown} mode=${mode} closed=${closed} toggleDir=${toggleDir} active=${active} onPick=${setActive} />`}
          ${files.length && !shown.length ? html`<p class="hint pad">No file matches.</p>` : null}
        </div>
      </div>
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
  </section>`;
}
