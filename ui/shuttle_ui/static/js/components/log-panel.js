/* The command log: every action run from this page, newest first, loaded a page at a time, with filters and a detail per entry. */
import { html, useState, useEffect, useRef, useMemo, useCallback } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { activeFilters, durationText, emptyFilters, historyQuery, loadFilters, mergePage, relative, resultOf, saveFilters, withDays } from "../logview.js";
import { Button, Modal, Search, Skeleton, cn } from "./ui.js";
import { ResizableTable } from "./table.js";

const PAGE = 50;
const RANGES = [["", "Any time"], ["today", "Today"], ["week", "Last 7 days"], ["month", "Last 30 days"]];

function Detail({ entry, onRerun, onCopy }) {
  const [wrap, setWrap] = useState(true);
  const steps = entry.steps || [];
  const text = steps.map((s, i) => "$ " + (entry.commands[i] || "") + "\n" + (s.output || "")).join("\n");
  return html`<div class="log-detail">
    <div class="log-detail-head"><span class="hint">${entry.time.replace("T", " ")} · exit ${entry.exit} · ${durationText(entry.duration)}</span>
      <span class="row-actions"><label class="check"><input type="checkbox" checked=${wrap} onChange=${e => setWrap(e.target.checked)} /> Wrap</label><${Button} size="sm" variant="ghost" onClick=${() => onCopy(text)}>Copy output<//>
      ${entry.params ? html`<${Button} size="sm" variant="outline" onClick=${() => onRerun(entry)}>Run again…<//>` : null}</span></div>
    ${steps.length ? steps.map((s, i) => html`<div class="log-step"><code class="log-cmd">${entry.commands[i]}</code><pre class=${cn("output", !wrap && "nowrap")}>${s.output || "(no output)"}</pre></div>`) : html`<pre class="output">${(entry.commands || []).join("\n")}</pre>`}
  </div>`;
}

export function LogPanel({ repos, version, onClose, onRerun, onCopy, notify, confirm }) {
  const [filters, setFilters] = useState(() => loadFilters(localStorage));
  const [entries, setEntries] = useState(null);
  const [next, setNext] = useState(null), [total, setTotal] = useState(0), [counts, setCounts] = useState({}), [facets, setFacets] = useState({ repos: [], actions: [] });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(new Set());
  const [active, setActive] = useState(null);
  const search = useRef(null), sentinel = useRef(null), seq = useRef(0);

  const load = useCallback(async (reset, cursor) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const page = await api("GET", "history?" + historyQuery(filters, reset ? null : cursor, PAGE));
      if (mine !== seq.current) return;
      setEntries(prev => (reset || !prev ? page.entries : mergePage(prev, page.entries)));
      setNext(page.next); setTotal(page.total); setCounts(page.counts); setFacets(page.facets);
    } catch (e) { notify({ variant: "error", title: "Cannot read the log", detail: e.message }); if (mine === seq.current) setEntries(prev => prev || []); }
    if (mine === seq.current) setLoading(false);
  }, [filters]);
  useEffect(() => { saveFilters(localStorage, filters); load(true); }, [filters]);
  useEffect(() => { if (entries) load(true); }, [version]);       // an action finished while the log is open: it joins the top
  useEffect(() => {          // the end of the list came into view: the next page
    const el = sentinel.current;
    if (!el || !next || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(seen => { if (seen[0].isIntersecting && !loading) load(false, next); }, { root: el.closest(".tbody"), rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, loading, entries]);
  useEffect(() => {
    const slash = e => { if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { e.preventDefault(); search.current && search.current.focus(); } };
    document.addEventListener("keydown", slash);
    return () => document.removeEventListener("keydown", slash);
  }, []);

  const set = (k, v) => setFilters({ ...filters, [k]: v });
  const toggle = id => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clear = async () => {
    if (!await confirm({ title: "Clear the whole log?", body: "Every entry is deleted from this machine. Nothing in your repositories changes.", confirmLabel: "Clear the log", tone: "destructive" })) return;
    try { await api("POST", "history/clear", {}); setOpen(new Set()); load(true); } catch (e) { notify({ variant: "error", title: "Cannot clear the log", detail: e.message }); }
  };

  const sections = useMemo(() => {
    const rows = [];
    for (const item of withDays(entries || [])) {
      if (item.separator) { rows.push({ key: item.key, full: () => html`<div class="day-sep">${item.separator}</div>` }); continue; }
      rows.push({ key: "e" + item.id, entry: item });
      if (open.has(item.id)) rows.push({ key: "d" + item.id, full: () => html`<${Detail} entry=${item} onRerun=${onRerun} onCopy=${onCopy} />` });
    }
    return [{ rows }];
  }, [entries, open]);
  const columns = useMemo(() => [
    { key: "time", label: "Time", min: 90, width: 120, priority: 4, sortable: false, render: r => html`<time title=${r.entry.time.replace("T", " ")}>${relative(r.entry.time)}</time>` },
    { key: "repo", label: "Repository", min: 90, width: 140, priority: 3, sortable: false, render: r => r.entry.repo },
    { key: "action", label: "Action", min: 140, width: 260, priority: 9, flex: true, required: true, sortable: false, render: r => html`<span title=${(r.entry.commands || []).join("\n")}>${r.entry.label || r.entry.action}</span>` },
    { key: "result", label: "Result", min: 90, width: 110, priority: 8, required: true, sortable: false, render: r => { const x = resultOf(r.entry.state); return html`<span class=${"badge badge-" + x.tone}>${x.icon ? html`<span aria-hidden="true">${x.icon}</span> ` : null}${x.label}</span>`; } },
    { key: "duration", label: "Took", min: 80, width: 90, priority: 2, align: "right", sortable: false, render: r => durationText(r.entry.duration) },
  ], []);
  const n = activeFilters(filters);

  return html`<${Modal} title="Command log" wide className="modal-log" onClose=${onClose}>
    <div class="log-filters" role="search">
      <select class="input" aria-label="Filter by repository" value=${filters.repo} onChange=${e => set("repo", e.target.value)}><option value="">All repositories</option>${facets.repos.map(r => html`<option value=${r}>${r}</option>`)}</select>
      <select class="input" aria-label="Filter by action" value=${filters.action} onChange=${e => set("action", e.target.value)}><option value="">All actions</option>${facets.actions.map(a => html`<option value=${a}>${a}</option>`)}</select>
      <select class="input" aria-label="Filter by period" value=${filters.range} onChange=${e => set("range", e.target.value)}>${RANGES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select>
      <div class="segmented" role="group" aria-label="Filter by result">${[["", "All"], ["done", "Done"], ["stopped", "Stopped"], ["failed", "Failed"]].map(([v, l]) => html`<button type="button" class=${filters.result === v ? "on" : ""} aria-pressed=${filters.result === v} onClick=${() => set("result", v)}>${l}${v ? " " + (counts[v] || 0) : ""}</button>`)}</div>
      <${Search} wrapClass="log-search" autofocus inputRef=${search} placeholder="Search (/)" aria-label="Search the log" value=${filters.q} onInput=${e => set("q", e.target.value)} />
      ${n ? html`<button type="button" class="link" onClick=${() => setFilters(emptyFilters())}>Clear filters (${n})</button>` : null}
      <span class="log-status"><span class="hint" aria-live="polite">${entries ? total + (total === 1 ? " entry" : " entries") : ""}</span>
      <${Button} size="sm" variant="ghost" onClick=${clear} disabled=${!total && !n}>Clear log<//></span>
    </div>
    ${entries === null ? html`<${Skeleton} rows=${8} />` : html`<${ResizableTable} id="log" label="Command log" columns=${columns} sections=${sections} rowKey=${r => r.key} selected=${new Set(active ? [active] : [])} activeKey=${active}
      onSelect=${(set_, k) => setActive(k)} onRowClick=${r => r.entry && toggle(r.entry.id)} onOpen=${r => toggle(r.entry.id)}
      rowClass=${r => (open.has(r.entry.id) ? "is-open" : "")} rowAttrs=${r => ({ "aria-expanded": open.has(r.entry.id) })}
      empty=${n ? "No entry matches the filters." : "Nothing has been run yet. Only actions run from this page are listed, on this machine."}
      tail=${html`<div ref=${sentinel} class="log-more" aria-live="polite">${loading ? "Loading…" : next ? "" : entries.length ? "End of the log" : ""}</div>`} />`}
  <//>`;
}
