import { cloud } from "../cloud.js";
import { createVideo } from "../model.js";
import { all, mutate } from "../storage.js";
const api = (() => {
  try {
    const u = new URL(import.meta.env.VITE_RESEARCH_API_URL);
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )
    )
      return null;
    return u.href.replace(/\/$/, "");
  } catch {
    return null;
  }
})();
export const apiConfigured = !!api;
export const defaults = () => ({
  channels: [],
  keywords: [],
  mode: "channels",
  published_after: new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10),
  published_before: new Date().toISOString().slice(0, 10),
  result_limit: 10,
});
const check = ({ data, error }) => {
  if (error)
    throw new Error(
      "Chưa đọc/ghi được dữ liệu nghiên cứu. Kiểm tra kết nối và migration 002.",
    );
  return data;
};
async function local(scope) {
  return (
    (await all(`research:${scope}`)).find((r) => r.id === "settings")
      ?.value || { settings: defaults(), proposals: [], runs: [] }
  );
}
async function localChange(scope, fn) {
  return mutate(`research:${scope}`, "settings", (old) => ({
    id: "settings",
    value: fn(old?.value || { settings: defaults(), proposals: [], runs: [] }),
  }));
}
export async function loadResearch(user) {
  if (!cloud || !user) return local("demo");
  const [settings, proposals, runs] = await Promise.all([
    cloud
      .from("content_research_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    cloud
      .from("content_research_videos")
      .select("*")
      .eq("user_id", user.id)
      .not("proposed_at", "is", null)
      .order("proposed_at", { ascending: false })
      .limit(500),
    cloud
      .from("content_research_runs")
      .select("*")
      .eq("user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(10),
  ]);
  return {
    settings: check(settings) || defaults(),
    proposals: check(proposals),
    runs: check(runs),
  };
}
export async function saveSettings(user, settings) {
  if (!cloud || !user) {
    await localChange("demo", (data) => ({ ...data, settings }));
    return;
  }
  check(
    await cloud
      .from("content_research_settings")
      .upsert(
        { ...settings, user_id: user.id, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      ),
  );
}
async function jobRequest(path, body = {}) {
  if (!cloud || !api)
    throw new Error("Cần đăng nhập Supabase và cấu hình máy chủ nghiên cứu.");
  const { data, error } = await cloud.auth.getSession();
  if (error || !data.session) throw new Error("Vui lòng đăng nhập lại.");
  let response;
  try {
    response = await fetch(`${api}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(100000),
    });
  } catch {
    throw new Error(
      "Kết nối bị gián đoạn. Tiến độ ở máy chủ được giữ; tải lại và tiếp tục sau khi lease hết hạn.",
    );
  }
  const result = await response.json().catch(() => null);
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error(
      "Phản hồi máy chủ không hợp lệ. Tiến độ đã lưu vẫn được giữ.",
    );
  if (!response.ok) throw new Error(result.error || "Chưa xử lý được lô.");
  if (
    !/^[0-9a-f-]{36}$/i.test(result.id || "") ||
    !["pending", "running", "paused", "completed", "cancelled"].includes(
      result.status,
    ) ||
    !Array.isArray(result.tasks) ||
    !Number.isInteger(result.cursor) ||
    result.cursor < 0 ||
    result.cursor > result.tasks.length
  )
    throw new Error(
      "Phản hồi tiến trình không hợp lệ. Tải lại để kiểm tra tiến độ đã lưu.",
    );
  return result;
}
export async function scanNow({
  kind = "research",
  query = "",
  resumeId = null,
  mission = undefined,
  onProgress = () => {},
  shouldContinue = () => true,
} = {}) {
  let job = resumeId
    ? { id: resumeId, status: "pending" }
    : await jobRequest("/api/research/jobs", { kind, query, mission });
  if (!resumeId && mission && !job.settings?.mission)
    throw new Error(
      "Máy chủ chưa nhận nhiệm vụ AI. Cập nhật backend và migration 004, hoặc hoàn tất/hủy tiến trình cũ trước khi thử lại.",
    );
  while (!["completed", "cancelled"].includes(job.status) && shouldContinue()) {
    job = await jobRequest(`/api/research/jobs/${job.id}/step`);
    onProgress(job);
  }
  return job;
}
export async function setProposalStatus(user, ids, status) {
  if (cloud && user) {
    check(
      await cloud.rpc("set_content_research_status", {
        p_ids: ids,
        p_status: status,
      }),
    );
    return;
  }
  await localChange("demo", (data) => ({
    ...data,
    proposals: data.proposals.map((p) =>
      ids.includes(p.youtube_id) && p.status !== "accepted"
        ? { ...p, status }
        : p,
    ),
  }));
}
export async function acceptProposals(user, ids) {
  if (cloud && user) {
    const accepted = check(
      await cloud.rpc("accept_content_research", { p_ids: ids }),
    );
    for (const video of accepted)
      await mutate(user.id, video.id, (current) =>
        current?.dirty
          ? current
          : { video, dirty: false, token: crypto.randomUUID() },
      );
    return;
  }
  // Demo acceptance is idempotent in a per-video IndexedDB transaction; existing content is never replaced.
  const data = await local("demo");
  for (const id of [...new Set(ids)]) {
    const proposal = data.proposals.find((p) => p.youtube_id === id);
    if (!proposal) throw new Error("Không tìm thấy đề xuất.");
    const existing = (await all("demo")).find(
      (r) =>
        r.video?.research?.youtube_id === id ||
        r.video?.source_url?.match(
          /(?:v=|youtu.be\/|shorts\/|embed\/)([\w-]{11})/,
        )?.[1] === id,
    );
    if (!existing) {
      const video = {
        ...createVideo(proposal.data.title),
        id: `youtube-${id}`,
        source_url: proposal.data.url,
        notes: `Nguồn: ${proposal.data.channel}\n${proposal.analysis?.angle || ""}`,
        research: proposal,
      };
      await mutate(
        "demo",
        video.id,
        (current) =>
          current || { video, dirty: false, token: crypto.randomUUID() },
      );
    }
  }
  await localChange("demo", (data) => ({
    ...data,
    proposals: data.proposals.map((p) =>
      ids.includes(p.youtube_id) ? { ...p, status: "accepted" } : p,
    ),
  }));
}
export async function provenance(user, video) {
  if (video.research) return [video.research];
  if (!cloud || !user) return [];
  return check(
    await cloud
      .from("content_research_links")
      .select("snapshot")
      .eq("user_id", user.id)
      .eq("video_id", video.id),
  );
}
