/* Reading a unified diff (what `git diff` prints for one file) into rows a page can draw. Pure, tested with node. */

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

// → { header: [line], hunks: [{ header, section, rows: [{ type, old, new, text }] }], additions, deletions }
// type: "ctx" | "add" | "del" | "note" ("\ No newline at end of file"); old/new are the line numbers on each side (or null).
export function parseDiff(text) {
  const header = [], hunks = [];
  let hunk = null, oldNo = 0, newNo = 0, additions = 0, deletions = 0;
  const lines = String(text || "").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    const m = HUNK.exec(line);
    if (m) {
      oldNo = +m[1]; newNo = +m[3];
      hunk = { header: line, section: m[5] || "", rows: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) { header.push(line); continue; }
    const mark = line[0], body = line.slice(1);
    if (mark === "+") { hunk.rows.push({ type: "add", old: null, new: newNo++, text: body }); additions++; }
    else if (mark === "-") { hunk.rows.push({ type: "del", old: oldNo++, new: null, text: body }); deletions++; }
    else if (mark === "\\") hunk.rows.push({ type: "note", old: null, new: null, text: line.slice(2) });
    else hunk.rows.push({ type: "ctx", old: oldNo++, new: newNo++, text: mark === " " ? body : line });
  }
  return { header, hunks, additions, deletions };
}

// The same rows side by side: a run of removed lines meets the run of added lines that follows it.
// → [{ left: row | null, right: row | null }]
export function splitRows(rows) {
  const out = [];
  for (let i = 0; i < rows.length;) {
    const row = rows[i];
    if (row.type === "ctx") { out.push({ left: row, right: row }); i++; continue; }
    if (row.type === "note") { out.push({ left: null, right: row, note: true }); i++; continue; }
    const dels = [], adds = [];
    while (i < rows.length && rows[i].type === "del") dels.push(rows[i++]);
    while (i < rows.length && rows[i].type === "add") adds.push(rows[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push({ left: dels[k] || null, right: adds[k] || null });
  }
  return out;
}

// What the header lines say about the file, for a caption: "renamed from x", "new file", "deleted"…
export function headerNotes(header) {
  const notes = [];
  for (const line of header || []) {
    let m;
    if ((m = /^rename from (.*)$/.exec(line))) notes.push("renamed from " + m[1]);
    else if (/^new file mode/.test(line)) notes.push("new file");
    else if (/^deleted file mode/.test(line)) notes.push("deleted file");
    else if ((m = /^old mode (\d+)/.exec(line))) notes.push("mode changed from " + m[1]);
    else if ((m = /^similarity index (\d+)%/.exec(line)) && m[1] !== "100") notes.push(m[1] + "% similar");
  }
  return notes;
}
