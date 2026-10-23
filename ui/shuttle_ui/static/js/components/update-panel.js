/* Updates, in the About dialog: looking for a release is a click; the reminder that one is out is the look that the server or a command makes, at most once an hour, and can be turned off here. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { describeApplied, describeCheck, describeFailure } from "../update.js";
import { ExternalLink } from "./links.js";
import { Alert, Button } from "./ui.js";

export function UpdatePanel({ auto, notify, notice, onNotice }) {
  const [state, setState] = useState({ step: "idle" });     // idle | checking | checked | applying | applied | failed
  const check = async () => {
    setState({ step: "checking" });
    try { setState({ step: "checked", info: await api("POST", "update/check", {}) }); }
    catch (e) { setState({ step: "failed", message: describeFailure(e) }); }
  };
  const apply = async () => {
    setState(s => ({ ...s, step: "applying" }));
    try {
      const result = await api("POST", "update/apply", {});
      setState({ step: "applied", result });
      if (notify) notify({ variant: "success", title: describeApplied(result).title, detail: describeApplied(result).detail });
    } catch (e) { setState(s => ({ step: "failed", message: describeFailure(e), info: s.info })); }
  };
  useEffect(() => { if (auto) check(); }, []);

  const { step } = state;
  const found = step === "checked" || step === "applying" ? describeCheck(state.info) : null;
  return html`<section aria-label="Updates" class="update-panel">
    <h4 class="about-title">Updates</h4>
    <div class="actions">
      <${Button} variant="outline" size="sm" busy=${step === "checking"} disabled=${step === "applying"} onClick=${check}>${step === "checking" ? "Looking…" : "Check for updates"}<//>
      ${found && found.canUpdate ? html`<${Button} size="sm" busy=${step === "applying"} onClick=${apply}>${step === "applying" ? "Updating…" : "Update to " + state.info.latest}<//>` : null}
    </div>
    ${notice ? html`<div class="update-remind">
      <label class="check"><input type="checkbox" checked=${notice.enabled} disabled=${notice.forced_off}
        onChange=${e => api("POST", "update/notice", { enabled: e.target.checked }).then(onNotice, e2 => setState(s => ({ ...s, step: "failed", message: describeFailure(e2) })))} /> Remind me when a new version is out</label>
      <p class="hint">${notice.forced_off ? "Turned off here by GIT_SHUTTLE_NO_UPDATE_CHECK." : "At most once an hour, this server (or a git-shuttle command) asks github.com for the number of the latest release: nothing about you or your repositories is sent."}</p>
    </div>` : null}
    <div aria-live="polite">
      ${found ? html`<${Alert} tone=${found.tone === "warn" ? "warn" : "info"} title=${found.title}>
        ${found.detail ? html`<span>${found.detail}</span>` : null}
        ${found.notes && state.info.available ? html`<span><${ExternalLink} href=${found.notes}>What changed<//></span>` : null}
      <//>` : null}
      ${step === "applied" ? html`<${Alert} tone="info" title=${describeApplied(state.result).title}><span>${describeApplied(state.result).detail}</span><//>` : null}
      ${step === "failed" ? html`<${Alert} tone="bad" title="Could not update"><span>${state.message}</span><//>` : null}
    </div>
  </section>`;
}
