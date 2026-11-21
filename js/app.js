import { t, setLang, getLang, apply } from "./i18n.js";
import { decode, restore, encode, applyNewline, sanitizeFilename } from "./txt.js";
import { TXT_MAX_BYTES } from "./limits.js";
import { initConvert, refreshInfo as refreshConvertInfo } from "./convert.js";
const $ = id => document.getElementById(id);

function show(p) {
  if (!document.getElementById(p)) p = "home";
  document.querySelectorAll(".page").forEach(s => s.classList.toggle("on", s.id === p));
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.page === p));
  if (location.hash !== "#" + p) history.replaceState(null, "", "#" + p);
}
document.querySelectorAll("#nav button").forEach(b => b.onclick = () => show(b.dataset.page));
document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => show(b.dataset.go));
$("lang").value = getLang();
$("lang").onchange = e => { setLang(e.target.value); refreshInfo(); refreshConvertInfo(); };

// ---------- TXT 정리 ----------
let state = { name: "", raw: "", enc: "", n: 0, p: 0 };
function refreshInfo() {
  $("info").textContent = state.name ? t("txt.info", { name: state.name, enc: state.enc, n: state.n, p: state.p }) : "";
}
function run() {
  if (!state.name) return;
  const r = restore(state.raw, { mode: $("mode").value, join: $("join").value, keepDialogue: $("dialogue").checked });
  $("result").value = r.text; state.p = r.paragraphs; refreshInfo();
}
async function load(file) {
  if (!file) return;
  if (file.size > TXT_MAX_BYTES) {
    $("saveMsg").textContent = t("err.tooLarge");
    return;
  }
  try {
    const d = decode(await file.arrayBuffer());
    state = { name: file.name, raw: d.text, enc: d.enc, n: d.text.split(/\r\n?|\n/).length, p: 0 };
    $("orig").value = d.text; run(); $("saveMsg").textContent = "";
  } catch {
    $("saveMsg").textContent = t("err.read");
  }
}
$("file").onchange = e => load(e.target.files[0]);
["mode", "join", "dialogue"].forEach(id => $(id).onchange = run);
const drop = $("drop");
["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => load(e.dataTransfer.files[0]));
$("save").onclick = () => {
  if (!state.name) return;
  const { bytes, bad } = encode(applyNewline($("result").value, $("nl").value), $("enc").value);
  const name = sanitizeFilename(state.name) + "_수정.txt";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "text/plain" })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  $("saveMsg").textContent = (bad ? t("txt.bad", { n: bad }) + " " : "") + t("txt.saved", { name });
};

initConvert();
apply(); show(location.hash.slice(1) || "home");
