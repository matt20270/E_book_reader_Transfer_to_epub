import test from "node:test"; import assert from "node:assert/strict";
import { decode, restore, encode, applyNewline, sanitizeFilename } from "../js/txt.js";
import { keys } from "../js/i18n.js";
const eucBytes = s => encode(s, "cp949").bytes;
test("인코딩 감지: UTF-8 / BOM / CP949", () => {
  assert.equal(decode(new TextEncoder().encode("안녕하세요")).enc, "UTF-8");
  assert.equal(decode(encode("안녕", "utf8bom").bytes).text, "안녕");
  const d = decode(eucBytes("오래된 텍스트 파일입니다. 한글 가나다")); assert.equal(d.enc, "CP949"); assert.match(d.text, /한글 가나다/);
});
test("CP949 확장 한글 저장: Python cp949 와 동일한 바이트", () => {
  assert.equal(Buffer.from(encode("똠", "cp949").bytes).toString("hex"), "8c63");
});
test("CP949 저장: 왕복 변환과 표현 불가 문자 경고", () => {
  const ok = encode("한글ABC123", "cp949"); assert.equal(ok.bad, 0); assert.equal(decode(ok.bytes).text, "한글ABC123");
  assert.equal(encode("이모지😀", "cp949").bad, 1);
});
test("문단 복원: 줄바꿈으로 끊긴 문장을 잇고 문단은 유지", () => {
  const src = "그는 오래된 집 앞에서 한참을 서\n있었다. 바람이 불었다.\n\n다음 문단은 여기서 시작되며 역시 줄이\n바뀌어 있다.";
  const r = restore(src, { mode: "auto" });
  assert.equal(r.text, "그는 오래된 집 앞에서 한참을 서 있었다. 바람이 불었다.\n\n다음 문단은 여기서 시작되며 역시 줄이 바뀌어 있다.");
});
test("제목·목록·대사 보호", () => {
  const src = "제1장 시작\n그는 걸었다 길고 긴 길을 따라서 계속 걸어\n갔다.\n“안녕.”\n“잘 가.”\n- 첫째 항목\n- 둘째 항목";
  const out = restore(src).text.split("\n\n");
  assert.deepEqual(out, ["제1장 시작", "그는 걸었다 길고 긴 길을 따라서 계속 걸어 갔다.", "“안녕.”", "“잘 가.”", "- 첫째 항목", "- 둘째 항목"]);
});
test("모드: 줄바꿈 유지 / 빈 줄 기준 / 연결 공백 없음", () => {
  assert.equal(restore("가\n나", { mode: "keep" }).text, "가\n나");
  assert.equal(restore("가나다\n라마바\n\n사", { mode: "blank" }).text, "가나다 라마바\n\n사");
  assert.equal(restore("가나다\n라마바", { mode: "blank", join: "none" }).text, "가나다라마바");
});
test("빈 파일·CRLF·줄바꿈 형식", () => {
  assert.equal(restore("").paragraphs, 0);
  assert.equal(restore("가\r\n\r\n나").text, "가\n\n나");
  assert.equal(applyNewline("a\nb", "\r\n"), "a\r\nb");
});
test("보안: 파일명 경로 조작 및 위험 특수문자 정제", () => {
  assert.equal(sanitizeFilename("../../evil:name?.txt"), "._._evil_name_");
  assert.equal(sanitizeFilename(""), "book");
});
test("파일명 정제: 책 제목은 마지막 점 뒤를 확장자로 보고 자르지 않음", () => {
  assert.equal(sanitizeFilename("Dr. Smith's Book", false), "Dr. Smith's Book");
  assert.equal(sanitizeFilename("Dr. Smith's Book"), "Dr");   // 기존 동작(파일명용)은 그대로
});
test("한/영 번역 키 일치", () => { assert.deepEqual(Object.keys(keys.ko).sort(), Object.keys(keys.en).sort()); });
