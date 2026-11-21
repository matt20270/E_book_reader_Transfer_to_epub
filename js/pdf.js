// pdf.js 래퍼: 라이브러리는 vendor/에 내장되어 있고 외부 통신은 하지 않는다.
import * as pdfjs from "../vendor/pdfjs/pdf.min.mjs";
import { MAX_CANVAS_PIXELS } from "./limits.js";

const base = new URL("../vendor/pdfjs/", import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";

export async function openPdf(buf) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: base + "cmaps/", cMapPacked: true,
    standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/", iccUrl: base + "iccs/",
    enableXfa: false, isEvalSupported: false,
    disableFontFace: true,          // 글꼴을 data:/blob:로 불러오지 않고 도형으로 그린다 (CSP 유지)
    useSystemFonts: false, verbosity: 0,
  });
  return task.promise;
}

// PDF 글자 정보(텍스트 레이어)를 줄 단위로 읽기. 글자가 없으면 chars=0
// 조각 사이에 공백을 넣을지는 실제 간격(x 위치)으로 판단한다. ("있었다" + "." 이 "있었다 ." 가 되지 않도록)
export async function readTextLines(page) {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== "string") continue;
    const h = Math.abs(it.transform[3]) || it.height || 10;
    items.push({ s: it.str, x: it.transform[4], w: it.width || 0, y: vp.height - it.transform[5], h });
  }
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    if (!it.s.trim()) { const ln = lines[lines.length - 1]; if (ln && Math.abs(it.y - ln.y) < Math.max(2, ln.h * 0.5)) ln.parts.push(it); continue; }
    const ln = lines[lines.length - 1];
    if (ln && Math.abs(it.y - ln.y) < Math.max(2, ln.h * 0.5)) { ln.parts.push(it); ln.h = Math.max(ln.h, it.h); }
    else lines.push({ y: it.y, h: it.h, parts: [it] });
  }
  const out = [];
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let t = "", prev = null;
    for (const p of l.parts) {
      if (prev) {
        const gap = p.x - (prev.x + prev.w);
        if (gap > l.h * 0.15 || /\s$/.test(prev.s) || /^\s/.test(p.s)) t += " ";
      }
      t += p.s; prev = p;
    }
    t = t.replace(/\s+/g, " ").trim();
    if (t) out.push({ t, y: l.y - l.h, h: l.h });
  }
  return { lines: out, chars: out.reduce((s, l) => s + l.t.length, 0), H: vp.height };
}

// 쪽을 canvas로 그리기. maxW/maxH(상자에 맞춤) 또는 longSide(긴 변 픽셀) 중 하나를 지정
export async function renderToCanvas(page, { maxW, maxH, longSide, gray = false } = {}) {
  const v1 = page.getViewport({ scale: 1 });
  let scale = maxW ? Math.min(maxW / v1.width, maxH / v1.height) : longSide / Math.max(v1.width, v1.height);
  const px = v1.width * v1.height * scale * scale;
  if (px > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / px);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(vp.width)); canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext("2d", { willReadFrequently: gray });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  if (gray) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = d[i + 1] = d[i + 2] = g; }
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}
export async function canvasToJpeg(canvas, q = 0.82) {
  const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", q));
  if (!blob) throw new Error("JPEG");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height };
}
export const freeCanvas = c => { c.width = 0; c.height = 0; };
