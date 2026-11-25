// CSS transforms affect the preview only. Mirror decoded camera pixels before
// the existing encoder, without changing its audio graph or encoding options.
export function recordingVideo(preview, stream, mirrored) {
  if (!mirrored) return {stream, close() {}};
  const camera = stream.getVideoTracks()[0];
  const {width, height, frameRate} = camera.getSettings();
  const canvas = document.createElement("canvas");
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;
  if (!canvas.width || !canvas.height || !Number.isFinite(frameRate) || frameRate <= 0 ||
      typeof canvas.captureStream !== "function" || typeof preview.requestVideoFrameCallback !== "function") {
    throw Error("Trình duyệt chưa hỗ trợ ghi cùng chiều camera trước ở chất lượng hiện tại. Hãy cập nhật Safari/iOS.");
  }
  // Safari may report sensor dimensions before its portrait rotation. Preserve
  // the decoded frame dimensions, accepting only a rotation of the same size.
  if (width && height && (Math.min(width, height) !== Math.min(canvas.width, canvas.height) ||
      Math.max(width, height) !== Math.max(canvas.width, canvas.height))) {
    throw Error("Kích thước camera chưa ổn định. Chuẩn bị lại camera trước khi quay.");
  }
  const paint = canvas.getContext("2d", {alpha:false});
  if (!paint) throw Error("Không tạo được bề mặt ghi video ở độ phân giải camera hiện tại.");
  paint.setTransform(-1, 0, 0, 1, canvas.width, 0);
  paint.imageSmoothingEnabled = false;
  const draw = () => paint.drawImage(preview, 0, 0);
  draw();
  const output = canvas.captureStream(frameRate);
  const track = output.getVideoTracks()[0];
  const settings = track?.getSettings();
  if (!track || typeof track.requestFrame !== "function" || settings.width !== canvas.width ||
      settings.height !== canvas.height || !Number.isFinite(settings.frameRate) ||
      settings.frameRate < frameRate - .01) {
    output.getTracks().forEach(item => item.stop());
    throw Error("Trình duyệt không giữ được độ phân giải/FPS của camera khi ghi cùng chiều. Không hạ chất lượng video.");
  }
  let closed = false, callback;
  function next() {
    if (closed) return;
    draw();
    // Request each camera frame explicitly: the canvas's periodic capture timer
    // can otherwise miss frames when its clock falls between camera callbacks.
    track.requestFrame();
    callback = preview.requestVideoFrameCallback(next);
  }
  callback = preview.requestVideoFrameCallback(next);
  return {
    // Pass the original microphone track to the existing stereo processor.
    stream:new MediaStream([track, ...stream.getAudioTracks()]),
    close() {
      if (closed) return;
      closed = true;
      preview.cancelVideoFrameCallback(callback);
      track.stop();
      canvas.width = canvas.height = 0;
    },
  };
}

export async function createPreviewRecording(core, preview, capture, changed, interrupted, source) {
  const output = recordingVideo(preview, capture.stream, preview.classList.contains("mirrored"));
  let recording;
  const camera = capture.stream.getVideoTracks()[0];
  // Relay into VideoSession's existing interruption handling so its manifest
  // retains the same incomplete/recovery state as a direct camera recording.
  const relay = type => output.stream.getVideoTracks()[0].dispatchEvent(new Event(type));
  const ended = () => relay("ended");
  const muted = () => relay("mute");
  const close = () => {
    camera.removeEventListener("ended", ended);
    camera.removeEventListener("mute", muted);
    output.close();
  };
  try {
    recording = await core.VideoSession.create(output.stream, changed, interrupted, source, capture.context);
    const stop = recording.stop.bind(recording);
    recording.stop = async () => { try { await stop(); } finally { close(); } };
    // The generated track cannot relay interruption events from its camera.
    if (output.stream !== capture.stream) {
      camera.addEventListener("ended", ended);
      camera.addEventListener("mute", muted);
    }
    return recording;
  } catch (error) {
    close();
    throw error;
  }
}
