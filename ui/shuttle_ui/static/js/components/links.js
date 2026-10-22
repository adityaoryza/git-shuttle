/* A link out of the page, and the mark of the product. */
import { html } from "../../vendor/preact-htm.js";
import { EXTERNAL } from "../brand.js";

export function ExternalLink({ href, children, class: klass, ...rest }) {
  return html`<a href=${href} target=${EXTERNAL.target} rel=${EXTERNAL.rel} class=${klass} ...${rest}>${children}</a>`;
}

export function BrandMark({ size = 32, class: klass }) {
  return html`<img src="/static/brand/mark.svg" width=${size} height=${size} alt="" class=${klass} />`;
}
