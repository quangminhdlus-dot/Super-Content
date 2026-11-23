import { cloud } from "./cloud.js";
import { MAX_TRANSCRIPT_CHARS } from "../shared/voice.js";
const api = (() => {
  try {
    const url = new URL(import.meta.env.VITE_RESEARCH_API_URL);
    return url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
      ? url.href.replace(/\/$/, "")
      : null;
  } catch {
    return null;
  }
})();
export async function authorizeVoice() {
  if (!api) throw new Error("Ghi âm AI chưa được cấu hình trên máy chủ.");
  if (!cloud)
    throw new Error(
      "Vui lòng cấu hình Supabase và đăng nhập để dùng ghi âm AI.",
    );
  const { data, error } = await cloud.auth.getSession();
  if (error || !data.session)
    throw new Error("Vui lòng đăng nhập trong Cài đặt để dùng ghi âm AI.");
  return data.session.access_token;
}
export async function voiceRequest(operation, body, signal, { detailed = false } = {}) {
  if (!navigator.onLine)
    throw new Error(
      "Đang mất mạng. Đoạn ghi được giữ trong cửa sổ này; kết nối lại rồi bấm Thử lại.",
    );
  const token = await authorizeVoice();
  let response;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(cancel, 95000);
  try {
    response = await fetch(`${api}/api/voice/${operation}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type":
          operation === "transcribe" ? body.type : "application/json",
      },
      body:
        operation === "transcribe" ? body : JSON.stringify({ original: body }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        result?.error || "Chưa xử lý được đoạn ghi âm. Thử lại sau.",
      );
    const value =
      operation === "transcribe" ? result?.original : operation === "title" ? result?.title : result?.polished;
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > MAX_TRANSCRIPT_CHARS
    )
      throw new Error("Máy chủ trả về bản chép không hợp lệ.");
    return detailed && operation === "title" ? result : value;
  } catch (error) {
    if (signal.aborted) throw error;
    if (controller.signal.aborted || error instanceof TypeError)
      throw new Error(
        "Kết nối bị gián đoạn hoặc quá thời gian. Đoạn ghi được giữ trong cửa sổ này để thử lại.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
