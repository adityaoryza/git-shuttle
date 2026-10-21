/* "Don't show this preview again". The preview is a safety net, so only actions that are easy to take back can be switched off
 * (the Undo button reverts them); anything that destroys or rewrites work always asks. The choice lives in this browser only.
 * The rules are pure and tested with node; the storage calls never throw (a browser may refuse it). */
const KEY = "shuttle.skipPreview";

// actions that can be run without the preview; each one is undone by Undo or leaves your work as it was
const SAFE = new Set(["pull", "pull-rebase", "pull-merge", "update-branch", "sync", "sync-merge", "push", "switch", "switch-detach", "branch", "tag",
  "cherry-pick", "merge-in", "rebase-on", "upstream", "stash", "start"]);

// action: the id of the request ({action, params}); tone: "destructive" for the ones that ask for care
export function canSkipPreview(action, params, tone) {
  if (tone === "destructive" || !SAFE.has(action)) return false;
  const p = params || {};
  if (action === "push" && p.force) return false;
  if (action === "stash" && p.sub === "drop") return false;
  return true;
}

export function skippedPreviews() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter(a => typeof a === "string" && SAFE.has(a)) : [];
  } catch (e) { return []; }
}

export function isPreviewSkipped(action, params, tone) {
  return canSkipPreview(action, params, tone) && skippedPreviews().includes(action);
}

export function skipPreview(action) {
  if (!SAFE.has(action)) return;
  try { localStorage.setItem(KEY, JSON.stringify([...new Set([...skippedPreviews(), action])])); } catch (e) { /* not remembered */ }
}

export function resetSkippedPreviews() {
  try { localStorage.removeItem(KEY); } catch (e) { /* nothing to forget */ }
}
