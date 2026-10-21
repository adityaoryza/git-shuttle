/* Talking to the local server. The token comes in the URL fragment, stays in memory and is removed from the address bar. */
const TOKEN = new URLSearchParams((typeof location !== "undefined" ? location.hash || "" : "").replace(/^#/, "")).get("token") || "";
try { history.replaceState(null, "", location.pathname); } catch (e) { /* not in a page */ }

export async function api(method, path, body) {
  const headers = { "X-Shuttle-Token": TOKEN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch("/api/" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (!res.ok) throw new Error((data && data.error) || "HTTP " + res.status);
  return data;
}
