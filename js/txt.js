export function decode(buf) {
  const u = new Uint8Array(buf);
  if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return { text: new TextDecoder("utf-8").decode(u.subarray(3)), enc: "UTF-8 BOM" };
  if (u[0] === 0xFF && u[1] === 0xFE) return { text: new TextDecoder("utf-16le").decode(u.subarray(2)), enc: "UTF-16LE" };
  if (u[0] === 0xFE && u[1] === 0xFF) return { text: new TextDecoder("utf-16be").decode(u.subarray(2)), enc: "UTF-16BE" };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(u), enc: "UTF-8" }; } catch {}
  return { text: new TextDecoder("euc-kr").decode(u), enc: "CP949" };
}
const END = /[.?!…。！？」』"”’)\]]$/, LIST = /^\s*([-*•·▪]|\d+[.)]|[①-⑩])\s+/, QUOTE = /^\s*[“"「『‘'(]/;
const HEAD = /^\s*(제\s*\d+\s*[장절화편부]|chapter\s+\d+|\d+\s*-\s*\d+\s*$|[#■◆●▶]\s*\S)/i;
const CJK_END = /[\u3040-\u30ff\u4e00-\u9fff]$/, CJK_START = /^[\u3040-\u30ff\u4e00-\u9fff]/;
export function restore(text, { mode = "auto", join = "auto", keepDialogue = true } = {}) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map(l => l.replace(/[ \t\u3000]+$/, ""));
  if (mode === "keep") return { text: lines.join("\n"), paragraphs: lines.length };
  const lens = lines.filter(l => l.trim()).map(l => [...l].length).sort((a, b) => a - b);
  const W = lens.length ? lens[Math.floor(lens.length * 0.9)] : 0;
  const sep = (a, b) => join === "none" ? "" : join === "space" ? " " : (CJK_END.test(a) && CJK_START.test(b) ? "" : " ");
  const out = []; let cur = null, lastLen = 0, lock = false;
  const flush = () => { if (cur !== null) out.push(cur); cur = null; };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { flush(); lock = false; continue; }
    const head = mode === "auto" && HEAD.test(l) && [...l].length <= 40;
    const special = mode === "auto" && (LIST.test(l) || (keepDialogue && QUOTE.test(l)));
    const endShort = mode === "auto" && cur !== null && END.test(cur) && lastLen < W * 0.85;
    if (cur === null || lock || head || special || endShort) { flush(); cur = l; lock = head; }
    else cur += sep(cur, l) + l;
    lastLen = [...l].length;
  }
  flush();
  return { text: out.join("\n\n"), paragraphs: out.length };
}
let map;
function table() {
  if (map) return map; map = new Map(); const d = new TextDecoder("euc-kr");
  for (let a = 0x81; a <= 0xFE; a++) for (let b = 0x41; b <= 0xFE; b++) {
    const s = d.decode(new Uint8Array([a, b]));
    if (s.length === 1 && s !== "\uFFFD" && !map.has(s)) map.set(s, [a, b]);
  }
  const ks = new Set(); for (const [ch, [a]] of map) if (ch >= "가" && ch <= "힣" && a >= 0xB0 && a <= 0xC8) ks.add(ch);
  const rng = (x, y) => Array.from({ length: y - x + 1 }, (_, i) => x + i), slots = [];
  for (let a = 0x81; a <= 0xA0; a++) for (const b of [...rng(0x41, 0x5A), ...rng(0x61, 0x7A), ...rng(0x81, 0xFE)]) slots.push([a, b]);
  for (let a = 0xA1; a <= 0xC6; a++) for (const b of [...rng(0x41, 0x5A), ...rng(0x61, 0x7A), ...rng(0x81, 0xA0)]) if (a !== 0xC6 || b <= 0x52) slots.push([a, b]);
  let i = 0;
  for (let c = 0xAC00; c <= 0xD7A3; c++) { const ch = String.fromCharCode(c); if (ks.has(ch)) continue; const sl = slots[i++]; if (sl && !map.has(ch)) map.set(ch, sl); }
  return map;
}
export const _table = table;
export function encode(text, enc) {
  if (enc !== "cp949") { const b = new TextEncoder().encode(text); if (enc !== "utf8bom") return { bytes: b, bad: 0 };
    const o = new Uint8Array(b.length + 3); o.set([0xEF, 0xBB, 0xBF]); o.set(b, 3); return { bytes: o, bad: 0 }; }
  const m = table(), o = []; let bad = 0;
  for (const ch of text) { const c = ch.codePointAt(0);
    if (c < 0x80) o.push(c); else if (m.has(ch)) o.push(...m.get(ch)); else { o.push(0x3F); bad++; } }
  return { bytes: Uint8Array.from(o), bad };
}
export const applyNewline = (s, nl) => s.replace(/\r\n?|\n/g, nl);
export function sanitizeFilename(name, stripExt = true) {
  const base = stripExt ? String(name || "book").replace(/\.[^.]+$/, "") : String(name || "book");
  const clean = base.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").replace(/\.{2,}/g, ".").trim();
  return (clean || "book").slice(0, 120);
}
