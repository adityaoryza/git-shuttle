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
  const [vaultInfo, setVaultInfo] = useState({ available: false, label: "", how: "" });   // where a password can be kept on this computer
  const [remember, setRemember] = useState(false);     // keep it on this computer, after a login that worked
  const [other, setOther] = useState(false);           // type a password although one is saved
  const [saveNote, setSaveNote] = useState(null);      // what happened to the password after the last job
  const [form, setForm] = useState(null);              // the form of a target, while it is open
  const [editing, setEditing] = useState(false);
  const target = (targets || []).find(t => t.target === name) || null;
  const modules = edited === null ? "" : tidyModules(edited);

  async function loadTargets(keep) {
    try {
      const got = await api("GET", "repos/" + repoId + "/deploy");
      const list = got.targets;
      setVaultInfo(got.vault || { available: false, label: "", how: "" });
      setTargets(list);
      setName(current => (list.some(t => t.target === (keep || current)) ? (keep || current) : list.length ? list[0].target : ""));
    } catch (e) { onError(e); }
  }
  useEffect(() => { loadTargets(); return () => setPassword(""); }, [repoId]);

  // What a deploy would do now. Another server (or command) starts from nothing; the modules being typed only read it again a moment
  // later, and keep what is on screen meanwhile: the field must not disappear under the cursor (the keys would go to the shortcuts of the page).
  const [planning, setPlanning] = useState(false);
  useEffect(() => { setPlan(null); setPlanError(""); }, [repoId, name, target && target.command]);
  useEffect(() => {
    if (!target || (edited !== null && modules && !MODULES_RE.test(modules))) return undefined;
    let alive = true;
    setPlanning(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api("POST", "repos/" + repoId + "/deploy/plan", { target: target.target, ...(modules ? { modules } : {}) });
        if (alive) { setPlan(r.plan); setPlanError(""); }
      } catch (e) { if (alive) setPlanError(e.message); }
      if (alive) setPlanning(false);
    }, edited === null ? 0 : 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [repoId, name, modules, target && target.command]);

  // the typed name and the password belong to one server and one deploy
  useEffect(() => { setTyped(""); setPassword(""); setEdited(null); setKeep(false); setRemember(false); setOther(false); setSaveNote(null); }, [name]);

  // after a deploy, or a change of the servers: read them again; the password is gone either way
  const doneJob = runner.job && runner.job.state !== "running" && /^deploy/.test(runner.job.action || "") ? runner.job : null;
  const handled = useRef(null);
  useEffect(() => {
    if (!doneJob || handled.current === doneJob.id) return;
    handled.current = doneJob.id;
    if (!keep) setPassword("");
    setTyped("");
    const unreadable = doneJob.state !== "done" && (doneJob.steps || []).some(st => /saved password is not there|keychain/.test(st.output || ""));
    if (unreadable) { setOther(true); setSaveNote({ tone: "warn", text: "The saved password could not be read: type the password of the server below (it can be saved again)." }); }
    else if (doneJob.remembered) setSaveNote({ tone: "ok", text: "The password is saved on this computer (" + vaultInfo.label + "). You will not have to type it again." });
    else if (doneJob.remember_error) setSaveNote({ tone: "warn", text: "The password was not saved: " + doneJob.remember_error });
    setRemember(false); if (!unreadable) setOther(false);
    // a server that was just saved is the one shown; after a removal the first is
    const saved = doneJob.action === "deploy-setup" && doneJob.params ? doneJob.params.target : "";
    loadTargets(doneJob.action === "deploy-forget" ? "" : saved || name);
  }, [doneJob && doneJob.id]);

  // the saved password is used unless one was typed
  const saved = !!(target && target.saved) && !other;
  const params = target ? deployParams(target, { modules, typed }) : {};
  const problems = deployProblems(target, plan, { modules, typed, password: password || (saved ? "saved" : "") });
  const ready = !!target && !!plan && !planning && problems.length === 0;
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
  // the login was refused because there was no password (and no key): say so on the page, where the field is
  const needsPassword = doneJob && /^deploy(-check)?$/.test(doneJob.action) && doneJob.state !== "done" && !password
    && (doneJob.steps || []).some(st => /can only use a key/.test(st.output || ""));
  function useLoginShell() {
    runner.run("deploy-setup", setupParams({ ...formOf(target), login: true }), "Run the command of " + target.target + " in a login shell");
  }
  const how = () => (saved && !password ? { use_saved: true } : password && remember && vaultInfo.available ? { remember: true } : undefined);
  function test() {
    setSaveNote(null);
    runner.run("deploy-check", { target: target.target }, "Test the connection to " + target.target, password || undefined, how());
    if (!keep) setPassword("");
  }
  function deploy() {
    setSaveNote(null);
    runner.run("deploy", params, label, password || undefined, how());
    if (!keep) setPassword("");
  }
  async function forgetPassword() {
    if (!await confirm({ title: "Forget the saved password?", body: "It is removed from this computer. The server is not touched.", confirmLabel: "Forget" })) return;
    try {
      await api("POST", "repos/" + repoId + "/deploy/forget-password", { target: target.target });
      setSaveNote({ tone: "ok", text: "The saved password was removed." });
      await loadTargets(target.target);
    } catch (e) { onError(e); }
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
    ${target && target.command.includes("{modules}") && (plan || edited !== null) ? html`<${Field} label="Modules" hint=${edited === null ? (plan && plan.modules ? "Found from what changed since the last deploy. Change them if needed." : "None found: name them.") : planning ? "Typed by hand · reading what would run…" : "Typed by hand."}>
      <${Input} value=${edited === null ? (plan ? plan.modules : "") : edited} onInput=${e => { setEdited(e.target.value); runner.clearPreview(); }} placeholder="sale_documents,custom_technicien" /><//>` : null}
    ${target && target.confirm === "name" ? html`<${Field} label=${"Type “" + target.target + "” to confirm"} hint=${typed && typed !== target.target ? "It does not match: type exactly “" + target.target + "”." : ""}><${Input} value=${typed} onInput=${e => setTyped(e.target.value)} autocomplete="off" aria-invalid=${typed && typed !== target.target ? "true" : undefined} /><//>` : null}
    ${target && saved ? html`<div class="deploy-saved"><span><strong>✓ Password saved</strong> on this computer (${vaultInfo.label || "the keychain"}) · ${target.saved.replace("T", " ").slice(0, 16)}</span>
      <span class="deploy-saved-actions"><${Button} variant="ghost" size="sm" onClick=${() => setOther(true)}>Use another<//><${Button} variant="ghost" size="sm" onClick=${forgetPassword} disabled=${runner.busy}>Forget<//></span></div>` : null}
    ${target && !saved ? html`<${Field} label="Password of the server" hint="For the login and for sudo, when the server asks. Not saved unless you tick the box below. Empty: you log in with a key.">
      <${Input} type="password" value=${password} onInput=${e => setPassword(e.target.value)} autocomplete="new-password" /><//>
      ${vaultInfo.available
        ? html`<label class="check"><input type="checkbox" checked=${remember} onChange=${e => setRemember(e.target.checked)} /> Remember on this computer</label>
            <p class="hint">${remember ? "Kept by " + vaultInfo.label + ", only after the login worked: never in the repository or a file in clear, and this page never gets it back. You can forget it here at any time." : "So that you do not type it again. It is kept by " + vaultInfo.label + "."}</p>`
        : html`<label class="check"><input type="checkbox" checked=${keep} onChange=${e => setKeep(e.target.checked)} /> Keep it until I close this page</label>
            <details class="advanced"><summary>Why can I not save it?</summary><p class="hint">${vaultInfo.how || "No keychain was found on this computer."} A key is the safest: ssh-copy-id once, and no password is needed.</p></details>`}` : null}
    ${saveNote ? html`<${Alert} tone=${saveNote.tone} title=${saveNote.tone === "ok" ? "Done" : "Not saved"}><p>${saveNote.text}</p><//>` : null}
    ${needsPassword ? html`<${Alert} tone="warn" title="The server asks for a password"><p>Type the password of the server in the field above, then try again. It is used once and never saved.</p><//>` : null}
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
