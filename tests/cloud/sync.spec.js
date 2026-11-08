import { test, expect } from "@playwright/test";
test("two browser sessions: sync, durable failed writes, conflict resolution, account separation (mock API)", async ({
  browser,
}) => {
  const server = new Map(),
    clients = [];
  let failSecond = false;
  async function client(email, second = false) {
    const context = await browser.newContext();
    clients.push(context);
    const id = email.startsWith("a")
      ? "00000000-0000-0000-0000-000000000001"
      : "00000000-0000-0000-0000-000000000002";
    const user = {
      id,
      email,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    };
    await context.route(
      "https://content-test.supabase.co/**",
      async (route) => {
        const request = route.request(),
          url = request.url();
        const reply = (data) =>
          route.fulfill({
            json: data,
            headers: { "access-control-allow-origin": "*" },
          });
        if (second && failSecond && url.includes("/rest/"))
          return route.abort("failed");
        if (url.includes("/auth/v1/token")) {
          const token = [
            "eyJhbGciOiJIUzI1NiJ9",
            Buffer.from(
              JSON.stringify({
                sub: id,
                exp: Math.floor(Date.now() / 1000) + 3600,
              }),
            ).toString("base64url"),
            "signature",
          ].join(".");
          return reply({
            access_token: token,
            refresh_token: "test-refresh",
            expires_in: 3600,
            token_type: "bearer",
            user,
          });
        }
        if (url.includes("/auth/v1/user")) return reply(user);
        if (url.includes("/rpc/save_content_video")) {
          const { payload, expected_revision } = request.postDataJSON(),
            old = server.get(payload.id);
          if (payload.user_id !== id)
            return route.fulfill({ status: 403, json: { message: "denied" } });
          if ((old?.revision || 0) !== expected_revision) return reply([]);
          const next = { ...payload, revision: expected_revision + 1 };
          server.set(next.id, next);
          return reply([next]);
        }
        if (url.includes("/rest/v1/content_videos"))
          return reply([...server.values()].filter((v) => v.user_id === id));
        return reply({});
      },
    );
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4175/super-content/");
    await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
    await page.locator("[name=email]").fill(email);
    await page.locator("[name=password]").fill("example-password");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page.locator("dialog")).not.toBeVisible();
    await expect(page.locator("[data-status]").first()).toHaveText(
      "Đã đồng bộ",
    );
    return page;
  }
  const a = await client("a@example.com");
  await a.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await a.locator("[name=titles]").fill("Video chung");
  await a.getByRole("button", { name: "Thêm vào kho ý tưởng" }).click();
  await expect.poll(() => server.size).toBe(1);
  const b = await client("a@example.com", true);
  await expect(b.locator(".video-row")).toHaveCount(1);
  await b.locator(".video-main").click();
  await a.locator(".video-main").click();
  await a.locator("#script").fill("Bản mới trên máy chủ");
  await expect
    .poll(() => [...server.values()][0].script)
    .toBe("Bản mới trên máy chủ");
  failSecond = true;
  await b.locator("#script").fill("Bản thiết bị chưa đồng bộ");
  await expect(b.locator("#save-state")).toContainText("Đã lưu");
  await expect(b.locator("[data-status]").first()).toContainText(
    "Chưa đồng bộ",
  );
  await b.reload();
  await b.locator(".video-main").click();
  await expect(b.locator("#script")).toHaveValue("Bản thiết bị chưa đồng bộ");
  failSecond = false;
  await b.locator(".local-notice button").click();
  await expect(b.locator("[data-status]").first()).toContainText("xung đột");
  await b.getByRole("button", { name: "Cài đặt", exact: true }).click();
  b.once("dialog", (d) => d.accept());
  await b
    .getByRole("button", { name: "Giữ bản thiết bị", exact: true })
    .click();
  await expect
    .poll(() => [...server.values()][0].script)
    .toBe("Bản thiết bị chưa đồng bộ");
  const other = await client("b@example.com");
  await expect(other.locator(".video-row")).toHaveCount(0);
  for (const context of clients) await context.close();
});
