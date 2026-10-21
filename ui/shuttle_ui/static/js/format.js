/* Small formatting helpers. Pure, tested with node. */

export function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

const pad = n => String(n).padStart(2, "0");

// "2026-10-21 14:16" in the browser's time zone.
export function fullDate(seconds) {
  if (!seconds) return "";
  const d = new Date(seconds * 1000);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
