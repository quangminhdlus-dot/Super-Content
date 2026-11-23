import { authorizeVoice, voiceRequest } from "./voice-client.js";
import { createLiveDictation } from "./live-dictation.js";
import {
  AUDIO_TYPES,
  audioType,
  insertVoiceText,
  recordingType,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
} from "../shared/voice.js";

export function initVoice({
  root = document.body,
  authorize = authorizeVoice,
  request = voiceRequest,
  onInserted = () => {},
  onQuickTranscript = async () => null,
  onQuickPolished = async () => {},
  onQuickOpen = async () => {},
  onQuickClosed = () => {},
} = {}) {
  const modal = document.createElement("dialog");
  modal.id = "voice-dialog";
  modal.setAttribute("aria-labelledby", "voice-title");
  modal.innerHTML = "<div class=\"dialog-heading voice-heading\">\n  <h2 id=\"voice-title\">Ghi âm</h2>\n  <button type=\"button\" class=\"icon-button\" data-voice=\"cancel\" aria-label=\"Đóng ghi âm\" title=\"Đóng\">×</button>\n</div>\n<div class=\"voice-recording-screen\">\n  <div class=\"voice-orbit\" aria-hidden=\"true\">\n    <span class=\"voice-ring voice-ring-outer\"></span>\n    <span class=\"voice-ring voice-ring-inner\"></span>\n    <div class=\"voice-bars voice-bars-left\"><i></i><i></i><i></i><i></i></div>\n    <div class=\"voice-mic-core\">\n      <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n        <rect x=\"9\" y=\"2.5\" width=\"6\" height=\"12\" rx=\"3\"></rect>\n        <path d=\"M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7\"></path>\n      </svg>\n    </div>\n    <div class=\"voice-bars voice-bars-right\"><i></i><i></i><i></i><i></i></div>\n  </div>\n  <div id=\"voice-clock\" class=\"voice-timer\" aria-label=\"Thời gian ghi âm\" hidden><span id=\"voice-elapsed\">0:00</span><span class=\"voice-timer-divider\"> / </span><span id=\"voice-limit\">2:00</span></div>\n  <div class=\"voice-controls voice-primary-controls\">\n  <button type=\"button\" class=\"voice-icon-action voice-delete\" data-voice=\"discard\" aria-label=\"Xóa bản ghi\" title=\"Xóa bản ghi\" hidden>\n    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" aria-hidden=\"true\"><path d=\"M5 5l14 14M19 5L5 19\"></path></svg>\n  </button>\n  <button type=\"button\" class=\"voice-icon-action voice-pause\" data-voice=\"pause\" aria-label=\"Tạm dừng\" title=\"Tạm dừng\" hidden>\n    <svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><rect x=\"5\" y=\"4\" width=\"5\" height=\"16\" rx=\"1\"></rect><rect x=\"14\" y=\"4\" width=\"5\" height=\"16\" rx=\"1\"></rect></svg>\n  </button>\n  <button type=\"button\" class=\"voice-icon-action voice-send\" data-voice=\"send\" aria-label=\"Gửi bản ghi\" title=\"Gửi bản ghi\" hidden>\n    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M21 3L10 14M21 3l-6 18-4-8-8-4 18-6\"></path></svg>\n  </button>\n  <button type=\"button\" class=\"voice-restart\" data-voice=\"start\" hidden>Ghi lại</button>\n  <button type=\"button\" data-voice=\"retry\" hidden>Thử lại</button>\n</div>\n</div>\n<p role=\"status\" id=\"voice-status\" aria-live=\"polite\"></p>\n<details class=\"voice-disclosure\"><summary>Thông tin xử lý</summary><p>Đoạn ghi âm và bản chép được gửi đến OpenAI để xử lý. Ứng dụng không lưu âm thanh trên máy chủ.</p></details>\n<div class=\"voice-versions\" hidden>\n  <label class=\"field\">Bản chép gốc<textarea id=\"voice-original\" rows=\"6\" readonly></textarea></label>\n  <label class=\"field\">Bản đã trau chuốt<textarea id=\"voice-polished\" rows=\"6\" readonly></textarea></label>\n  <label class=\"field\">Chọn bản để dùng<select id=\"voice-version\"><option value=\"original\">Bản chép gốc</option><option value=\"polished\" disabled>Bản đã trau chuốt</option></select></label>\n  <p class=\"muted\">Đọc lại tên riêng, số liệu và trích dẫn trước khi dùng. Chèn giữ nguyên nội dung hiện có; thay thế cần xác nhận.</p>\n  <div class=\"voice-controls\"><button type=\"button\" class=\"primary\" data-voice=\"insert\">Chèn tại con trỏ</button><button type=\"button\" data-voice=\"replace\">Thay thế toàn bộ ô</button></div>\n</div>\n<div class=\"voice-quick-actions\" hidden><button type=\"button\" class=\"primary\" data-voice=\"openquick\">Mở trong Kho ý tưởng</button><button type=\"button\" data-voice=\"toscript\">Lưu vào kịch bản</button></div>";
  const q = (selector) => modal.querySelector(selector);
  const button = (name) => q(`[data-voice=${name}]`);
  let session = null;
  const liveDictations = new Set();
  const stopInline = () => { for (const editor of liveDictations) editor.stop(); };
  const cancelInline = () => { for (const editor of liveDictations) editor.abort(); };
  const formatTime = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const pauseSymbol = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1"></rect><rect x="14" y="4" width="5" height="16" rx="1"></rect></svg>';
  const resumeSymbol = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5a1 1 0 0 1 1.5-.86l11 7.5a1 1 0 0 1 0 1.72l-11 7.5A1 1 0 0 1 7 19.5z"></path></svg>';
  const setPhase = (phase) => {
    modal.dataset.voicePhase = phase;
    q("#voice-clock").hidden = !["recording", "paused", "ready"].includes(phase);
    q(".voice-orbit").hidden = phase === "processing" || phase === "review";
  };
  const elapsedMs = (s) =>
    (s.elapsedMs || 0) + (s.recorder?.state === "recording" ? Date.now() - s.resumedAt : 0);
  function updateClock(s) {
    q("#voice-elapsed").textContent = formatTime(Math.floor(elapsedMs(s) / 1000));
  }
  function startClock(s) {
    clearTimers(s);
    updateClock(s);
    s.clock = setInterval(() => {
      updateClock(s);
      if (elapsedMs(s) >= MAX_RECORDING_MS) finish(s, false);
    }, 500);
    s.limit = setTimeout(() => finish(s, false), Math.max(0, MAX_RECORDING_MS - elapsedMs(s)));
  }
  function setPauseButton(paused) {
    const b = button("pause");
    b.setAttribute("aria-label", paused ? "Tiếp tục" : "Tạm dừng");
    b.title = paused ? "Tiếp tục" : "Tạm dừng";
    b.innerHTML = paused ? resumeSymbol : pauseSymbol;
  }

  const meterReset = () => {
    const orbit = q(".voice-orbit");
    orbit.style.setProperty("--voice-scale", "1");
    orbit.style.setProperty("--voice-bars-scale", ".4");
    orbit.style.setProperty("--voice-glow", "0");
  };
  function stopMeter(s) {
    if (s.meterFrame) cancelAnimationFrame(s.meterFrame);
    s.meterFrame = null;
    try { s.meterSource?.disconnect(); } catch {}
    try { s.meterAnalyser?.disconnect(); } catch {}
    if (s.meterContext) void s.meterContext.close().catch(() => {});
    s.meterContext = null;
    s.meterSource = null;
    s.meterAnalyser = null;
    meterReset();
  }
  function startMeter(s) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      const context = new Context();
      const source = context.createMediaStreamSource(s.stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      s.meterContext = context;
      s.meterSource = source;
      s.meterAnalyser = analyser;
      const buffer = new Uint8Array(analyser.fftSize);
      if (context.state === "suspended") void context.resume().catch(() => {});
      const tick = () => {
        if (session !== s || s.recorder?.state !== "recording") return;
        analyser.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const value of buffer) {
          const sample = (value - 128) / 128;
          sum += sample * sample;
        }
        const level = Math.min(1, Math.sqrt(sum / buffer.length) * 7);
        const orbit = q(".voice-orbit");
        orbit.style.setProperty("--voice-scale", (1 + level * 0.14).toFixed(3));
        orbit.style.setProperty("--voice-bars-scale", (0.35 + level * 1.9).toFixed(3));
        orbit.style.setProperty("--voice-glow", level.toFixed(3));
        s.meterFrame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Keep recording even if audio visualization is not supported by the browser.
      stopMeter(s);
    }
  }
  const message = (text) => {
    q("#voice-status").textContent = text;
  };
  const show = (name, visible) => {
    button(name).hidden = !visible;
  };
  function stopTracks(s) {
    s.stream?.getTracks().forEach((track) => track.stop());
  }
  function clearTimers(s) {
    clearTimeout(s.limit);
    clearInterval(s.clock);
  }
  function cleanup(s) {
    s.controller.abort();
    clearTimers(s);
    stopMeter(s);
    stopTracks(s);
    if (s.recorder?.state !== "inactive") {
      try {
        s.recorder?.stop();
      } catch {}
    }
    s.audio = null;
    s.chunks = [];
  }
  function close({ discard = false, skipQuickClosed = false } = {}) {
    const s = session;
    if (s?.quick && !s.savedId && !discard &&
        (s.original || s.audio || s.bytes > 0 ||
         ["recording", "paused", "ready", "processing"].includes(modal.dataset.voicePhase)) &&
        !window.confirm("Bản ghi chưa được lưu. Xóa bản ghi này?")) return false;
    session = null;
    if (s) cleanup(s);
    q("#voice-original").value = q("#voice-polished").value = "";
    if (modal.open) modal.close();
    modal.remove();
    if (s?.target.isConnected && s.target.id !== "quick-idea-content") {
      s.target.focus();
      s.target.setSelectionRange(s.start, s.end);
      s.target.scrollTop = s.scroll;
    }
    if (s?.quick && s.savedId && !skipQuickClosed) {
      try { onQuickClosed(s.savedId); } catch {}
    }
    return true;
  }

  async function open(target, { quick = false } = {}) {
    cancelInline();
    if (session && !close()) return;
    const s = {
      target,
      before: target.value,
      start: target.selectionStart ?? target.value.length,
      end: target.selectionEnd ?? target.value.length,
      scroll: target.scrollTop,
      controller: new AbortController(),
      chunks: [],
      original: "",
      polished: "",
      quick,
    };
    session = s;
    button("insert").textContent = "Chèn tại con trỏ";
    button("insert").hidden = quick;
    button("replace").hidden = quick;
    q(".voice-quick-actions").hidden = true;
    s.savedId = null;
    q(".voice-versions").hidden = true;
    q("#voice-version").value = "original";
    q("#voice-version option[value=polished]").disabled = true;
    ["start", "discard", "pause", "send", "retry"].forEach((name) => show(name, false));
    setPauseButton(false);
    meterReset();
    q("#voice-elapsed").textContent = "0:00";
    q("#voice-limit").textContent = formatTime(MAX_RECORDING_MS / 1000);
    setPhase("preparing");
    message("Đang mở micro…");
    root.append(modal);
    modal.showModal();

    if (
      !isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder
    ) {
      message("Trình duyệt chưa hỗ trợ ghi âm. Hãy mở bằng HTTPS trên Chrome hoặc Safari mới.");
      return;
    }
    if (!navigator.onLine) {
      message("Cần có mạng trước khi bắt đầu ghi âm AI.");
      return;
    }

    // Request microphone in the original click gesture (important for Safari/iPhone).
    // Recording itself begins only after the signed-in session is authorized.
    let streamPromise;
    try {
      streamPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      message(error.message || "Không mở được micro. Vui lòng thử lại.");
      show("start", true);
      return;
    }
    // Revoke a late permission grant if the dialog is closed or authorization fails.
    streamPromise.then(
      (stream) => {
        if (session !== s || s.authorizationFailed || s.controller.signal.aborted)
          stream.getTracks().forEach((track) => track.stop());
      },
      () => {},
    );
    try {
      await authorize();
      if (session !== s) return;
      await start(s, streamPromise);
    } catch (error) {
      s.authorizationFailed = true;
      streamPromise.then(
        (stream) => stream.getTracks().forEach((track) => track.stop()),
        () => {},
      );
      if (session === s) message(error.message || "Chưa xác thực được tài khoản.");
    }
  }
  async function process(s) {
    if (session !== s) return;
    setPhase("processing");
    ["start", "discard", "pause", "send", "retry"].forEach((n) => show(n, false));
    try {
      if (!s.original) {
        message("Đang chuyển lời nói thành văn bản…");
        s.original = await request("transcribe", s.audio, s.controller.signal);
        if (session !== s) return;
        q("#voice-original").value = s.original;
        // Skip transcript selection during normal processing.
        q(".voice-versions").hidden = true;
        s.audio = null;
      }
      if (s.quick && !s.savedId) {
        message("Đang lưu bản chép vào Kho ý tưởng…");
        // Commit the original transcript BEFORE polishing. It must survive edit/API errors.
        s.savedId = await onQuickTranscript(s.original);
        if (session !== s) return;
        if (!s.savedId) throw new Error("Chưa lưu được ý tưởng. Hãy thử lại.");
      }
      if (!s.polished) {
        message(s.quick ? "Đã lưu bản chép gốc. Đang trau chuốt nội dung…" : "Đang trau chuốt câu chữ…");
        s.polished = await request("polish", s.original, s.controller.signal);
        if (session !== s) return;
      }
      if (s.quick && !s.polishStored) {
        message("Đang lưu nội dung đã trau chuốt…");
        await onQuickPolished(s.savedId, s.original, s.polished);
        if (session !== s) return;
        s.polishStored = true;
      }
      if (s.quick) {
        // The original was already saved as a safety checkpoint. The polished
        // version is now stored; return to the ideas inbox without another tap.
        close();
        return;
      }
      if (s.target.isConnected && s.target.value === s.before) {
        // Contextual recording inserts the polished copy directly, preserving
        // any existing text. The editor's input listener persists the change.
        const result = insertVoiceText(s.target.value, s.polished, s.start);
        s.target.value = result.value;
        s.start = s.end = result.cursor;
        s.target.dispatchEvent(new Event("input", { bubbles: true }));
        try { onInserted({ target: s.target, value: result.value }); } catch {}
        close();
        return;
      }
      // Only show the recovery view when another edit or UI change prevents safe insertion.
      q("#voice-polished").value = s.polished;
      q("#voice-version option[value=polished]").disabled = false;
      q("#voice-version").value = "polished";
      q(".voice-versions").hidden = false;
      setPhase("review");
      message("Nội dung đã thay đổi trong lúc ghi. Chọn bản chép để tránh ghi đè dữ liệu.");
    } catch (error) {
      if (session !== s) return;
      setPhase("error");
      if (s.quick && s.savedId) {
        // The draft survives polishing errors, and retry reuses its original transcript.
        message("Bản chép gốc đã lưu an toàn. Chưa trau chuốt được: " + error.message + ". Bấm Thử lại.");
      } else {
        message(`${error.message}${s.original ? " Bản chép vẫn ở đây để thử lưu lại." :
          " Bản ghi âm chưa bị xóa. Hãy bấm Thử lại."}`);
      }
      show("retry", true);
    }
  }

  function finish(s, send = true) {
    if (session !== s) return;
    const state = s.recorder?.state;
    if (state !== "recording" && state !== "paused") {
      if (send && s.audio && modal.dataset.voicePhase === "ready") void process(s);
      return;
    }
    s.elapsedMs = elapsedMs(s);
    q("#voice-elapsed").textContent = formatTime(Math.floor(s.elapsedMs / 1000));
    clearTimers(s);
    stopMeter(s);
    s.sendRequested = send;
    try { s.recorder.stop(); } catch (error) {
      setPhase("error");
      message("Chưa hoàn tất đoạn ghi: " + (error.message || "Lỗi micro."));
      return;
    }
    stopTracks(s);
    ["discard", "pause", "send"].forEach((n) => show(n, false));
    setPhase("processing");
    message(send ? "Đang chuẩn bị gửi…" : "Đã ghi đủ thời lượng. Chạm mũi tên để gửi.");
  }
  function pauseOrResume(s) {
    if (session !== s) return;
    if (s.recorder?.state === "recording") {
      if (typeof s.recorder.pause !== "function") {
        message("Thiết bị chưa hỗ trợ tạm dừng. Anh có thể bấm Gửi để lưu.");
        return;
      }
      const stoppedAt = elapsedMs(s);
      try { s.recorder.pause(); } catch (e) {
        message("Không tạm dừng được: " + e.message);
        return;
      }
      s.elapsedMs = stoppedAt;
      clearTimers(s);
      stopMeter(s);
      updateClock(s);
      setPhase("paused");
      setPauseButton(true);
      message("Đã tạm dừng");
    } else if (s.recorder?.state === "paused") {
      try { s.recorder.resume(); } catch (e) {
        message("Không tiếp tục được: " + e.message);
        return;
      }
      s.resumedAt = Date.now();
      startClock(s);
      startMeter(s);
      setPauseButton(false);
      setPhase("recording");
      message("");
    }
  }

  async function start(s, streamPromise = null) {
    setPhase("preparing");
    show("start", false);
    show("retry", false);
    message("Đang chờ quyền truy cập micro…");
    try {
      if (!navigator.onLine)
        throw new Error("Cần có mạng trước khi bắt đầu ghi âm AI.");
      const stream = await (streamPromise || navigator.mediaDevices.getUserMedia({ audio: true }));
      if (session !== s) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      s.stream = stream;
      const type = recordingType(MediaRecorder);
      // Safari can choose MP4; if no known format is advertised, use its native default.
      s.recorder = new MediaRecorder(stream, {
        ...(type ? { mimeType: type } : {}),
        audioBitsPerSecond: 64000,
      });
      s.bytes = 0;
      s.chunks = [];
      s.oversized = false;
      s.recorder.ondataavailable = (ev) => {
        if (session !== s || !ev.data.size) return;
        s.bytes += ev.data.size;
        if (s.bytes <= MAX_AUDIO_BYTES) s.chunks.push(ev.data);
        else {
          s.oversized = true;
          finish(s, false);
        }
      };
      s.recorder.onerror = () => {
        if (session !== s) return;
        cleanup(s);
        setPhase("error");
        message(
          "Ghi âm bị lỗi. Nội dung đang viết được giữ nguyên. Hãy đóng và ghi lại.",
        );
        ["discard", "pause", "send"].forEach((name) => show(name, false));
      };
      s.recorder.onstop = () => {
        clearTimers(s);
        stopTracks(s);
        if (session !== s || s.controller.signal.aborted) return;
        const mime = s.recorder.mimeType || s.chunks[0]?.type || "";
        const audio = new Blob(s.chunks, { type: mime });
        s.chunks = [];
        if (
          s.oversized ||
          !audio.size ||
          audio.size > MAX_AUDIO_BYTES ||
          !AUDIO_TYPES[audioType(mime)]
        ) {
          message(
            "Đoạn ghi trống, quá lớn hoặc không hỗ trợ định dạng này. Hãy ghi lại đoạn ngắn hơn.",
          );
          setPhase("error");
          show("start", true);
          return;
        }
        s.audio = audio;
        if (s.sendRequested) void process(s);
        else {
          setPhase("ready");
          show("discard", true);
          show("send", true);
          message("Đã ghi đủ thời lượng. Chạm mũi tên để gửi.");
        }
      };
      s.recorder.start(1000);
      s.elapsedMs = 0;
      s.resumedAt = Date.now();
      s.sendRequested = false;
      q("#voice-elapsed").textContent = "0:00";
      setPhase("recording");
      setPauseButton(false);
      message("");
      ["discard", "pause", "send"].forEach((name) => show(name, true));
      startMeter(s);
      startClock(s);
      stream
        .getAudioTracks()
        .forEach((track) =>
          track.addEventListener("ended", () => finish(s, false), { once: true }),
        );
    } catch (error) {
      stopTracks(s);
      if (session !== s) return;
      setPhase("error");
      message(
        ["NotAllowedError", "SecurityError"].includes(error.name)
          ? "Chưa được cấp quyền micro. Cho phép micro trong cài đặt trình duyệt rồi thử lại."
          : error.name === "NotFoundError"
            ? "Không tìm thấy micro. Kiểm tra thiết bị rồi thử lại."
            : error.message || "Không mở được micro. Vui lòng thử lại.",
      );
      show("start", true);
    }
  }
  modal.addEventListener("click", (event) => {
    const action = event.target.closest("[data-voice]")?.dataset.voice;
    const s = session;
    if (!s || !action) return;
    if (action === "cancel") close();
    else if (action === "discard") close({ discard: true });
    else if (action === "start") void start(s);
    else if (action === "pause") pauseOrResume(s);
    else if (action === "send") finish(s, true);
    else if (action === "retry") void process(s);
    else if (action === "openquick" || action === "toscript") {
      if (!s.savedId) return;
      const id = s.savedId, stage = action === "toscript" ? "script" : "ideas";
      close({ skipQuickClosed: true });
      Promise.resolve(onQuickOpen(id, stage)).catch((error) => {
        window.alert("Chưa mở được ý tưởng: " + (error.message || "Vui lòng thử lại."));
      });
    } else if (action === "insert" || action === "replace") {
      const text = q("#voice-version").value === "polished" ? s.polished : s.original;
      if (!text) return;
      if (!s.target.isConnected || s.target.value !== s.before) {
        message("Ô nội dung đã thay đổi. Không ghi đè dữ liệu; hãy sao chép bản chép rồi thử lại.");
        return;
      }
      if (action === "replace" &&
        !window.confirm("Thay thế toàn bộ nội dung của ô này bằng bản đã chọn?")) return;
      const result = action === "replace" ? { value: text, cursor: text.length } :
        insertVoiceText(s.target.value, text, s.start);
      s.target.value = result.value;
      s.start = s.end = result.cursor;
      s.target.dispatchEvent(new Event("input", { bubbles: true }));
      try { onInserted({ target: s.target, value: result.value }); } catch {}
      close();
    }
  });

  modal.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  modal.addEventListener("close", () => {
    if (session && !modal.open) close();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    stopInline();
    if (session && session.recorder?.state === "recording") pauseOrResume(session);
  });
  window.addEventListener("pagehide", () => {
    stopInline();
    close();
  });
  const observer = new MutationObserver(() => {
    // UI changes may temporarily remove the original textarea (e.g. live sync).
    // Retain the recording; insertion already checks target.isConnected before editing.
    attach();
  });
  function attach() {
    // Stop any live recognition session whose editor was removed by navigation
    // or a cloud refresh, so no delayed transcript can be written to stale DOM.
    for (const editor of liveDictations) {
      if (!editor.target.isConnected) {
        editor.abort();
        liveDictations.delete(editor);
      }
    }
    root
      .querySelectorAll("textarea:not([readonly]):not([name=titles])")
      .forEach((target) => {
        if (target.closest("#voice-dialog") || target.dataset.voiceBound)
          return;
        target.dataset.voiceBound = "true";
        const inline = ["new-idea-content", "idea-content"].includes(target.id);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "voice-mic";
        const label =
          target.getAttribute("aria-label") ||
          target.closest("label")?.firstChild?.textContent?.trim() ||
          "nội dung";
        if (target.id === "new-idea-content") {
          b.textContent = "🎙";
          b.classList.add("voice-icon-only");
        } else if (inline) {
          b.textContent = "🎙 Đọc thành chữ";
        } else {
          b.textContent = "🎙 Ghi âm";
        }
        b.setAttribute("aria-label", inline
          ? "Bắt đầu nhập giọng nói cho Nội dung ý tưởng"
          : `Ghi âm cho ${label}`);
        // Preserve the caret before an iPhone tap shifts focus to the button.
        let selection;
        b.addEventListener("pointerdown", () => {
          selection = [target.selectionStart, target.selectionEnd, target.scrollTop];
        });
        const toolbar = target.id === "script"
          ? target.closest(".script-panel")?.querySelector(".script-toolbar")
          : null;
        // Idea dictation belongs beside the writing area rather than at the
        // distant heading: on mobile it becomes a reachable floating control.
        if (target.id === "idea-content") {
          b.classList.add("idea-dictation-float", "voice-icon-only");
          b.textContent = "🎙";
        }
        if (toolbar) toolbar.append(b);
        else if (target.id === "new-idea-content")
          target.closest(".field")?.insertAdjacentElement("afterend", b);
        else target.insertAdjacentElement("afterend", b);
        if (inline) {
          const feedback = document.createElement("small");
          feedback.className = "live-dictation-status";
          feedback.setAttribute("role", "status");
          feedback.setAttribute("aria-live", "polite");
          feedback.textContent = "Chạm micro để đọc thành chữ ngay trong ô.";
          if (toolbar) toolbar.insertAdjacentElement("afterend", feedback);
          else b.insertAdjacentElement("afterend", feedback);
          const dictation = createLiveDictation({
            target,
            button: b,
            status: feedback,
            onPreview: (el) => {
              if (el.id !== "idea-content") return;
              const counter = document.querySelector("#word-count");
              if (counter)
                counter.textContent = (el.value.trim()
                  ? el.value.trim().split(/\s+/).length : 0) + " từ";
            },
          });
          liveDictations.add(dictation);
          b.addEventListener("click", (event) => {
            event.preventDefault();
            if (selection && !dictation.isActive()) {
              target.setSelectionRange(selection[0], selection[1]);
              target.scrollTop = selection[2];
            }
            selection = null;
            // Only one microphone session is allowed at a time.
            for (const editor of liveDictations) {
              if (editor !== dictation && editor.isActive()) editor.abort();
            }
            dictation.toggle();
          });
        } else {
          b.addEventListener("click", (event) => {
            event.preventDefault();
            if (selection) {
              target.setSelectionRange(selection[0], selection[1]);
              target.scrollTop = selection[2];
            }
            selection = null;
            open(target);
          });
        }
      });
  }
  attach();
  observer.observe(root, { childList: true, subtree: true });
  return {
    cancel: () => { cancelInline(); return close(); },
    stopInline,
    open,
    isActive: () => (!!session && modal.open) ||
      [...liveDictations].some((editor) => editor.isActive()),
  };
}
