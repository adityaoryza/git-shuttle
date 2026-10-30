/* One dialog for every action that needs a few answers: text, choices, check boxes, a confirmation to type. The fields come from js/ops.js. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { formProblem, initialValues } from "../ops.js";
import { Button, Field, Input, Modal, Textarea, cn } from "./ui.js";

const remembered = key => { try { return localStorage.getItem("shuttle." + key) === "1"; } catch (e) { return false; } };
const remember = (key, value) => { try { localStorage.setItem("shuttle." + key, value ? "1" : "0"); } catch (e) { /* not remembered */ } };

/* Names to start from, as chips: a click fills the field (a prefix, or a whole release name). */
export function TemplateChips({ templates, value, onPick }) {
  if (!templates || !templates.length) return null;
  return html`<div class="chips templates" role="group" aria-label="Names to start from">${templates.map(t => html`<button type="button"
    class=${cn("chip", t.value === value && "on")} title=${t.title} onClick=${() => onPick(t)}>${t.label}</button>`)}</div>`;
}

export function FormDialog({ title, fields, repoId, commit, submitLabel = "Continue", tone = "default", onSubmit, onClose }) {
  const [values, setValues] = useState(() => {
    const v = initialValues(fields);
    for (const f of fields) if (f.remember) v[f.name] = remembered(f.remember);        // a remembered choice; never for a force or a deletion
    return v;
  });
  const [loading, setLoading] = useState(fields.some(f => f.load));
  useEffect(() => {      // the full message of a commit, to edit it (the graph only carries the subject)
    if (!fields.some(f => f.load) || !commit) return undefined;
    let alive = true;
    api("GET", "repos/" + repoId + "/commits/" + commit.sha).then(d => alive && (setValues(v => ({ ...v, message: (d.message || "").trim() })), setLoading(false))).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);
  const visible = fields.filter(f => !f.when || Object.entries(f.when).every(([k, v]) => values[k] === v));
  const problem = loading ? "loading" : formProblem(visible, values);
  const set = (f, v) => { setValues({ ...values, [f.name]: v }); if (f.remember) remember(f.remember, v); };
  const pickTemplate = (f, t) => {
    set(f, t.value);
    // the cursor goes to the end of the field: after a prefix, the name of the task is typed next
    setTimeout(() => { const el = document.querySelector(".modal input:not([type=checkbox])"); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0);
  };
  const go = () => { if (!problem) onSubmit(values); };
  return html`<${Modal} title=${title} onClose=${onClose} footer=${html`<${Button} variant="ghost" onClick=${onClose}>Cancel<//><${Button} variant=${tone === "destructive" ? "destructive" : "default"} disabled=${!!problem} onClick=${go}>${submitLabel}<//>`}>
    ${visible.map(f => f.type === "checkbox"
      ? html`<label class="check"><input type="checkbox" checked=${!!values[f.name]} onChange=${e => set(f, e.target.checked)} /> ${f.label}</label>${f.hint ? html`<span class="field-hint">${f.hint}</span>` : null}`
      : html`<${Field} label=${f.label} hint=${f.hint}>${f.type === "select"
        ? html`<select class="input" value=${values[f.name]} onChange=${e => set(f, e.target.value)}>${f.options.map(o => html`<option value=${o.value}>${o.label}</option>`)}</select>`
        : f.type === "textarea"
          ? html`<${Textarea} class=${f.mono ? "mono" : ""} rows="6" disabled=${loading} autofocus=${f.autofocus} value=${values[f.name]} onInput=${e => set(f, e.target.value)} />`
          : html`<${Input} class=${f.mono ? "mono" : ""} autofocus=${f.autofocus} placeholder=${f.placeholder} value=${values[f.name]} onInput=${e => set(f, e.target.value)} onKeyDown=${e => e.key === "Enter" && go()} />${f.templates ? html`<${TemplateChips} templates=${f.templates} value=${values[f.name]} onPick=${t => pickTemplate(f, t)} />` : null}`}<//>`)}
    ${problem && problem !== "loading" && Object.values(values).some(Boolean) ? html`<span class="field-hint warn" role="alert">${problem}</span>` : null}
  <//>`;
}
