/**
 * Live in-place Vietnamese dictation for idea editors.
 * Unlike the separate quick capture flow, this uses the browser SpeechRecognition
 * API for interim text; it never opens an audio-review modal.
 */
export function createLiveDictation({
  target,
  button,
  status,
  onPreview = () => {},
  recognitionFactory = () => window.SpeechRecognition || window.webkitSpeechRecognition,
} = {}) {
  let current = null;
  const setStatus = (text) => { if (status?.isConnected) status.textContent = text; };
  const setButton = (active) => {
    if (!button?.isConnected) return;
    button.classList.toggle("dictation-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute(
      "aria-label",
      (active ? "Dừng" : "Bắt đầu") + " nhập giọng nói cho Nội dung ý tưởng",
    );
    button.title = active ? "Dừng nhập giọng nói" : "Đọc thành chữ ngay trong ô";
    if (!button.classList.contains("voice-icon-only"))
      button.textContent = active ? "■ Dừng đọc" : "🎙 Đọc thành chữ";
    else
      button.textContent = active ? "■" : "🎙";
  };

  function commit(s) {
    if (!target.isConnected || target.value === s.lastCommitted) return;
    s.lastCommitted = target.value;
    s.dispatching = true;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatching = false;
  }
  function release(s, message = "") {
    if (current !== s) return;
    current = null;
    setButton(false);
    commit(s);
    if (message) setStatus(message);
  }
  function abort({ reason = "" } = {}) {
    const s = current;
    if (!s) return;
    // Invalidate callbacks first: a late interim response must never overwrite
    // text typed by the user or changes received from another device.
    current = null;
    try { s.engine.abort(); } catch {}
    setButton(false);
    if (target.value === s.before + s.inserted + s.after) commit(s);
    if (reason) setStatus(reason);
  }
  function stop() {
    const s = current;
    if (!s) return;
    if (s.stopping) return;
    s.stopping = true;
    // Persist the currently visible interim phrase immediately; navigation
    // or form submission may remove the textarea before speechend arrives.
    commit(s);
    setStatus("Đang hoàn tất câu cuối…");
    try {
      s.engine.stop();
      // Some Safari implementations omit end after a paused recognition.
      if (current === s)
        s.stopTimer = window.setTimeout(() => release(s, "Đã dừng. Chạm micro để đọc tiếp."), 1800);
    } catch {
      release(s, "Đã dừng. Chạm micro để đọc tiếp.");
    }
  }
  function applySpeech(s, speech, hasFinal) {
    if (current !== s || !target.isConnected) {
      if (current === s) abort();
      return;
    }
    if (target.value !== s.before + s.inserted + s.after) {
      abort({ reason: "Nội dung vừa được sửa. Đã dừng micro để không ghi đè chữ." });
      return;
    }
    const spoken = String(speech || "").replace(/\s+/gu, " ").trim();
    const prefix = spoken && s.before && !/\s$/u.test(s.before) ? " " : "";
    const suffix = spoken && s.after && !/^[\s,.!?;:]/u.test(s.after) ? " " : "";
    const injected = spoken ? prefix + spoken + suffix : "";
    if (s.inserted !== injected) {
      target.value = s.before + injected + s.after;
      s.inserted = injected;
      onPreview(target);
    }
    if (hasFinal) commit(s);
  }
  function start() {
    if (current) return;
    const Constructor = recognitionFactory();
    if (!Constructor || !window.isSecureContext) {
      setStatus("Trình duyệt chưa hỗ trợ đọc thành chữ trực tiếp. Anh có thể dùng micro trên bàn phím điện thoại.");
      target.focus();
      return;
    }
    let engine;
    try { engine = new Constructor(); } catch {
      setStatus("Chưa mở được nhận dạng giọng nói. Hãy thử Safari hoặc Chrome mới.");
      return;
    }
    engine.lang = "vi-VN";
    engine.continuous = true;
    engine.interimResults = true;
    engine.maxAlternatives = 1;
    const startOffset = target.selectionStart ?? target.value.length;
    const endOffset = target.selectionEnd ?? startOffset;
    const s = {
      engine,
      before: target.value.slice(0, startOffset),
      after: target.value.slice(endOffset),
      inserted: "",
      lastCommitted: target.value,
      dispatching: false,
      stopping: false,
      stopTimer: null,
      hadResult: false,
      lastFinal: "",
      error: "",
    };
    // If a selection existed, replacing it with recognized text is intentional;
    // the empty preview doesn't erase the selection until the first result.
    s.afterSelection = target.value.slice(startOffset, endOffset);
    s.before = target.value.slice(0, startOffset);
    s.after = target.value.slice(endOffset);
    s.inserted = s.afterSelection;
    current = s;
    setButton(true);
    setStatus("Đang mở micro… Chữ sẽ xuất hiện ngay khi anh nói.");
    engine.onstart = () => {
      if (current === s) setStatus("Đang nghe… Anh có thể nói tiếng Việt.");
    };
    engine.onresult = (event) => {
      if (current !== s) return;
      const finals = [];
      const interim = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const part = result[0]?.transcript?.trim();
        if (!part) continue;
        (result.isFinal ? finals : interim).push(part);
      }
      const words = [...finals, ...interim].join(" ");
      if (!words) return;
      s.hadResult = true;
      const finalText = finals.join(" ");
      const newFinal = finalText !== s.lastFinal && finalText.length > 0;
      s.lastFinal = finalText;
      // Interim text is visible immediately, but only new final chunks trigger
      // autosave; this prevents excessive DB writes and cloud sync requests.
      applySpeech(s, words, newFinal);
      if (current === s && !s.stopping)
        setStatus(interim.length ? "Đang nhận lời nói thành chữ…" : "Đang nghe…");
    };
    engine.onerror = (event) => {
      if (current !== s) return;
      const code = event.error || "unknown";
      if (code === "no-speech") {
        s.error = "Chưa nghe thấy giọng nói. Chạm micro để thử lại.";
      } else if (["not-allowed", "service-not-allowed"].includes(code)) {
        s.error = "Micro bị từ chối. Hãy cấp quyền trong Safari hoặc dùng micro trên bàn phím.";
      } else if (code === "network") {
        s.error = "Nhận dạng giọng nói cần kết nối mạng. Nội dung đang viết vẫn được giữ.";
      } else if (code === "audio-capture") {
        s.error = "Không truy cập được micro. Hãy kiểm tra quyền micro trên điện thoại.";
      } else if (code !== "aborted") {
        s.error = "Nhận dạng giọng nói bị gián đoạn. Chạm micro để đọc tiếp.";
      }
    };
    engine.onend = () => {
      window.clearTimeout(s.stopTimer);
      release(s, s.error || (s.stopping
        ? "Đã dừng. Chạm micro để đọc tiếp."
        : s.hadResult
          ? "Đã ngừng nghe. Chạm micro để đọc tiếp."
          : "Chưa nghe thấy giọng nói. Chạm micro để thử lại."));
    };
    try {
      // Must run synchronously inside the user's click gesture on iPhone.
      engine.start();
    } catch (error) {
      release(s, "Không thể bật micro: " + (error.message || "hãy thử lại."));
    }
  }
  const onExternalInput = () => {
    if (!current || current.dispatching) return;
    abort({ reason: "Đã dừng micro để anh gõ. Chạm micro khi muốn đọc tiếp." });
  };
  target.addEventListener("input", onExternalInput);
  setButton(false);
  return {
    target,
    toggle: () => current ? stop() : start(),
    stop,
    abort,
    isActive: () => !!current,
  };
}
