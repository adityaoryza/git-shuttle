/* One changed file in a list: status letter, name (the folder in grey), +/- counts. */
import { html } from "../../vendor/preact-htm.js";
import { STATUS_NAMES } from "../filetree.js";
import { cn } from "./ui.js";

export function FileRow({ file, active, depth = 0, label, onPick, tag, plain }) {
  return html`<button type="button" role=${plain ? undefined : "option"} aria-selected=${plain ? undefined : active} class=${cn("frow", active && "on")} style=${{ paddingLeft: 8 + depth * 14 + "px" }} onClick=${() => onPick(file)} title=${file.path + (file.old_path ? " (was " + file.old_path + ")" : "")}>
    <span class=${"st st-" + (file.status === "?" ? "q" : file.status)} title=${STATUS_NAMES[file.status] || file.status}>${file.status}</span>
    <span class="fname">${label ? label : html`${file.path.split("/").pop()} <span class="fdir">${file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : ""}</span>`}</span>
    ${tag ? html`<span class="ftag">${tag}</span>` : null}<span class="fnum">${file.binary ? html`<span class="hint">bin</span>` : html`${file.additions ? html`<span class="add">+${file.additions}</span>` : null}${file.deletions ? html` <span class="del">−${file.deletions}</span>` : null}`}</span>
  </button>`;
}
