/* The small mark of where a commit is on its way to production (see release-state.js): the same in the graph, the details and the Release tab. */
import { html } from "../../vendor/preact-htm.js";
import { STAGE_LABEL, stageTitle } from "../release-state.js";

const MARK = { prod: "✓", queued: "→", staging: "" };

export function StateChip({ stage, release, integration, compact }) {
  if (!stage) return null;
  return html`<span class=${"stage stage-" + stage.kind + (compact ? " stage-compact" : "")} title=${stageTitle(stage, release, integration)}>${MARK[stage.kind] ? html`<span aria-hidden="true">${MARK[stage.kind]}</span> ` : null}${STAGE_LABEL[stage.kind]}${stage.kind === "queued" && !compact ? html` <span class="stage-name">${stage.name}</span>` : null}</span>`;
}
