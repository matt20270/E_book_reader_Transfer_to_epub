import test from "node:test"; import assert from "node:assert/strict"; import { createRequire } from "node:module";
import { buildEpub, chunkItems, esc } from "../js/epub.js";
const JSZip = createRequire(import.meta.url)("../vendor/jszip/jszip.min.js");
const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);

test("esc: XML 특수문자와 금지 문자", () => { assert.equal(esc('a<b>&"c\u0000'), "a&lt;b&gt;&amp;&quot;c"); });
test("챕터 나누기: 제목에서 새 파일, 제목 없으면 쪽 범위 이름", () => {
  const items = [{ type: "p", text: "가".repeat(2000), page: 1 }, { type: "h", text: "제2장", page: 2 }, { type: "p", text: "나", page: 2 }];
  const c = chunkItems(items, (a, b) => `${a}-${b}`);
  assert.equal(c.length, 2); assert.equal(c[1].title, "제2장"); assert.equal(c[0].title, "1-1");
});
test("EPUB 구조: mimetype 무압축 첫 항목, 필수 파일, 이스케이프", async () => {
  const items = [{ type: "h", text: "제목 <1>", page: 1 }, { type: "p", text: "본문 & 내용", page: 1 }, { type: "img", page: 2 }, { type: "img", page: 99 }];
  const out = await buildEpub(JSZip, { title: 'A&B "책"', author: "저자", lang: "ko", items, images: new Map([[2, { bytes: jpg }]]), cover: { bytes: jpg }, uuid: "test-uuid" });
  const b = Buffer.from(out.bytes);
  assert.equal(b.subarray(30, 38).toString(), "mimetype");
  assert.equal(b.readUInt16LE(8), 0);                       // 압축 방식 0 = 무압축
  assert.equal(b.subarray(38, 58).toString(), "application/epub+zip");
  const z = await JSZip.loadAsync(out.bytes);
  const names = Object.keys(z.files);
  for (const f of ["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/toc.ncx", "OEBPS/css/style.css", "OEBPS/text/c0001.xhtml", "OEBPS/images/p0002.jpg", "OEBPS/images/cover.jpg", "OEBPS/cover.xhtml"]) assert.ok(names.includes(f), f);
  assert.ok(!names.includes("OEBPS/images/p0099.jpg"));       // 이미지 데이터가 없는 쪽은 제외
  const opf = await z.file("OEBPS/content.opf").async("string");
  assert.match(opf, /A&amp;B &quot;책&quot;/); assert.match(opf, /properties="cover-image"/); assert.match(opf, /urn:uuid:test-uuid/);
  const ch = await z.file("OEBPS/text/c0001.xhtml").async("string");
  assert.match(ch, /<h2 id="h1">제목 &lt;1&gt;<\/h2>/); assert.match(ch, /<p>본문 &amp; 내용<\/p>/); assert.match(ch, /src="\.\.\/images\/p0002\.jpg"/);
  assert.match(ch, /href="\.\.\/css\/style\.css"/);
  const nav = await z.file("OEBPS/nav.xhtml").async("string"); assert.match(nav, /text\/c0001\.xhtml#h1/);
});
test("빈 내용은 오류", async () => { await assert.rejects(() => buildEpub(JSZip, { title: "x", items: [] }), /EMPTY/); });
