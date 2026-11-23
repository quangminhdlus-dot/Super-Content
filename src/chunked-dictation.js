/**
 * iOS Home Screen/Safari safe dictation. WebKit's SpeechRecognition can remain
 * "listening" forever without onresult/onerror/onend, so do NOT call it here.
 *
 * Record short, COMPLETE MediaRecorder files and transcribe them one-by-one
 * through the existing authenticated /api/voice/transcribe endpoint. This is
 * near-real-time (a few seconds per clip), not instant per-syllable dictation.
 * Nothing overlays or disables the editor; Stop is always immediate.
 */
import { recordingType, audioType, AUDIO_TYPES, MAX_AUDIO_BYTES } from "../shared/voice.js";
import { authorizeVoice, voiceRequest } from "./voice-client.js";

export function isAppleMobile() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function createChunkedDictation({
  target, button, status, onPreview = () => {},
  authorize = authorizeVoice,
  transcribe = (audio, signal) => voiceRequest("transcribe", audio, signal),
  mediaDevices = navigator.mediaDevices,
  Recorder = window.MediaRecorder,
  clipMs = 5300,
  startupMs = 16000,
  transcribeMs = 22000,
  stopMs = 2300,
} = {}) {
  let current = null;
  const say = (message) => {
    if (status?.isConnected) status.textContent = message;
  };
  const draw = (active) => {
    if (!button?.isConnected) return;
    button.classList.toggle("dictation-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label",
      (active ? "Dừng" : "Bắt đầu") + " nhập giọng nói cho Nội dung ý tưởng");
    button.title = active ? "Dừng đọc thành chữ" : "Đọc thành chữ";
    button.textContent = active ? "■ Dừng" : "🎙";
  };
  const stopTracks = (s) => {
    if (!s.stream) return;
    try { s.stream.getTracks().forEach((track) => track.stop()); } catch {}
    s.stream = null;
  };
  const finish = (s, message) => {
    if (s.completed) return;
    s.completed = true;
    s.stopping = true;
    clearTimeout(s.startupTimer);
    clearTimeout(s.clipTimer);
    clearTimeout(s.endTimer);
    stopTracks(s);
    if (current === s) {
      current = null;
      draw(false);
      if (message) say(message);
    }
    s.resolveDone();
  };
  const fail = (s, message) => {
    s.controller.abort();
    try {
      if (s.recorder?.state === "recording") s.recorder.stop();
    } catch {}
    finish(s, message);
  };
  function insert(s, transcript) {
    if (s.completed || !target?.isConnected) return;
    const words = String(transcript || "").trim();
    if (!words) return;
    const value = target.value;
    const point = Math.max(0, Math.min(s.cursor, value.length));
    const before = value.slice(0, point), after = value.slice(point);
    const inserted = (before && !/\s$/u.test(before) ? " " : "") + words +
      (after && !/^[\s,.!?;:]/u.test(after) ? " " : "");
    s.applying = true;
    try {
      target.value = before + inserted + after;
      s.cursor = point + inserted.length;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      onPreview(target);
    } finally {
      s.applying = false;
    }
  }
  function maybeFinish(s) {
    if (s.completed) return;
    if (s.stopping && !s.recorder && s.pending === 0) {
      finish(s, s.error || "Đã chuyển lời nói thành chữ. Có thể đọc tiếp.");
    }
  }
  function queueTranscription(s, blob) {
    if (s.completed) return;
    if (!blob.size || blob.size > MAX_AUDIO_BYTES ||
        !AUDIO_TYPES[audioType(blob.type)]) {
      fail(s, "Không đọc được định dạng âm thanh. Anh có thể dùng micro trên bàn phím.");
      return;
    }
    s.pending++;
    s.queue = s.queue.then(async () => {
      if (s.completed) return;
      const timeout = setTimeout(() => {
        if (!s.completed) fail(s, "Nhận dạng quá thời gian. Anh có thể bấm micro để thử lại.");
      }, transcribeMs);
      try {
        const transcript = await transcribe(blob, s.controller.signal);
        if (!s.completed) insert(s, transcript);
      } catch (error) {
        if (!s.completed) {
          s.error = error.message || "Không thể nhận dạng đoạn âm thanh.";
          fail(s, "Đã dừng an toàn: " + s.error + " Chữ đã lưu không bị xóa.");
        }
      } finally {
        clearTimeout(timeout);
      }
    }).catch((error) => {
      if (!s.completed) fail(s, "Đã dừng an toàn vì lỗi lưu chữ: " +
        (error?.message || "không rõ lỗi") + ".");
    }).finally(() => {
      s.pending--;
      if (!s.completed && !s.stopping && !s.recorder && s.pending < 2)
        startClip(s);
      maybeFinish(s);
    });
  }
  function stopClip(s) {
    if (s.completed || !s.recorder) return;
    clearTimeout(s.clipTimer);
    const recorder = s.recorder;
    try {
      if (recorder.state === "recording") recorder.stop();
    } catch (error) {
      fail(s, "Không thể dừng micro. Nội dung đã nhập vẫn được giữ.");
      return;
    }
    // Safari can omit onstop. Release the UI instead of waiting forever.
    clearTimeout(s.endTimer);
    s.endTimer = setTimeout(() => {
      if (s.recorder === recorder && !s.completed)
        fail(s, "Trình duyệt không hoàn tất đoạn ghi. Micro đã được giải phóng.");
    }, stopMs);
  }
  function startClip(s) {
    if (s.completed || s.stopping || s.recorder || !s.stream) return;
    let recorder;
    try {
      const format = typeof Recorder.isTypeSupported === "function"
        ? recordingType(Recorder) : null;
      recorder = new Recorder(s.stream, {
        ...(format ? { mimeType: format } : {}),
        audioBitsPerSecond: 64000,
      });
    } catch {
      fail(s, "Không thể khởi tạo micro. Hãy thử micro bàn phím iPhone.");
      return;
    }
    s.recorder = recorder;
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (!s.completed && event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = () => fail(s, "Micro gặp lỗi. Nội dung đã viết vẫn được giữ.");
    recorder.onstop = () => {
      clearTimeout(s.endTimer);
      if (s.recorder !== recorder || s.completed) return;
      s.recorder = null;
      const mime = recorder.mimeType || chunks[0]?.type || "";
      const blob = new Blob(chunks, { type: mime });
      if (blob.size) queueTranscription(s, blob);
      if (!s.stopping && !s.completed && s.pending < 2) startClip(s);
      maybeFinish(s);
    };
    try {
      recorder.start();
      s.clipTimer = setTimeout(() => stopClip(s), clipMs);
      say(s.pending ? "Đang nghe; đoạn trước đang chuyển thành chữ…" :
        "Đang nghe… chữ sẽ hiện sau từng đoạn ngắn, anh vẫn có thể bấm Dừng.");
    } catch {
      fail(s, "Không thể bắt đầu thu giọng nói. Anh có thể dùng micro bàn phím.");
    }
  }
  function stop() {
    const s = current;
    if (!s) return Promise.resolve();
    if (s.stopping) return s.done;
    s.stopping = true;
    clearTimeout(s.startupTimer);
    draw(false); // NEVER wait for native browser APIs before restoring Stop.
    say("Đã dừng micro. Đang chép nốt đoạn cuối; anh vẫn có thể tiếp tục soạn…");
    if (s.recorder) stopClip(s);
    else if (s.pending > 0) maybeFinish(s);
    else finish(s, "Đã dừng. Chạm micro để đọc tiếp.");
    return s.done;
  }
  function abort() {
    const s = current;
    if (!s) return;
    s.controller.abort();
    try { if (s.recorder?.state === "recording") s.recorder.stop(); } catch {}
    finish(s, "Đã hủy nhận giọng nói. Nội dung đã lưu không thay đổi.");
  }
  async function start() {
    if (current) {
      // A second tap after Stop cancels an indefinitely slow upload. This
      // keeps the micro usable even when the provider hangs.
      abort();
    }
    if (!window.isSecureContext || !mediaDevices?.getUserMedia || !Recorder) {
      say("Trình duyệt chưa hỗ trợ micro. Anh có thể dùng micro trên bàn phím iPhone.");
      return;
    }
    if (!navigator.onLine) {
      say("Đang mất mạng. Vẫn có thể viết hoặc dùng micro trên bàn phím.");
      return;
    }
    const s = {
      stream: null, recorder: null, controller: new AbortController(),
      completed: false, stopping: false, applying: false,
      pending: 0, queue: Promise.resolve(), error: "",
      cursor: target.selectionStart ?? target.value.length,
    };
    s.done = new Promise((resolve) => { s.resolveDone = resolve; });
    current = s;
    draw(true);
    say("Đang xin quyền micro… Có thể bấm Dừng bất cứ lúc nào.");
    // getUserMedia MUST start within the user's gesture in Safari.
    let permission;
    try {
      permission = mediaDevices.getUserMedia({ audio: true });
    } catch {
      fail(s, "Không mở được micro. Hãy kiểm tra quyền trong Cài đặt iPhone.");
      return;
    }
    Promise.resolve(permission).then((stream) => {
      if (s.completed || s.stopping) {
        stream.getTracks().forEach((track) => track.stop());
      }
    }, () => {});
    s.startupTimer = setTimeout(() => {
      if (!s.completed)
        fail(s, "Micro không phản hồi. Đã thoát an toàn; anh vẫn có thể gõ chữ.");
    }, startupMs);
    try {
      const [stream] = await Promise.all([permission, authorize()]);
      if (s.completed || s.stopping) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      clearTimeout(s.startupTimer);
      s.stream = stream;
      for (const track of stream.getTracks()) {
        track.addEventListener?.("ended", () => {
          if (!s.completed) stop();
        }, { once: true });
      }
      startClip(s);
    } catch (error) {
      if (s.completed) return;
      fail(s, "Không bắt đầu được micro: " +
        (["NotAllowedError", "SecurityError"].includes(error.name)
          ? "hãy cấp quyền cho Safari trong Cài đặt."
          : (error.message || "hãy thử lại.")));
    }
  }
  const onKeyboardInput = () => {
    const s = current;
    if (!s || s.applying || s.completed) return;
    s.cursor = target.selectionStart ?? target.value.length;
    // Keep accepted speech chunks; don't let a later upload overwrite typing.
    void stop();
    say("Đã dừng micro để anh gõ. Đoạn đang chép sẽ được thêm sau.");
  };
  target.addEventListener("input", onKeyboardInput);
  draw(false);
  return {
    target,
    toggle: () => current && !current.stopping ? stop() : start(),
    stop,
    abort,
    isActive: () => !!current,
  };
}
