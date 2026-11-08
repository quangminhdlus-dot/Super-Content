import { ResearchError } from "./validation.js";
const checked = ({ data, error }) => {
  if (error)
    throw new ResearchError(
      "DATABASE",
      "Không đọc/ghi được dữ liệu nghiên cứu. Kiểm tra migration và cấu hình máy chủ.",
      503,
    );
  return data;
};
export function repository(admin, userId) {
  return {
    async settings() {
      return checked(
        await admin
          .from("content_research_settings")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle(),
      );
    },
    async begin(settings) {
      const { data, error } = await admin.rpc("begin_content_research_scan", {
        p_user_id: userId,
        p_settings: settings,
      });
      if (error) {
        if (/SCAN_(RUNNING|COOLDOWN|DAILY_LIMIT)/.test(error.message))
          throw new ResearchError(
            "SCAN_LIMIT",
            "Đang quét, chưa hết 60 giây chờ hoặc đã đạt 10 lần/24 giờ.",
            429,
          );
        throw new ResearchError(
          "DATABASE",
          "Chưa khởi tạo được lần quét. Kiểm tra migration nghiên cứu.",
          503,
        );
      }
      return data;
    },
    async history() {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString(),
        result = [];
      // Supabase's default response cap is 1,000 rows even when limit(10000) is requested.
      for (let offset = 0; offset < 10000; offset += 1000) {
        const page = checked(
          await admin
            .from("content_research_snapshots")
            .select("youtube_id,captured_at,views")
            .eq("user_id", userId)
            .gte("captured_at", cutoff)
            .order("captured_at", { ascending: false })
            .order("youtube_id")
            .range(offset, offset + 999),
        );
        result.push(...page);
        if (page.length < 1000) break;
      }
      return result;
    },
    async persist(videos, runId, capturedAt) {
      checked(
        await admin.rpc("persist_content_research_scan", {
          p_user_id: userId,
          p_run_id: runId,
          p_items: videos,
          p_captured_at: capturedAt,
        }),
      );
    },
    async finish(id, values) {
      checked(
        await admin
          .from("content_research_runs")
          .update({ ...values, completed_at: new Date().toISOString() })
          .eq("id", id)
          .eq("user_id", userId),
      );
    },
  };
}
