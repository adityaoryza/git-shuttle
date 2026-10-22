/* Updates, in the About dialog: nothing is asked of the internet until the button is clicked. */
import { html, useState, useEffect } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { describeApplied, describeCheck, describeFailure } from "../update.js";
import { ExternalLink } from "./links.js";
import { Alert, Button } from "./ui.js";

export function UpdatePanel({ auto, notify }) {
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
