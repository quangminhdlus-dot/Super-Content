import { cloud } from "../cloud.js";
import { all, mutate } from "../storage.js";
import {
  defaultCriteria,
  validateCriteria,
  importChannels,
} from "../../shared/personalization.js";
const empty = () => ({
  channels: [],
  versions: [],
  feedback: [],
  memories: [],
  evaluations: [],
  jobs: [],
});
const check = ({ data, error }) => {
  if (error)
    throw new Error(
      error.message?.includes("CRITERIA_CONFLICT")
        ? "Tiêu chuẩn đã đổi ở thiết bị khác. Tải lại trước khi lưu."
        : "Chưa đọc/ghi được dữ liệu cá nhân hóa. Kiểm tra migration 003 và kết nối.",
    );
  return data;
};
async function local(user) {
  return (
    (await all(`personal:${user?.id || "demo"}`)).find(
      (r) => r.id === "workspace",
    )?.value || empty()
  );
}
async function change(user, fn) {
  return mutate(`personal:${user?.id || "demo"}`, "workspace", (r) => ({
    id: "workspace",
    value: fn(r?.value || empty()),
  }));
}
export async function loadPersonal(user) {
  if (!cloud || !user) {
    let data = await local(user);
    if (!data.legacy_imported) {
      const legacy =
        (await all("research:demo")).find((r) => r.id === "settings")?.value
          ?.settings?.channels || [];
      await change(user, (current) => ({
        ...current,
        legacy_imported: true,
        channels: current.channels.length
          ? current.channels
          : importChannels(legacy.map((c) => c.url).join("\n")).added.map(
              (c) => ({ ...c, id: crypto.randomUUID() }),
            ),
      }));
      data = await local(user);
    }
    return data;
  }
  const tables = [
    "content_research_channels",
    "content_criteria_versions",
    "content_research_feedback",
    "content_preference_memories",
    "content_research_evaluations",
    "content_research_jobs",
  ];
  const data = await Promise.all(
    tables.map(async (t) => {
      const order =
        t === "content_research_channels"
          ? "canonical_url"
          : t === "content_preference_memories"
            ? "updated_at"
            : "created_at";
      const q = () =>
        cloud
          .from(t)
          .select("*")
          .eq("user_id", user.id)
          .order(order, { ascending: t === "content_research_channels" })
          .order("id");
      if (
        ["content_preference_memories", "content_criteria_versions"].includes(t)
      ) {
        const rows = [];
        for (let offset = 0; ; offset += 1000) {
          const page = check(await q().range(offset, offset + 999));
          rows.push(...page);
          if (page.length < 1000) break;
        }
        return { data: rows, error: null };
      }
      return q().limit(t === "content_research_channels" ? 500 : 200);
    }),
  );
  return Object.fromEntries(
    ["channels", "versions", "feedback", "memories", "evaluations", "jobs"].map(
      (k, i) => [k, check(data[i])],
    ),
  );
}
export async function saveChannels(user, channels) {
  if (cloud && user) {
    check(
      await cloud.rpc("save_content_channels", {
        p_channels: channels.map((c) => ({
          canonical_url: c.canonical_url || c.url,
          title: c.title || "",
          topic_group: c.topic_group || "",
          enabled: c.enabled !== false,
        })),
      }),
    );
    return;
  }
  await change(user, (data) => {
    const map = new Map(data.channels.map((c) => [c.canonical_url, c]));
    for (const c of channels)
      map.set(c.canonical_url || c.url, {
        ...c,
        id: c.id || crypto.randomUUID(),
        canonical_url: c.canonical_url || c.url,
        updated_at: new Date().toISOString(),
      });
    if (map.size > 500) throw new Error("Tối đa 500 kênh.");
    return { ...data, channels: [...map.values()] };
  });
}
export async function removeChannel(user, id) {
  if (cloud && user) {
    check(await cloud.rpc("delete_content_channel", { p_id: id }));
    return;
  }
  await change(user, (data) => ({
    ...data,
    channels: data.channels.filter((c) => c.id !== id),
  }));
}
export async function saveCriteria(user, content, revision) {
  content = validateCriteria(content);
  if (cloud && user)
    return check(
      await cloud.rpc("save_content_criteria", {
        p_content: content,
        p_expected_revision: revision,
      }),
    );
  let result;
  await change(user, (data) => {
    const latest = Math.max(0, ...data.versions.map((v) => v.revision));
    if (latest !== revision)
      throw new Error("Tiêu chuẩn đã thay đổi. Tải lại trước khi lưu.");
    result = {
      id: crypto.randomUUID(),
      revision: latest + 1,
      content,
      created_at: new Date().toISOString(),
    };
    return { ...data, versions: [result, ...data.versions] };
  });
  return result;
}
export async function feedback(user, proposal, decision, reason = "") {
  if (cloud && user)
    return check(
      await cloud.rpc("record_content_feedback", {
        p_youtube_id: proposal.youtube_id,
        p_decision: decision,
        p_reason: reason,
      }),
    );
  let saved;
  await change(user, (data) => {
    saved = {
      id: crypto.randomUUID(),
      youtube_id: proposal.youtube_id,
      decision,
      reason,
      video_snapshot: proposal.data,
      criteria_version: data.versions[0]?.id || null,
      evaluated_version: proposal.analysis?.criteria_version || null,
      created_at: new Date().toISOString(),
    };
    return { ...data, feedback: [saved, ...data.feedback] };
  });
  return saved;
}
export async function saveMemory(user, memory) {
  if (!memory.text?.trim() || memory.text.length > 2000)
    throw new Error("Ghi nhớ từ 1 đến 2.000 ký tự.");
  const row = {
    id: memory.id || crypto.randomUUID(),
    text: memory.text,
    video_title: memory.video_title || "",
    feedback_id: memory.feedback_id || null,
    preference: memory.preference === "negative" ? "negative" : "positive",
    confirmed: memory.confirmed === true,
    updated_at: new Date().toISOString(),
  };
  if (cloud && user) {
    check(
      await cloud
        .from("content_preference_memories")
        .upsert({ ...row, user_id: user.id }),
    );
    return;
  }
  await change(user, (data) => ({
    ...data,
    memories: [row, ...data.memories.filter((m) => m.id !== row.id)],
  }));
}
export async function deleteMemory(user, id) {
  if (cloud && user) {
    check(
      await cloud
        .from("content_preference_memories")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id),
    );
    return;
  }
  await change(user, (data) => ({
    ...data,
    memories: data.memories.filter((m) => m.id !== id),
  }));
}
export async function cancelJob(user, id) {
  if (!cloud || !user) return;
  check(await cloud.rpc("cancel_content_research_job", { p_id: id }));
}
export { defaultCriteria, importChannels };
