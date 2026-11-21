// Tesseract.js 래퍼: 엔진·언어 데이터는 모두 vendor/에 내장 (외부 다운로드 없음)
import Tesseract from "../vendor/tesseract/tesseract.esm.min.js";

export async function createOcr(langs = ["kor", "eng"]) {
  const base = new URL("../vendor/tesseract/", import.meta.url).href;
  const worker = await Tesseract.createWorker(langs, 1, {
    workerPath: base + "worker.min.js",
    corePath: base + "core",
    langPath: base + "lang",
    workerBlobURL: false,            // blob: 작업자를 쓰지 않아 CSP를 더 열 필요가 없다
    gzip: true, cacheMethod: "none",
  });
  return {
    async recognize(canvas) { const { data } = await worker.recognize(canvas, {}, { blocks: true }); return data.blocks || []; },
    terminate: () => worker.terminate(),
  };
}
