import { test, expect } from "@playwright/test";
test("configured research UI calls the authenticated server, shows errors and imports selected results (mock services)", async ({
  page,
}) => {
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "research@example.com",
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  let runs = [],
    proposals = [],
    videos = [],
    calls = 0,
    fail = false;
  let settings = {
    user_id: user.id,
    channels: [{ url: "https://www.youtube.com/@example" }],
    keywords: [],
    mode: "channels",
    published_after: "2026-10-01",
    published_before: "2026-11-08",
    result_limit: 5,
  };
  await page.route("https://content-test.supabase.co/**", async (route) => {
    const req = route.request(),
      url = req.url(),
      reply = (data) =>
        route.fulfill({
          json: data,
          headers: { "access-control-allow-origin": "*" },
        });
    if (url.includes("/auth/v1/token"))
      return reply({
        access_token: "test-user-token",
        refresh_token: "refresh",
        expires_in: 3600,
        token_type: "bearer",
        user,
      });
    if (url.includes("/auth/v1/user")) return reply(user);
    if (url.includes("/rpc/accept_content_research")) {
      const { p_ids } = req.postDataJSON();
      for (const id of p_ids) {
        const p = proposals.find((p) => p.youtube_id === id);
        p.status = "accepted";
        if (!videos.some((v) => v.source_url === p.data.url))
          videos.push({
            id: crypto.randomUUID(),
            user_id: user.id,
            title: p.data.title,
            stage: "ideas",
            source_url: p.data.url,
            notes: "Giữ hồ sơ nghiên cứu",
            script: "",
            postproduction_notes: "",
            draft_url: "",
            youtube_url: "",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            published_at: null,
            archived_at: null,
            deleted_at: null,
            purged_at: null,
            revision: 1,
          });
      }
      return reply(videos);
    }
    if (url.includes("/content_research_settings")) {
      if (req.method() === "POST") {
        settings = req.postDataJSON();
        return reply(null);
      }
      return reply(settings);
    }
    if (url.includes("/content_research_runs")) return reply(runs);
    if (url.includes("/content_research_videos")) return reply(proposals);
    if (url.includes("/content_research_links")) return reply([]);
    if (url.includes("/content_videos")) return reply(videos);
    return reply([]);
  });
  await page.route("https://research-api.example/**", async (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization",
          "access-control-allow-methods": "POST",
        },
      });
    calls++;
    expect(route.request().headers().authorization).toBe(
      "Bearer test-user-token",
    );
    if (fail) {
      runs = [
        {
          started_at: new Date().toISOString(),
          status: "failed",
          found_count: 0,
          proposed_count: 0,
          api_units: 1,
          error_code: "YOUTUBE_QUOTA",
          error_message: "YouTube API đã hết hạn mức.",
          warnings: [],
        },
      ];
      return route.fulfill({
        status: 429,
        json: { error: "YouTube API đã hết hạn mức." },
        headers: { "access-control-allow-origin": "*" },
      });
    }
    proposals = [0, 1].map((i) => ({
      youtube_id: `video00000${i}`,
      status: "suggested",
      sources: ["Kênh: Example"],
      data: {
        title: `Nghiên cứu thật khi có API ${i}`,
        channel: "Example",
        published_at: "2026-11-01T00:00:00Z",
        url: `https://www.youtube.com/watch?v=video00000${i}`,
        views: 10000,
        likes: null,
        comments: 200,
      },
      analysis: {
        score: 50,
        confidence: "limited",
        eligible: true,
        reasons: ["Lượt xem bằng 3× nhóm so sánh."],
        angle: "Góc nhìn với dữ liệu riêng.",
      },
    }));
    runs = [
      {
        started_at: new Date().toISOString(),
        status: "succeeded",
        found_count: 2,
        proposed_count: 2,
        api_units: 3,
        warnings: [],
      },
    ];
    return route.fulfill({
      json: { found: 2, proposed: 2 },
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
  await page.locator("[name=email]").fill(user.email);
  await page.locator("[name=password]").fill("example-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.locator(".research-shortcut").click();
  await page.getByRole("button", { name: "Quét ngay", exact: true }).click();
  await expect(page.locator(".proposal-card")).toHaveCount(2);
  await expect(page.locator(".run-panel")).toContainText("Hoàn tất");
  expect(calls).toBe(1);
  await page.locator("#research-select-all").check();
  await page
    .getByRole("button", { name: "Chuyển vào Kho ý tưởng", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(0);
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /Ý tưởng/ })
    .click();
  await expect(page.locator(".video-row")).toHaveCount(2);
  await page.locator(".research-shortcut").click();
  fail = true;
  await page.getByRole("button", { name: "Quét ngay", exact: true }).click();
  await expect(page.locator("#research-status")).toContainText("hết hạn mức");
  await expect(page.locator(".run-panel")).toContainText("YOUTUBE_QUOTA");
  expect(videos).toHaveLength(2);
});
