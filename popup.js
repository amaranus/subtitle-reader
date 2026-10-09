const toggleBtn = document.getElementById("toggleBtn");
const statusEl = document.getElementById("status");
const voiceSel = document.getElementById("voiceSel");
const stVoiceSel = document.getElementById("stVoiceSel");
const stLangSel = document.getElementById("stLangSel");
const rateSel = document.getElementById("rateSel");
const browserSection = document.getElementById("browserSection");
const stSection = document.getElementById("stSection");
const modeRadios = document.querySelectorAll('input[name="mode"]');

const FALLBACK_VOICES = ["F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5"];
const LANG_NAMES = {
  na: "Bilinmeyen",
  en: "İngilizce",
  tr: "Türkçe",
  de: "Almanca",
  fr: "Fransızca",
  es: "İspanyolca",
  it: "İtalyanca",
  pt: "Portekizce",
  ru: "Rusça",
  uk: "Ukraynaca",
  ja: "Japonca",
  ko: "Korece",
  ar: "Arapça",
  bg: "Bulgarca",
  cs: "Çekçe",
  da: "Danca",
  el: "Yunanca",
  et: "Estonca",
  fi: "Fince",
  hi: "Hintçe",
  hr: "Hırvatça",
  hu: "Macarca",
  id: "Endonezce",
  lt: "Litvanca",
  lv: "Letonca",
  nl: "Felemenkçe",
  pl: "Lehçe",
  ro: "Romence",
  sk: "Slovakça",
  sl: "Slovence",
  sv: "İsveççe",
  vi: "Vietnamca",
};

let running = false;
let mode = "browser";
let stOk = false;
let tabOk = true;
let tabId = null;

function currentMode() {
  return document.getElementById("modeSt").checked ? "supertonic" : "browser";
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

function render() {
  toggleBtn.textContent = running ? "Durdur" : "Başlat";
  toggleBtn.classList.toggle("stop", running);

  browserSection.classList.toggle("hidden", mode !== "browser");
  stSection.classList.toggle("hidden", mode !== "supertonic");

  modeRadios.forEach((r) => (r.disabled = running));

  const stBlocked = mode === "supertonic" && !stOk && !running;
  toggleBtn.disabled = !tabOk || stBlocked;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function send(msg) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    return null;
  }
}

function fillVoices(savedURI) {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;

  const ordered = [...voices.filter((v) => v.localService), ...voices.filter((v) => !v.localService)];

  voiceSel.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Varsayılan ses";
  voiceSel.appendChild(def);

  for (const v of ordered) {
    const opt = document.createElement("option");
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})${v.localService ? "" : " - online"}`;
    voiceSel.appendChild(opt);
  }

  if (savedURI && ordered.some((v) => v.voiceURI === savedURI)) {
    voiceSel.value = savedURI;
  }
}

function fillStVoices(list, savedVoice) {
  const voices = list && list.length ? list : FALLBACK_VOICES;
  stVoiceSel.innerHTML = "";
  for (const name of voices) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    stVoiceSel.appendChild(opt);
  }
  stVoiceSel.value = voices.includes(savedVoice) ? savedVoice : voices[0];
}

function fillStLangs(list, savedLang) {
  const langs = list && list.length ? list : Object.keys(LANG_NAMES);
  stLangSel.innerHTML = "";

  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Otomatik (video dili)";
  stLangSel.appendChild(auto);

  for (const code of langs) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = LANG_NAMES[code] ? `${LANG_NAMES[code]} (${code})` : code;
    stLangSel.appendChild(opt);
  }
  stLangSel.value = savedLang && langs.includes(savedLang) ? savedLang : "";
}

async function probeST(savedVoice, savedLang) {
  if (stOk) return;
  setStatus("SuperTonic sunucusu aranıyor…");
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ type: "ST_VOICES" });
  } catch {
    res = null;
  }
  if (res && res.ok) {
    stOk = true;
    fillStVoices(res.voices, savedVoice);
    fillStLangs(res.languages, savedLang);
    setStatus("SuperTonic sunucusuna bağlandı");
  } else {
    stOk = false;
    fillStVoices(null, savedVoice);
    fillStLangs(null, savedLang);
    setStatus("Sunucu bulunamadı: ws://127.0.0.1:8765", "error");
  }
  render();
}

async function refreshStatus() {
  const res = await send({ type: "STATUS" });
  if (res) {
    tabOk = true;
    running = res.running;
    if (running) {
      setStatus(`Seslendirme aktif${res.mode === "supertonic" ? " (SuperTonic)" : ""}`, "active");
    } else if (!(mode === "supertonic" && !stOk)) {
      setStatus("Hazır");
    }
  } else {
    tabOk = false;
    setStatus("Bu sekmede çalıştırılamaz. YouTube sekmesini aç.", "error");
  }
  render();
}

async function init() {
  const saved = await chrome.storage.local.get(["mode", "voiceURI", "rate", "stVoice", "stLang"]);
  mode = saved.mode === "supertonic" ? "supertonic" : "browser";
  document.getElementById(mode === "supertonic" ? "modeSt" : "modeBrowser").checked = true;
  if (saved.rate) rateSel.value = String(saved.rate);
  fillVoices(saved.voiceURI);
  fillStVoices(null, saved.stVoice);
  fillStLangs(null, saved.stLang);

  const tab = await activeTab();
  tabId = tab ? tab.id : null;

  if (mode === "supertonic") await probeST(saved.stVoice, saved.stLang);
  await refreshStatus();
}

modeRadios.forEach((radio) => {
  radio.addEventListener("change", async () => {
    mode = currentMode();
    await chrome.storage.local.set({ mode });
    render();
    if (mode === "supertonic") {
      const saved = await chrome.storage.local.get(["stVoice", "stLang"]);
      stOk = false;
      await probeST(saved.stVoice, saved.stLang);
    } else {
      setStatus("Hazır");
    }
  });
});

toggleBtn.addEventListener("click", async () => {
  if (tabId == null) return;
  const rate = parseFloat(rateSel.value) || 1;

  let payload;
  if (running) {
    payload = { type: "STOP" };
  } else if (mode === "supertonic") {
    const stVoice = stVoiceSel.value || "M1";
    const stLang = stLangSel.value || null;
    await chrome.storage.local.set({ stVoice, stLang, rate });
    payload = { type: "START", mode: "supertonic", stVoice, stLang, rate };
  } else {
    const voiceURI = voiceSel.value || null;
    await chrome.storage.local.set({ voiceURI, rate });
    payload = { type: "START", mode: "browser", voiceURI, rate };
  }

  const res = await send(payload);
  if (!res) {
    setStatus("Bağlantı kurulamadı. Sayfayı yenileyin.", "error");
    return;
  }
  running = res.running;
  if (running) {
    setStatus(`Seslendirme aktif${mode === "supertonic" ? " (SuperTonic)" : ""}`, "active");
  } else if (mode === "supertonic" && !stOk) {
    setStatus("Sunucu bulunamadı: ws://127.0.0.1:8765", "error");
  } else {
    setStatus("Durduruldu");
  }
  render();
});

voiceSel.addEventListener("change", async () => {
  await chrome.storage.local.set({ voiceURI: voiceSel.value || null });
});

stVoiceSel.addEventListener("change", async () => {
  await chrome.storage.local.set({ stVoice: stVoiceSel.value });
});

stLangSel.addEventListener("change", async () => {
  await chrome.storage.local.set({ stLang: stLangSel.value || null });
});

rateSel.addEventListener("change", async () => {
  await chrome.storage.local.set({ rate: parseFloat(rateSel.value) || 1 });
});

speechSynthesis.onvoiceschanged = () => fillVoices(voiceSel.value);

init();
