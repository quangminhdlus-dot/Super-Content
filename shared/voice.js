// Each recording is a complete container, never an arbitrary MediaRecorder timeslice.
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_RECORDING_MS = 600000;
export const MAX_TRANSCRIPT_CHARS = 20000;
export const AUDIO_TYPES = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};
export function audioType(value = "") {
  return value.split(";")[0].trim().toLowerCase();
}
export function recordingType(Recorder) {
  return [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ].find((type) => Recorder.isTypeSupported(type));
}
export function insertVoiceText(value, text, start) {
  const point = Math.max(0, Math.min(value.length, start));
  const before = value.slice(0, point),
    after = value.slice(point);
  const addition = `${before && !/\s$/.test(before) ? " " : ""}${text}${after && !/^\s/.test(after) ? " " : ""}`;
  return { value: before + addition + after, cursor: point + addition.length };
}
