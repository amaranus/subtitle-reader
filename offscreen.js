let queue = [];
let playing = false;
let paused = false;
let current = null;
let currentUrl = null;

function cleanupCurrent() {
  if (current) {
    current.onended = null;
    current.onerror = null;
    try {
      current.pause();
    } catch {}
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  playing = false;
}

function playNext() {
  if (playing || paused) return;
  const item = queue.shift();
  if (!item) return;

  playing = true;
  const bytes = Uint8Array.from(atob(item.buffer), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  const audio = new Audio(url);
  audio.playbackRate = item.rate || 1;
  audio.preservesPitch = true;

  const done = () => {
    if (current !== audio) return;
    current = null;
    currentUrl = null;
    playing = false;
    URL.revokeObjectURL(url);
    playNext();
  };

  current = audio;
  currentUrl = url;
  audio.onended = done;
  audio.onerror = done;
  audio.play().catch(done);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.type === "PLAY_WAV") {
    queue.push(msg);
    if (!paused) playNext();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "PAUSE_AUDIO") {
    paused = true;
    if (current) {
      try {
        current.pause();
      } catch {}
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "RESUME_AUDIO") {
    paused = false;
    if (current) {
      current.play().catch(() => {});
    } else {
      playNext();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "STOP_AUDIO") {
    queue = [];
    paused = false;
    cleanupCurrent();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
