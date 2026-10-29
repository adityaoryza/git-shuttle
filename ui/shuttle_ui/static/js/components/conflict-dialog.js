/* One file in conflict, in a big dialog, in plain words: for each change, which version to keep (one click), or a mix made by clicking single lines;
 * the result is shown as it will be written. Nothing is written here: the choices become one request, which is previewed first like every other action. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { blameLine, conflictChoices, hunkLines, hunksDecided, pickChoice, pickProgress, pickResult, plainSide, presetPick, resolveHunksRequest, setOrder, shortName, togglePick } from "../logic.js";
import { highlightLine, languageOf } from "../highlight.js";
import { Alert, Button, Modal, Skeleton, cn } from "./ui.js";

// a line of code in the colours of its language (the pieces put back together are the line)
const CodeBlock = ({ text, lang, className }) => html`<pre class=${className}>${String(text).split("\n").map((line, i) => html`${i ? "\n" : ""}${highlightLine(line, lang).map(p => (p.kind ? html`<span class=${"tok-" + p.kind}>${p.text}</span>` : p.text))}`)}</pre>`;
const Code = ({ text, lang }) => html`<code>${text === "" ? " " : highlightLine(text, lang).map(p => (p.kind ? html`<span class=${"tok-" + p.kind}>${p.text}</span>` : p.text))}</code>`;

const MARK = { o: "◀", t: "▶", b: "◆" };


// one version of a change: its plain title, where it comes from, and its lines (a click on a line keeps it or leaves it out)
function Column({ kind, plain, lines, flags, lang, onToggle }) {
  const kept = flags ? flags.filter(Boolean).length : 0;
  return html`<div class=${cn("side", "side-" + kind, kept > 0 && "picked")}>
    <div class="side-head"><strong>${plain.title}</strong><span class="hint grow">${plain.hint}</span></div>
    <div class="side-name mono" title=${plain.name}>${shortName(plain.name, 56)}</div>
    ${lines.length
      ? html`<div class="code" role="group" aria-label=${"Lines of " + plain.title}>${lines.map((text, i) => html`<button type="button" role="checkbox" aria-checked=${flags && flags[i] ? "true" : "false"}
          class=${cn("code-line", flags && flags[i] && "on")} title=${(flags && flags[i] ? "Leave out" : "Keep") + " this line"} onClick=${() => onToggle(i)}>
          <span class="mark" aria-hidden="true">${flags && flags[i] ? "✓" : ""}</span><span class="ln">${i + 1}</span><${Code} text=${text} lang=${lang} /></button>`)}</div>`
      : html`<pre class="side-text"><span class="hint">(this version has no line here)</span></pre>`}
    <div class="side-foot hint">${lines.length ? (kept === 0 ? "nothing kept" : kept === lines.length ? "all kept" : kept + " of " + lines.length + " kept") : ""}</div>
  </div>`;
}

export function ConflictDialog({ repoId, file, status, onClose, onSubmit }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [picks, setPicks] = useState({});        // change number -> which lines are kept, and in which order
  useEffect(() => {
    let alive = true;
    api("POST", "repos/" + repoId + "/conflicts", { path: file }).then(d => alive && setData(d), e => alive && setError(e.message));
    return () => { alive = false; };
  }, [file]);

  const sides = conflictChoices(status) || { ours: { name: "ours", role: "" }, theirs: { name: "theirs", role: "" } };
  const plain = { ours: plainSide(sides.ours), theirs: plainSide(sides.theirs) };
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
  const main = [
    { id: "ours", label: "Use “" + plain.ours.title + "”", title: "Only the lines of " + plain.ours.name },
    { id: "theirs", label: "Use “" + plain.theirs.title + "”", title: "Only the lines of " + plain.theirs.name },
    { id: "both", label: "Keep both", title: "The lines of " + plain.ours.title + ", then those of " + plain.theirs.title + " (the order can be changed)" },
  ];
  const many = hunks.length > 1;
  const lang = languageOf(file);

  const footer = html`<span class="hint grow">${data && hunks.length ? decided + " of " + hunks.length + (hunks.length === 1 ? " change decided" : " changes decided") : ""}</span>
    <${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} disabled=${!complete} title=${complete ? "" : "Decide every change first"} onClick=${submit}>Preview and write<//>`;
  return html`<${Modal} title=${"Resolve " + file} wide className="modal-huge" onClose=${onClose} footer=${footer} initialFocus=".choice">
    ${error ? html`<${Alert} tone="warn">${error}<//>` : null}
    ${!data && !error ? html`<${Skeleton} rows=${4} height=${40} />` : null}
    ${data && hunks.length === 0 ? html`<${Alert} tone="info" title="Nothing to choose line by line">
      <span>This file has no conflict markers (it was deleted on one side, or the markers are gone). Close this and use the Keep buttons for the whole file.</span><//>` : null}
    ${hunks.length ? html`<div class="rc-intro">
      <p><strong>Two versions changed the same lines of <code>${file}</code>.</strong> For each change below, choose the version to keep, or click single lines to make your own mix. The result is shown under it. Nothing is written until you press “Preview and write”.</p>
      ${many ? html`<div class="hunk-bar"><span class="hint">All ${hunks.length} changes at once:</span>
        ${main.map(o => html`<button type="button" class="chip" title=${o.title} onClick=${() => setAll(o.id)}>${o.label}</button>`)}</div>` : null}
    </div>` : null}
    ${hunks.map(h => {
      const pick = picks[h.n];
      const lines = hunkLines(h);
      const result = pick ? pickResult(h, pick) : null;
      const bothKept = pick && !pick.base && pick.o.some(Boolean) && pick.t.some(Boolean);
      const where = h.from != null ? "around line " + h.from + " of the file on this branch" : "around line " + h.start + " of the file";
      return html`<section class=${cn("hunk", "rc", pick ? "is-decided" : "is-open")} key=${h.n} aria-label=${"Change " + h.n}>
        <header class="hunk-head"><strong>Change ${h.n}${many ? " of " + hunks.length : ""}</strong><span class="hint">${where}</span>
          ${pick ? html`<span class="field-status">decided</span>` : html`<span class="field-status is-warn">needs your choice</span>`}</header>
        <div class="rc-ask">Which version should the file keep?</div>
        <div class="choices" role="group" aria-label=${"Choose for change " + h.n}>${main.map(o => html`<button type="button" data-side=${o.id}
          class=${cn("choice", pick && pickChoice(h, pick) === o.id && "on")} title=${o.title} onClick=${() => setPick(h.n, presetPick(h, o.id))}>${o.label}</button>`)}
          ${bothKept ? html`<span class="order"><span class="hint">Order:</span><button type="button" class=${cn("choice", pick.order === "ours" && "on")} onClick=${() => setPick(h.n, setOrder(pick, "ours"))}>${plain.ours.title} first</button>
            <button type="button" class=${cn("choice", pick.order === "theirs" && "on")} onClick=${() => setPick(h.n, setOrder(pick, "theirs"))}>${plain.theirs.title} first</button></span>` : null}</div>
        ${h.before ? html`<${CodeBlock} className="hunk-ctx" text=${h.before} lang=${lang} />` : null}
        <div class="hunk-sides">
          <${Column} kind="ours" plain=${plain.ours} lang=${lang} lines=${lines.o} flags=${pick && !pick.base ? pick.o : null} onToggle=${i => setPick(h.n, togglePick(h, pick, "o", i))} />
          <${Column} kind="theirs" plain=${{ ...plain.theirs, hint: theirsNote || plain.theirs.hint }} lang=${lang} lines=${lines.t} flags=${pick && !pick.base ? pick.t : null} onToggle=${i => setPick(h.n, togglePick(h, pick, "t", i))} />
        </div>
        ${h.after ? html`<${CodeBlock} className="hunk-ctx" text=${h.after} lang=${lang} />` : null}
        <div class="result-box" aria-live="polite">
          <div class="result-head"><strong class="result-title">Result in the file${result && result.length ? " (" + result.length + (result.length === 1 ? " line" : " lines") + ")" : ""}</strong>
            <span class="legend" aria-hidden="true"><span class="dot o"></span>${plain.ours.title}<span class="dot t"></span>${plain.theirs.title}</span></div>
          ${result === null ? html`<span class="hint">Choose a version above, or click lines, to see what the file will say.</span>` : null}
          ${result && result.length ? html`<ol class="result-lines">${result.map(l => html`<li class=${"from-" + l.side}><span class="src" aria-hidden="true">${MARK[l.side]}</span><${Code} text=${l.text} lang=${lang} /></li>`)}</ol>` : null}
          ${result && !result.length ? html`<span class="field-hint warn">Nothing: these lines are taken out of the file.</span>` : null}
        </div>
        <details class="hunk-more"><summary class="hint">More: the original, who changed these lines</summary>
          ${h.base !== null ? html`<div class="more-block"><strong>What both started from</strong><pre class="side-text">${lines.b.length ? lines.b.join("\n") : "(no line)"}</pre>
            <button type="button" class=${cn("choice", pick && pickChoice(h, pick) === "base" && "on")} onClick=${() => setPick(h.n, presetPick(h, "base"))}>Go back to the original</button></div>` : null}
          ${h.blame && h.blame.length ? html`<div class="more-block"><strong>Who last changed the lines of “${plain.ours.title}”</strong><ul class="blame">${h.blame.map(b => html`<li class=${b.picked ? "from-pick" : ""}>${blameLine(b, progress ? progress.total : 0)}</li>`)}</ul></div>` : null}
        </details>
      </section>`;
    })}
  <//>`;
}
