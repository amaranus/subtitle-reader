(() => {
  const state = {
    running: false,
    voiceURI: null,
    rate: 1,
    lastText: "",
    timer: null,
    observer: null,
    keepAlive: null,
    video: null,
    handlers: null,
  };

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

  function pickVoice() {
    if (!state.voiceURI) return null;
    return speechSynthesis.getVoices().find((v) => v.voiceURI === state.voiceURI) || null;
  }

  function speakNow(text) {
    if (!state.running) return;
    if (!text) return;

    let chunk = text;
    const rolling = state.lastText && text.startsWith(state.lastText);
    if (rolling) {
      chunk = text.slice(state.lastText.length);
    } else {
      speechSynthesis.cancel();
    }
    chunk = chunk.trim();
    if (!chunk) return;

    const u = new SpeechSynthesisUtterance(chunk);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = state.rate;
    speechSynthesis.speak(u);
    state.lastText = text;
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

  function bindVideo() {
    const video = document.querySelector("video");
    state.video = video;
    if (!video) return;

    state.handlers = {
      pause: () => speechSynthesis.pause(),
      play: () => speechSynthesis.resume(),
      seeking: () => {
        speechSynthesis.cancel();
        state.lastText = "";
      },
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
        speechSynthesis.speaking &&
        !speechSynthesis.paused &&
        (!state.video || !state.video.paused)
      ) {
        speechSynthesis.resume();
      }
    }, 8000);
  }

  function start({ voiceURI, rate }) {
    stopCore();
    state.voiceURI = voiceURI || null;
    state.rate = rate || 1;
    state.lastText = "";
    state.running = true;
    speechSynthesis.getVoices();
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
    speechSynthesis.cancel();
    speechSynthesis.resume();
    state.lastText = "";
    state.running = false;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "START") {
      start(msg);
      sendResponse({ ok: true, running: true });
    } else if (msg.type === "STOP") {
      stopCore();
      sendResponse({ ok: true, running: false });
    } else if (msg.type === "STATUS") {
      sendResponse({ ok: true, running: state.running });
    }
    return false;
  });
})();
