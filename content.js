(() => {
  const state = {
    running: false,
    mode: "browser",
    voiceURI: null,
    rate: 1,
    stVoice: "M1",
    stLang: null,
    lastText: "",
    timer: null,
    observer: null,
    keepAlive: null,
    video: null,
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

  function nextChunk(text) {
    const rolling = state.lastText && text.startsWith(state.lastText);
    let chunk = text;
    if (rolling) {
      chunk = text.slice(state.lastText.length);
    } else if (state.mode === "browser") {
      speechSynthesis.cancel();
    } else {
      stSend({ type: "ST_STOP" });
    }
    state.lastText = text;
    return chunk.trim();
  }

  function speakNow(text) {
    if (!state.running || !text) return;

    const chunk = nextChunk(text);
    if (!chunk) return;

    if (state.mode === "supertonic") {
      stSend({
        type: "ST_SPEAK",
        text: chunk,
        voice: state.stVoice || "M1",
        lang: state.stLang || pageLang(),
        rate: state.rate,
      });
      return;
    }

    const u = new SpeechSynthesisUtterance(chunk);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = state.rate;
    speechSynthesis.speak(u);
  }

  function scheduleSpeak(text) {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => speakNow(text), 300);
  }

  function onMutate() {
    scheduleSpeak(captionText());
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

  function handlePause() {
    if (state.mode === "supertonic") stSend({ type: "ST_CONTROL", action: "PAUSE_AUDIO" });
    else speechSynthesis.pause();
  }

  function handlePlay() {
    if (state.mode === "supertonic") stSend({ type: "ST_CONTROL", action: "RESUME_AUDIO" });
    else speechSynthesis.resume();
  }

  function handleSeeking() {
    state.lastText = "";
    if (state.mode === "supertonic") stSend({ type: "ST_STOP" });
    else speechSynthesis.cancel();
  }

  function bindVideo() {
    const video = document.querySelector("video");
    state.video = video;
    if (!video) return;

    state.handlers = {
      pause: handlePause,
      play: handlePlay,
      seeking: handleSeeking,
    };
    video.addEventListener("pause", state.handlers.pause);
    video.addEventListener("play", state.handlers.play);
    video.addEventListener("seeking", state.handlers.seeking);
  }

  function unbindVideo() {
    if (state.video && state.handlers) {
      state.video.removeEventListener("pause", state.handlers.pause);
      state.video.removeEventListener("play", state.handlers.play);
      state.video.removeEventListener("seeking", state.handlers.seeking);
    }
    state.video = null;
    state.handlers = null;
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
    state.lastText = "";
    state.running = true;
    if (state.mode === "browser") speechSynthesis.getVoices();
    bindVideo();
    attachObserver();
    startKeepAlive();
    scheduleSpeak(captionText());
  }

  function stopCore() {
    clearTimeout(state.timer);
    state.timer = null;
    detachObserver();
    unbindVideo();
    clearInterval(state.keepAlive);
    state.keepAlive = null;
    if (state.mode === "supertonic") {
      stSend({ type: "ST_STOP" });
    } else {
      speechSynthesis.cancel();
      speechSynthesis.resume();
    }
    state.lastText = "";
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
    }
    return false;
  });
})();
