/* What the About dialog says about updates: from the answer of the server to a title, a tone and the buttons that make sense.
 * Pure, tested with node. */

// info: what POST /api/update/check answered → { tone, title, detail, canUpdate, notes }
export function describeCheck(info) {
  if (!info) return { tone: "neutral", title: "", detail: "", canUpdate: false, notes: "" };
  const have = info.current, latest = info.latest;
  if (!info.available) {
    return { tone: "ok", title: "You have the latest release (" + have + ")", detail: "", canUpdate: false, notes: info.notes || "" };
  }
  const title = latest + " is available (you have " + have + ")";
  if (info.can_update) return { tone: "info", title, detail: "", canUpdate: true, notes: info.notes || "" };
  return { tone: "warn", title, detail: info.reason || "This copy cannot be updated from here.", canUpdate: false, notes: info.notes || "" };
}

// What was installed: the server starts again by itself (the page reloads when it is back); where it cannot, the page says to start it by hand.
export function describeApplied(result) {
  const version = result && result.version ? result.version : "";
  return {
    title: version ? "Updated to " + version : "Updated",
    detail: result && result.restart ? "The server starts again by itself, and this page reloads when it is back."
      : "Stop git shuttle ui (Ctrl-C) and start it again to use it.",
  };
}

// The reminder under the top bar: what it says, or nothing (turned off, nothing newer, or put off for this release).
export function noticeBanner(notice) {
  if (!notice || !notice.enabled || !notice.available || notice.snoozed) return null;
  return {
    title: "git-shuttle " + notice.latest + " is available",
    detail: "You have " + notice.current + ".",
    notes: notice.notes || "",
    canUpdate: !!notice.can_update,
    action: notice.can_update ? "Update to " + notice.latest : "How to update",
  };
}

// An error of the server or of the connection → one sentence for the dialog.
export function describeFailure(error) {
  const message = error && error.message ? String(error.message) : "";
  return message || "Something went wrong: try again.";
}
