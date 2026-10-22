/* The Deploy tab: after a push, update a server over ssh. The servers (targets) are saved in the repository; a deploy is previewed
 * like every other action. The sudo password, when the server asks, is typed here, used once, and not saved. */
import { html, useState, useEffect, useRef } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { branchOptions } from "../logic.js";
import { MODULES_RE, deployParams, deployProblems, emptyForm, formOf, lastDeployText, setupParams, setupProblems, suggestRequireName, tidyModules } from "../deploy.js";
import { PreviewBox, settings } from "./panel.js";
import { Alert, Badge, Button, Field, Input, Skeleton } from "./ui.js";

export function DeployTab({ repoId, status, branches, runner, onError, confirm }) {
  const c = settings(status);
  const [targets, setTargets] = useState(null);
  const [name, setName] = useState("");
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState("");
  const [edited, setEdited] = useState(null);          // the modules typed by hand; null: the ones that were found
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [keep, setKeep] = useState(false);             // keep the password until the page is closed (in this page only: never saved)
  const [form, setForm] = useState(null);              // the form of a target, while it is open
  const [editing, setEditing] = useState(false);
  const target = (targets || []).find(t => t.target === name) || null;
  const modules = edited === null ? "" : tidyModules(edited);

  async function loadTargets(keep) {
    try {
      const list = (await api("GET", "repos/" + repoId + "/deploy")).targets;
      setTargets(list);
      setName(current => (list.some(t => t.target === (keep || current)) ? (keep || current) : list.length ? list[0].target : ""));
    } catch (e) { onError(e); }
  }
  useEffect(() => { loadTargets(); return () => setPassword(""); }, [repoId]);

  // What a deploy would do now: read again when the server, or the modules (a moment after they are typed), change.
  useEffect(() => {
    setPlan(null); setPlanError("");
    if (!target || (edited !== null && modules && !MODULES_RE.test(modules))) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const r = await api("POST", "repos/" + repoId + "/deploy/plan", { target: target.target, ...(modules ? { modules } : {}) });
        if (alive) setPlan(r.plan);
      } catch (e) { if (alive) setPlanError(e.message); }
    }, edited === null ? 0 : 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [repoId, name, modules, target && target.command]);

  // the typed name and the password belong to one server and one deploy
  useEffect(() => { setTyped(""); setPassword(""); setEdited(null); setKeep(false); }, [name]);

  // after a deploy, or a change of the servers: read them again; the password is gone either way
  const doneJob = runner.job && runner.job.state !== "running" && /^deploy/.test(runner.job.action || "") ? runner.job : null;
  const handled = useRef(null);
  useEffect(() => {
    if (!doneJob || handled.current === doneJob.id) return;
    handled.current = doneJob.id;
    if (!keep) setPassword("");
    setTyped("");
    // a server that was just saved is the one shown; after a removal the first is
    const saved = doneJob.action === "deploy-setup" && doneJob.params ? doneJob.params.target : "";
    loadTargets(doneJob.action === "deploy-forget" ? "" : saved || name);
  }, [doneJob && doneJob.id]);

  const params = target ? deployParams(target, { modules, typed }) : {};
  const problems = deployProblems(target, plan, { modules, typed, password });
  const ready = !!target && !!plan && problems.length === 0;
  const label = target ? "Deploy to " + target.target : "Deploy";

  function open(forTarget) {
    setEditing(!!forTarget);
    setForm(forTarget ? formOf(forTarget) : emptyForm(c.integration));
  }
  const patch = values => setForm(f => ({ ...f, ...values }));
  const remoteBranches = branchOptions(branches).map(o => o.name);
  async function remove() {
    if (!target) return;
    if (await confirm({ title: "Remove the server “" + target.target + "”?", body: "Its settings leave this repository. The server itself is not touched.", confirmLabel: "Remove", tone: "destructive" })) {
      runner.run("deploy-forget", { target: target.target }, "Remove the server " + target.target);
    }
  }
  // the server did not find the command: it is probably an alias of its login shell: one click runs it in a login shell
  const notFound = doneJob && doneJob.action === "deploy" && doneJob.state !== "done" && target && !formOf(target).login
    && (doneJob.steps || []).some(st => /did not find the command/.test(st.output || ""));
  function useLoginShell() {
    runner.run("deploy-setup", setupParams({ ...formOf(target), login: true }), "Run the command of " + target.target + " in a login shell");
  }
  function test() {
    runner.run("deploy-check", { target: target.target }, "Test the connection to " + target.target, password || undefined);
    if (!keep) setPassword("");
  }
  function deploy() {
    runner.run("deploy", params, label, password || undefined);
    if (!keep) setPassword("");
  }
  function save() {
    runner.run("deploy-setup", setupParams(form), "Save the server " + form.target);
    setForm(null);
  }

  if (form) {
    const bad = setupProblems(form, { editing });
    return html`<div class="deploy">
      <h3>${editing ? "Edit " + form.target : "Add a server"}</h3>
      ${editing ? null : html`<${Field} label="Name" hint="staging, production…"><${Input} value=${form.target} onInput=${e => patch({ target: e.target.value })} placeholder="staging" autofocus /><//>`}
      <${Field} label="Server" hint="Its address, or an alias of ~/.ssh/config."><${Input} value=${form.host} onInput=${e => patch({ host: e.target.value })} placeholder="203.0.113.10" /><//>
      <${Field} label="User" hint="The user you log in with on that server. Empty: ssh uses your own user name, or the User of ~/.ssh/config."><${Input} value=${form.user} onInput=${e => patch({ user: e.target.value })} placeholder="deploy" autocomplete="off" /><//>
      <${Field} label="Command" hint="What the server runs to update itself. {modules} is replaced by the modules that changed."><${Input} value=${form.command} onInput=${e => patch({ command: e.target.value })} placeholder="staging-update {modules}" /><//>
      <label class="check"><input type="checkbox" checked=${form.login} onChange=${e => patch({ login: e.target.checked })} /> It works in my own login on the server, but not here (an alias): run it in a login shell</label>
      <${Field} label="Branch the server runs"><select class="input" value=${form.branch} onChange=${e => patch({ branch: e.target.value, ...(editing ? {} : { require_name: suggestRequireName(e.target.value, { integration: c.integration, release: c.release, base: c.release }) }) })}>
        ${[...new Set([form.branch, ...remoteBranches].filter(Boolean))].map(b => html`<option value=${b}>${b}</option>`)}</select><//>
      <p class="hint">The password is not asked here: you type it when you deploy, and it is never saved.</p>
      <details class="advanced"><summary>More options</summary>
        <${Field} label="Modules"><select class="input" value=${form.detector} onChange=${e => patch({ detector: e.target.value })}>
          <option value="none">I do not use {modules}</option><option value="odoo">Odoo: the folders with a __manifest__.py that changed</option></select><//>
        <label class="check"><input type="checkbox" checked=${form.require_name} onChange=${e => patch({ require_name: e.target.checked })} /> Type the name of the server before each deploy (use it for production)</label>
        <${Field} label="ssh port" hint="Empty: the default."><${Input} value=${form.port} onInput=${e => patch({ port: e.target.value })} inputmode="numeric" /><//>
      </details>
      ${bad.length ? html`<${Alert} tone="warn" title="Not ready"><ul>${bad.map(p => html`<li>${p}</li>`)}</ul><//>` : null}
      <div class="actions"><${Button} onClick=${save} disabled=${bad.length > 0 || runner.busy}>Save<//><${Button} variant="ghost" onClick=${() => setForm(null)}>Cancel<//></div>
    </div>`;
  }

  if (targets === null) return html`<div class="deploy"><${Skeleton} /></div>`;
  if (!targets.length) {
    return html`<div class="deploy">
      <${Alert} tone="info" title="Add the server you deploy to"><p>You need its address, the user you log in with, and the command that updates it. Then, after a push, one click updates the server.</p><//>
      <div class="actions"><${Button} onClick=${() => open(null)}>Add a server<//></div>
    </div>`;
  }
  return html`<div class="deploy">
    <div class="deploy-pick">
      <${Field} label="Server"><select class="input" value=${name} onChange=${e => setName(e.target.value)}>${targets.map(t => html`<option value=${t.target}>${t.target} — ${t.host}</option>`)}</select><//>
      <${Button} variant="ghost" size="sm" onClick=${() => open(target)} disabled=${!target}>Edit<//>
      <${Button} variant="ghost" size="sm" onClick=${() => open(null)}>Add<//>
      <${Button} variant="ghost" size="sm" onClick=${remove} disabled=${!target || runner.busy}>Remove<//>
    </div>
    ${target ? html`<p class="hint">${lastDeployText(target)}${target.confirm === "name" ? " · asks for its name" : ""}</p>` : null}
    ${planError ? html`<${Alert} tone="bad" title="Cannot deploy yet"><p>${planError}</p><//>` : null}
    ${target && !plan && !planError ? html`<${Skeleton} />` : null}
    ${plan ? html`<dl class="deploy-facts">
      <dt>Deploys</dt><dd><code>${plan.branch}</code> at <code>${plan.tip.slice(0, 9)}</code> ${plan.subject}</dd>
      <dt>To</dt><dd><code>${plan.host}${plan.port ? ":" + plan.port : ""}</code>${plan.host.includes("@") ? "" : html` <span class="hint">no user: ssh uses your own (Edit the server to add it)</span>`}</dd>
      <dt>Runs</dt><dd><code>${plan.command}</code></dd>
    </dl>` : null}
    ${plan && target.command.includes("{modules}") ? html`<${Field} label="Modules" hint=${edited === null ? (plan.modules ? "Found from what changed since the last deploy. Change them if needed." : "None found: name them.") : "Typed by hand."}>
      <${Input} value=${edited === null ? plan.modules : edited} onInput=${e => { setEdited(e.target.value); runner.clearPreview(); }} placeholder="sale_documents,custom_technicien" /><//>` : null}
    ${target && target.confirm === "name" ? html`<${Field} label=${"Type “" + target.target + "” to confirm"} hint=${typed && typed !== target.target ? "It does not match: type exactly “" + target.target + "”." : ""}><${Input} value=${typed} onInput=${e => setTyped(e.target.value)} autocomplete="off" aria-invalid=${typed && typed !== target.target ? "true" : undefined} /><//>` : null}
    ${target ? html`<${Field} label="Password of the server" hint="For the login and for sudo, when the server asks. Used once, never saved or logged. Empty: you log in with a key.">
      <${Input} type="password" value=${password} onInput=${e => setPassword(e.target.value)} autocomplete="new-password" /><//>
      <label class="check"><input type="checkbox" checked=${keep} onChange=${e => setKeep(e.target.checked)} /> Keep it until I close this page</label>` : null}
    ${notFound ? html`<${Alert} tone="warn" title="The server does not find the command"><p>If you can type it in your own login on the server, it is an alias there: run it in a login shell.</p>
      <div class="actions"><${Button} size="sm" onClick=${useLoginShell} disabled=${runner.busy}>Run it in a login shell<//></div><//>` : null}
    <div class="actions">
      <${Button} onClick=${deploy} disabled=${runner.busy || !ready}>${label}<//>
      <${Button} variant="secondary" onClick=${test} disabled=${runner.busy || !target}>Test the connection<//>
      <${Button} variant="ghost" onClick=${() => runner.preview("deploy", params)} disabled=${runner.busy || !plan || problems.some(p => /modules/i.test(p))}>Show the exact command<//>
    </div>
    ${problems.length && plan ? html`<p class="hint deploy-why"><strong>Cannot run yet:</strong> ${problems[0]}</p>` : null}
    <${PreviewBox} runner=${runner} action="deploy" />
  </div>`;
}
