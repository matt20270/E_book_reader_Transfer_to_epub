// OCR·PDF 글자 정리용 순수 함수 (브라우저/Node 공용, DOM 사용 없음)
export const LOW_CONF = 70;                 // 이 점수 미만 단어는 "확인 필요"로 표시
export const END = /[.?!…。！？」』"”’)\]]$/;
const CJK_END = /[\u3040-\u30ff\u4e00-\u9fff]$/, CJK_START = /^[\u3040-\u30ff\u4e00-\u9fff]/;
const HEAD = /^\s*(제\s*\d+\s*[장절화편부]|chapter\s+\d+|part\s+\d+|\d+\s*-\s*\d+\s*$)/i;
const HAS_LETTER = /[\p{L}\p{N}]/u;

// XML에서 허용되지 않는 문자 제거 (EPUB 파일이 깨지는 것을 방지)
export function cleanXmlText(s) {
  let o = "";
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xD7FF) || (c >= 0xE000 && c <= 0xFFFD) || (c >= 0x10000 && c <= 0x10FFFF)) o += ch;
  }
  return o;
}

// OCR 결과 전체의 평균 신뢰도(0~100). 단어가 없으면 0
export function meanConf(blocks) {
  let sum = 0, n = 0;
  for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
    if (String(w.text || "").trim()) { sum += w.confidence ?? 0; n++; }
  }
  return n ? sum / n : 0;
}

// 줄 배열(각 줄은 단어 배열)을 하나의 문단 단어 목록으로 잇기
export function joinWords(lines) {
  const words = [];
  for (const line of lines) {
    line.forEach((w, i) => {
      const cur = { t: w.t, low: !!w.low, glue: false };
      if (i === 0 && words.length) {
        const prev = words[words.length - 1];
        if (/[A-Za-z]-$/.test(prev.t) && /^[a-z]/.test(cur.t)) {       // 영어 줄 끝 하이픈 이어 붙이기
          prev.t = prev.t.slice(0, -1) + cur.t; prev.low = prev.low || cur.low; return;
        }
        if (CJK_END.test(prev.t) && CJK_START.test(cur.t)) cur.glue = true; // 한자·가나는 공백 없이
      }
      words.push(cur);
    });
  }
  return words;
}
export const wordsToText = words => words.map((w, i) => (i && !w.glue ? " " : "") + w.t).join("");

function makePara(lines, H) {
  const words = joinWords(lines.map(l => l.words));
  const lh = lines.reduce((s, l) => s + (l.y1 - l.y0), 0) / lines.length;
  return {
    words, text: wordsToText(words),
    y0: Math.min(...lines.map(l => l.y0)) / H, y1: Math.max(...lines.map(l => l.y1)) / H,
    lh: lh / H, lines: lines.length, heading: false, removed: false,
  };
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// 큰 글자의 짧은 문단, 또는 "제1장" 같은 형식을 제목으로 표시
export function markHeadings(paras) {
  const hs = []; for (const p of paras) for (let i = 0; i < p.lines; i++) hs.push(p.lh);
  const med = median(hs);
  for (const p of paras) {
    const len = [...p.text].length;
    const short = p.lines <= 2 && len > 0 && len <= 40 && !END.test(p.text);
    const big = paras.length >= 3 && med > 0 && p.lh >= med * 1.4;
    p.heading = short && (big || HEAD.test(p.text));
  }
  return paras;
}

// 한 줄의 OCR 결과 -> [{t, low}]. 글자는 엔진이 준 줄 텍스트(띄어쓰기가 정확)를 쓰고,
// 신뢰도는 단어 조각에서 가져와 글자 위치에 맞춰 붙인다. 맞출 수 없으면 단어 조각을 그대로 쓴다.
function lineTokens(l, low) {
  const ws = [];
  for (const w of l.words || []) {
    const t = String(w.text || "").trim(), conf = w.confidence ?? 100;
    if (t) ws.push({ t, low: conf < low, junk: conf < 40 && !HAS_LETTER.test(t) });   // 사진 무늬에서 생긴 기호 쓰레기
  }
  if (!ws.length) return [];
  const toks = String(l.text || "").trim().split(/\s+/).filter(Boolean);
  if (toks.length && toks.join("") === ws.map(w => w.t).join("")) {
    const lowAt = [], junkAt = [];
    for (const w of ws) for (const _ of [...w.t]) { lowAt.push(w.low); junkAt.push(w.junk); }
    const out = []; let pos = 0;
    for (const t of toks) {
      const n = [...t].length; let lo = false, allJunk = true;
      for (let i = 0; i < n; i++) { if (lowAt[pos + i]) lo = true; if (!junkAt[pos + i]) allJunk = false; }
      pos += n; if (!allJunk) out.push({ t, low: lo });
    }
    return out;
  }
  return ws.filter(w => !w.junk).map(w => ({ t: w.t, low: w.low }));
}

// Tesseract.js의 blocks 결과 -> 문단 목록. 문단은 엔진의 구분을 믿지 않고 줄의 위치(간격·들여쓰기·글자 크기)로 직접 나눈다.
export function ocrPage(blocks, W, H, { low = LOW_CONF } = {}) {
  const lines = [];
  for (const b of blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const words = lineTokens(l, low);
    if (words.length && l.bbox) lines.push({ words, y0: l.bbox.y0, y1: l.bbox.y1, x0: l.bbox.x0 ?? 0 });
  }
  if (!lines.length) return [];
  const medH = median(lines.map(l => l.y1 - l.y0)) || 1;
  const xs = lines.map(l => l.x0).sort((a, b) => a - b), margin = xs[Math.floor(xs.length * 0.1)];
  const groups = []; let cur = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    const ha = a.y1 - a.y0, hb = b.y1 - b.y0;
    const newPara = (b.y0 - a.y1) > medH * 0.9                       // 줄 사이 빈 공간이 큼
      || b.y0 < a.y0                                                 // 위로 되돌아감(단 바뀜)
      || Math.max(ha, hb) / Math.max(1, Math.min(ha, hb)) > 1.35     // 글자 크기가 달라짐(제목)
      || (b.x0 - a.x0) > medH * 1.0 && (a.x0 - margin) < medH * 0.5; // 첫 줄 들여쓰기
    if (newPara) { groups.push(cur); cur = []; }
    cur.push(b);
  }
  groups.push(cur);
  return markHeadings(groups.map(g => makePara(g, H || 1)));
}

// PDF 글자 정보(텍스트 레이어)의 줄 목록 -> 문단 목록. lines: [{t, y, h}] (y는 위에서부터의 위치)
export function textLinesToParas(lines, H) {
  const ls = lines.filter(l => l.t.trim()).sort((a, b) => a.y - b.y);
  if (!ls.length) return [];
  const gaps = []; for (let i = 1; i < ls.length; i++) gaps.push(ls[i].y - ls[i - 1].y);
  const med = median(gaps.filter(g => g > 0)) || 0;
  const groups = []; let cur = [ls[0]];
  for (let i = 1; i < ls.length; i++) {
    const gap = ls[i].y - ls[i - 1].y, h = Math.max(ls[i].h, ls[i - 1].h);
    const hr = Math.max(ls[i].h, ls[i - 1].h) / Math.max(1, Math.min(ls[i].h, ls[i - 1].h));
    // 줄 간격이 보통보다 많이 넓거나(문단 사이), 글자 크기가 달라지면(제목) 새 문단
    if ((med && gap > med * 1.45) || gap > h * 1.7 || hr > 1.25) { groups.push(cur); cur = []; }
    cur.push(ls[i]);
  }
  groups.push(cur);
  const paras = groups.map(g => {
    const words = joinWords(g.map(l => l.t.trim().split(/\s+/).map(t => ({ t, low: false }))));
    return {
      words, text: wordsToText(words), y0: g[0].y / H, y1: (g[g.length - 1].y + g[g.length - 1].h) / H,
      lh: g.reduce((s, l) => s + l.h, 0) / g.length / H, lines: g.length, heading: false, removed: false,
    };
  });
  return markHeadings(paras);
}

// 쪽마다 반복되는 머리말·꼬리말, 쪽 번호를 찾아 removed 표시. 제거한 문단 수를 반환.
export function normKey(t) { return String(t).toLowerCase().replace(/\d+/g, "0").replace(/[\s\p{P}\p{S}]+/gu, ""); }
export function markRunning(pages, { edge = 0.09, minPages = 3, minShare = 0.2 } = {}) {
  const inEdge = p => p.y1 <= edge || p.y0 >= 1 - edge;
  const cnt = new Map();
  for (const pg of pages) {
    const seen = new Set();
    for (const p of pg.paras) { if (inEdge(p)) { const k = normKey(p.text); if (k) seen.add(k); } }
    for (const k of seen) cnt.set(k, (cnt.get(k) || 0) + 1);
  }
  const need = Math.max(minPages, Math.ceil(pages.length * minShare));
  let n = 0;
  for (const pg of pages) for (const p of pg.paras) {
    if (!inEdge(p)) continue;
    const k = normKey(p.text);
    if (k && (cnt.get(k) >= need || /^0+$/.test(k)) && !p.removed) { p.removed = true; n++; }
  }
  return n;
}

// 쪽 목록 -> EPUB에 넣을 항목 목록. 쪽을 넘어 끊긴 문단은 이어 붙인다.
// page: { n, mode: "text"|"image"|"both"|"skip", paras:[{text, heading, removed}] }
export function pagesToItems(pages) {
  const items = []; let prevTextEnd = false;
  for (const pg of pages) {
    if (pg.mode === "skip") { prevTextEnd = false; continue; }
    if (pg.mode === "text" || pg.mode === "both") {
      let first = true, any = false;
      for (const p of pg.paras) {
        const text = String(p.text || "").replace(/\s+/g, " ").trim();
        if (p.removed || !text) continue;
        const last = items[items.length - 1];
        if (first && prevTextEnd && !p.heading && last && last.type === "p" && !END.test(last.text)) {
          last.text += (CJK_END.test(last.text) && CJK_START.test(text) ? "" : " ") + text;
        } else items.push({ type: p.heading ? "h" : "p", text, page: pg.n });
        first = false; any = true;
      }
      prevTextEnd = any && items[items.length - 1].type === "p" && pg.mode === "text";
    } else prevTextEnd = false;
    if (pg.mode === "image" || pg.mode === "both") items.push({ type: "img", page: pg.n });
  }
  return items;
}
