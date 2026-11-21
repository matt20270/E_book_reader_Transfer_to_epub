import test from "node:test"; import assert from "node:assert/strict";
import { cleanXmlText, joinWords, wordsToText, ocrPage, meanConf, textLinesToParas, markRunning, normKey, pagesToItems } from "../js/layout.js";

const W = (t, c = 95) => ({ text: t, confidence: c });
const L = (y0, y1, text, ...ws) => ({ text, bbox: { x0: 100, y0, x1: 900, y1 }, words: ws });
const P = (...lines) => ({ lines });

test("XML 금지 문자 제거", () => {
  assert.equal(cleanXmlText("a\u0000b\u000bc\ufffed\ud800e"), "abcde");
  assert.equal(cleanXmlText("가\n나\t😀"), "가\n나\t😀");
});
test("줄 잇기: 영어 하이픈 합치기, 한글은 공백", () => {
  const w = joinWords([[{ t: "inter-" }], [{ t: "national" }, { t: "law" }]]);
  assert.equal(wordsToText(w), "international law");
  assert.equal(wordsToText(joinWords([[{ t: "가나다" }], [{ t: "라마바" }]])), "가나다 라마바");
  assert.equal(wordsToText(joinWords([[{ t: "日本" }], [{ t: "語" }]])), "日本語");
});
test("OCR 문단: 줄 위치로 문단 나눔, 제목 감지, 낮은 신뢰도 표시, 기호 쓰레기 제거", () => {
  // 엔진이 한 문단으로 뭉쳐 줘도 간격·글자 크기로 다시 나눈다
  const blocks = [{ paragraphs: [P(
    L(100, 160, "바게트", W("바게트")),
    L(300, 320, "본문 글자", W("본문", 90), W("글자", 40)),
    L(325, 345, "이어진 줄입니다.", W("이어진", 95), W("줄입니다.", 95)),
    L(400, 420, "두번째 ~., 문단입니다.", W("두번째", 95), W("~.,", 20), W("문단입니다.", 95)),
    L(500, 520, "세번째 문단입니다.", W("세번째", 95), W("문단입니다.", 95)),
  )] }];
  const paras = ocrPage(blocks, 1000, 1000);
  assert.equal(paras.length, 4);
  assert.equal(paras[0].heading, true);
  assert.equal(paras[1].heading, false);
  assert.equal(paras[1].text, "본문 글자 이어진 줄입니다.");
  assert.deepEqual(paras[1].words.map(w => w.low), [false, true, false, false]);
  assert.equal(paras[2].text, "두번째 문단입니다.");         // 신뢰도 20인 기호 "~.,"는 버림
  assert.ok(meanConf(blocks) > 70);
  assert.equal(meanConf([]), 0);
  assert.deepEqual(ocrPage([], 1, 1), []);
});
test("OCR 줄: 엔진이 음절 단위로 쪼갠 단어 조각이 있어도 줄 텍스트의 띄어쓰기를 사용", () => {
  const line = L(100, 120, "한참을 서 있었다.", W("한", 95), W("참", 60), W("을", 95), W("서", 95), W("있었다.", 95));
  const [p] = ocrPage([{ paragraphs: [P(line)] }], 1000, 1000);
  assert.equal(p.text, "한참을 서 있었다.");
  assert.deepEqual(p.words.map(w => [w.t, w.low]), [["한참을", true], ["서", false], ["있었다.", false]]);
  // 줄 텍스트와 단어 조각이 맞지 않으면 단어 조각을 그대로 사용
  const [q] = ocrPage([{ paragraphs: [P(L(100, 120, "전혀 다름", W("가나", 90)))] }], 1000, 1000);
  assert.equal(q.text, "가나");
});
test("OCR 문단: 들여쓰기와 단 바뀜(위로 되돌아감)에서 문단 나눔", () => {
  const ln = (x0, y0, text) => ({ text, bbox: { x0, y0, x1: 900, y1: y0 + 20 }, words: [W(text)] });
  const blocks = [{ paragraphs: [P(ln(100, 100, "첫째"), ln(100, 125, "이어짐"), ln(160, 150, "들여쓴 새 문단"), ln(100, 175, "이어짐2"), ln(100, 100, "다음 단 시작"))] }];
  assert.deepEqual(ocrPage(blocks, 1000, 1000).map(p => p.text), ["첫째 이어짐", "들여쓴 새 문단 이어짐2", "다음 단 시작"]);
});
test("PDF 글자 줄: 짧은 문단만 있어도 간격·글자 크기로 제목/문단 분리", () => {
  const lines = [{ t: "제목", y: 50, h: 20 }, { t: "한 줄짜리 문단.", y: 100, h: 12 }, { t: "또 한 줄짜리 문단.", y: 130, h: 12 }];
  assert.deepEqual(textLinesToParas(lines, 800).map(p => p.text), ["제목", "한 줄짜리 문단.", "또 한 줄짜리 문단."]);
});
test("PDF 글자 줄 -> 문단 (줄 간격으로 나눔)", () => {
  const lines = [
    { t: "첫 문단 첫 줄", y: 100, h: 10 }, { t: "첫 문단 둘째 줄.", y: 114, h: 10 },
    { t: "둘째 문단 시작", y: 140, h: 10 }, { t: "둘째 문단 끝.", y: 154, h: 10 },
  ];
  const p = textLinesToParas(lines, 800);
  assert.deepEqual(p.map(x => x.text), ["첫 문단 첫 줄 첫 문단 둘째 줄.", "둘째 문단 시작 둘째 문단 끝."]);
});
const para = (text, y0, y1) => ({ text, y0, y1, words: [], lines: 1, lh: 0.02, heading: false, removed: false });
test("쪽 번호·반복 머리말 자동 제거 (본문은 유지)", () => {
  const pages = [1, 2, 3, 4, 5].map(i => ({ paras: [para("저자 이름 - 책 제목", 0.02, 0.05), para("본문 " + i + " 입니다.", 0.3, 0.4), para(String(i), 0.95, 0.98)] }));
  const n = markRunning(pages);
  assert.equal(n, 10);
  assert.ok(pages.every(p => p.paras[0].removed && !p.paras[1].removed && p.paras[2].removed));
  assert.equal(normKey("- 12 -"), "0");
});
test("본문이 가장자리에 있어도 한두 번 나오는 글은 지우지 않음", () => {
  const pages = [{ paras: [para("각주 설명입니다.", 0.92, 0.97)] }, { paras: [para("다른 글", 0.3, 0.4)] }, { paras: [para("또 다른 글", 0.3, 0.4)] }];
  assert.equal(markRunning(pages), 0);
});
test("쪽 -> 항목: 쪽을 넘는 문단 이어 붙이기, 이미지·제외 처리", () => {
  const mk = (n, mode, ...texts) => ({ n, mode, paras: texts.map(t => (typeof t === "string" ? { text: t } : t)) });
  const items = pagesToItems([
    mk(1, "text", { text: "제목", heading: true }, "문장이 끝나지 않고 이어지는"),
    mk(2, "text", "다음 쪽 계속입니다.", "새 문단."),
    mk(3, "image"),
    mk(4, "skip", "무시"),
    mk(5, "both", { text: "삭제됨", removed: true }, "글과 그림"),
    mk(6, "text", "앞이 이미지라 이어붙이지 않음."),
  ]);
  assert.deepEqual(items.map(i => i.type + ":" + (i.text || i.page)), [
    "h:제목", "p:문장이 끝나지 않고 이어지는 다음 쪽 계속입니다.", "p:새 문단.", "img:3", "p:글과 그림", "img:5", "p:앞이 이미지라 이어붙이지 않음."]);
});
