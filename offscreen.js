let queue = [];
let playing = false;
let paused = false;
let current = null;
let currentItem = null;
let currentUrl = null;
let pauseStartedAt = null;
let catchSticky = 0;
let reportTimer = null;
let lastReport = 0;

function findTag(bytes, tag, from) {
  const a = tag.charCodeAt(0),
    b = tag.charCodeAt(1),
    c = tag.charCodeAt(2),
    d = tag.charCodeAt(3);
  for (let i = from || 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === a && bytes[i + 1] === b && bytes[i + 2] === c && bytes[i + 3] === d) return i;
  }
  return -1;
}

function trimWavTail(bytes) {
  try {
    const f = findTag(bytes, "fmt ");
    const d = findTag(bytes, "data");
    if (f < 0 || d < 0 || d + 8 + 64 > bytes.length) return bytes;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const channels = dv.getUint16(f + 10, true);
    const sampleRate = dv.getUint32(f + 12, true);
    const bits = dv.getUint16(f + 22, true);
    if (bits !== 16 || channels < 1 || sampleRate < 8000) return bytes;
    const frame = channels * 2;
    const dStart = d + 8;
    const total = Math.floor((bytes.length - dStart) / frame);
    if (total < 1000) return bytes;
    const thr = 500;
    let last = -1;
    for (let i = total - 1; i >= 0; i--) {
      const off = dStart + i * frame;
      let mx = 0;
      for (let ch = 0; ch < channels; ch++) {
        const v = Math.abs(dv.getInt16(off + ch * 2, true));
        if (v > mx) mx = v;
      }
      if (mx > thr) {
        last = i;
        break;
      }
    }
    if (last < 0) return bytes;
    const keep = Math.min(total, last + Math.round(sampleRate * 0.06));
    const newLen = dStart + keep * frame;
    if (newLen >= bytes.length - 16) return bytes;
    const out = bytes.slice(0, newLen);
    const odv = new DataView(out.buffer);
    odv.setUint32(4, newLen - 8, true);
    odv.setUint32(d + 4, keep * frame, true);
    return out;
  } catch {
    return bytes;
  }
}

function lagInfo() {
  const now = Date.now();
  let lag = 0;
  if (queue.length > 0) {
    lag = Math.max(0, (now - (queue[0].td || now)) / 1000);
  } else if (current && currentItem) {
    const td = currentItem.td || now;
    lag = Math.max(0, (now - td) / 1000 - (current.currentTime || 0));
  }
  return { lag: Math.round(lag * 100) / 100, queued: queue.length };
}

function isCatchup(item) {
  return !!item && (item.syncMode === "catchup" || item.syncMode === "both");
}

function autoFactor(lag) {
  if (lag <= 1) return 1;
  return Math.min(1.2, 1 + (lag - 1) * 0.05);
}

function effectiveRate(item, info) {
  const base = (item && item.rate) || 1;
  if (isCatchup(item)) {
    const factor = [1, 1.25, 1.5][catchSticky] || 1;
    return Math.min(4, base * factor);
  }
  if (item && item.syncMode === "video") {
    const lag = info ? info.lag : lagInfo().lag;
    return Math.min(4, base * autoFactor(lag));
  }
  return base;
}

function refreshCatchup(info) {
  const raw = info.lag > 6 ? 2 : info.lag > 3 ? 1 : 0;
  if (raw === 0) catchSticky = 0;
  else if (raw > catchSticky) catchSticky = raw;

  if (current && currentItem && (isCatchup(currentItem) || currentItem.syncMode === "video")) {
    const r = effectiveRate(currentItem, info);
    if (Math.abs((current.playbackRate || 0) - r) > 0.01) {
      current.playbackRate = r;
    }
  }
}

function report(force) {
  const now = Date.now();
  if (!force && now - lastReport < 400) return;
  lastReport = now;
  const info = lagInfo();
  refreshCatchup(info);
  chrome.runtime
    .sendMessage({ type: "ST_LAG", lag: info.lag, queued: info.queued })
    .catch(() => {});
}

function ensureTicker(on) {
  if (on && !reportTimer) {
    reportTimer = setInterval(() => report(false), 500);
    report(true);
  } else if (!on && reportTimer) {
    clearInterval(reportTimer);
    reportTimer = null;
  }
}

function cleanupCurrent() {
  if (current) {
    current.onended = null;
    current.onerror = null;
    try {
      current.pause();
    } catch {}
    current = null;
  }
  currentItem = null;
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  playing = false;
}

function playNext() {
  if (playing || paused) return;
  const item = queue.shift();
  if (!item) {
    report(true);
    ensureTicker(false);
    return;
  }

  playing = true;
  ensureTicker(true);

  const url = URL.createObjectURL(new Blob([item.bytes], { type: "audio/wav" }));
  const audio = new Audio(url);
  audio.playbackRate = effectiveRate(item, lagInfo());
  audio.preservesPitch = true;

  const done = () => {
    if (current !== audio) return;
    current = null;
    currentItem = null;
    playing = false;
    URL.revokeObjectURL(url);
    report(true);
    playNext();
  };

  current = audio;
  currentItem = item;
  currentUrl = url;
  audio.onended = done;
  audio.onerror = done;
  audio.play().catch(done);
}

function shiftTds(delta) {
  if (!delta) return;
  for (const it of queue) it.td = (it.td || 0) + delta;
  if (currentItem) currentItem.td = (currentItem.td || 0) + delta;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.type === "PLAY_WAV") {
    const bytes = trimWavTail(Uint8Array.from(atob(msg.buffer), (c) => c.charCodeAt(0)));
    queue.push({
      bytes,
      rate: msg.rate,
      syncMode: msg.syncMode,
      td: msg.td || Date.now(),
    });
    ensureTicker(true);
    if (!paused) playNext();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "PAUSE_AUDIO") {
    if (!paused) {
      paused = true;
      pauseStartedAt = Date.now();
    }
    if (current) {
      try {
        current.pause();
      } catch {}
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "RESUME_AUDIO") {
    if (paused && pauseStartedAt) {
      shiftTds(Date.now() - pauseStartedAt);
    }
    paused = false;
    pauseStartedAt = null;
    if (current) {
      current.play().catch(() => {});
    } else {
      playNext();
    }
    report(true);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "STOP_AUDIO") {
    queue = [];
    paused = false;
    pauseStartedAt = null;
    catchSticky = 0;
    cleanupCurrent();
    report(true);
    ensureTicker(false);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
