import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { startResearchJob, stepResearchJob } from "../server/jobs.js";
import { emptyMission } from "../shared/search.js";
import { defaultCriteria } from "../shared/personalization.js";
test("004 integration: real local SQL runs AI plan → YouTube collection → evaluation, snapshots, task history, editable feedback and account isolation", async () => {
  const db = new PGlite();
  await db.exec(
    `create role authenticated;create role anon;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`,
  );
  for (const file of [
    "001_content_videos.sql",
    "002_youtube_research.sql",
    "003_personal_research.sql",
    "004_search_missions.sql",
  ])
    await db.exec(readFileSync(`supabase/${file}`, "utf8"));
  const a = "00000000-0000-0000-0000-000000000001",
    b = "00000000-0000-0000-0000-000000000002";
  await db.query("insert into auth.users values($1),($2)", [a, b]);
  const as = async (role, user = a) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user,
    ]);
    await db.exec(`set role ${role}`);
  };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  await as("authenticated");
  const mission = {
    ...emptyMission(),
    name: "Thử nghiệm AI",
    description: "Tìm ý nghĩa cuộc sống ở tuổi trưởng thành",
    source: "youtube",
    task_id: "11111111-1111-1111-1111-111111111111",
  };
  const saved = await one(
    "select * from public.save_content_search_task($1,$2,$3,0)",
    [mission.task_id, mission.name, JSON.stringify(mission)],
  );
  await assert.rejects(
    () =>
      one("select * from public.save_content_search_task($1,$2,$3,7)", [
        saved.id,
        "Other",
        JSON.stringify(mission),
      ]),
    /TASK_CONFLICT/,
  );
  const version = await one(
    "select * from public.save_content_criteria($1,0)",
    [JSON.stringify(defaultCriteria())],
  );
  await db.query(
    "insert into public.content_videos(id,user_id,title,script) values(gen_random_uuid(),$1,'Giữ nguyên','Kịch bản quan trọng')",
    [a],
  );
  await as("authenticated", b);
  assert.equal(
    (await db.query("select * from public.content_search_tasks")).rows.length,
    0,
  );
  await assert.rejects(
    () =>
      one("select * from public.save_content_search_task($1,$2,$3,1)", [
        saved.id,
        "Spoof",
        JSON.stringify(mission),
      ]),
    /TASK_CONFLICT/,
  );
  await assert.rejects(
    () =>
      db.query(
        "select public.reserve_content_search_ai($1,gen_random_uuid(),'plan')",
        [a],
      ),
    /permission denied/,
  );
  await as("service_role");
  const personal = {
    channels: async () => [],
    profile: async () => version,
    memories: async () => [],
    start: (settings, tasks) =>
      one("select * from public.start_content_research_job($1,$2,$3)", [
        a,
        JSON.stringify(settings),
        JSON.stringify(tasks),
      ]),
    claim: (id) =>
      one("select * from public.claim_content_research_step($1,$2)", [a, id]),
    reserveAI: (id, phase) =>
      db.query("select public.reserve_content_search_ai($1,$2,$3)", [
        a,
        id,
        phase,
      ]),
    cache: async () =>
      (
        await db.query(
          "select * from public.content_research_videos where user_id=$1",
          [a],
        )
      ).rows,
    commit: (
      j,
      {
        items = [],
        task = null,
        done = true,
        units = 0,
        channel = null,
        error = null,
      } = {},
    ) =>
      one(
        "select * from public.commit_content_research_step($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          a,
          j.id,
          j.lease_token,
          JSON.stringify(items),
          task ? JSON.stringify(task) : null,
          done,
          units,
          channel ? JSON.stringify(channel) : null,
          error,
        ],
      ),
  };
  const repo = {
    settings: async () => ({
      channels: [],
      keywords: [],
      mode: "channels",
      published_after: "2026-10-01",
      published_before: "2026-11-08",
      result_limit: 10,
    }),
    history: async () => [],
  };
  let aiCalls = 0,
    searches = 0;
  const fetcher = async (input, req) => {
    const u = new URL(input);
    if (u.hostname === "api.openai.com") {
      aiCalls++;
      const payload = JSON.parse(req.body),
        data = JSON.parse(payload.input);
      const value =
        payload.text.format.name === "search_plan"
          ? {
              intent: {
                audience: "Trưởng thành",
                problem: "Mất phương hướng",
                outcome: "Tìm ý nghĩa",
                direct_topics: "Mục đích sống",
                related_topics: "Giá trị",
                selection: "Ứng dụng",
                exclusions: "Giật gân",
              },
              groups: [
                {
                  topic: "Ý nghĩa",
                  query: "finding purpose",
                  language: "en",
                  reason: "Mở rộng ngữ nghĩa",
                  relevance: 0.9,
                },
                {
                  topic: "Giá trị",
                  query: "giá trị sống",
                  language: "vi",
                  reason: "Liên quan",
                  relevance: 0.8,
                },
              ],
            }
          : {
              videos: data.videos.map((v) => ({
                youtube_id: v.youtube_id,
                need_fit: 0.9,
                relevance: 0.8,
                novelty: 0.6,
                potential: 0.7,
                explanation: "Phù hợp nhu cầu; chỉ dựa metadata.",
                angle: "Câu chuyện kiểm chứng",
                missing: ["Nội dung đầy đủ"],
              })),
            };
      return Response.json({
        output: [
          { content: [{ type: "output_text", text: JSON.stringify(value) }] },
        ],
      });
    }
    if (u.pathname.endsWith("search")) {
      searches++;
      return Response.json({ items: [{ id: { videoId: "video000000" } }] });
    }
    return Response.json({
      items: [
        {
          id: "video000000",
          snippet: {
            title: "Finding purpose",
            description: "Meaning of life",
            channelId: "UC" + "a".repeat(22),
            channelTitle: "Fixture",
            publishedAt: "2026-11-01T00:00:00Z",
            categoryId: "27",
          },
          statistics: { viewCount: "1000", likeCount: "10", commentCount: "5" },
          contentDetails: { duration: "PT10M" },
        },
      ],
    });
  };
  let job = await startResearchJob(repo, personal, { mission });
  let steps = 0;
  while (job.status !== "completed" && steps++ < 8)
    job = await stepResearchJob(
      repo,
      personal,
      job.id,
      { youtubeKey: "test", openaiKey: "test" },
      { fetcher, now: Date.now() },
    );
  assert.equal(job.status, "completed");
  assert.equal(aiCalls, 2);
  assert.equal(searches, 2);
  assert.equal(job.settings.search_plan.groups.length, 2);
  const video = await one(
    "select * from public.content_research_videos where user_id=$1",
    [a],
  );
  assert.equal(video.analysis.need_fit, 90);
  assert.equal(video.sources.length, 2);
  assert.equal(
    (await one("select count(*)::int n from public.content_research_videos")).n,
    1,
  );
  assert.ok(
    (
      await one(
        "select last_run_at from public.content_search_tasks where id=$1",
        [saved.id],
      )
    ).last_run_at,
  );
  await as("authenticated");
  assert.equal(
    (
      await one("select script from public.content_videos where user_id=$1", [
        a,
      ])
    ).script,
    "Kịch bản quan trọng",
  );
  assert.deepEqual(
    (
      await one(
        "select content from public.content_criteria_versions where id=$1",
        [version.id],
      )
    ).content,
    defaultCriteria(),
  );
  await as("authenticated");
  const feedback = await one(
    "select * from public.record_content_feedback('video000000','excellent','Tôi thích góc nhìn này')",
  );
  assert.equal(feedback.research_context.mission.task_id, saved.id);
  await db.query(
    "insert into public.content_preference_memories(user_id,feedback_id,text,preference,confirmed) values($1,$2,'Góc nhìn','positive',true)",
    [a, feedback.id],
  );
  await db.query(
    "select public.edit_content_feedback($1,'rejected','Đổi lựa chọn',false)",
    [feedback.id],
  );
  assert.equal(
    (await one("select confirmed from public.content_preference_memories"))
      .confirmed,
    false,
  );
  await as("authenticated", b);
  await assert.rejects(
    () =>
      db.query(
        "select public.edit_content_feedback($1,'chosen','spoof',true)",
        [feedback.id],
      ),
    /Feedback not found/,
  );
  await as("authenticated");
  await db.query("select public.edit_content_feedback($1,'rejected','',true)", [
    feedback.id,
  ]);
  assert.equal(
    (await db.query("select * from public.content_research_feedback")).rows
      .length,
    0,
  );
  assert.equal(
    (await db.query("select * from public.content_preference_memories")).rows
      .length,
    0,
  );
  // A cache-only replay retains the user's criteria version and never fabricates a fresh snapshot.
  await as("service_role");
  const snapBefore = (
    await one("select count(*)::int n from public.content_research_snapshots")
  ).n;
  await db.query(
    "update public.content_research_runs set started_at=now()-interval '2 minutes'",
  );
  const replayMission = {
    ...mission,
    source: "channels",
    plan: job.settings.search_plan,
  };
  personal.channels = async () => [
    {
      enabled: true,
      id: "row",
      url: "https://youtube.com/@fixture",
      youtube_channel_id: "UC" + "a".repeat(22),
      last_checked_at: new Date().toISOString(),
    },
  ];
  job = await startResearchJob(repo, personal, { mission: replayMission });
  for (let i = 0; i < 2; i++)
    job = await stepResearchJob(
      repo,
      personal,
      job.id,
      { openaiKey: "test" },
      { fetcher },
    );
  assert.equal(job.status, "completed");
  assert.equal(
    (await one("select count(*)::int n from public.content_research_snapshots"))
      .n,
    snapBefore,
  );
  assert.equal(searches, 2);
  await db.query(
    "update public.content_research_runs set started_at=now()-interval '2 minutes'",
  );
  job = await startResearchJob(repo, personal, {
    mission: { ...mission, source: "combined", plan: job.settings.search_plan },
  });
  for (let i = 0; i < 4; i++)
    job = await stepResearchJob(
      repo,
      personal,
      job.id,
      { youtubeKey: "test", openaiKey: "test" },
      { fetcher },
    );
  assert.equal(job.status, "completed");
  assert.equal(searches, 4);
  assert.equal(
    (await one("select count(*)::int n from public.content_research_videos")).n,
    1,
  );
  await db.query(
    "update public.content_research_runs set started_at=now()-interval '2 minutes'",
  );
  const budgetJob = await startResearchJob(repo, personal, {
    kind: "plan",
    mission,
  });
  await personal.claim(budgetJob.id);
  for (let i = 0; i < 3; i++) await personal.reserveAI(budgetJob.id, "plan");
  await assert.rejects(
    () => personal.reserveAI(budgetJob.id, "plan"),
    /AI_BUDGET/,
  );
  await assert.rejects(
    () =>
      db.query("select public.reserve_content_search_ai($1,$2,'evaluate')", [
        b,
        budgetJob.id,
      ]),
    /JOB_ACCESS/,
  );
  await db.close();
});
