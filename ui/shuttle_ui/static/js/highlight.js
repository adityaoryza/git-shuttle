/* Light syntax colours for one line of code: comments, strings, numbers and keywords. Pure, tested with node.
 * A line is read on its own (a comment or string that goes on over several lines is not followed): good enough to read a diff. */

const KEYWORDS = {
  py: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda None not or pass raise return self try while with yield True False",
  js: "async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new null of return static super switch this throw try typeof undefined var void while yield true false",
  sh: "if then else elif fi for while do done case esac function in local export return exit echo set unset source",
  css: "important",
  xml: "",
  json: "true false null",
  md: "",
};
const LANGS = { py: "py", js: "js", mjs: "js", jsx: "js", ts: "js", tsx: "js", json: "json", xml: "xml", html: "xml", htm: "xml", svg: "xml", css: "css", scss: "css", sh: "sh", bash: "sh", zsh: "sh", md: "md", yml: "sh", yaml: "sh", csv: "" };
const COMMENT = { py: "#", sh: "#", js: "//", css: "", xml: "", json: "", md: "" };

export function languageOf(path) {
  const ext = String(path).split("/").pop().split(".").pop().toLowerCase();
  return LANGS[ext] || "";
}

// → [{ kind: "kw" | "str" | "com" | "num" | "tag" | "", text }] ; the pieces put back together are the line.
export function highlightLine(line, lang) {
  if (!lang || line.length > 400) return [{ kind: "", text: line }];
  const words = new Set((KEYWORDS[lang] || "").split(" ").filter(Boolean));
  const out = [];
  const push = (kind, text) => { if (!text) return; const last = out[out.length - 1]; if (last && last.kind === kind) last.text += text; else out.push({ kind, text }); };
  const comment = COMMENT[lang];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    let m;
    if (lang === "md") { if (/^#{1,6} /.test(line)) { push("kw", line); break; } push("", line); break; }
    if (lang === "xml" && (m = /^<!--.*?-->|^<!--.*/.exec(rest))) { push("com", m[0]); i += m[0].length; continue; }
    if (lang === "xml" && (m = /^<\/?[A-Za-z][\w:.-]*/.exec(rest))) { push("tag", m[0]); i += m[0].length; continue; }
    if (lang === "css" && (m = /^\/\*.*?\*\/|^\/\*.*/.exec(rest))) { push("com", m[0]); i += m[0].length; continue; }
    if (lang === "js" && (m = /^\/\*.*?\*\//.exec(rest))) { push("com", m[0]); i += m[0].length; continue; }
    if (comment && rest.startsWith(comment) && !(lang === "sh" && i > 0 && /\S/.test(line[i - 1]))) { push("com", rest); break; }
    if ((m = /^("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)/.exec(rest))) { push("str", m[0]); i += m[0].length; continue; }
    if ((m = /^\d[\d._xa-fA-F]*/.exec(rest)) && !/\w/.test(line[i - 1] || "")) { push("num", m[0]); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_][\w-]*/.exec(rest))) { push(words.has(m[0]) ? "kw" : "", m[0]); i += m[0].length; continue; }
    push("", rest[0]); i++;
  }
  return out;
}
