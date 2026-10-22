/* The reminder that a newer git-shuttle is out, like the one of other apps: under the top bar, with the button that updates right there.
 * "Later" is for that release only. A copy that cannot be updated from here (a git clone) is told how instead. */
import { html, useState } from "../../vendor/preact-htm.js";
import { api } from "../api.js";
import { describeApplied, describeFailure, noticeBanner } from "../update.js";
import { ExternalLink } from "./links.js";
import { Button } from "./ui.js";

export function UpdateBanner({ notice, notify, onHowTo, onLater }) {
  const [state, setState] = useState({ step: "idle" });       // idle | applying | applied | failed
  const banner = noticeBanner(notice);
  if (!banner) return null;
  const apply = async () => {
    setState({ step: "applying" });
    try {
      const result = await api("POST", "update/apply", {});
      setState({ step: "applied", result });
      if (notify) notify({ variant: "success", title: describeApplied(result).title, detail: describeApplied(result).detail });
    } catch (e) { setState({ step: "failed", message: describeFailure(e) }); }
  };
  if (state.step === "applied") {
    const done = describeApplied(state.result);
    return html`<div class="update-banner" role="status">
      <span class="update-banner-text"><strong>${done.title}</strong> <span class="hint">${done.detail}</span></span>
      <span class="update-banner-actions"><${Button} variant="ghost" size="sm" onClick=${onLater}>Dismiss<//></span>
    </div>`;
  }
  return html`<div class="update-banner" role="status">
    <span class="update-banner-text"><strong>${banner.title}</strong> <span class="hint">${banner.detail}</span>${state.step === "failed" ? html` <span class="update-banner-error">${state.message}</span>` : null}</span>
    <span class="update-banner-actions">
      ${banner.notes ? html`<${ExternalLink} href=${banner.notes}>What changed<//>` : null}
      <${Button} size="sm" busy=${state.step === "applying"} onClick=${banner.canUpdate ? apply : onHowTo}>${state.step === "applying" ? "Updating…" : banner.action}<//>
      <${Button} variant="ghost" size="sm" disabled=${state.step === "applying"} onClick=${onLater}>Later<//>
    </span>
  </div>`;
}
