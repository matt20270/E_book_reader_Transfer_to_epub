// PDF → EPUB 변환 화면. 사용자 파일에서 나온 모든 글은 textContent / createTextNode 로만 화면에 넣는다.
import { t } from "./i18n.js";
import { sanitizeFilename } from "./txt.js";
import { PDF_WARN_BYTES, PDF_MAX_BYTES, PDF_MAX_PAGES } from "./limits.js";
import { ocrPage, textLinesToParas, markRunning, pagesToItems, meanConf, LOW_CONF } from "./layout.js";
import { buildEpub } from "./epub.js";
import { openPdf, readTextLines, renderToCanvas, canvasToJpeg, freeCanvas } from "./pdf.js";

const $ = id => document.getElementById(id);
const st = { pdf: null, name: "", size: 0, pages: [], cur: 0, busy: false, cancel: false, previewToken: 0 };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) e.append(k);
  return e;
}
const msg = (text, bad = true) => { const m = $("cvMsg"); m.textContent = text; m.className = (bad ? "notice" : "muted") + " small"; };
const mb = n => (n / 1048576).toFixed(1);

// ---------- 파일 열기 ----------
async function onFile(file) {
  if (!file || st.busy) return;
  msg("");
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return msg(t("cv.err.notPdf"));
  if (file.size > PDF_MAX_BYTES) return msg(t("cv.err.tooLarge"));
  if (file.size > PDF_WARN_BYTES && !confirm(t("cv.warnBig", { mb: mb(file.size) }))) return;
  try {
    const buf = await file.arrayBuffer();
    const head = new TextDecoder("latin1").decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)));
    if (!head.includes("%PDF-")) return msg(t("cv.err.notPdf"));
    if (st.pdf) { try { await st.pdf.destroy(); } catch {} }
    st.pdf = await openPdf(buf);
    if (st.pdf.numPages > PDF_MAX_PAGES) { const n = st.pdf.numPages; await st.pdf.destroy(); st.pdf = null; return msg(t("cv.err.pages", { max: PDF_MAX_PAGES }) + " (" + n + ")"); }
    st.name = file.name; st.size = file.size; st.pages = [];
    $("cvReview").hidden = true; $("cvStart").disabled = false;
    $("metaTitle").value = sanitizeFilename(file.name).slice(0, 200);
    refreshInfo();
  } catch { st.pdf = null; $("cvStart").disabled = true; msg(t("cv.err.open")); }
}
export function refreshInfo() {
  $("cvInfo").textContent = st.pdf ? t("cv.info", { name: st.name, n: st.pdf.numPages, mb: mb(st.size) }) : "";
  if (!$("cvReview").hidden) showPage(st.cur, true);
}

// ---------- 변환(글자 읽기 + OCR) ----------
const opt = () => ({
  langs: $("cvLang").value === "ko" ? ["kor"] : $("cvLang").value === "en" ? ["eng"] : ["kor", "eng"],
  longSide: $("cvQuality").value === "hi" ? 2400 : 1600,
  mode: $("cvMode").value, running: $("cvRunning").checked, forceOcr: $("cvForceOcr").checked, autoImg: $("cvAutoImg").checked,
});
const fmtEta = s => (s < 0 || !isFinite(s)) ? t("cv.eta.calc") : s >= 60 ? t("cv.eta.min", { m: Math.ceil(s / 60) }) : t("cv.eta.sec", { s: Math.ceil(s) });

async function start() {
  if (!st.pdf || st.busy) return;
  st.busy = true; st.cancel = false; msg("");
  const o = opt(), n = st.pdf.numPages, pages = [];
  $("cvStart").disabled = true; $("cvCancel").hidden = false; $("cvProg").hidden = false; $("cvProg").value = 0; $("cvReview").hidden = true;
  let ocr = null; const t0 = performance.now();
  try {
    for (let i = 1; i <= n; i++) {
      if (st.cancel) break;
      const page = await st.pdf.getPage(i);
      const tl = await readTextLines(page);
      let paras, src, conf = 100;
      if (tl.chars >= 20 && !o.forceOcr) { paras = textLinesToParas(tl.lines, tl.H); src = "text"; }
      else {
        if (!ocr) {
          $("cvStatus").textContent = t("cv.loadEngine");
          try { const { createOcr } = await import("./ocr.js"); ocr = await createOcr(o.langs); }
          catch { throw Object.assign(new Error("OCR"), { code: "cv.err.ocr" }); }
        }
        const canvas = await renderToCanvas(page, { longSide: o.longSide });
        const blocks = await ocr.recognize(canvas);
        paras = ocrPage(blocks, canvas.width, canvas.height); conf = meanConf(blocks); src = "ocr";
        freeCanvas(canvas);
      }
      const chars = paras.reduce((s, p) => s + p.text.length, 0);
      let mode = o.mode;
      if (chars < 5) mode = "image";                                   // 글이 거의 없는 쪽(사진 등)은 이미지로
      else if (src === "ocr" && o.autoImg && conf < 60) mode = "image"; // 선택 옵션: 신뢰도 낮은 쪽 자동 이미지화
      pages.push({ n: i, paras, src, conf, mode, low: paras.reduce((s, p) => s + p.words.filter(w => w.low).length, 0), rows: null });
      page.cleanup();
      const el_s = (performance.now() - t0) / 1000;
      $("cvProg").value = (i / n) * 100;
      $("cvStatus").textContent = t("cv.prog", { i, n, eta: i >= 2 ? fmtEta(el_s / i * (n - i)) : t("cv.eta.calc") });
    }
    if (st.cancel) { msg(t("cv.cancelled"), false); return; }
    if (o.running) { const removed = markRunning(pages); st.removed = removed; } else st.removed = 0;
    st.pages = pages; st.cur = 0;
    const need = pages.filter(needsCheck).length;
    $("cvStatus").textContent = t("cv.done", { n, k: need });
    $("cvReview").hidden = false; showPage(0, true);
  } catch (e) { msg(t(e && e.code ? e.code : "cv.err.run")); }
  finally {
    if (ocr) { try { await ocr.terminate(); } catch {} }
    st.busy = false; $("cvStart").disabled = false; $("cvCancel").hidden = true; $("cvProg").hidden = true;
  }
}
const needsCheck = p => p.low > 0 && (p.mode === "text" || p.mode === "both");

// ---------- 검토 화면 ----------
function makeRow(para) {
  const row = el("div", { class: "pr" + (para.heading ? " heading" : "") + (para.removed ? " removed" : "") });
  const body = el("p", { class: "pt", contenteditable: "true", spellcheck: "false" });
  para.words.forEach((w, i) => {
    if (i && !w.glue) body.append(document.createTextNode(" "));
    if (w.low) body.append(el("span", { class: "low", text: w.t })); else body.append(document.createTextNode(w.t));
  });
  const bar = el("div", { class: "pb" });
  const bH = el("button", { type: "button", class: "mini", text: t("cv.btn.heading") });
  const bX = el("button", { type: "button", class: "mini", text: row.classList.contains("removed") ? t("cv.btn.restore") : t("cv.btn.remove") });
  bH.onclick = () => row.classList.toggle("heading");
  bX.onclick = () => { row.classList.toggle("removed"); bX.textContent = row.classList.contains("removed") ? t("cv.btn.restore") : t("cv.btn.remove"); };
  bar.append(bH, bX);
  body.addEventListener("paste", e => { e.preventDefault(); const tx = (e.clipboardData?.getData("text/plain") || "").replace(/\s*\n\s*/g, " "); document.execCommand("insertText", false, tx); });
  body.addEventListener("drop", e => e.preventDefault());
  body.addEventListener("keydown", e => onKey(e, row, body));
  row.append(body, bar);
  return row;
}
function onKey(e, row, body) {
  const sel = getSelection(); if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if (e.key === "Enter") {                       // 문단 나누기
    e.preventDefault(); r.deleteContents();
    const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(body, body.childNodes.length);
    const row2 = makeRow({ words: [], heading: false, removed: false }), b2 = row2.querySelector(".pt");
    b2.append(tail.extractContents()); row.after(row2);
    const nr = document.createRange(); nr.setStart(b2, 0); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); b2.focus();
  } else if (e.key === "Backspace" && r.collapsed && row.previousElementSibling) {   // 앞 문단과 합치기
    const pre = document.createRange(); pre.selectNodeContents(body); pre.setEnd(r.startContainer, r.startOffset);
    if (pre.toString().length) return;
    e.preventDefault();
    const pb = row.previousElementSibling.querySelector(".pt"), at = pb.childNodes.length;
    if (pb.textContent && body.textContent) pb.append(document.createTextNode(" "));
    while (body.firstChild) pb.append(body.firstChild);
    row.remove();
    const nr = document.createRange(); nr.setStart(pb, Math.min(at, pb.childNodes.length)); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); pb.focus();
  }
}
function captureCurrent() {          // 현재 쪽 편집 내용을 보관
  const ed = $("cvEditor"), pg = st.pages[st.cur];
  if (pg && ed.dataset.page === String(pg.n)) pg.rows = [...ed.children].filter(c => c.classList.contains("pr"));
}
function showPage(i, force = false) {
  if (!st.pages.length) return;
  if (!force) captureCurrent();
  i = Math.max(0, Math.min(st.pages.length - 1, i)); st.cur = i;
  const pg = st.pages[i], ed = $("cvEditor");
  ed.replaceChildren(); ed.dataset.page = String(pg.n);
  if (!pg.rows) pg.rows = pg.paras.map(makeRow);
  if (!pg.rows.length) ed.append(el("p", { class: "muted small", text: t("cv.noText") }));
  pg.rows.forEach(r => ed.append(r));
  $("cvPageNo").textContent = t("cv.page", { i: pg.n, n: st.pages.length });
  $("cvGoto").value = String(pg.n);
  $("cvPageMode").value = pg.mode;
  $("cvPageInfo").textContent = (pg.src === "ocr" ? t("cv.srcOcr") + " · " + t("cv.conf", { c: Math.round(pg.conf) }) : t("cv.srcText")) + (pg.low ? " · " + t("cv.lowCount", { k: pg.low }) : "");
  $("cvRemoved").textContent = st.removed ? t("cv.removedAuto", { n: st.removed }) : "";
  drawPreview(pg.n);
}
async function drawPreview(n) {
  const tok = ++st.previewToken, box = $("cvPreview");
  try {
    const page = await st.pdf.getPage(n);
    const c = await renderToCanvas(page, { maxW: 420, maxH: 560 });
    if (tok !== st.previewToken) { freeCanvas(c); return; }
    c.className = "pvimg"; box.replaceChildren(c); page.cleanup();
  } catch { if (tok === st.previewToken) box.replaceChildren(); }
}

// ---------- EPUB 만들기 ----------
function collectRow(r) { return { text: r.querySelector(".pt")?.textContent ?? "", heading: r.classList.contains("heading"), removed: r.classList.contains("removed") }; }
async function build() {
  if (st.busy || !st.pages.length) return;
  st.busy = true; msg(""); captureCurrent();
  const btn = $("cvBuild"); btn.disabled = true;
  try {
    if (typeof window.JSZip !== "function") throw new Error("JSZip");
    const pages = st.pages.map(p => ({ n: p.n, mode: p.mode, paras: p.rows ? p.rows.map(collectRow) : p.paras }));
    const items = pagesToItems(pages);
    if (!items.length) return msg(t("cv.err.empty"));
    const gray = $("cvColor").value === "gray", big = $("cvRes").value === "large";
    const box = big ? { maxW: 960, maxH: 1600 } : { maxW: 480, maxH: 800 };
    const need = new Set(items.filter(i => i.type === "img").map(i => i.page));
    const wantCover = $("cvCover").checked;
    if (wantCover) need.add(1);
    const images = new Map(); let k = 0;
    for (const n of [...need].sort((a, b) => a - b)) {
      $("cvStatus").textContent = t("cv.building", { i: ++k, n: need.size });
      const page = await st.pdf.getPage(n);
      const c = await renderToCanvas(page, { ...box, gray });
      images.set(n, await canvasToJpeg(c, 0.82)); freeCanvas(c); page.cleanup();
    }
    const lang = $("metaLang").value, title = $("metaTitle").value.trim() || sanitizeFilename(st.name);
    const label = (a, b) => (a === b ? t("cv.pl1", { a }) : t("cv.pl2", { a, b }));
    const out = await buildEpub(window.JSZip, { title, author: $("metaAuthor").value.trim(), lang, items, images, cover: wantCover ? images.get(1) : null, label });
    const name = (sanitizeFilename(title, false).replace(/^\.+/, "") || "book") + ".epub";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([out.bytes], { type: "application/epub+zip" })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $("cvStatus").textContent = ""; msg(t("cv.built", { name, mb: mb(out.bytes.length) }), false);
  } catch { msg(t("cv.err.build")); }
  finally { st.busy = false; btn.disabled = false; }
}

// ---------- 연결 ----------
export function initConvert() {
  $("cvFile").onchange = e => { onFile(e.target.files[0]); e.target.value = ""; };
  const drop = $("cvDrop");
  ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => onFile(e.dataTransfer.files[0]));
  $("cvStart").onclick = start; $("cvStart").disabled = true;
  $("cvCancel").onclick = () => { st.cancel = true; };
  $("cvPrev").onclick = () => showPage(st.cur - 1);
  $("cvNext").onclick = () => showPage(st.cur + 1);
  $("cvNextCheck").onclick = () => {
    const n = st.pages.length;
    for (let d = 1; d <= n; d++) { const j = (st.cur + d) % n; if (needsCheck(st.pages[j])) { showPage(j); return; } }
  };
  $("cvGoto").onchange = e => { const v = parseInt(e.target.value, 10); if (v >= 1) showPage(v - 1); };
  $("cvPageMode").onchange = e => { const pg = st.pages[st.cur]; if (pg) pg.mode = e.target.value; };
  $("cvBuild").onclick = build;
  addEventListener("beforeunload", e => { if (st.pages.length) { e.preventDefault(); e.returnValue = ""; } });
}
