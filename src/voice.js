import { authorizeVoice, voiceRequest } from "./voice-client.js";
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
} = {}) {
  const modal = document.createElement("dialog");
  modal.id = "voice-dialog";
  modal.setAttribute("aria-labelledby", "voice-title");
  modal.innerHTML = "<div class=\"dialog-heading voice-heading\">\n  <h2 id=\"voice-title\">Ghi âm</h2>\n  <button type=\"button\" class=\"icon-button\" data-voice=\"cancel\" aria-label=\"Đóng ghi âm\" title=\"Đóng\">×</button>\n</div>\n<div class=\"voice-recording-screen\">\n  <div class=\"voice-orbit\" aria-hidden=\"true\">\n    <span class=\"voice-ring voice-ring-outer\"></span>\n    <span class=\"voice-ring voice-ring-inner\"></span>\n    <div class=\"voice-bars voice-bars-left\"><i></i><i></i><i></i><i></i></div>\n    <div class=\"voice-mic-core\">\n      <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n        <rect x=\"9\" y=\"2.5\" width=\"6\" height=\"12\" rx=\"3\"></rect>\n        <path d=\"M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7\"></path>\n      </svg>\n    </div>\n    <div class=\"voice-bars voice-bars-right\"><i></i><i></i><i></i><i></i></div>\n  </div>\n  <div id=\"voice-clock\" class=\"voice-timer\" aria-label=\"Thời gian ghi âm\" hidden><span id=\"voice-elapsed\">0:00</span><span class=\"voice-timer-divider\"> / </span><span id=\"voice-limit\">2:00</span></div>\n  <div class=\"voice-controls voice-primary-controls\">\n    <button type=\"button\" class=\"voice-restart\" data-voice=\"start\" hidden>Ghi lại</button>\n    <button type=\"button\" class=\"voice-stop\" data-voice=\"stop\" title=\"Dừng và nhận dạng\" aria-label=\"Dừng & nhận dạng\" hidden>\n      <svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"6\" y=\"6\" width=\"12\" height=\"12\" rx=\"2\" fill=\"currentColor\"></rect></svg>\n    </button>\n    <button type=\"button\" data-voice=\"retry\" hidden>Thử lại</button>\n  </div>\n</div>\n<p role=\"status\" id=\"voice-status\" aria-live=\"polite\"></p>\n<details class=\"voice-disclosure\"><summary>Thông tin xử lý</summary><p>Đoạn ghi âm và bản chép được gửi đến OpenAI để xử lý. Ứng dụng không lưu âm thanh trên máy chủ.</p></details>\n<div class=\"voice-versions\" hidden>\n  <label class=\"field\">Bản chép gốc<textarea id=\"voice-original\" rows=\"6\" readonly></textarea></label>\n  <label class=\"field\">Bản đã trau chuốt<textarea id=\"voice-polished\" rows=\"6\" readonly></textarea></label>\n  <label class=\"field\">Chọn bản để dùng<select id=\"voice-version\"><option value=\"original\">Bản chép gốc</option><option value=\"polished\" disabled>Bản đã trau chuốt</option></select></label>\n  <p class=\"muted\">Đọc lại tên riêng, số liệu và trích dẫn trước khi dùng. Chèn giữ nguyên nội dung hiện có; thay thế cần xác nhận.</p>\n  <div class=\"voice-controls\"><button type=\"button\" class=\"primary\" data-voice=\"insert\">Chèn tại con trỏ</button><button type=\"button\" data-voice=\"replace\">Thay thế toàn bộ ô</button></div>\n</div>";
  const q = (selector) => modal.querySelector(selector);
  const button = (name) => q(`[data-voice=${name}]`);
  let session = null;
  const formatTime = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const setPhase = (phase) => {
    modal.dataset.voicePhase = phase;
    q("#voice-clock").hidden = phase !== "recording";
    q(".voice-orbit").hidden = phase === "processing" || phase === "review";
  };
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
  function close() {
    const s = session;
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
  }
  async function open(target, { quick = false } = {}) {
    if (session) close();
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
    button("insert").textContent = quick ? "Lưu ý tưởng" : "Chèn tại con trỏ";
    button("replace").hidden = quick;
    q(".voice-versions").hidden = true;
    q("#voice-version").value = "original";
    q("#voice-version option[value=polished]").disabled = true;
    ["start", "stop", "retry"].forEach((name) => show(name, false));
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
    show("retry", false);
    show("start", false);
    show("stop", false);
    try {
      if (!s.original) {
        message("Đang nhận dạng tiếng Việt…");
        s.original = await request("transcribe", s.audio, s.controller.signal);
        if (session !== s) return;
        s.audio = null;
        q("#voice-original").value = s.original;
        q(".voice-versions").hidden = false;
      }
      message("Đã có bản chép gốc. Đang trau chuốt câu chữ…");
      s.polished = await request("polish", s.original, s.controller.signal);
      if (session !== s) return;
      q("#voice-polished").value = s.polished;
      q("#voice-version option[value=polished]").disabled = false;
      q("#voice-version").value = "polished";
      setPhase("review");
      message("Chọn bản chép để chèn. Nội dung hiện tại chưa thay đổi.");
    } catch (error) {
      if (session !== s) return;
      setPhase("error");
      message(
        `${error.message}${s.original ? " Bạn vẫn có thể chèn bản chép gốc." : " Không đóng cửa sổ nếu muốn giữ đoạn ghi để thử lại."}`,
      );
      show("retry", true);
    }
  }
  function finish(s) {
    if (session !== s || s.recorder?.state !== "recording") return;
    clearTimers(s);
    stopMeter(s);
    s.recorder.stop();
    stopTracks(s);
    show("stop", false);
    setPhase("processing");
    message("Đang hoàn tất đoạn ghi…");
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
          finish(s);
        }
      };
      s.recorder.onerror = () => {
        if (session !== s) return;
        cleanup(s);
        setPhase("error");
        message(
          "Ghi âm bị lỗi. Nội dung đang viết được giữ nguyên. Hãy đóng và ghi lại.",
        );
        show("stop", false);
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
        process(s);
      };
      s.recorder.start(1000);
      s.started = Date.now();
      q("#voice-elapsed").textContent = "0:00";
      setPhase("recording");
      message("");
      show("stop", true);
      startMeter(s);
      s.clock = setInterval(() => {
        const seconds = Math.floor((Date.now() - s.started) / 1000);
        if (seconds >= MAX_RECORDING_MS / 1000) {
          finish(s);
          return;
        }
        q("#voice-elapsed").textContent = formatTime(seconds);
      }, 500);
      s.limit = setTimeout(() => finish(s), MAX_RECORDING_MS);
      stream
        .getAudioTracks()
        .forEach((track) =>
          track.addEventListener("ended", () => finish(s), { once: true }),
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
    else if (action === "start") start(s);
    else if (action === "stop") finish(s);
    else if (action === "retry") process(s);
    else if (action === "insert" || action === "replace") {
      const text =
        q("#voice-version").value === "polished" ? s.polished : s.original;
      if (!text) return;
      if (!s.target.isConnected || s.target.value !== s.before) {
        message(
          "Ô nội dung đã thay đổi. Hãy sao chép bản chép cần dùng và đóng cửa sổ; không có nội dung nào bị ghi đè.",
        );
        return;
      }
      if (
        action === "replace" &&
        !window.confirm("Thay thế toàn bộ nội dung của ô này bằng bản đã chọn?")
      )
        return;
      const result =
        action === "replace"
          ? { value: text, cursor: text.length }
          : insertVoiceText(s.target.value, text, s.start);
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
    if (document.hidden && session) finish(session);
  });
  window.addEventListener("pagehide", close);
  const observer = new MutationObserver(() => {
    if (session && !session.target.isConnected) close();
    attach();
  });
  function attach() {
    root
      .querySelectorAll("textarea:not([readonly]):not([name=titles])")
      .forEach((target) => {
        if (target.closest("#voice-dialog") || target.dataset.voiceBound)
          return;
        target.dataset.voiceBound = "true";
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
          b.title = "Ghi âm nội dung ý tưởng";
        } else {
          b.textContent = "🎙 Ghi âm";
        }
        b.setAttribute("aria-label", `Ghi âm cho ${label}`);
        // Keep the selection before the button takes focus, including Safari touch interaction.
        let selection;
        b.addEventListener("pointerdown", () => {
          selection = [
            target.selectionStart,
            target.selectionEnd,
            target.scrollTop,
          ];
        });
        b.addEventListener("click", (event) => {
          event.preventDefault();
          if (selection) {
            target.setSelectionRange(selection[0], selection[1]);
            target.scrollTop = selection[2];
          }
          selection = null;
          open(target);
        });
        const toolbar =
          ["script", "idea-content"].includes(target.id)
            ? target.parentElement.querySelector(".script-toolbar")
            : null;
        if (toolbar) toolbar.append(b);
        else target.insertAdjacentElement("afterend", b);
      });
  }
  attach();
  observer.observe(root, { childList: true, subtree: true });
  return { cancel: close, open };
}
