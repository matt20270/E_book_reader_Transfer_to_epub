# X4 Pro Reader Studio (웹) — 마스터 인수인계서 (v0.2.0)

> **AI 어시스턴트에게 (필수 지침)**
> 1. 이 프로젝트는 **순수 정적 웹사이트(HTML/CSS/JS, GitHub Pages)** 입니다. Mac 로컬 앱, Python 백엔드, 로컬 AI(Ollama/Qwen), 로컬 OCR(PaddleOCR/Apple Vision)은 폐기되었으므로 제안·구현 금지.
> 2. 사용자는 코딩을 거의 모르고 **로컬 터미널/Node를 쓰지 않습니다.** 쉬운 한국어로 설명하고, 코드를 쓰기 전에 중요한 질문(최대 3개)을 먼저 하세요. 결과물은 GitHub 웹에 올릴 수 있는 파일 묶음(100개 이하)이어야 합니다.
> 3. **보안 수칙은 모든 단계에서 무조건 지킵니다** (아래 1번).

## 1. 보안 및 안전 수칙
1. 비밀 정보(API 키 등)를 코드에 넣지 않고 `.gitignore`를 유지한다.
2. **CSP를 임의로 완화하지 않는다.** 현재: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'`. 외부 CDN 금지, 라이브러리는 `vendor/`에 내장. 완화가 필요해 보이면 이유를 설명하고 사용자 허락을 먼저 받는다. (v0.2.0에서 허락받은 `'wasm-unsafe-eval'`은 **필요 없는 것으로 확인되어 추가하지 않았다.** pdf.js·OCR이 모두 별도 Worker에서 돌고 `workerBlobURL:false`로 blob 작업자를 쓰지 않기 때문. 특정 브라우저에서 OCR이 막힐 때만 다시 검토.)
3. 사용자 파일에서 나온 글(PDF·OCR·TXT·메타데이터)은 `innerHTML` 금지, `textContent`/`createTextNode`만. 편집 영역 붙여넣기는 text/plain만, 드롭은 차단. EPUB 출력은 `esc()`/`cleanXmlText()`.
4. 파일 상한: TXT 50MB. PDF 기본 50MB, 경고 후 최대 150MB(초과 불가), 최대 1500쪽, 쪽 한 장 렌더링 1,600만 픽셀 상한 (`js/limits.js`). EPUB을 읽는 기능을 추가하면 Zip Slip(`../`) 차단 필수.
5. 다운로드 파일명은 `sanitizeFilename`으로 정제 (책 제목에는 `stripExt=false`).

## 2. 현재 상태 (v0.2.0)
- **완료**: 사이트(남색+금색, 한/영), TXT 정리 엔진, **PDF → EPUB**(글자형은 텍스트 레이어, 스캔형은 Tesseract.js OCR 한+영, 쪽별 글/이미지/둘 다/제외, 낮은 신뢰도 단어 노란 표시와 직접 편집, 문단 나누기·합치기, 쪽 번호·머리말 자동 제거, 제목 기반 목차, 쪽 넘김 문단 이어붙이기, 표지, 흑백/컬러, 480×800 / 960×1600).
- **검증함 (Chromium 헤드리스, 실제 CSP)**: 24개 단위 테스트, 16개 화면·보안 시험(악성 문자열, 잘못된 파일, 상한, 편집, 파일명), 192쪽 53MB 실제 PDF 변환(약 5분, EPUB 4.9MB, XML 오류 0).
- **미검증**: 실제 X4 Pro 순정 펌웨어에서 EPUB 표시, Safari/Firefox/휴대폰, EPUB 정식 검사기(epubcheck).
- **미구현**: EPUB→TXT/EPUB→EPUB, 2단 편집 감지, 그림·표 영역만 잘라 넣기, 수식 처리, 변경 부분 색상 강조(TXT), 저장 전 인코딩 경고(TXT), Web Worker 분리, 설정 백업/복원.

## 3. 알게 된 사실 (설계 근거)
- 사용자의 예시 PDF(「세계의 귀여운 빵」 192쪽)는 **전부 스캔 이미지**, 사진 위에 기울어진 글자라 OCR 신뢰도가 낮다(표지·프롤로그는 양호, 사진 위 본문은 오류 다수). 해상도·전처리·float 모델 모두 개선 효과가 거의 없었고 자동 레이아웃(PSM 3)이 가장 좋았다. 이런 쪽은 "쪽 이미지"가 현실적.
- Tesseract.js `blocks`의 **단어 조각은 한글을 음절 단위로 쪼개는 경우가 있다** → 글은 `line.text`, 신뢰도만 단어 조각에서 가져온다(`lineTokens`). 엔진의 문단 구분은 머리말·제목·본문을 뭉치므로 줄 위치(간격·들여쓰기·글자 크기)로 직접 나눈다.
- Tesseract.js 7은 core 7.0.0(`relaxedsimd` 포함)이 필요하다 (`tesseract.js` 안쪽 node_modules의 core 사용). 한국어 `best_int` 모델(1.5MB)이 float 모델보다 띄어쓰기가 깨끗했다.
- 사용자 PDF는 50MB를 넘는다 → 상한 정책을 50MB 경고/150MB 하드로 정함.
- cmaps는 GitHub 웹 업로드 100개 제한 때문에 한국어 관련만 남김.

## 4. 다음 단계 후보 (새 채팅 첫 응답에서 사용자에게 질문 후 확정)
- **A. 배포·실기 검증**: GitHub Pages 배포 → 스마트폰·맥북 Safari/Chrome 확인 → X4 Pro에서 EPUB 표시(이미지 크기·글꼴·목차) 확인 후 필요시 CSS/해상도 조정.
- **B. 논문 품질**: 2단 편집 읽기 순서, 그림·표 영역만 잘라 넣기, 수식 쪽 자동 이미지화.
- **C. OCR 품질**: 신뢰도 낮은 쪽에 기울기 보정 재시도(각도 ±4°, ±8°), 쪽별 언어 선택.
- **D. TXT 편집기 완성**: 변경 부분 강조, 저장 전 인코딩 경고, 문단 연결/분리 버튼.

## 5. 파일 구조
`index.html`, `css/style.css`, `js/{app,convert,layout,epub,pdf,ocr,txt,i18n,limits}.js`, `tests/*.test.js`, `vendor/{pdfjs,tesseract,jszip}`(+`NOTICE.md`), `README.md`, `.gitignore`, `.nojekyll`. 소스의 기준은 이 저장소/ZIP입니다 (이전처럼 인수인계서에 전체 코드를 붙이지 않음).
