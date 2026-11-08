import { ResearchError } from "./validation.js";
const check = ({ data, error }) => {
  if (error)
    throw new ResearchError(
      "PERSONAL_DATABASE",
      "Chưa đọc/ghi được nền tảng cá nhân hóa. Kiểm tra migration 003.",
      503,
    );
  return data;
};
const single = (value) => (Array.isArray(value) ? value[0] : value);
export function personalRepository(admin, userId) {
  const query = (table) => admin.from(table).select("*").eq("user_id", userId);
  return {
    async channels() {
      return check(
        await query("content_research_channels")
          .order("canonical_url")
          .limit(500),
      );
    },
    async channel(id) {
      return check(
        await query("content_research_channels").eq("id", id).maybeSingle(),
      );
    },
    async channelVideoIds(channelId) {
      return check(
        await query("content_research_videos")
          .eq("data->>channel_id", channelId)
          .order("data->>published_at", { ascending: false })
          .order("youtube_id")
          .limit(150),
      ).map((row) => row.youtube_id);
    },
    async profile(id = undefined) {
      if (id === null) return null;
      if (id === undefined) {
        const p = check(await query("content_criteria_profiles").maybeSingle());
        id = p?.version_id;
      }
      return id
        ? check(await query("content_criteria_versions").eq("id", id).single())
        : null;
    },
    async memories() {
      return check(
        await query("content_preference_memories")
          .eq("confirmed", true)
          .order("updated_at", { ascending: false })
          .limit(500),
      );
    },
    async cache() {
      const rows = [];
      for (let offset = 0; offset < 2000; offset += 1000) {
        const data = check(
          await query("content_research_videos")
            .order("collected_at", { ascending: false })
            .order("youtube_id")
            .range(offset, offset + 999),
        );
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    },
    async start(settings, tasks) {
      const result = await admin.rpc("start_content_research_job", {
        p_user_id: userId,
        p_settings: settings,
        p_tasks: tasks,
      });
      if (
        /SCAN_(RUNNING|COOLDOWN|DAILY_LIMIT)/.test(result.error?.message || "")
      )
        throw new ResearchError(
          "SCAN_LIMIT",
          "Đang quét, chưa hết 60 giây chờ hoặc đã đạt 10 lần/24 giờ.",
          429,
        );
      return single(check(result));
    },
    async claim(id) {
      const { data, error } = await admin.rpc("claim_content_research_step", {
        p_user_id: userId,
        p_job_id: id,
      });
      if (error) {
        if (error.message.includes("JOB_BUSY"))
          throw new ResearchError(
            "JOB_BUSY",
            "Một thiết bị khác đang xử lý lô này. Chờ hai phút rồi tiếp tục.",
            409,
          );
        throw new ResearchError(
          "JOB_ACCESS",
          "Không truy cập được tiến trình hoặc chưa cài migration 003.",
          403,
        );
      }
      return single(data);
    },
    async commit(
      job,
      {
        items = [],
        task = null,
        done = true,
        units = 0,
        channel = null,
        error = null,
      } = {},
    ) {
      return single(
        check(
          await admin.rpc("commit_content_research_step", {
            p_user_id: userId,
            p_job_id: job.id,
            p_token: job.lease_token,
            p_items: items,
            p_task: task,
            p_done: done,
            p_units: units,
            p_channel: channel,
            p_error: error,
          }),
        ),
      );
    },
  };
}
