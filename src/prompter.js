import {createStudioView} from "./prompter-view.js";
import {createStudioReader} from "./prompter-reader.js";
import "./prompter.css";
const runtimeUrl = new URL("prompter/runtime.js", document.baseURI);
const defaults = { font: 38, anchor: 0, mode: "voice", wpm: 125, countdown: 3, framing: "portrait", wake: true, mic: "" };
const preferenceKey = "super-content:prompter";
const clamp = (value, min, max) => Math.min(max, Math.max(value, min));
const readyPhases = new Set(["listening", "recognizing", "processing", "recognized"]);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function preferences() {
  try {
    const p = { ...defaults, ...JSON.parse(localStorage.getItem(preferenceKey) || "{}") };
    return {
      font: Number.isFinite(p.font) ? clamp(p.font, 24, 100) : defaults.font,
      anchor: Number.isFinite(p.anchor) ? clamp(p.anchor, 0, 1) : 0,
      mode: ["voice", "fixed", "manual"].includes(p.mode) ? p.mode : "voice",
      wpm: Number.isFinite(p.wpm) ? clamp(p.wpm, 40, 260) : defaults.wpm,
      countdown: Number.isFinite(p.countdown) ? clamp(Math.round(p.countdown), 1, 10) : 3,
      framing: p.framing === "landscape" ? "landscape" : "portrait",
      wake: p.wake === true,
      mic: typeof p.mic === "string" ? p.mic : "",
    };
  } catch {
    return { ...defaults };
  }
}

function mediaError(error) {
  switch (error?.name) {
    case "NotAllowedError": return "Cho phép Camera và Micro trong cài đặt website, rồi nhấn Thử lại.";
    case "NotFoundError": return "Kiểm tra camera và micro đã kết nối, rồi nhấn Thử lại.";
    case "NotReadableError": return "Đóng ứng dụng khác đang dùng camera hoặc micro, rồi nhấn Thử lại.";
    case "OverconstrainedError": return "Thiết bị đã chọn không còn khả dụng. Chọn Micro hệ thống trong Cài đặt.";
    default: return error?.message || "Chưa mở được camera hoặc micro.";
  }
}

export function openPrompter(source, callbacks, initialContext) {
  const readOnly = source.mode === "read";
  const prefs = preferences();
  const {overlay, el, backdrop, modeButtons} = createStudioView(readOnly);
  const signals = new AbortController();
  const listen = (node, event, handler) => node.addEventListener(event, handler, { signal: signals.signal });
  let core, voice, capture, capturePending, captureEvents, session, wakeLock;
  let phase = "idle", voicePhase = "paused", captureError = "", message = "", facing = "user";
  let destroyed = false, reading = true, semanticReady = false;
  let lastTick = performance.now(), startTime = 0, deadline = 0, startTimeout = 0, frame = 0;
  let request = 0, stopping, meter, meterData, meterSource, meterTime = 0;
  let review, reviewing = 0, reviewBusy = false, confirmation = false, draftCount = 0;

  const reader = createStudioReader({overlay, el, prefs, source, listen, active, seek:position => voice?.seek(position), savePreferences});

  function savePreferences() {
    try { localStorage.setItem(preferenceKey, JSON.stringify(prefs)); } catch {}
  }

  overlay.dataset.title = source.title;
  el.script.setAttribute("aria-label", source.title || "Kịch bản");
  el.script.textContent = source.text;
  el.flip.hidden = el.cameraState.hidden = el.previewBtn.hidden = readOnly;
  el.framingRow.hidden = el.countdownRow.hidden = el.draftsBtn.hidden = readOnly;
  el.wake.disabled = !navigator.wakeLock;
  el.font.value = prefs.font;
  el.speed.value = prefs.wpm;
  el.countdown.value = prefs.countdown;
  el.framing.value = prefs.framing;
  el.wake.checked = prefs.wake;

  function active() {
    return readOnly ? reading : phase === "recording";
  }

  function usePhase(next) {
    phase = next;
    syncControls();
  }

  function syncControls() {
    if (destroyed) return;
    const camera = capture?.stream.getVideoTracks()[0];
    const mic = capture?.stream.getAudioTracks()[0];
    el.cameraState.classList.toggle("available", !!camera && camera.readyState === "live" && !camera.muted);
    el.micState.classList.toggle("available", !!mic && mic.readyState === "live" && !mic.muted);
    const recording = phase === "recording" && session?.recording;
    el.recordTime.hidden = !recording;
    if (recording) updateRecordingTime(performance.now());
    const waiting = phase === "waiting" || phase === "countdown";
    const working = phase === "starting" || phase === "stopping";
    el.record.dataset.state = readOnly ? (reading ? "pause" : "play") : recording ? "stop" : waiting ? "cancel" : "ready";
    el.record.setAttribute("aria-label", readOnly ? (reading ? "Tạm dừng nhắc chữ" : "Bắt đầu nhắc chữ") :
      recording ? "Dừng quay" : waiting ? "Hủy bắt đầu quay" : "Bắt đầu quay");
    el.record.disabled = !core || working;
    el.back.disabled = !!session || working;
    el.flip.disabled = !core || !!capturePending || phase !== "idle";
    el.flip.setAttribute("aria-pressed", String(facing === "environment"));
    el.flip.title = facing === "user" ? "Camera trước" : "Camera sau";
    el.framing.disabled = el.mic.disabled = !!capturePending || phase !== "idle";
    el.previewBtn.disabled = !camera || camera.readyState !== "live";
    el.count.hidden = phase !== "countdown";
    el.retry.hidden = !captureError && voicePhase !== "error";
    let status = message || captureError;
    if (!status && !core) status = "Đang mở Prompter…";
    if (!status && capturePending) status = readOnly ? "Đang mở micro…" : "Đang mở camera và micro…";
    if (!status && prefs.mode === "voice" && !readyPhases.has(voicePhase) && voicePhase !== "paused") {
      status = voicePhase === "error" ? "Nhắc chữ giọng nói chưa sẵn sàng." : "Đang chuẩn bị giọng nói…";
    }
    if (!status && phase === "waiting" && !mediaReady()) status = "Đang chờ camera và micro…";
    if (!status && phase === "starting") status = "Đang bắt đầu quay…";
    if (!status && phase === "stopping") status = "Đang hoàn tất video…";
    if (el.status.textContent !== status) el.status.textContent = status;
    el.stage.dataset.semantic = String(semanticReady);
    el.fontValue.textContent = prefs.font + " px";
    el.speedValue.textContent = prefs.wpm;
    el.speedRow.hidden = prefs.mode !== "fixed";
    for (const button of modeButtons) button.setAttribute("aria-pressed", String(button.dataset.mode === prefs.mode));
  }

  function updateRecordingTime(now) {
    const text = "ĐANG QUAY " + clock((now - startTime) / 1000);
    if (text !== el.recordTime.textContent) el.recordTime.textContent = text;
  }

  function tick(now) {
    if (destroyed) return;
    reader.move(now, Math.min(now - lastTick, 40));
    lastTick = now;
    if (phase === "countdown") {
      const seconds = Math.ceil((deadline - now) / 1000);
      if (seconds <= 0) void startRecording();
      else if (el.count.textContent !== String(seconds)) el.count.textContent = seconds;
    }
    if (phase === "recording" && session.recording) updateRecordingTime(now);
    if (meter && now - meterTime > 80) {
      meterTime = now;
      meter.getFloatTimeDomainData(meterData);
      const power = Math.sqrt(meterData.reduce((sum, value) => sum + value * value, 0) / meterData.length);
      el.signal.value = Math.min(1, power * 11);
    }
    frame = requestAnimationFrame(tick);
  }

  function changeMode(mode) {
    if (prefs.mode === mode) return;
    prefs.mode = mode;
    savePreferences();
    reader.resetMotion();
    reader.seekCurrent();
    if (readOnly && mode !== "voice") releaseCapture();
    else if (mode === "voice" && !capture && (reading || !readOnly)) void prepare();
    syncVoice();
    if (phase === "countdown" && mode === "voice" && !readyPhases.has(voicePhase)) usePhase("waiting");
    maybeCountdown();
    syncControls();
  }

  function syncVoice() {
    if (!voice) return;
    if (prefs.mode === "voice" && capture && (!readOnly || reading)) voice.start(capture);
    else voice.stop();
  }

  function releaseCapture() {
    captureEvents?.abort();
    captureEvents = undefined;
    voice?.stop();
    meterSource?.disconnect();
    meter?.disconnect();
    meterSource = meter = undefined;
    el.signal.value = 0;
    el.camera.pause();
    el.camera.srcObject = null;
    if (capture) core.closeCapture(capture);
    capture = undefined;
  }

  function showPreview(visible) {
    el.preview.hidden = !visible;
    if (visible) el.previewArea.prepend(el.camera);
    else el.stage.append(el.camera);
    el.camera.classList.toggle("show", visible);
    if (capture?.stream.getVideoTracks().length) void el.camera.play().catch(() => {});
  }

  function prepare() {
    if (!core || destroyed || (readOnly && (prefs.mode !== "voice" || !reading))) return Promise.resolve();
    if (capturePending) return capturePending;
    releaseCapture();
    captureError = "";
    const chosen = {facing, framing: prefs.framing, mic:prefs.mic};
    capturePending = Promise.resolve().then(async () => {
      let input;
      const unlockedContext = initialContext;
      initialContext = undefined;
      if (readOnly) {
        const context = unlockedContext ?? new AudioContext({latencyHint:"interactive"});
        void context.resume().catch(() => {});
        try {
          const stream = await navigator.mediaDevices.getUserMedia({audio:chosen.mic ? {deviceId:{exact:chosen.mic}} : true});
          input = {stream, context};
        } catch (error) {
          void context.close().catch(() => {});
          throw error;
        }
      } else {
        try {
          input = await core.openCapture(chosen.framing, chosen.mic, chosen.facing, unlockedContext);
        } catch (error) {
          if (unlockedContext?.state !== "closed") void unlockedContext?.close().catch(() => {});
          throw error;
        }
      }
      if (destroyed || (readOnly && (prefs.mode !== "voice" || !reading))) {
        core.closeCapture(input);
        return;
      }
      capture = input;
      const update = () => {
        if (capture !== input || destroyed) return;
        if (input.stream.getTracks().some(track => track.readyState === "ended")) captureError = "Camera hoặc micro đã ngắt. Nhấn Thử lại.";
        maybeCountdown();
        syncControls();
      };
      captureEvents = new AbortController();
      for (const track of input.stream.getTracks()) {
        for (const type of ["mute", "unmute", "ended"]) track.addEventListener(type, update, {signal:captureEvents.signal});
      }
      if (!readOnly) {
        el.camera.srcObject = input.stream;
        void el.camera.play().catch(() => {});
      }
      const audio = input.context;
      meter = audio.createAnalyser();
      meter.fftSize = 512;
      meterData = new Float32Array(meter.fftSize);
      meterSource = audio.createMediaStreamSource(input.stream);
      meterSource.connect(meter);
      syncVoice();
    }).catch(error => {
      if (destroyed) return;
      releaseCapture();
      captureError = mediaError(error);
      if (phase === "waiting") usePhase("idle");
    }).finally(() => {
      capturePending = undefined;
      maybeCountdown();
      syncControls();
    });
    syncControls();
    return capturePending;
  }

  function mediaReady() {
    const tracks = capture?.stream.getTracks();
    return tracks?.length >= 2 && tracks.every(track => track.readyState === "live" && !track.muted);
  }

  function maybeCountdown() {
    if (destroyed || phase !== "waiting" || !mediaReady() || capturePending) return;
    if (prefs.mode === "voice" && !readyPhases.has(voicePhase)) return;
    el.count.textContent = prefs.countdown;
    deadline = performance.now() + prefs.countdown * 1000;
    usePhase("countdown");
  }

  function requestRecording() {
    message = "";
    if (!navigator.storage?.getDirectory || !globalThis.MediaRecorder || !core.recordingMime()) {
      message = "Trình duyệt chưa hỗ trợ lưu video trên thiết bị.";
      syncControls();
      return;
    }
    usePhase("waiting");
    if (!capture || capture.stream.getTracks().some(track => track.readyState !== "live")) void prepare();
    else {
      void capture.context.resume().catch(() => {});
      maybeCountdown();
    }
  }

  async function startRecording() {
    if (phase !== "countdown") return;
    if (!mediaReady()) {
      captureError = "Camera hoặc micro chưa sẵn sàng. Nhấn Thử lại.";
      usePhase("idle");
      return;
    }
    usePhase("starting");
    const currentCapture = capture, token = ++request;
    try {
      const recording = await core.VideoSession.create(currentCapture.stream, () => {}, reason => { void stopRecording(reason); },
        {owner:source.owner, contentId:source.id});
      if (destroyed || token !== request || capture !== currentCapture) return;
      session = recording;
      startTimeout = window.setTimeout(() => {
        if (phase === "starting") void stopRecording("Chưa khởi động được bộ ghi. Hãy thử lại.");
      }, 7000);
      recording.start(() => {
        clearTimeout(startTimeout);
        if (destroyed || phase !== "starting" || !recording.recording) return;
        startTime = performance.now();
        reader.resetMotion();
        usePhase("recording");
        void navigator.storage.persist?.().catch(() => {});
      });
    } catch (error) {
      if (destroyed || token !== request) return;
      clearTimeout(startTimeout);
      const failed = session;
      session = undefined;
      if (failed) void failed.stop().catch(() => {});
      message = error.message || "Chưa bắt đầu được video.";
      usePhase("idle");
    }
  }

  function stopRecording(reason = "") {
    if (stopping || !session) return stopping;
    clearTimeout(startTimeout);
    const recording = session;
    message = reason;
    usePhase("stopping");
    stopping = recording.stop().then(async () => {
      session = undefined;
      releaseCapture();
      if (destroyed) return;
      usePhase("idle");
      if (recording.meta.bytes) await showReview({...recording.meta}, reason || recording.meta.reason);
      else {
        message = reason || "Chưa có dữ liệu video. Hãy thử lại.";
        syncControls();
      }
      void refreshDraftCount();
    }).catch(() => {
      if (!destroyed) {
        message = "Chưa hoàn tất video. Bản nháp có thể mở lại.";
        session = undefined;
        releaseCapture();
        usePhase("idle");
      }
    }).finally(() => { stopping = undefined; });
    return stopping;
  }

  function showPanel(panel) {
    for (const item of backdrop) item.hidden = item !== panel;
    if (panel) panel.querySelector("button")?.focus();
  }

  function disposeReview() {
    reviewing++;
    review = undefined;
    el.reviewVideo.pause();
    el.reviewVideo.removeAttribute("src");
    el.reviewVideo.load();
    if (disposeReview.url) URL.revokeObjectURL(disposeReview.url);
    disposeReview.url = undefined;
  }

  async function showReview(meta, reason) {
    disposeReview();
    const token = reviewing;
    confirmation = false;
    reviewBusy = true;
    showPanel(el.review);
    el.reviewMessage.textContent = "Đang mở video…";
    updateReview();
    try {
      const file = await core.DraftStore.file(meta, "Super-Content");
      if (destroyed || token !== reviewing) return;
      if (!file.size) throw Error("Bản nháp chưa có dữ liệu.");
      disposeReview.url = URL.createObjectURL(file);
      el.reviewVideo.src = disposeReview.url;
      review = {meta, file, saved:false};
      el.reviewMessage.textContent = reason || "";
    } catch (error) {
      if (token === reviewing) el.reviewMessage.textContent = error.message || "Chưa mở được bản nháp.";
    } finally {
      if (token === reviewing) {
        reviewBusy = false;
        updateReview();
      }
    }
  }

  function updateReview() {
    for (const button of [el.save, el.download, el.discard, el.confirmSaved, el.complete]) button.disabled = !review || reviewBusy;
    for (const button of [el.reviewClose, el.retake, el.draftsFromReview]) button.disabled = reviewBusy;
    el.discard.hidden = !!review?.saved;
    el.confirmSaved.hidden = !confirmation || !!review?.saved;
    el.complete.hidden = !source.canComplete || !review?.saved;
  }

  async function exportReview(download) {
    if (!review || reviewBusy) return;
    const {file} = review;
    reviewBusy = true;
    confirmation = false;
    updateReview();
    try {
      if (!download && navigator.canShare?.({files:[file]}) && navigator.share) await core.shareVideo(file, "Super Content");
      else core.downloadVideo(file);
      confirmation = true;
      el.reviewMessage.textContent = "Kiểm tra video trong Ảnh hoặc Tệp, rồi xác nhận đã lưu.";
    } catch (error) {
      el.reviewMessage.textContent = error.name === "AbortError" ? "Đã hủy. Bản nháp vẫn còn." : "Chưa lưu được. Bản nháp vẫn còn.";
    } finally {
      reviewBusy = false;
      updateReview();
    }
  }

  async function removeReview(saved) {
    if (!review || reviewBusy || (saved && !confirmation)) return;
    if (!saved && !confirm("Xóa bản nháp video này khỏi thiết bị?")) return;
    reviewBusy = true;
    updateReview();
    try {
      await core.DraftStore.remove(review.meta.id);
      void refreshDraftCount();
      if (saved) {
        review.saved = true;
        confirmation = false;
        el.reviewMessage.textContent = "Đã xác nhận lưu video.";
      } else {
        disposeReview();
        showPanel(null);
        void prepare();
      }
    } catch {
      el.reviewMessage.textContent = "Chưa xóa được bản nháp. Hãy thử lại.";
    } finally {
      reviewBusy = false;
      updateReview();
    }
  }

  async function ownedDrafts() {
    return (await core.DraftStore.list()).filter(meta => meta.bytes > 0 && meta.owner === source.owner && meta.contentId === source.id);
  }

  async function refreshDraftCount() {
    if (readOnly || !core) return;
    try { draftCount = (await ownedDrafts()).length; }
    catch { draftCount = 0; }
    el.draftsBtn.textContent = draftCount ? `Video chưa lưu (${draftCount})` : "Video chưa lưu";
  }

  async function showDrafts() {
    disposeReview();
    showPanel(el.drafts);
    el.draftList.textContent = "Đang mở bản nháp…";
    try {
      const drafts = await ownedDrafts();
      el.draftList.replaceChildren();
      if (!drafts.length) el.draftList.textContent = "Chưa có video nháp.";
      for (const meta of drafts) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sc-p-secondary";
        button.textContent = new Date(meta.created).toLocaleString("vi-VN") + " · " + clock(meta.seconds) + (meta.complete ? "" : " · Gián đoạn");
        button.addEventListener("click", () => void showReview(meta, meta.reason), {once:true});
        el.draftList.append(button);
      }
    } catch {
      el.draftList.textContent = "Không mở được bộ nhớ video trên thiết bị.";
    }
  }

  async function updateWake() {
    if (destroyed || !prefs.wake || document.hidden) {
      const previous = wakeLock;
      wakeLock = undefined;
      await previous?.release().catch(() => {});
      return;
    }
    if (!navigator.wakeLock || wakeLock?.released === false || updateWake.pending) return;
    updateWake.pending = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (destroyed || !prefs.wake || document.hidden) await lock.release();
      else wakeLock = lock;
    } catch {} finally { updateWake.pending = false; }
  }

  function close() {
    if (destroyed) return;
    destroyed = true;
    request++;
    clearTimeout(startTimeout);
    cancelAnimationFrame(frame);
    reader.destroy();
    signals.abort();
    void initialContext?.close().catch(() => {});
    initialContext = undefined;
    voice?.destroy();
    if (session) void (stopping || session.stop()).catch(() => {}).finally(releaseCapture);
    else releaseCapture();
    void updateWake();
    disposeReview();
    overlay.close();
    overlay.remove();
    callbacks.closed();
  }

  listen(el.font, "input", () => {
    prefs.font = el.font.valueAsNumber;
    reader.measure();
    savePreferences();
    syncControls();
  });
  listen(el.speed, "input", () => { prefs.wpm = el.speed.valueAsNumber; savePreferences(); syncControls(); });
  for (const button of modeButtons) listen(button, "click", () => changeMode(button.dataset.mode));
  listen(el.record, "click", () => {
    if (readOnly) {
      reading = !reading;
      reader.resetMotion();
      if (reading && !capture) void prepare();
      if (!reading) releaseCapture();
      syncVoice();
      syncControls();
    } else if (phase === "recording") void stopRecording();
    else if (phase === "waiting" || phase === "countdown") usePhase("idle");
    else if (phase === "idle") {
      showPreview(false);
      requestRecording();
    }
  });
  listen(el.flip, "click", () => { facing = facing === "user" ? "environment" : "user"; void prepare(); });
  listen(el.retry, "click", () => {
    message = "";
    if (captureError) {
      if (!session) void prepare();
    } else {
      voice?.stop();
      syncVoice();
    }
    syncControls();
  });
  listen(el.camera, "loadedmetadata", () => {
    if (el.camera.videoWidth && el.camera.videoHeight) el.previewArea.style.setProperty("--sc-p-ratio", el.camera.videoWidth / el.camera.videoHeight);
  });
  listen(el.previewBtn, "click", () => showPreview(true));
  listen(el.previewClose, "click", () => showPreview(false));
  listen(el.settingsBtn, "click", async () => {
    showPreview(false);
    showPanel(el.settings);
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput");
      el.mic.replaceChildren(new Option("Micro hệ thống", ""));
      for (const device of devices) {
        if (device.deviceId && device.deviceId !== "default") el.mic.add(new Option(device.label || "Micro ngoài", device.deviceId));
      }
      el.mic.value = prefs.mic;
      if (el.mic.selectedIndex < 0) el.mic.selectedIndex = 0;
    } catch {}
  });
  listen(el.settingsClose, "click", () => showPanel(null));
  listen(el.framing, "change", () => { prefs.framing = el.framing.value; savePreferences(); void prepare(); });
  listen(el.mic, "change", () => { prefs.mic = el.mic.value; savePreferences(); void prepare(); });
  listen(el.wake, "change", () => { prefs.wake = el.wake.checked; savePreferences(); void updateWake(); });
  listen(el.countdown, "change", () => {
    prefs.countdown = clamp(Math.round(el.countdown.valueAsNumber || 3), 1, 10);
    el.countdown.value = prefs.countdown;
    savePreferences();
  });
  listen(el.draftsBtn, "click", () => void showDrafts());
  listen(el.draftsFromReview, "click", () => void showDrafts());
  listen(el.draftsClose, "click", () => { showPanel(null); void prepare(); });
  listen(el.save, "click", () => void exportReview(false));
  listen(el.download, "click", () => void exportReview(true));
  listen(el.confirmSaved, "click", () => void removeReview(true));
  listen(el.discard, "click", () => void removeReview(false));
  const retake = () => {
    disposeReview();
    showPanel(null);
    message = "";
    reader.rewind();
    void prepare();
  };
  listen(el.retake, "click", retake);
  listen(el.reviewClose, "click", retake);
  listen(el.reviewVideo, "error", () => { if (review) el.reviewMessage.textContent = "Chưa phát được video. Có thể tải xuống để kiểm tra."; });
  listen(el.complete, "click", async () => {
    reviewBusy = true;
    updateReview();
    try { await callbacks.complete(); }
    catch { el.reviewMessage.textContent = "Chưa chuyển được công đoạn. Hãy thử lại."; }
    finally { reviewBusy = false; updateReview(); }
  });
  listen(el.back, "click", close);
  listen(overlay, "cancel", event => {
    event.preventDefault();
    if (el.preview.hidden === false) showPreview(false);
    else if (el.settings.hidden === false) showPanel(null);
    else if (el.review.hidden === false && !reviewBusy) retake();
    else if (el.drafts.hidden === false) { showPanel(null); void prepare(); }
    else if (!session && phase !== "starting") close();
  });
  listen(document, "visibilitychange", () => {
    if (document.hidden && ["waiting", "countdown"].includes(phase)) usePhase("idle");
    void updateWake();
  });
  listen(window, "beforeunload", event => {
    if (phase === "recording" || phase === "stopping" || phase === "starting") {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.body.append(overlay);
  overlay.showModal();
  syncControls();
  frame = requestAnimationFrame(tick);
  void updateWake();
  import(/* @vite-ignore */ runtimeUrl.href).then(runtime => {
    if (destroyed) return;
    core = runtime;
    const segments = reader.load(core);
    voice = core.createVoice({
      segments,
      active:() => active() && prefs.mode === "voice",
      follow:reader.follow,
      phase:next => { voicePhase = next; maybeCountdown(); syncControls(); },
      semantic:ready => { semanticReady = ready; syncControls(); },
      voiceActivity:reader.activity,
    });
    void prepare();
    void refreshDraftCount();
    syncControls();
  }).catch(() => {
    if (!destroyed) {
      message = "Chưa tải được bộ nhắc chữ. Đóng rồi mở lại khi có mạng.";
      syncControls();
    }
  });
  return close;
}
