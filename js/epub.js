import { cleanXmlText } from "./layout.js";

export const esc = s => cleanXmlText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// E-Ink 단말기용 기본 스타일: 글자 크기는 리더 설정을 따르고, 그림은 화면 폭에 맞춘다.
export const CSS = `body{margin:0;padding:0 .3em;line-height:1.6}
p{margin:0 0 .9em;text-align:left;orphans:2;widows:2}
h2{font-size:1.25em;margin:1.2em 0 .7em;text-align:center;page-break-after:avoid}
.pg{margin:0 0 1em;text-align:center;page-break-inside:avoid}
.pg img{max-width:100%;max-height:100%;height:auto;display:block;margin:0 auto}
.cover{margin:0;padding:0;text-align:center}
.cover img{max-width:100%;max-height:100%;height:auto}
`;

const CHUNK_CHARS = 7000, IMG_WEIGHT = 3500;
const pad = (n, w = 4) => String(n).padStart(w, "0");

// items -> 파일 단위(챕터)로 나누기. 제목에서 새 파일을 시작해 목차가 자연스럽게 만들어진다.
export function chunkItems(items, label) {
  const chunks = []; let cur = null, budget = 0;
  const start = () => { cur = { items: [], first: null, last: null }; chunks.push(cur); budget = 0; };
  for (const it of items) {
    if (!cur || budget >= CHUNK_CHARS || (it.type === "h" && budget > 1500)) start();
    cur.items.push(it);
    if (cur.first === null) cur.first = it.page;
    cur.last = it.page;
    budget += it.type === "img" ? IMG_WEIGHT : it.text.length;
  }
  chunks.forEach(c => { c.title = c.items.find(i => i.type === "h")?.text || label(c.first, c.last); });
  return chunks;
}

export async function buildEpub(JSZip, { title, author = "", lang = "ko", items, images = new Map(), cover = null, uuid, label }) {
  if (!items || !items.length) throw new Error("EMPTY");
  label = label || ((a, b) => (a === b ? `${a}p` : `${a}-${b}p`));
  const id = uuid || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const chunks = chunkItems(items, label);
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file("OEBPS/css/style.css", CSS);

  const manifest = [], spine = [], toc = []; // toc: {href, text}
  manifest.push(`<item id="css" href="css/style.css" media-type="text/css"/>`);
  manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  manifest.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);

  const xhtml = (t, body, cls = "") => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.w3.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(t)}</title><link rel="stylesheet" type="text/css" href="css/style.css"/></head><body${cls ? ` class="${cls}"` : ""}>\n${body}</body></html>\n`;

  if (cover) {
    zip.file("OEBPS/images/cover.jpg", cover.bytes, { compression: "STORE" });
    manifest.push(`<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`);
    zip.file("OEBPS/cover.xhtml", xhtml("Cover", `<div class="cover"><img src="images/cover.jpg" alt="Cover"/></div>\n`, "cover"));
    manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="cover" linear="yes"/>`);
  }

  const usedImages = new Set();
  const anyHeading = items.some(i => i.type === "h");
  chunks.forEach((c, ci) => {
    const file = `text/c${pad(ci + 1)}.xhtml`;
    let body = "", hn = 0;
    // 챕터 파일은 text/ 아래에 두므로 CSS·이미지 경로에 ../ 가 필요하다
    for (const it of c.items) {
      if (it.type === "h") {
        const hid = `h${++hn}`; body += `<h2 id="${hid}">${esc(it.text)}</h2>\n`;
        toc.push({ href: `${file}#${hid}`, text: it.text });
      } else if (it.type === "p") body += `<p>${esc(it.text)}</p>\n`;
      else if (it.type === "img" && images.has(it.page)) {
        usedImages.add(it.page);
        body += `<div class="pg"><img src="../images/p${pad(it.page)}.jpg" alt="${esc(label(it.page, it.page))}"/></div>\n`;
      }
    }
    if (!anyHeading) toc.push({ href: file, text: c.title });
    zip.file(`OEBPS/${file}`, xhtml(c.title, body).replace(`href="css/style.css"`, `href="../css/style.css"`));
    manifest.push(`<item id="c${pad(ci + 1)}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${pad(ci + 1)}"/>`);
  });
  for (const n of usedImages) {
    const im = images.get(n);
    zip.file(`OEBPS/images/p${pad(n)}.jpg`, im.bytes, { compression: "STORE" });
    manifest.push(`<item id="p${pad(n)}" href="images/p${pad(n)}.jpg" media-type="image/jpeg"/>`);
  }
  if (!toc.length) toc.push({ href: `text/c${pad(1)}.xhtml`, text: title });

  zip.file("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.w3.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>${esc(title)}</h1><ol>\n${toc.map(t => `<li><a href="${esc(t.href)}">${esc(t.text)}</a></li>`).join("\n")}\n</ol></nav></body></html>\n`);
  zip.file("OEBPS/toc.ncx", `<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${esc(id)}"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>\n${toc.map((t, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(t.text)}</text></navLabel><content src="${esc(t.href)}"/></navPoint>`).join("\n")}\n</navMap></ncx>\n`);
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">urn:uuid:${esc(id)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>${esc(lang)}</dc:language>${author ? `<dc:creator>${esc(author)}</dc:creator>` : ""}<meta property="dcterms:modified">${modified}</meta>${cover ? `<meta name="cover" content="cover-img"/>` : ""}</metadata>\n<manifest>\n${manifest.join("\n")}\n</manifest>\n<spine toc="ncx">\n${spine.join("\n")}\n</spine></package>\n`);

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/epub+zip" });
  return { bytes, chunks: chunks.length, tocEntries: toc.length, images: usedImages.size };
}
