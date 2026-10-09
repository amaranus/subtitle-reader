(() => {
  const STABLE_MS = 550;
  const SHORT_MS = 800;
  const SENT_MS = 100;
  const SENT_RE = /[.,!?…]["'”’)\]]?$/;
  const MAX_PENDING = 320;

  const state = {
    running: false,
    mode: "browser",
    voiceURI: null,
    rate: 1,
    stVoice: "M1",
    stLang: null,
    syncMode: "off",
    offset: 0,
    pending: 0,
    video: null,
    videoOrig: null,
    videoLevel: -1,
    videoWePaused: false,
    ourPause: false,
    userPaused: false,
    noPauseUntil: 0,
    lagGraceUntil: 0,
    lastRaw: "",
    prevTokens: [],
    hasPrev: false,
    pendingText: "",
    due: [],
    sendTimer: null,
    timer: null,
    observer: null,
    keepAlive: null,
    enforce: null,
    handlers: null,
  };

  function stSend(msg) {
    try {
      const p = chrome.runtime.sendMessage(msg);
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }

  function captionText() {
    const segs = document.querySelectorAll(".ytp-caption-segment");
    if (segs.length) {
      return Array.from(segs)
        .map((s) => s.textContent)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    const win = document.querySelector(".ytp-caption-window-text");
    return win ? win.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function pageLang() {
    const raw = (document.documentElement.lang || navigator.language || "en").toLowerCase();
    return raw.split("-")[0] || "en";
  }

  function pickVoice() {
    if (!state.voiceURI) return null;
    return speechSynthesis.getVoices().find((v) => v.voiceURI === state.voiceURI) || null;
  }

  function syncOn() {
    return state.syncMode !== "off";
  }

  function videoSyncOn() {
    return state.syncMode === "video" || state.syncMode === "both";
  }

  function catchUpOn() {
    return state.syncMode === "catchup" || state.syncMode === "both";
  }

  function browserFactor() {
    if (!catchUpOn()) return 1;
    if (state.pending >= 4) return 1.5;
    if (state.pending >= 2) return 1.25;
    return 1;
  }

  // ---- video sync ----

  function resumeVideo() {
    state.videoWePaused = false;
    if (!state.video || !state.video.paused) return;
    const p = state.video.play();
    if (p && p.catch) p.catch(() => {});
  }

  function setVideoLevel(level) {
    if (!state.video) return;
    if (level === 3 && Date.now() < state.noPauseUntil) level = 2;
    if (level === state.videoLevel) return;
    const prev = state.videoLevel;
    state.videoLevel = level;

    if (prev === 3 && state.videoWePaused) resumeVideo();

    if (level === 0) {
      state.video.playbackRate = state.videoOrig != null ? state.videoOrig : 1;
    } else if (level === 1) {
      state.video.playbackRate = 0.75;
    } else if (level === 2) {
      state.video.playbackRate = 0.5;
    } else if (level === 3) {
      if (!state.video.paused) {
        state.ourPause = true;
        state.videoWePaused = true;
        state.video.pause();
      }
    }
  }

  function applyLevel(raw) {
    if (raw === 0) setVideoLevel(0);
    else if (raw > state.videoLevel) setVideoLevel(raw);
  }

  function evalBrowserVideo() {
    if (!videoSyncOn()) {
      setVideoLevel(0);
      return;
    }
    const p = state.pending;
    applyLevel(p >= 6 ? 3 : p >= 4 ? 2 : p >= 2 ? 1 : 0);
  }

  // ---- caption reading: stream delta, sentence-level flush ----

  const wordNorm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

  function wordOverlap(prev, cur) {
    const max = Math.min(prev.length, cur.length);
    for (let k = max; k > 0; k--) {
      let match = true;
      for (let i = 0; i < k; i++) {
        if (wordNorm(prev[prev.length - k + i]) !== wordNorm(cur[i])) {
          match = false;
          break;
        }
      }
      if (match) return k;
    }
    return 0;
  }

  function handleCaption(text) {
    if (text === state.lastRaw) return;

    if (!text) {
      flushCue();
      resetStream();
      return;
    }

    const tokens = text.split(/\s+/);
    let delta;
    if (state.hasPrev) {
      const k = wordOverlap(state.prevTokens, tokens);
      if (k === 0) {
        flushCue();
        delta = tokens.join(" ");
      } else {
        delta = tokens.slice(k).join(" ");
      }
    } else {
      delta = tokens.join(" ");
    }
    if (delta) state.pendingText = state.pendingText ? state.pendingText + " " + delta : delta;

    state.prevTokens = tokens;
    state.hasPrev = true;
    state.lastRaw = text;

    if (state.pendingText.length > MAX_PENDING) {
      flushCue();
      return;
    }
    const sentenceDone = SENT_RE.test(state.pendingText);
    const wcount = state.pendingText.split(/\s+/).length;
    scheduleFlush(sentenceDone ? SENT_MS : wcount < 3 ? SHORT_MS : STABLE_MS);
  }

  function resetStream() {
    state.lastRaw = "";
    state.prevTokens = [];
    state.hasPrev = false;
    state.pendingText = "";
  }

  function scheduleFlush(base) {
    clearTimeout(state.timer);
    const neg = Math.min(0, state.offset || 0) * 1000;
    const floor = base >= STABLE_MS ? 500 : 50;
    const delay = Math.max(floor, base + neg);
    state.timer = setTimeout(() => flushCue(), delay);
  }

  function flushCue() {
    clearTimeout(state.timer);
    state.timer = null;
    const text = state.pendingText;
    if (!state.running || !text) return;
    state.pendingText = "";
    queueSend(text, Date.now() + Math.max(0, (state.offset || 0) * 1000));
  }

  function queueSend(text, at) {
    state.due.push({ text, at });
    armSendTimer();
  }

  function armSendTimer() {
    if (state.sendTimer || !state.due.length) return;
    const wait = Math.max(0, state.due[0].at - Date.now());
    state.sendTimer = setTimeout(() => {
      state.sendTimer = null;
      const now = Date.now();
      while (state.due.length && state.due[0].at <= now) {
        const item = state.due.shift();
        if (!state.running || !item.text) continue;
        if (!syncOn()) hardCancel();
        dispatch(item.text);
      }
      armSendTimer();
    }, wait);
  }

  function clearDue() {
    clearTimeout(state.sendTimer);
    state.sendTimer = null;
    state.due = [];
  }

  function hardCancel() {
    if (state.mode === "supertonic") {
      stSend({ type: "ST_STOP" });
    } else {
      speechSynthesis.cancel();
      state.pending = 0;
    }
  }

  function dispatch(chunk) {
    if (state.mode === "supertonic") {
      stSend({
        type: "ST_SPEAK",
        text: chunk,
        voice: state.stVoice || "M1",
        lang: state.stLang || pageLang(),
        rate: state.rate,
        syncMode: state.syncMode,
        td: Date.now(),
      });
      return;
    }

    const u = new SpeechSynthesisUtterance(chunk);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = state.rate * browserFactor();
    const done = () => {
      state.pending = Math.max(0, state.pending - 1);
      evalBrowserVideo();
    };
    u.onend = done;
    u.onerror = done;
    state.pending++;
    evalBrowserVideo();
    speechSynthesis.speak(u);
  }

  function onMutate() {
    handleCaption(captionText());
  }

  function attachObserver() {
    const target = document.querySelector(".html5-video-player") || document.body;
    state.observer = new MutationObserver(onMutate);
    state.observer.observe(target, { subtree: true, childList: true, characterData: true });
  }

  function detachObserver() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
  }

  // ---- video events ----

  function handlePause() {
    if (state.ourPause) {
      state.ourPause = false;
      return;
    }
    state.userPaused = true;
    if (state.mode === "supertonic") stSend({ type: "ST_CONTROL", action: "PAUSE_AUDIO" });
    else speechSynthesis.pause();
  }

  function handlePlay() {
    state.userPaused = false;
    state.lagGraceUntil = Date.now() + 2500;
    if (state.videoLevel === 3) {
      state.videoWePaused = false;
      state.noPauseUntil = Date.now() + 15000;
      state.videoLevel = 2;
      if (state.video) state.video.playbackRate = 0.5;
    }
    if (state.mode === "supertonic") stSend({ type: "ST_CONTROL", action: "RESUME_AUDIO" });
    else speechSynthesis.resume();
  }

  function handleSeeking() {
    resetStream();
    clearDue();
    state.pending = 0;
    if (state.mode === "supertonic") stSend({ type: "ST_STOP" });
    else speechSynthesis.cancel();
    evalBrowserVideo();
  }

  function bindVideo() {
    const video = document.querySelector("video");
    state.video = video;
    if (!video) return;
    state.videoOrig = video.playbackRate;
    state.videoLevel = -1;

    state.handlers = {
      pause: handlePause,
      play: handlePlay,
      seeking: handleSeeking,
    };
    video.addEventListener("pause", state.handlers.pause);
    video.addEventListener("play", state.handlers.play);
    video.addEventListener("seeking", state.handlers.seeking);
  }

  function restoreVideoRate() {
    if (state.video && state.videoOrig != null) {
      state.video.playbackRate = state.videoOrig;
    }
    if (state.videoWePaused && state.video && state.video.paused) resumeVideo();
    state.video = null;
    state.videoOrig = null;
    state.videoLevel = -1;
    state.videoWePaused = false;
    state.ourPause = false;
    state.userPaused = false;
  }

  function unbindVideo() {
    if (state.video && state.handlers) {
      state.video.removeEventListener("pause", state.handlers.pause);
      state.video.removeEventListener("play", state.handlers.play);
      state.video.removeEventListener("seeking", state.handlers.seeking);
    }
    state.handlers = null;
    restoreVideoRate();
  }

  function startEnforce() {
    state.enforce = setInterval(() => {
      if (!state.running || !state.video || !videoSyncOn()) return;
      const lvl = state.videoLevel;
      if (lvl === 1 || lvl === 2) {
        const want = lvl === 1 ? 0.75 : 0.5;
        if (!state.video.paused && Math.abs(state.video.playbackRate - want) > 0.01) {
          state.video.playbackRate = want;
        }
      } else if (lvl === 3 && !state.video.paused) {
        state.ourPause = true;
        state.videoWePaused = true;
        state.video.pause();
      }
    }, 1000);
  }

  function startKeepAlive() {
    state.keepAlive = setInterval(() => {
      if (
        state.running &&
        state.mode === "browser" &&
        speechSynthesis.speaking &&
        !speechSynthesis.paused &&
        (!state.video || !state.video.paused)
      ) {
        speechSynthesis.resume();
      }
    }, 8000);
  }

  function start(msg) {
    stopCore();
    state.mode = msg.mode === "supertonic" ? "supertonic" : "browser";
    state.voiceURI = msg.voiceURI || null;
    state.rate = msg.rate || 1;
    state.stVoice = msg.stVoice || "M1";
    state.stLang = msg.stLang || null;
    state.syncMode = msg.syncMode || "off";
    state.offset = typeof msg.offset === "number" ? msg.offset : 0;
    state.pending = 0;
    resetStream();
    state.running = true;
    if (state.mode === "supertonic") {
      stSend({ type: "ST_REGISTER" });
    } else {
      speechSynthesis.getVoices();
    }
    bindVideo();
    attachObserver();
    startKeepAlive();
    startEnforce();
    handleCaption(captionText());
  }

  function stopCore() {
    clearTimeout(state.timer);
    state.timer = null;
    clearDue();
    detachObserver();
    unbindVideo();
    clearInterval(state.keepAlive);
    state.keepAlive = null;
    clearInterval(state.enforce);
    state.enforce = null;
    state.pending = 0;
    if (state.mode === "supertonic") {
      stSend({ type: "ST_STOP" });
    } else {
      speechSynthesis.cancel();
      speechSynthesis.resume();
    }
    resetStream();
    state.running = false;
  }

  window.addEventListener("pagehide", () => {
    if (state.running) stopCore();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "START") {
      start(msg);
      sendResponse({ ok: true, running: true });
    } else if (msg.type === "STOP") {
      stopCore();
      sendResponse({ ok: true, running: false });
    } else if (msg.type === "STATUS") {
      sendResponse({ ok: true, running: state.running, mode: state.mode });
    } else if (msg.type === "SET_CONFIG") {
      if (typeof msg.rate === "number") state.rate = msg.rate;
      if (msg.syncMode) state.syncMode = msg.syncMode;
      if (typeof msg.offset === "number") state.offset = msg.offset;
      if (!videoSyncOn()) setVideoLevel(0);
      else if (state.mode === "browser") evalBrowserVideo();
      sendResponse({ ok: true });
    } else if (msg.type === "ST_LAG") {
      if (
        state.running &&
        state.mode === "supertonic" &&
        videoSyncOn() &&
        !state.userPaused &&
        Date.now() > state.lagGraceUntil
      ) {
        const lag = msg.lag || 0;
        applyLevel(lag > 9 ? 3 : lag > 6 ? 2 : lag > 3 ? 1 : 0);
      }
      sendResponse({ ok: true });
    }
    return false;
  });
})();
