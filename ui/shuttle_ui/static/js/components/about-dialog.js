/* About: what this is, who made it, where to find the code. The page asks nobody for anything until a link is clicked. */
import { html } from "../../vendor/preact-htm.js";
import { AUTHOR, LINKS, PRODUCT, PROJECT_LINKS, TAGLINE } from "../brand.js";
import { BrandMark, ExternalLink } from "./links.js";
import { UpdatePanel } from "./update-panel.js";
import { Button, Modal } from "./ui.js";

export function AboutDialog({ version, auto, notify, onClose }) {
  return html`<${Modal} title=${"About " + PRODUCT} onClose=${onClose} className="about" initialFocus=".modal-foot button" footer=${html`<${Button} onClick=${onClose}>Close<//>`}>
    <div class="about-head">
      <${BrandMark} size=${56} />
      <div>
        <h3 class="about-name">git-<b>shuttle</b></h3>
        <p class="hint">${version ? "Version " + version : "Version unknown: the server has not answered"}</p>
      </div>
    </div>
    <p class="about-tagline">${TAGLINE}</p>
    <section aria-label="Author">
      <h4 class="about-title">Made by ${AUTHOR}</h4>
      <div class="about-links">${Object.values(LINKS).map(link => html`<${ExternalLink} class="btn btn-outline btn-sm" href=${link.href}>${link.label}<//>`)}</div>
    </section>
    <section aria-label="Project">
      <h4 class="about-title">Project</h4>
      <ul class="about-list">${PROJECT_LINKS.map(link => html`<li><${ExternalLink} href=${link.href}>${link.label}<//></li>`)}</ul>
    </section>
    <${UpdatePanel} auto=${auto} notify=${notify} />
    <p class="hint">It runs on this machine only. This page loads nothing from the internet; a link opens in a new tab when you click it.</p>
  <//>`;
}
