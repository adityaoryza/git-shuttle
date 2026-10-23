/* One file in conflict, in a big dialog: the code line by line, the two sides next to each other. Every line of either side is kept or left out with a
 * click; a whole side, or both, is taken with one click, for one place or for all of them; and under each place stands what will be written. Next to the
 * lines of your side stands who last changed them on this branch (with a release made of several commits: which of them the place is about).
 * Nothing is written here: the choices become one request, which is previewed first like every other action. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { blameLine, conflictChoices, hunkChoices, hunkLines, hunksDecided, pickChoice, pickProgress, pickResult, presetPick, resolveHunksRequest, setOrder, shortName, togglePick } from "../logic.js";
import { Alert, Badge, Button, Modal, Skeleton, cn } from "./ui.js";

const MARK = { o: "◀", t: "▶", b: "◆" };

function Column({ kind, name, role, note, lines, flags, blame, total, onToggle }) {
  const kept = flags ? flags.filter(Boolean).length : 0;
  return html`<div class=${cn("side", "side-" + kind, kept > 0 && "picked")}>
    <div class="side-head"><strong title=${name}>${shortName(name, 48)}</strong><span class="hint">${role}</span>
      <span class="hint grow right">${lines.length ? kept + " of " + lines.length + (lines.length === 1 ? " line" : " lines") + " kept" : "no line"}</span></div>
    ${note ? html`<p class="hint side-note">${note}</p>` : null}
    ${lines.length
      ? html`<div class="code" role="group" aria-label=${"Lines of " + name}>${lines.map((text, i) => html`<button type="button" role="checkbox" aria-checked=${flags && flags[i] ? "true" : "false"}
          class=${cn("code-line", flags && flags[i] && "on")} title=${(flags && flags[i] ? "Leave out" : "Keep") + " this line"} onClick=${() => onToggle(i)}>
          <span class="mark" aria-hidden="true">${flags && flags[i] ? "✓" : ""}</span><span class="ln">${i + 1}</span><code>${text === "" ? " " : text}</code></button>`)}</div>`
      : html`<pre class="side-text"><span class="hint">(no line)</span></pre>`}
    ${blame && blame.length ? html`<ul class="blame">${blame.map(b => html`<li class=${b.picked ? "from-pick" : ""}>${blameLine(b, total)}</li>`)}</ul>` : null}
  </div>`;
}

export function ConflictDialog({ repoId, file, status, onClose, onSubmit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [picks, setPicks] = useState({});        // place number -> which lines are kept, and in which order
  useEffect(() => {
    let alive = true;
    api("POST", "repos/" + repoId + "/conflicts", { path: file }).then(d => alive && setData(d), e => alive && setError(e.message));
    return () => { alive = false; };
  }, [file]);

  const sides = conflictChoices(status) || { ours: { name: "ours", role: "" }, theirs: { name: "theirs", role: "" } };
  const progress = pickProgress(status);
  const hunks = (data && data.hunks) || [];
  const choices = {};
  for (const h of hunks) if (picks[h.n]) choices[h.n] = pickChoice(h, picks[h.n]);
  const decided = hunks.filter(h => picks[h.n]).length;
  const complete = hunksDecided(hunks, choices);
  const setPick = (n, pick) => setPicks({ ...picks, [n]: pick });
  const setAll = id => { const next = {}; for (const h of hunks) next[h.n] = presetPick(h, id); setPicks(next); };
  const theirsNote = progress && progress.current ? "Commit " + progress.index + " of " + progress.total + ": " + progress.current.subject : "";
  const submit = () => { if (complete) onSubmit(resolveHunksRequest(file, choices)); };
  const allOptions = hunkChoices(sides, false);

  const footer = html`<span class="hint grow">${data && hunks.length ? decided + " of " + hunks.length + " places decided" : ""}</span>
    <${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} disabled=${!complete} onClick=${submit}>Preview and write<//>`;
  return html`<${Modal} title=${"Resolve " + file} wide className="modal-huge" onClose=${onClose} footer=${footer} initialFocus=".choice">
    ${error ? html`<${Alert} tone="warn">${error}<//>` : null}
    ${!data && !error ? html`<${Skeleton} rows=${4} height=${40} />` : null}
    ${data && hunks.length === 0 ? html`<${Alert} tone="info" title="Nothing to choose line by line">
      <span>This file has no conflict markers (it was deleted on one side, or the markers are gone). Close this and use the Keep buttons for the whole file.</span><//>` : null}
    ${hunks.length ? html`<div class="hunk-bar"><span class="hint">Click a line to keep it or leave it out. For ${hunks.length === 1 ? "this place" : "all " + hunks.length + " places"}:</span>
      ${allOptions.map(o => html`<button type="button" class="chip" title=${o.title} onClick=${() => setAll(o.id)}>${o.label}</button>`)}</div>` : null}
    ${hunks.map(h => {
      const pick = picks[h.n];
      const lines = hunkLines(h);
      const result = pick ? pickResult(h, pick) : null;
      const bothKept = pick && !pick.base && pick.o.some(Boolean) && pick.t.some(Boolean);
      const lineOf = h.from != null ? (h.to > h.from ? "lines " + h.from + " to " + h.to : "line " + h.from) + " of the file on this branch" : "lines " + h.start + " to " + h.end + " of the file";
      return html`<section class="hunk" key=${h.n} aria-label=${"Place " + h.n}>
        <header class="hunk-head"><strong>Place ${h.n} of ${hunks.length}</strong><span class="hint">${lineOf}</span>
          ${pick ? html`<${Badge} tone="ok">decided<//>` : html`<${Badge} tone="warn">to decide<//>`}</header>
        ${h.before ? html`<pre class="hunk-ctx">${h.before}</pre>` : null}
        <div class="hunk-sides">
          <${Column} kind="ours" name=${sides.ours.name} role=${sides.ours.role} lines=${lines.o} flags=${pick && !pick.base ? pick.o : null} blame=${h.blame}
            total=${progress ? progress.total : 0} onToggle=${i => setPick(h.n, togglePick(h, pick, "o", i))} />
          <${Column} kind="theirs" name=${sides.theirs.name} role=${sides.theirs.role} lines=${lines.t} flags=${pick && !pick.base ? pick.t : null} note=${theirsNote}
            onToggle=${i => setPick(h.n, togglePick(h, pick, "t", i))} />
        </div>
        ${h.base !== null ? html`<details class="hunk-base"><summary class="hint">What both started from</summary><pre class="side-text">${lines.b.length ? lines.b.join("\n") : "(no line)"}</pre></details>` : null}
        ${h.after ? html`<pre class="hunk-ctx">${h.after}</pre>` : null}
        <div class="choices" role="group" aria-label=${"Take a whole side for place " + h.n}>${hunkChoices(sides, h.base !== null).map(o => html`<button type="button"
          class=${cn("choice", pick && pickChoice(h, pick) === o.id && "on")} title=${o.title} onClick=${() => setPick(h.n, presetPick(h, o.id))}>${o.label}</button>`)}
          ${bothKept ? html`<span class="order"><button type="button" class=${cn("choice", pick.order === "ours" && "on")} onClick=${() => setPick(h.n, setOrder(pick, "ours"))}>Left lines first</button>
            <button type="button" class=${cn("choice", pick.order === "theirs" && "on")} onClick=${() => setPick(h.n, setOrder(pick, "theirs"))}>Right lines first</button></span>` : null}</div>
        <div class="result-box" aria-live="polite">
          <span class="hint">${result === null ? "Nothing decided yet: click lines, or take a side." : "What will be written here" + (result.length ? " (" + result.length + (result.length === 1 ? " line" : " lines") + ")" : "")}</span>
          ${result && result.length ? html`<ol class="result-lines">${result.map(l => html`<li class=${"from-" + l.side}><span class="src" aria-hidden="true">${MARK[l.side]}</span><code>${l.text === "" ? " " : l.text}</code></li>`)}</ol>` : null}
          ${result && !result.length ? html`<span class="field-hint warn">Nothing: these lines are taken out of the file.</span>` : null}
        </div>
      </section>`;
    })}
  <//>`;
}
