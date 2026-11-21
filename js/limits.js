// 보안·메모리 보호용 상한값 (임의로 키우지 마세요)
export const TXT_MAX_BYTES = 50 * 1024 * 1024;     // TXT: 50MB
export const PDF_WARN_BYTES = 50 * 1024 * 1024;    // PDF: 50MB 초과 시 경고 후 허용
export const PDF_MAX_BYTES = 150 * 1024 * 1024;    // PDF: 어떤 경우에도 150MB 초과 불가
export const PDF_MAX_PAGES = 1500;                 // 쪽수 상한
export const MAX_CANVAS_PIXELS = 16 * 1000 * 1000; // 쪽 한 장을 그릴 때 최대 픽셀 수 (메모리 고갈 방지)
