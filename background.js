const WS_URL = "ws://127.0.0.1:8765";
const CONNECT_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 60000;

let ws = null;
let handshake = null;
let connectWaiter = null;
let pendingMeta = null;
let pending = null;
let sendQueue = [];
let processing = false;
let generation = 0;

function ensureConnected() {
  if (ws && ws.readyState === WebSocket.OPEN && handshake) {
    return Promise.resolve(handshake);
  }
  if (connectWaiter) return connectWaiter.promise;

  const waiter = {};
  waiter.promise = new Promise((resolve, reject) => {
    waiter.resolve = resolve;
    waiter.reject = reject;
  });
  connectWaiter = waiter;

  let sock;
  try {
    sock = new WebSocket(WS_URL);
  } catch (err) {
    connectWaiter = null;
    waiter.reject(err);
    return waiter.promise;
  }
  sock.binaryType = "arraybuffer";
  ws = sock;

  const timer = setTimeout(() => {
    if (connectWaiter === waiter) connectWaiter = null;
    try {
      sock.close();
    } catch {}
    waiter.reject(new Error("SuperTonic sunucusuna bağlanılamadı (ws://127.0.0.1:8765)"));
  }, CONNECT_TIMEOUT_MS);

  sock.onmessage = (ev) => {
    if (typeof ev.data !== "string") {
      onBinary(ev.data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.status === "connected") {
      handshake = { voices: msg.voices || [], languages: msg.languages || [] };
      clearTimeout(timer);
      if (connectWaiter === waiter) {
        connectWaiter = null;
        waiter.resolve(handshake);
      }
    } else if (msg.type === "audio_meta") {
      pendingMeta = msg;
    } else if (msg.type === "error") {
      finishPending({ ok: false, error: msg.message || "sunucu hatası" });
      pump();
    }
  };

  sock.onclose = () => {
    if (ws === sock) ws = null;
    handshake = null;
    if (connectWaiter) {
      const w = connectWaiter;
      connectWaiter = null;
      clearTimeout(timer);
      w.reject(new Error("SuperTonic bağlantısı kapandı"));
    }
    finishPending({ ok: false, error: "bağlantı kapandı" });
    pump();
  };

  sock.onerror = () => {};

  return waiter.promise;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function onBinary(data) {
  const meta = pendingMeta;
  pendingMeta = null;
  const p = pending;
  pending = null;
  if (!p) return;
  clearTimeout(p.timer);
  if (p.gen === generation) {
    ensureOffscreen()
      .then(() =>
        chrome.runtime.sendMessage({
          target: "offscreen",
          type: "PLAY_WAV",
          buffer: toBase64(data),
          rate: p.rate,
          meta,
        })
      )
      .catch(() => {});
  }
  p.resolve({ ok: true });
  pump();
}

function finishPending(result) {
  const p = pending;
  pending = null;
  if (p) {
    clearTimeout(p.timer);
    p.resolve(result);
  }
}

function pump() {
  if (processing) return;
  const item = sendQueue.shift();
  if (!item) return;
  if (item.gen !== generation) {
    pump();
    return;
  }
  processing = true;

  ensureConnected()
    .then((h) => {
      if (item.gen !== generation) throw new Error("durdu");
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("SuperTonic bağlantısı yok");
      }
      return new Promise((resolve, reject) => {
        const gen = item.gen;
        pending = {
          resolve,
          rate: item.rate,
          gen,
          timer: setTimeout(() => {
            pending = null;
            reject(new Error("sunucu zaman aşımı"));
          }, REQUEST_TIMEOUT_MS),
        };
        ws.send(
          JSON.stringify({
            text: item.text,
            lang: item.lang || "en",
            voice: item.voice || "M1",
            speed: 1,
          })
        );
      });
    })
    .catch((err) => {
      console.warn("[Subtitle Reader] Supertonic:", err && err.message);
    })
    .finally(() => {
      processing = false;
      pump();
    });
}

async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Supertonic WAV seslerini oynatmak icin",
    });
  } catch {
    // zaten acik
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "ST_SPEAK") {
    sendQueue.push({
      text: msg.text,
      voice: msg.voice,
      lang: msg.lang,
      rate: msg.rate,
      gen: generation,
    });
    pump();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "ST_STOP") {
    generation++;
    sendQueue = [];
    pendingMeta = null;
    chrome.runtime.sendMessage({ target: "offscreen", type: "STOP_AUDIO" }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "ST_CONTROL") {
    chrome.runtime.sendMessage({ target: "offscreen", type: msg.action }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "ST_VOICES") {
    ensureConnected()
      .then((h) => sendResponse({ ok: true, voices: h.voices, languages: h.languages }))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }

  return false;
});
