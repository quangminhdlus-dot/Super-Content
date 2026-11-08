import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyMission,
  validateMission,
  validatePlan,
  videoId,
  proposalOrder,
} from "../shared/search.js";
import { startMissionJob, planStep } from "../server/search-jobs.js";
import { planSearch, evaluateSearch } from "../server/search-ai.js";
import { defaultCriteria, personalScore } from "../shared/personalization.js";
import { personalRepository } from "../server/personal-repository.js";
import { marketScore } from "../server/scoring.js";
import { stepResearchJob } from "../server/jobs.js";
const mission = {
  ...emptyMission(),
  description:
    "Người trưởng thành có gia đình cảm thấy mất phương hướng; cần tìm lại ý nghĩa và động lực.",
  source: "youtube",
};
const plan = {
  intent: {
    audience: "30–40 tuổi",
    problem: "Mất phương hướng",
    outcome: "Tìm ý nghĩa",
    direct_topics: "Mục đích sống",
    related_topics: "Thiết kế cuộc đời",
    selection: "Câu chuyện thực tế",
    exclusions: "Giật gân",
  },
  groups: [
    {
      topic: "Khủng hoảng mục đích",
      query: "adult crisis finding purpose",
      language: "en",
      reason: "Mở rộng ngữ nghĩa",
      relevance: 0.9,
    },
    {
      topic: "Thiết kế cuộc đời",
      query: "thiết kế lại cuộc đời",
      language: "vi",
      reason: "Hướng ứng dụng",
      relevance: 0.8,
    },
  ],
};
const response = (value) =>
  Response.json({
    output: [
      { content: [{ type: "output_text", text: JSON.stringify(value) }] },
    ],
  });
test("mission result limit marks only the selected subset even for previously proposed cache records", async () => {
  const base = {
    title: "Purpose",
    description: "Life",
    channel_id: "channel",
    category_id: "27",
    duration_seconds: 600,
    views: 1000,
    likes: null,
    comments: null,
    published_at: "2026-11-01T00:00:00Z",
  };
  const m = { ...mission, method: "keywords", keywords: ["purpose"] };
  let output;
  const job = {
    id: "job",
    status: "running",
    cursor: 0,
    api_units: 0,
    tasks: [{ type: "evaluate" }],
    criteria_version: null,
    settings: {
      mission: m,
      search_plan: validatePlan(plan),
      mode: "keywords",
      keywords: ["purpose"],
      query: "",
      published_after: "2026-10-01",
      published_before: "2026-11-08",
      result_limit: 1,
    },
  };
  await stepResearchJob(
    { history: async () => [] },
    {
      claim: async () => job,
      cache: async () =>
        [0, 1].map((i) => ({
          data: { ...base, youtube_id: `video00000${i}` },
          collected_at: new Date().toISOString(),
          sources: ["Từ khóa: purpose"],
        })),
      channels: async () => [],
      memories: async () => [],
      profile: async () => null,
      commit: async (_j, result) => {
        output = result;
        return job;
      },
    },
    "job",
    {},
  );
  assert.deepEqual(
    output.items.map((v) => v.proposed),
    [true, false],
  );
  assert.deepEqual(
    output.items.map((v) => v.analysis.selected_for_mission),
    [true, false],
  );
});
test("description is default; methods/sources are independent; reference URLs cannot fetch arbitrary hosts", () => {
  assert.equal(emptyMission().method, "description");
  for (const source of ["channels", "youtube", "combined"])
    assert.equal(validateMission({ ...mission, source }).source, source);
  for (const u of [
    "http://youtu.be/video000000",
    "https://evil.test/watch?v=video000000",
    "https://youtube.com.evil/watch?v=video000000",
    "https://youtube.com@evil.test/watch?v=video000000",
  ])
    assert.throws(() => videoId(u));
  assert.equal(videoId("https://youtu.be/video000000"), "video000000");
  assert.throws(() => validateMission({ ...mission, description: "" }));
  assert.throws(() =>
    validatePlan({ ...plan, groups: Array(6).fill(plan.groups[0]) }),
  );
});
test("migration readiness and active mission mismatches fail explicitly before collecting data", async () => {
  const missing = personalRepository(
    { rpc: async () => ({ data: null, error: { message: "missing" } }) },
    "user",
  );
  await assert.rejects(
    () => missing.ensureSearchReady(),
    (e) => e.code === "SEARCH_SCHEMA",
  );
  const active = personalRepository(
    {
      rpc: async () => ({
        data: {
          settings: {
            mission: { ...mission, description: "Another mission" },
            kind: "research",
          },
        },
        error: null,
      }),
    },
    "user",
  );
  await assert.rejects(
    () => active.start({ mission, kind: "research" }, []),
    (e) => e.code === "JOB_ACTIVE",
  );
  assert.equal(marketScore({ score: 20, relevance: 1 }), 0);
  assert.equal(marketScore({ view_ratio: 4 }), 50);
});
test("AI planner receives entire description plus extra keywords, not a literal token split", async () => {
  let payload;
  const result = await planSearch({ ...mission, keywords: ["ikigai"] }, [], {
    key: "test-only",
    fetcher: async (_u, r) => {
      payload = JSON.parse(JSON.parse(r.body).input);
      return response(plan);
    },
  });
  assert.equal(payload.mission.description, mission.description);
  assert.deepEqual(payload.mission.keywords, ["ikigai"]);
  assert.equal(result.groups[0].query, "adult crisis finding purpose");
  await assert.rejects(
    () => planSearch(mission, [], {}),
    (e) => e.code === "AI_NOT_CONFIGURED",
  );
  await assert.rejects(
    () =>
      planSearch(mission, [], {
        key: "test",
        fetcher: async () => new Response("", { status: 429 }),
      }),
    (e) => e.code === "AI_UNAVAILABLE",
  );
});
test("100 followed channels get bounded refresh tasks; fresh channels reuse cache and never become whole-YouTube searches", async () => {
  let captured;
  const channels = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    url: `https://youtube.com/@ch${i}`,
    enabled: true,
    last_checked_at: i ? null : new Date().toISOString(),
  }));
  const personal = {
    channels: async () => channels,
    start: async (s, t) => {
      captured = { settings: s, tasks: t };
      return captured;
    },
  };
  const repo = {
    settings: async () => ({
      published_after: "2026-10-01",
      published_before: "2026-11-08",
      result_limit: 10,
    }),
  };
  await startMissionJob(repo, personal, {
    mission: { ...mission, source: "channels" },
  });
  assert.equal(captured.tasks.filter((t) => t.type === "channel").length, 99);
  const commits = [];
  const p = {
    reserveAI: async () => {},
    commit: async (_j, c) => {
      commits.push(c);
      return c;
    },
  };
  await planStep(
    { ...captured, cursor: 0, id: "job" },
    p,
    { units: 0 },
    { key: "test", fetcher: async () => response(plan) },
  );
  assert.equal(
    commits[0].task.remaining_tasks.some((t) => t.type === "keyword"),
    false,
  );
  await startMissionJob(repo, personal, {
    mission: { ...mission, source: "combined", plan },
  });
  await planStep(
    { ...captured, cursor: 0, id: "job" },
    p,
    { units: 0 },
    { key: "test" },
  );
  assert.equal(
    commits[1].task.remaining_tasks.filter((t) => t.type === "keyword").length,
    2,
  );
  await startMissionJob(repo, personal, { kind: "plan", mission });
  assert.deepEqual(captured.tasks, [{ type: "plan" }]);
});
test("reference planning reads actual metadata, excludes unavailable examples and stops before collection when AI is absent", async () => {
  let ids, input;
  const m = {
    ...mission,
    method: "examples",
    description: "",
    examples: ["https://youtu.be/video000000"],
  };
  const youtube = {
    key: "test",
    units: 1,
    details: async (value) => {
      ids = value;
      return [
        {
          youtube_id: value[0],
          title: "Reference title",
          description: "Reference metadata",
        },
      ];
    },
  };
  const p = { reserveAI: async () => {}, commit: async (_j, c) => c };
  const j = {
    settings: { mission: m, kind: "plan" },
    tasks: [{ type: "plan" }],
    cursor: 0,
  };
  await planStep(j, p, youtube, {
    key: "test",
    fetcher: async (_u, r) => {
      input = JSON.parse(JSON.parse(r.body).input);
      return response(plan);
    },
  });
  assert.deepEqual(ids, ["video000000"]);
  assert.equal(input.examples[0].description, "Reference metadata");
  await assert.rejects(
    () =>
      planStep(j, p, { ...youtube, details: async () => [] }, { key: "test" }),
    (e) => e.code === "EXAMPLE_UNAVAILABLE",
  );
  await assert.rejects(
    () => planStep(j, p, youtube, {}),
    (e) => e.code === "AI_NOT_CONFIGURED",
  );
});
test("AI ranks current need separately from long-term criteria, uses confirmed memory, and rejects invented IDs", async () => {
  const profile = { id: "criteria-1", content: defaultCriteria() };
  const original = JSON.stringify(profile);
  const videos = [0, 1].map((i) => ({
    youtube_id: `video00000${i}`,
    title: i ? "Lãnh đạo" : "Ý nghĩa cuộc sống",
    description: "Cuộc đời",
    views: 100,
    likes: 0,
    comments: 0,
    analysis: personalScore(
      { title: "Cuộc đời", description: "", views: 100, likes: 0, comments: 0 },
      { score: 20, market_score: 20, note: "", eligible: false },
      profile.content,
      [],
    ),
  }));
  const memory = {
    id: "memory",
    confirmed: true,
    preference: "positive",
    text: "cuộc đời",
    video_title: "Cuộc đời",
  };
  let payload;
  const config = {
    key: "test",
    fetcher: async (_u, r) => {
      payload = JSON.parse(JSON.parse(r.body).input);
      return response({
        videos: payload.videos.map((v, i) => ({
          youtube_id: v.youtube_id,
          need_fit: 0.8,
          relevance:
            payload.criteria.topics === "Lãnh đạo" ? (i ? 1 : 0) : i ? 0 : 1,
          novelty: 0.5,
          potential: 0.5,
          explanation: "Theo nhu cầu và tiêu chuẩn cụ thể.",
          angle: "Kiểm chứng bằng câu chuyện thật",
          missing: ["Chưa đọc transcript"],
        })),
      });
    },
  };
  const a = await evaluateSearch(
    videos,
    mission,
    validatePlan(plan),
    profile,
    [memory, { ...memory, id: "no", confirmed: false }],
    config,
  );
  assert.equal(a[0].analysis.need_fit, 80);
  assert.equal(a[0].analysis.market_score, 20);
  assert.equal(payload.videos[0].confirmed_examples.length, 1);
  assert.equal(JSON.stringify(profile), original);
  const changed = structuredClone(profile);
  changed.content.topics = "Lãnh đạo";
  const b = await evaluateSearch(
    videos,
    mission,
    validatePlan(plan),
    changed,
    [memory],
    config,
  );
  assert.ok(b[1].analysis.personal_fit > a[1].analysis.personal_fit);
  assert.ok(
    proposalOrder(
      { data: {}, analysis: a[0].analysis },
      { data: {}, analysis: a[1].analysis },
    ) < 0,
  );
  assert.ok(
    proposalOrder(
      { data: {}, analysis: b[1].analysis },
      { data: {}, analysis: b[0].analysis },
    ) < 0,
  );
  assert.deepEqual(
    await evaluateSearch([], mission, plan, profile, [], {}),
    [],
  );
  await assert.rejects(
    () =>
      evaluateSearch(videos, mission, plan, profile, [], {
        key: "test",
        fetcher: async () => response({ videos: [{ youtube_id: "invented" }] }),
      }),
    (e) => e.code === "AI_EVALUATION_FORMAT",
  );
  assert.equal(
    proposalOrder(
      { data: {}, analysis: { need_fit: 10 } },
      { data: {}, analysis: { need_fit: 90 } },
    ) > 0,
    true,
  );
});
