/* The page and the server are two programs that can be of different ages (an old `git shuttle ui` left running).
 * The page asks the server for its api level at start. Pure, tested with node. */

export const REQUIRED_API = 6;
export const OLD_SERVER = "The server is older than this page: stop it (Ctrl-C) and run git shuttle ui again.";

// A route the server does not have answers 404 "not found" (or something that is not JSON at all).
export function isMissingRoute(status, data) {
  return status === 404 && (!data || data.error === "not found");
}

// info: what GET /api/version answered (null when it failed). → { ok } or { ok: false, message }
export function checkVersion(info) {
  const level = info && typeof info.api === "number" ? info.api : 0;
  return level >= REQUIRED_API ? { ok: true } : { ok: false, message: OLD_SERVER };
}
