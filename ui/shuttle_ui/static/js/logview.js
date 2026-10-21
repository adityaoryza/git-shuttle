/* The command log: grouping, filters and labels. Pure, tested with node. */
const two = n => String(n).padStart(2, "0");
const day = iso => (iso || "").slice(0, 10);

export function dayLabel(iso, now = new Date()) {
  const d = day(iso);
  const today = now.getFullYear() + "-" + two(now.getMonth() + 1) + "-" + two(now.getDate());
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = y.getFullYear() + "-" + two(y.getMonth() + 1) + "-" + two(y.getDate());
  return d === today ? "Today" : d === yesterday ? "Yesterday" : d;
}
// Entries (newest first) with a separator before the first entry of each day.
export function withDays(entries, now) {
  const out = [];
  let last = null;
  for (const e of entries) {
    const d = day(e.time);
    if (d !== last) { out.push({ separator: dayLabel(e.time, now), day: d, key: "day-" + d }); last = d; }
    out.push(e);
  }
  return out;
}
export function relative(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + " h ago";
  return Math.round(s / 86400) + " d ago";
}
export const durationText = seconds => (seconds == null ? "" : seconds < 1 ? Math.round(seconds * 1000) + " ms" : seconds < 60 ? seconds.toFixed(1) + " s" : Math.floor(seconds / 60) + " min " + Math.round(seconds % 60) + " s");
export const RESULTS = { done: { label: "done", icon: "✓", tone: "ok" }, stopped: { label: "stopped", icon: "!", tone: "warn" }, failed: { label: "failed", icon: "✕", tone: "bad" } };
export const resultOf = state => RESULTS[state] || { label: String(state), icon: "?", tone: "neutral" };

// The query string of a page request from the filters (empty values are left out).
export function historyQuery(filters, before, limit = 50) {
  const q = new URLSearchParams();
  q.set("limit", String(limit));
  if (before) q.set("before", String(before));
  for (const key of ["repo", "action", "result", "q"]) if (filters[key]) q.set(key, filters[key]);
  const since = sinceDate(filters.range);
  if (since) q.set("since", since);
  return q.toString();
}
export function sinceDate(range, now = new Date()) {
  const days = { today: 0, week: 6, month: 29 }[range];
  if (days === undefined) return "";
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
}
export const activeFilters = f => ["repo", "action", "result", "q", "range"].filter(k => f[k]).length;
export const emptyFilters = () => ({ repo: "", action: "", result: "", q: "", range: "" });
export function loadFilters(storage) {
  try {
    const raw = JSON.parse(storage.getItem("shuttle.log.filters"));
    const out = emptyFilters();
    for (const k of Object.keys(out)) if (raw && typeof raw[k] === "string" && raw[k].length < 200) out[k] = raw[k];
    if (!["", "done", "stopped", "failed"].includes(out.result)) out.result = "";
    if (!["", "today", "week", "month"].includes(out.range)) out.range = "";
    out.q = "";       // a text search is never carried over to the next visit
    return out;
  } catch (e) { return emptyFilters(); }
}
export const saveFilters = (storage, f) => { try { storage.setItem("shuttle.log.filters", JSON.stringify(f)); } catch (e) { /* not remembered */ } };
// Entries already shown plus a new page, by id, newest first, never twice.
export function mergePage(shown, page) {
  const seen = new Set(shown.map(e => e.id));
  return [...shown, ...page.filter(e => !seen.has(e.id))];
}
// A live entry joins the top when it matches the filters (the server filters pages; this keeps the list current between loads).
export function matchesFilters(e, f) {
  if (f.repo && e.repo !== f.repo) return false;
  if (f.action && e.action !== f.action) return false;
  if (f.result && e.state !== f.result) return false;
  if (f.q && !(e.repo + " " + e.action + " " + (e.label || "") + " " + (e.commands || []).join(" ")).toLowerCase().includes(f.q.toLowerCase())) return false;
  const since = sinceDate(f.range);
  return !since || (e.time || "") >= since;
}
