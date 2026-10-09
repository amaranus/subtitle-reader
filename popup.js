const toggleBtn = document.getElementById("toggleBtn");
const statusEl = document.getElementById("status");
const voiceSel = document.getElementById("voiceSel");
const rateSel = document.getElementById("rateSel");

let running = false;
let tabId = null;

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = "status" + (cls ? " " + cls : "");
}

function render() {
  toggleBtn.textContent = running ? "Durdur" : "Başlat";
  toggleBtn.classList.toggle("stop", running);
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

  const local = voices.filter((v) => v.localService);
  const remote = voices.filter((v) => !v.localService);
  const ordered = [...local, ...remote];

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

async function init() {
  const saved = await chrome.storage.local.get(["voiceURI", "rate"]);
  if (saved.rate) rateSel.value = String(saved.rate);
  fillVoices(saved.voiceURI);

  const tab = await activeTab();
  tabId = tab ? tab.id : null;

  const res = await send({ type: "STATUS" });
  if (res) {
    running = res.running;
    setStatus(running ? "Seslendirme aktif" : "Hazır", running ? "active" : "");
  } else {
    setStatus("Bu sekmede çalıştırılamaz. YouTube sekmesini aç.", "error");
    toggleBtn.disabled = true;
  }
  render();
}

toggleBtn.addEventListener("click", async () => {
  if (tabId == null) return;
  const voiceURI = voiceSel.value || null;
  const rate = parseFloat(rateSel.value) || 1;
  await chrome.storage.local.set({ voiceURI, rate });

  const res = await send(running ? { type: "STOP" } : { type: "START", voiceURI, rate });
  if (!res) {
    setStatus("Bağlantı kurulamadı. Sayfayı yenileyin.", "error");
    return;
  }
  running = res.running;
  setStatus(running ? "Seslendirme aktif" : "Durduruldu", running ? "active" : "");
  render();
});

voiceSel.addEventListener("change", async () => {
  await chrome.storage.local.set({ voiceURI: voiceSel.value || null });
});

rateSel.addEventListener("change", async () => {
  await chrome.storage.local.set({ rate: parseFloat(rateSel.value) || 1 });
});

speechSynthesis.onvoiceschanged = () => fillVoices(voiceSel.value);

init();
