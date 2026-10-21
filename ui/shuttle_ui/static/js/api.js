/* Talking to the local server. The token comes in the URL fragment and is removed from the address bar; it is kept for this
 * tab only (sessionStorage), so that a refresh does not lock you out. Closing the tab forgets it. */
function readToken() {
  const fromUrl = new URLSearchParams((location.hash || "").replace(/^#/, "")).get("token");
  try {
    if (fromUrl) sessionStorage.setItem("shuttle.token", fromUrl);
    return fromUrl || sessionStorage.getItem("shuttle.token") || "";
  } catch (e) { return fromUrl || ""; }
}
const TOKEN = readToken();
try { history.replaceState(null, "", location.pathname); } catch (e) { /* not in a page */ }

import { OLD_SERVER, isMissingRoute } from "./version.js";

export async function api(method, path, body) {
  const headers = { "X-Shuttle-Token": TOKEN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch("/api/" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.status === 401) throw new Error("This page has no valid token: open the link that `git shuttle ui` printed.");
  if (isMissingRoute(res.status, data)) { const e = new Error(OLD_SERVER); e.oldServer = true; throw e; }
  if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
  return data;
}
