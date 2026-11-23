import { test, expect } from "@playwright/test";

test("choosing one of three title suggestions hides other two and keeps the chosen one", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(async () => {
    const { collapseTitleChoices, revealTitleChoices } = await import("/super-content/src/title-choices.js");
    const host = document.createElement("section");
    host.id = "title-choices-test";
    const title = document.createElement("input");
    title.id = "test-video-title";
    const group = document.createElement("div");
    group.className = "title-option-list";
    const reopen = document.createElement("button");
    reopen.className = "title-choice-reopen";
    reopen.hidden = true;
    for (let i = 1; i <= 3; i++) {
      const button = document.createElement("button");
      button.className = "title-option";
      button.textContent = "Tiêu đề " + i;
      button.addEventListener("click", () => {
        title.value = button.textContent;
        title.dispatchEvent(new Event("input", { bubbles: true }));
        collapseTitleChoices(group, button, reopen);
      });
      group.append(button);
    }
    reopen.addEventListener("click", () => revealTitleChoices(group, reopen));
    host.append(title, group, reopen);
    document.body.append(host);
  });

  const options = page.locator("#title-choices-test .title-option");
  const reopen = page.locator("#title-choices-test .title-choice-reopen");
  await expect(options).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(options.nth(i)).toBeVisible();
  await options.nth(1).click();

  await expect(page.locator("#test-video-title")).toHaveValue("Tiêu đề 2");
  await expect(options.nth(0)).toBeHidden();
  await expect(options.nth(1)).toBeVisible();
  await expect(options.nth(2)).toBeHidden();
  await expect(options.nth(1)).toHaveClass(/selected/);
  await expect(options.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(reopen).toBeVisible();
  await expect(reopen).toHaveText("Xem lại 3 tiêu đề");

  // Trigger directly: this isolated fixture is appended outside the app layout,
  // where unrelated fixed navigation can intercept pointer actionability.
  await reopen.evaluate((element) => element.click());
  for (let i = 0; i < 3; i++) await expect(options.nth(i)).toBeVisible();
  await expect(reopen).toBeHidden();
  await options.nth(2).evaluate((element) => element.click());
  await expect(page.locator("#test-video-title")).toHaveValue("Tiêu đề 3");
  await expect(options.nth(0)).toBeHidden();
  await expect(options.nth(1)).toBeHidden();
  await expect(options.nth(2)).toBeVisible();
  await expect(reopen).toBeVisible();
});

test("single title suggestion does not show a redundant reopen control", async ({ page }) => {
  await page.goto("./");
  const state = await page.evaluate(async () => {
    const { collapseTitleChoices } = await import("/super-content/src/title-choices.js");
    const group = document.createElement("div");
    const chosen = document.createElement("button");
    chosen.className = "title-option";
    group.append(chosen);
    const reopen = document.createElement("button");
    reopen.hidden = true;
    collapseTitleChoices(group, chosen, reopen);
    return { chosenHidden: chosen.hidden, isSelected: chosen.classList.contains("selected"), reopenHidden: reopen.hidden };
  });
  expect(state).toEqual({ chosenHidden: false, isSelected: true, reopenHidden: true });
});


test("Super Content editor: selecting a researched title hides the other choices and saves the selection", async ({ page }) => {
  const rows = new Map();
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    email: "editor@example.com",
    aud: "authenticated", role: "authenticated",
    app_metadata: {}, user_metadata: {},
    created_at: new Date().toISOString(),
  };
  await page.route("https://content-test.supabase.co/**", route => {
    const request = route.request(), url = request.url();
    const reply = (data) => route.fulfill({
      json: data,
      headers: { "access-control-allow-origin": "*" },
    });
    if (url.includes("/auth/v1/token")) {
      const jwt = [
        "eyJhbGciOiJIUzI1NiJ9",
        Buffer.from(JSON.stringify({
          sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600,
        })).toString("base64url"),
        "signature",
      ].join(".");
      return reply({ access_token: jwt, refresh_token: "refresh", expires_in: 3600, token_type: "bearer", user });
    }
    if (url.includes("/auth/v1/user")) return reply(user);
    if (url.includes("/rpc/save_content_video")) {
      const { payload, expected_revision } = request.postDataJSON();
      const before = rows.get(payload.id);
      if ((before?.revision || 0) !== expected_revision) return reply([]);
      const updated = { ...payload, revision: expected_revision + 1 };
      rows.set(updated.id, updated);
      return reply([updated]);
    }
    if (url.includes("/rest/v1/content_videos")) return reply([...rows.values()]);
    return reply({});
  });
  let titleRequests = 0;
  await page.route("https://research-api.example/api/voice/title", route => {
    titleRequests++;
    return route.fulfill({
      json: {
        title: "Vì sao chờ động lực khiến bạn không hành động?",
        alternatives: [
          "Hành động trước, động lực sẽ đến sau",
          "Cái giá của việc đợi đến khi có hứng thú",
        ],
        framework: "Nghịch lý",
        explanation: "Đảo ngược kỳ vọng về mối quan hệ giữa động lực và hành động.",
        research: { status: "unavailable", sampledVideos: 0 },
      },
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
  await page.locator("[name=email]").fill("editor@example.com");
  await page.locator("[name=password]").fill("password123");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("#new-idea-title").fill("Tiêu đề ban đầu");
  await page.locator("#new-idea-content").fill("Đừng chờ động lực mới hành động. Hãy làm ngay.");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await page.locator(".video-main").first().click();
  await page.getByRole("button", { name: "Nghiên cứu & gợi ý 3 tiêu đề" }).click();
  await expect(page.locator(".title-option")).toHaveCount(3);
  await expect.poll(() => titleRequests).toBe(1);
  await page.getByRole("button", { name: "Dùng tiêu đề 2" }).click();
  await expect(page.locator("#video-title")).toHaveValue("Hành động trước, động lực sẽ đến sau");
  await expect(page.getByRole("button", { name: "Dùng tiêu đề 1" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Dùng tiêu đề 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dùng tiêu đề 3" })).toBeHidden();
  await expect(page.locator(".title-choice-reopen")).toBeVisible();
  await expect.poll(() => [...rows.values()][0]?.title).toBe("Hành động trước, động lực sẽ đến sau");

  await page.locator(".title-choice-reopen").click();
  await expect(page.getByRole("button", { name: "Dùng tiêu đề 3" })).toBeVisible();
  await page.getByRole("button", { name: "Dùng tiêu đề 3" }).click();
  await expect(page.locator("#video-title")).toHaveValue("Cái giá của việc đợi đến khi có hứng thú");
  await expect(page.getByRole("button", { name: "Dùng tiêu đề 1" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Dùng tiêu đề 2" })).toBeHidden();
  await expect.poll(() => [...rows.values()][0]?.title).toBe("Cái giá của việc đợi đến khi có hứng thú");
});
