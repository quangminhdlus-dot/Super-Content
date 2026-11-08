import { test, expect } from "@playwright/test";
test("authenticated mission UI previews/edits strategy, saves/reruns task, shows A/B/C results, history, empty results and explicit AI failure (mock services)", async ({
  page,
}) => {
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "missions@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const settings = {
    channels: [],
    keywords: [],
    mode: "channels",
    published_after: "2026-10-01",
    published_before: "2026-11-08",
    result_limit: 10,
  };
  const plan = {
    intent: {
      audience: "Trưởng thành",
      problem: "Mất phương hướng",
      outcome: "Ý nghĩa",
      direct_topics: "Mục đích",
      related_topics: "Giá trị sống",
      selection: "Câu chuyện thật",
      exclusions: "Giật gân",
    },
    groups: [
      {
        topic: "Thiết kế cuộc đời",
        query: "life design",
        language: "en",
        reason: "Mở rộng ngữ nghĩa",
        relevance: 0.9,
        enabled: true,
      },
    ],
  };
  const tasks = [],
    jobs = [],
    requests = [];
  let proposals = [],
    current,
    fail = false,
    empty = false,
    criteriaWrites = 0;
  await page.route("https://content-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = req.url(),
      reply = (data) => route.fulfill({ json: data });
    if (url.includes("/auth/v1/token"))
      return reply({
        access_token: "test-mission-token",
        refresh_token: "test-refresh",
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
    if (url.includes("/auth/v1/user")) return reply(user);
    if (url.includes("/rpc/save_content_criteria")) {
      criteriaWrites++;
      return reply({});
    }
    if (url.includes("/rpc/save_content_search_task")) {
      const p = req.postDataJSON();
      const saved = {
        id: p.p_id,
        name: p.p_name,
        spec: p.p_spec,
        revision: p.p_revision + 1,
      };
      tasks.splice(0, tasks.length, saved);
      return reply(saved);
    }
    if (url.includes("/content_search_tasks")) return reply(tasks);
    if (url.includes("/content_research_settings")) {
      if (req.method() === "POST") Object.assign(settings, req.postDataJSON());
      return reply(settings);
    }
    if (url.includes("/content_research_jobs")) return reply(jobs);
    if (url.includes("/content_research_videos")) return reply(proposals);
    if (url.includes("/content_research_evaluations"))
      return reply(
        proposals.map((p) => ({
          youtube_id: p.youtube_id,
          explanation: p.analysis,
        })),
      );
    return reply([]);
  });
  await page.route("https://research-api.example/**", async (route) => {
    const req = route.request();
    expect(req.headers().authorization).toBe("Bearer test-mission-token");
    if (fail)
      return route.fulfill({
        status: 503,
        json: {
          code: "AI_UNAVAILABLE",
          error: "Tìm kiếm thông minh đang tạm thời không hoạt động.",
        },
      });
    if (req.url().endsWith("/jobs")) {
      const input = req.postDataJSON();
      requests.push(input);
      current = {
        id: crypto.randomUUID(),
        run_id: crypto.randomUUID(),
        settings: input,
        status: "pending",
        cursor: 0,
        tasks: [{ type: "plan" }, { type: "evaluate" }],
        api_units: 0,
        created_at: new Date().toISOString(),
      };
      return route.fulfill({ json: current });
    }
    current = {
      ...current,
      status: "completed",
      cursor: 2,
      settings: {
        ...current.settings,
        search_plan: current.settings.mission.plan || plan,
      },
    };
    jobs.unshift(current);
    if (current.settings.kind !== "plan" && !empty)
      proposals = [
        {
          youtube_id: "video000000",
          status: "suggested",
          last_run_id: current.run_id,
          data: {
            title: "Ví dụ kiểm thử tìm ý nghĩa",
            channel: "Fixture",
            views: 1000,
            published_at: "2026-11-01T00:00:00Z",
          },
          analysis: {
            need_fit: 92,
            personal_fit: 80,
            market_score: 20,
            score: 80,
            ranking_engine: "ai_search",
            search_explanation: "Theo nhu cầu tìm ý nghĩa và tiêu chuẩn riêng.",
            missing_data: ["Chưa đọc transcript"],
            search_context: { mission: current.settings.mission, plan },
          },
        },
      ];
    return route.fulfill({ json: current });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
  await page.locator("[name=email]").fill(user.email);
  await page.locator("[name=password]").fill("test-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.locator(".research-shortcut").click();
  await page
    .locator("#mission-description")
    .fill(
      "Tìm video giúp người trưởng thành mất phương hướng tìm lại động lực và ý nghĩa.",
    );
  await page.locator("[name=mode]").selectOption("keywords");
  await page.locator(".search-plan summary").click();
  await page
    .getByRole("button", { name: "Tạo chiến lược AI", exact: true })
    .click();
  await expect(page.locator("#research-status")).toContainText(
    "Đã tạo chiến lược",
  );
  await page.locator(".search-plan summary").click();
  await page.locator("[data-plan-query]").fill("adult purpose stories");
  await page.locator(".mission-options summary").click();
  await page.locator("#mission-name").fill("Nhiệm vụ ý nghĩa");
  await page.getByRole("button", { name: "Lưu nhiệm vụ", exact: true }).click();
  await expect(page.locator("#research-status")).toContainText(
    "Đã lưu nhiệm vụ",
  );
  await page.getByRole("button", { name: "Quét ngay", exact: true }).click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await expect(page.locator(".search-scores")).toContainText("92/100");
  expect(requests.at(-1).mission.source).toBe("youtube");
  expect(requests.at(-1).mission.plan.groups[0].query).toBe(
    "adult purpose stories",
  );
  expect(requests.at(-1).mission.task_id).toBe(tasks[0].id);
  expect(criteriaWrites).toBe(0);
  await page.locator("#proposal-sort").selectOption("newest");
  await page.locator(".mission-options summary").click();
  await page
    .getByRole("button", { name: "Lịch sử kết quả", exact: true })
    .click();
  await expect(page.locator(".mission-history")).toContainText("video000000");
  empty = true;
  await page.getByRole("button", { name: "Quét ngay", exact: true }).click();
  await expect(page.locator(".proposal-card")).toHaveCount(0);
  fail = true;
  await page.getByRole("button", { name: "Quét ngay", exact: true }).click();
  await expect(page.locator("#research-status")).toContainText(
    "tạm thời không hoạt động",
  );
});
