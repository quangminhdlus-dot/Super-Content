import { test } from "node:test";
import assert from "node:assert/strict";
import { importChannels, tokens } from "../shared/personalization.js";
import { startResearchJob, stepResearchJob } from "../server/jobs.js";
import { personalRepository } from "../server/personal-repository.js";
import { createResearchServer } from "../server/index.js";
import { YouTube } from "../server/youtube.js";

const now = Date.parse("2026-11-08T12:00:00Z");
const channelId = "UC" + "a".repeat(22);
const settings = {
  channels: [],
  keywords: ["science"],
  mode: "keywords",
  published_after: "2026-10-01",
  published_before: "2026-11-08",
  result_limit: 10,
};
const cached = (id, source, age = 0) => ({
  data: {
    youtube_id: id,
    channel_id: channelId,
    title: "Science discoveries",
    description: "",
    channel: "Example",
    category_id: "27",
    duration_seconds: 600,
    published_at: "2026-11-01T00:00:00Z",
    views: 1000,
    likes: null,
    comments: null,
  },
  sources: [source],
  collected_at: new Date(now - age).toISOString(),
});
async function evaluate(rows, extra = {}) {
  let committed;
  const job = {
    id: "job",
    status: "running",
    cursor: 0,
    api_units: 0,
    criteria_version: null,
    tasks: [{ type: "evaluate" }],
    settings: { ...settings, query: "" },
    ...extra,
  };
  await stepResearchJob(
    { history: async () => [] },
    {
      claim: async () => job,
      cache: async () => rows,
      channels: async () => [],
      memories: async () => [],
      profile: async () => null,
      commit: async (_job, result) => {
        committed = result;
        return { ...job, status: "completed" };
      },
    },
    "job",
    {},
    { now },
  );
  return committed;
}

test("resolved channel handles and exact channel IDs both prevent reimport", () => {
  const existing = [
    { url: "https://www.youtube.com/@Example", youtube_channel_id: channelId },
  ];
  const result = importChannels(
    `https://youtube.com/@EXAMPLE/videos\nhttps://youtube.com/channel/${channelId}`,
    existing,
  );
  assert.equal(result.added.length, 0);
  assert.equal(result.duplicates.length, 2);
});

test("500 channels can start a resumable job; a 501st import is rejected", async () => {
  const channels = importChannels(
    Array.from({ length: 500 }, (_, i) => `https://youtube.com/@test${i}`).join(
      "\n",
    ),
  ).added;
  assert.equal(channels.length, 500);
  assert.equal(
    importChannels("https://youtube.com/@overflow", channels).invalid.length,
    1,
  );
  const job = await startResearchJob(
    { settings: async () => settings },
    {
      channels: async () => channels.map((c, i) => ({ ...c, id: String(i) })),
      start: async (s, tasks) => ({ settings: s, tasks }),
    },
    { kind: "refresh" },
  );
  assert.equal(job.tasks.length, 501);
});

test("YouTube requests cannot overspend the remaining job budget", async () => {
  let calls = 0;
  const youtube = new YouTube("test-only", {
    budget: 1,
    fetcher: async () => {
      calls++;
      return Response.json({ items: [] });
    },
  });
  await youtube.get("videos", {});
  await assert.rejects(
    () => youtube.get("search", {}),
    (e) => e.code === "QUOTA_BUDGET",
  );
  assert.equal(calls, 1);
  assert.equal(youtube.units, 1);
});

test("keyword research excludes cached videos from unrelated sources", async () => {
  const result = await evaluate([
    cached("video000001", "Từ khóa: science"),
    cached("video000002", "Từ khóa: music"),
    cached("video000003", "Kênh: Disabled channel"),
  ]);
  assert.deepEqual(
    result.items.map((v) => v.youtube_id),
    ["video000001"],
  );
});

test("Vietnamese cache search retains short words and normalizes uppercase Đ", async () => {
  assert.deepEqual(tokens("ĐƯỜNG"), tokens("đường"));
  const food = cached("video000001", "Từ khóa: science");
  food.data.title = "Ăn uống và sức khỏe";
  const other = cached("video000002", "Từ khóa: science");
  const result = await evaluate([food, other], {
    settings: { ...settings, query: "ăn" },
  });
  assert.deepEqual(
    result.items.map((v) => v.youtube_id),
    ["video000001"],
  );
});

test("fresh candidates cannot become outliers against stale cached peers", async () => {
  const fresh = cached("video000000", "Từ khóa: science");
  fresh.data.views = 10000;
  const peers = Array.from({ length: 5 }, (_, i) =>
    cached(`peer000000${i}`, "Từ khóa: science", 2 * 86400000),
  );
  const result = await evaluate([fresh, ...peers]);
  const analysis = result.items.find(
    (v) => v.youtube_id === fresh.data.youtube_id,
  ).analysis;
  assert.equal(analysis.eligible, false);
  assert.equal(analysis.view_ratio, null);
});

test("cache-only evaluation still completes when the YouTube budget is exhausted", async () => {
  const result = await evaluate([cached("video000000", "Từ khóa: science")], {
    api_units: 2500,
  });
  assert.equal(result.items.length, 1);
});

test("refresh updates statistics for cached uploads beyond the first playlist page", async () => {
  const row = {
    id: "row",
    enabled: true,
    youtube_channel_id: channelId,
    uploads: "UU-example",
    title: "Example",
    last_video_at: "2026-11-07T00:00:00Z",
  };
  let result;
  const requested = [];
  await stepResearchJob(
    {},
    {
      claim: async () => ({
        id: "job",
        status: "running",
        api_units: 0,
        cursor: 0,
        tasks: [
          {
            type: "channel",
            row_id: row.id,
            pages: 0,
            watermark: row.last_video_at,
          },
        ],
      }),
      channel: async () => row,
      channels: async () => [row],
      channelVideoIds: async () => ["cached00001"],
      commit: async (_job, data) => {
        result = data;
        return data;
      },
    },
    "job",
    { youtubeKey: "test-only" },
    {
      fetcher: async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith("playlistItems"))
          return Response.json({
            items: [{ contentDetails: { videoId: "recent00001" } }],
            nextPageToken: "older",
          });
        const ids = url.searchParams.get("id").split(",");
        requested.push(...ids);
        return Response.json({
          items: ids.map((id) => ({
            id,
            snippet: {
              title: "Example",
              channelId,
              channelTitle: "Example",
              publishedAt: "2026-11-07T00:00:00Z",
            },
            statistics: { viewCount: "2000" },
            contentDetails: { duration: "PT10M" },
          })),
        });
      },
    },
  );
  assert.ok(requested.includes("cached00001"));
  assert.equal(
    result.items.find((v) => v.youtube_id === "cached00001").views,
    2000,
  );
  assert.equal(result.done, true);
});

test("job start maps database scan limits to actionable HTTP 429", async () => {
  const personal = personalRepository(
    { rpc: async () => ({ error: { message: "SCAN_DAILY_LIMIT" } }) },
    "user",
  );
  await assert.rejects(
    () => personal.start({}, []),
    (e) => e.code === "SCAN_LIMIT" && e.status === 429,
  );
});

test("job API rejects non-object JSON and invalid job options without starting work", async () => {
  let calls = 0;
  const server = createResearchServer({
    authenticate: async () => ({ id: "user" }),
    jobs: {
      start: async () => {
        calls++;
        return {};
      },
      step: async () => ({}),
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const body of ["null", "[]", "42", '"text"']) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/research/jobs`,
        { method: "POST", headers: { Authorization: "Bearer test" }, body },
      );
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
    for (const input of [null, [], 42, { kind: "bad" }, { query: 42 }]) {
      await assert.rejects(
        () => startResearchJob({}, {}, input),
        (e) => e.code === "JOB_INPUT",
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("job HTTP routes verify auth, dispatch steps, reject bad/oversize bodies and expose revision", async () => {
  const jobId = "11111111-1111-1111-1111-111111111111";
  const server = createResearchServer({
    version: "test-revision",
    allowedOrigins: ["https://app.example"],
    authenticate: async (token) =>
      token === "valid" ? { id: "account-a" } : null,
    jobs: {
      start: async (user, input) => ({ user: user.id, kind: input.kind }),
      step: async (user, id) => ({ user: user.id, id }),
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: "Bearer valid",
    Origin: "https://app.example",
  };
  try {
    const health = await (await fetch(`${root}/health`)).json();
    assert.equal(health.version, "test-revision");
    assert.equal(
      (await fetch(`${root}/api/research/jobs`, { method: "POST" })).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${root}/api/research/jobs`, {
          method: "POST",
          headers: { Authorization: "Bearer expired" },
        })
      ).status,
      401,
    );
    const preflight = await fetch(`${root}/api/research/jobs`, {
      method: "OPTIONS",
      headers: { Origin: "https://app.example" },
    });
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("access-control-allow-headers"),
      /content-type/,
    );
    const start = await fetch(`${root}/api/research/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "refresh" }),
    });
    assert.deepEqual(await start.json(), {
      user: "account-a",
      kind: "refresh",
    });
    const step = await fetch(`${root}/api/research/jobs/${jobId}/step`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.deepEqual(await step.json(), { user: "account-a", id: jobId });
    const bad = await fetch(`${root}/api/research/jobs`, {
      method: "POST",
      headers,
      body: "{",
    });
    assert.equal(bad.status, 400);
    const large = await fetch(`${root}/api/research/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: "ứ".repeat(45000) }),
    });
    assert.equal(large.status, 413);
    assert.equal((await large.json()).code, "BODY_LIMIT");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
