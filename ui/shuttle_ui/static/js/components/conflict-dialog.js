/* One file in conflict, place by place. For each place: the lines before it, what each side has next to the other, who last changed the lines of
 * your side on this branch (with a release made of several commits, that says which of them the place is about), and a choice. Nothing is
 * written here: the choices become one request, which is previewed first like every other action. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { blameLine, conflictChoices, hunkChoices, hunksDecided, pickProgress, resolveHunksRequest, shortName } from "../logic.js";
import { Alert, Badge, Button, Modal, Skeleton, cn } from "./ui.js";

function Side({ kind, name, role, text, picked, note, blame, total }) {
  return html`<div class=${cn("side", "side-" + kind, picked && "picked")}>
    <div class="side-head"><strong>${name}</strong><span class="hint">${role}</span></div>
    ${note ? html`<p class="hint side-note">${note}</p>` : null}
    <pre class="side-text">${text === "" ? html`<span class="hint">(no line)</span>` : text}</pre>
    ${blame && blame.length ? html`<ul class="blame">${blame.map(b => html`<li class=${b.picked ? "from-pick" : ""}>${blameLine(b, total)}</li>`)}</ul>` : null}
  </div>`;
}

export function ConflictDialog({ repoId, file, status, onClose, onSubmit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState({});
  useEffect(() => {
    let alive = true;
    api("POST", "repos/" + repoId + "/conflicts", { path: file }).then(d => alive && setData(d), e => alive && setError(e.message));
    return () => { alive = false; };
  }, [file]);

  const sides = conflictChoices(status) || { ours: { name: "ours", role: "" }, theirs: { name: "theirs", role: "" } };
  const progress = pickProgress(status);
  const hunks = (data && data.hunks) || [];
  const decided = hunks.filter(h => choices[h.n]).length;
  const complete = hunksDecided(hunks, choices);
  const set = (n, choice) => setChoices({ ...choices, [n]: choice });
  const setAll = choice => { const next = {}; for (const h of hunks) next[h.n] = choice; setChoices(next); };
  const theirsNote = progress && progress.current ? "Commit " + progress.index + " of " + progress.total + ": " + progress.current.subject : "";
  const submit = () => { if (complete) onSubmit(resolveHunksRequest(file, choices)); };

  const footer = html`<span class="hint grow">${data && hunks.length ? decided + " of " + hunks.length + " places decided" : ""}</span>
    <${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} disabled=${!complete} onClick=${submit}>Preview and write<//>`;
  return html`<${Modal} title=${"Resolve " + file} wide onClose=${onClose} footer=${footer} initialFocus=".choice">
    ${error ? html`<${Alert} tone="warn">${error}<//>` : null}
    ${!data && !error ? html`<${Skeleton} rows=${4} height=${40} />` : null}
    ${data && hunks.length === 0 ? html`<${Alert} tone="info" title="Nothing to choose place by place">
      <span>This file has no conflict markers (it was deleted on one side, or the markers are gone). Close this and use the Keep buttons for the whole file.</span><//>` : null}
    ${hunks.length > 1 ? html`<div class="hunk-bar"><span class="hint">For all ${hunks.length} places:</span>
      <button type="button" class="chip" onClick=${() => setAll("ours")} title=${sides.ours.name}>Keep ${shortName(sides.ours.name)}</button>
      <button type="button" class="chip" onClick=${() => setAll("theirs")} title=${sides.theirs.name}>Keep ${shortName(sides.theirs.name)}</button></div>` : null}
    ${hunks.map(h => {
      const choice = choices[h.n];
      return html`<section class="hunk" key=${h.n} aria-label=${"Place " + h.n}>
        <header class="hunk-head"><strong>Place ${h.n} of ${hunks.length}</strong><span class="hint">${h.from != null ? (h.to > h.from ? "lines " + h.from + " to " + h.to : "line " + h.from) + " of the file on this branch" : "lines " + h.start + " to " + h.end + " of the file"}</span>
          ${choice ? html`<${Badge} tone="ok">decided<//>` : html`<${Badge} tone="warn">to decide<//>`}</header>
        ${h.before ? html`<pre class="hunk-ctx">${h.before}</pre>` : null}
        <div class="hunk-sides">
          <${Side} kind="ours" name=${sides.ours.name} role=${sides.ours.role} text=${h.ours} blame=${h.blame} total=${progress ? progress.total : 0}
            picked=${choice === "ours" || choice === "both" || choice === "both-reverse"} />
          <${Side} kind="theirs" name=${sides.theirs.name} role=${sides.theirs.role} text=${h.theirs} note=${theirsNote}
            picked=${choice === "theirs" || choice === "both" || choice === "both-reverse"} />
        </div>
        ${h.base !== null ? html`<details class="hunk-base"><summary class="hint">What both started from</summary><pre class="side-text">${h.base === "" ? "(no line)" : h.base}</pre></details>` : null}
        ${h.after ? html`<pre class="hunk-ctx">${h.after}</pre>` : null}
        <div class="choices" role="radiogroup" aria-label=${"What place " + h.n + " keeps"}>${hunkChoices(sides, h.base !== null).map(o => html`<button type="button" role="radio"
          aria-checked=${choice === o.id ? "true" : "false"} class=${cn("choice", choice === o.id && "on")} title=${o.title} onClick=${() => set(h.n, o.id)}>${o.label}</button>`)}</div>
      </section>`;
    })}
  <//>`;
}
