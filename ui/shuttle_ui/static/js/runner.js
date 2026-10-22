/* Preview first, then run. A preview counts only for the exact request it was made for: change anything and it is made again. */
import { useState, useRef } from "../vendor/preact-htm.js";
import { api } from "./api.js";

export function useRunner(repoId, { onDone, onError }) {
  const [shown, setPreview] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(0);

  const key = (action, params) => JSON.stringify([action, params]);
  const fresh = (action, params) => !!(shown && shown.ok && shown.key === key(action, params));

  async function doPreview(action, params) {
    setBusy(true);
    try {
      const r = await api("POST", "repos/" + repoId + "/preview", { action, params });
      setPreview({ action, ok: r.ok, steps: r.steps, key: key(action, params) });
    } catch (e) { onError(e); }
    setBusy(false);
  }

  // secret: the sudo password of a deploy: sent with the request and kept nowhere (not in the preview key, not in the job)
  // extra: flags of the request that are not part of the preview: { remember } keeps the password after a login that worked, { use_saved } uses the one kept
  async function run(action, params, label, secret, extra) {
    setBusy(true);
    try {
      const r = await api("POST", "repos/" + repoId + "/run", { action, params: { ...params, ...(secret ? { sudo_password: secret } : {}), ...(extra || {}) } });
      setPreview(null);
      setJob({ id: r.job, label: label || action, action, state: "running", steps: [] });
      poll(r.job, label || action, action);
    } catch (e) { onError(e); setBusy(false); }
  }

  async function poll(id, label, action) {
    const mine = ++alive.current;
    for (;;) {
      let job;
      try { job = (await api("GET", "jobs/" + id)).job; } catch (e) { onError(e); break; }
      if (mine !== alive.current) return;
      setJob({ ...job, label, action });
      if (job.state !== "running") { setBusy(false); await onDone({ ...job, label, action }); return; }
      await new Promise(r => setTimeout(r, 600));
    }
    setBusy(false);
  }

  const reset = () => { alive.current++; setPreview(null); setJob(null); setBusy(false); };
  return { shown, job, busy, fresh, preview: doPreview, run, reset, clearPreview: () => setPreview(null), closeJob: () => setJob(null) };
}
