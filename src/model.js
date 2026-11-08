export const STAGES = ["ideas", "script", "filming", "editing", "published"];
export const LABELS = [
  "Kho ý tưởng",
  "Lên kịch bản",
  "Chờ quay",
  "Hoàn thiện",
  "Đã xuất bản",
];
export function createVideo(title, userId = null) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    title: title.trim(),
    stage: "ideas",
    source_url: "",
    notes: "",
    script: "",
    postproduction_notes: "",
    draft_url: "",
    youtube_url: "",
    created_at: now,
    updated_at: now,
    published_at: null,
    archived_at: null,
    deleted_at: null,
    purged_at: null,
    revision: 0,
  };
}
export const normalize = (title) =>
  title.trim().normalize("NFC").toLocaleLowerCase("vi").replace(/\s+/g, " ");
export function parseTitles(text, videos) {
  const seen = new Set(
    videos.filter((v) => !v.purged_at).map((v) => normalize(v.title)),
  );
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((title) => {
      const duplicate = seen.has(normalize(title));
      seen.add(normalize(title));
      return { title, duplicate };
    });
}
export function transition(video, stage) {
  if (!STAGES.includes(stage)) throw new Error("Công đoạn không hợp lệ");
  return {
    ...video,
    stage,
    published_at:
      stage === "published"
        ? video.published_at || new Date().toISOString()
        : video.published_at,
  };
}
export function visible(v, view) {
  if (v.purged_at) return false;
  if (view === "trash") return !!v.deleted_at;
  if (v.deleted_at) return false;
  if (view === "archive") return !!v.archived_at;
  return !v.archived_at && v.stage === view;
}
