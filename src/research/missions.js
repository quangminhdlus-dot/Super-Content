import { cloud } from "../cloud.js";
import { all, mutate } from "../storage.js";
import { validateMission } from "../../shared/search.js";
const check = ({ data, error }) => {
  if (error)
    throw new Error(
      error.message?.includes("TASK_CONFLICT")
        ? "Nhiệm vụ đã thay đổi ở thiết bị khác. Tải lại trước khi lưu."
        : "Chưa đọc/ghi được nhiệm vụ. Kiểm tra kết nối và migration 004.",
    );
  return data;
};
const scope = (user) => `missions:${user?.id || "demo"}`;
export async function loadMissions(user) {
  if (cloud && user)
    return check(
      await cloud
        .from("content_search_tasks")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(100),
    );
  return (await all(scope(user))).filter((r) => !r.deleted).map((r) => r.value);
}
export async function saveMission(user, mission, revision = 0) {
  const spec = validateMission(mission, { draft: true });
  if (!spec.name.trim()) throw new Error("Đặt tên nhiệm vụ trước khi lưu.");
  const id = spec.task_id || crypto.randomUUID();
  spec.task_id = id;
  if (cloud && user) {
    const data = check(
      await cloud.rpc("save_content_search_task", {
        p_id: id,
        p_name: spec.name,
        p_spec: spec,
        p_revision: revision,
      }),
    );
    return Array.isArray(data) ? data[0] : data;
  }
  if (!revision && (await loadMissions(user)).length >= 100)
    throw new Error("Tối đa 100 nhiệm vụ.");
  const saved = await mutate(scope(user), id, (old) => {
    if ((old?.value?.revision || 0) !== revision)
      throw new Error("Nhiệm vụ đã đổi ở tab khác. Tải lại trước khi lưu.");
    return {
      id,
      value: {
        id,
        name: spec.name,
        spec,
        revision: revision + 1,
        updated_at: new Date().toISOString(),
        last_run_at: old?.value?.last_run_at || null,
      },
    };
  });
  return saved.value;
}
export async function taskHistory(user, id) {
  if (!cloud || !user) return [];
  const jobs = check(
    await cloud
      .from("content_research_jobs")
      .select("*")
      .eq("user_id", user.id)
      .eq("settings->mission->>task_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  );
  return Promise.all(
    jobs.map(async (j) => ({
      ...j,
      evaluations: check(
        await cloud
          .from("content_research_evaluations")
          .select("youtube_id,explanation,created_at")
          .eq("user_id", user.id)
          .eq("run_id", j.run_id)
          .order("created_at", { ascending: false })
          .limit(20),
      ),
    })),
  );
}
