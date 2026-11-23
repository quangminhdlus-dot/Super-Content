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
  await a.locator("#new-idea-title").fill("Video chung");
  await a.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await expect.poll(() => server.size).toBe(1);
  const b = await client("a@example.com", true);
  await expect(b.locator(".video-row")).toHaveCount(1);
  await b.locator(".video-main").click();
  await a.locator(".video-main").click();
  await a.locator("#idea-content").fill("Bản mới trên máy chủ");
  await expect
    .poll(() => [...server.values()][0].notes)
    .toBe("Bản mới trên máy chủ");
  failSecond = true;
  await b.locator("#idea-content").fill("Bản thiết bị chưa đồng bộ");
  await expect(b.locator("#save-state")).toContainText("Đã lưu");
  await expect(b.locator("[data-status]").first()).toContainText(
    "Chưa đồng bộ",
  );
  await b.reload();
  await b.locator(".video-main").click();
  await expect(b.locator("#idea-content")).toHaveValue("Bản thiết bị chưa đồng bộ");
  failSecond = false;
  await b.locator(".local-notice button").click();
  await expect(b.locator("[data-status]").first()).toContainText("xung đột");
  await b.getByRole("button", { name: "Cài đặt", exact: true }).click();
  b.once("dialog", (d) => d.accept());
  await b
    .getByRole("button", { name: "Giữ bản thiết bị", exact: true })
    .click();
  await expect
    .poll(() => [...server.values()][0].notes)
    .toBe("Bản thiết bị chưa đồng bộ");
  const other = await client("b@example.com");
  await expect(other.locator(".video-row")).toHaveCount(0);
  // Real Chromium MediaRecorder + authenticated client + existing autosave/sync path.
  await a.reload();
  await a.locator(".video-main").click();
  await a.locator("#idea-content").fill("Giữ bản gốc");
  await expect.poll(() => [...server.values()][0].notes).toBe("Giữ bản gốc");
  let recordedType, recordedBytes;
  await a.route("https://research-api.example/api/voice/**", async (route) => {
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    if (route.request().url().endsWith("transcribe")) {
      recordedType = route.request().headers()["content-type"];
      recordedBytes = route.request().postDataBuffer();
      return route.fulfill({ json: { original: "ừ thêm ý này" } });
    }
    return route.fulfill({ json: { polished: "Thêm ý này." } });
  });
  await a.evaluate(() => {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const destination = audio.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    window.voiceTestAudio = audio;
    window.voiceTestStream = destination.stream;
    window.voiceTestBytes = 0;
    const NativeRecorder = window.MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder {
      constructor(...args) {
        super(...args);
        this.addEventListener("dataavailable", (event) => {
          window.voiceTestBytes += event.data.size;
        });
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      await audio.resume();
      return destination.stream;
    };
    const script = document.querySelector("#idea-content");
    script.focus();
    script.setSelectionRange(0, 0);
  });
  await a.setViewportSize({ width: 390, height: 844 });
  await a
    .getByRole("button", { name: "Ghi âm cho Nội dung ý tưởng", exact: true })
    .click();
  await expect(a.getByRole("button", { name: "Dừng & nhận dạng" })).toBeVisible();
  await expect(a.getByRole("button", { name: "Ghi lại" })).toBeHidden();
  await expect(a.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "recording");
  await expect(a.locator("#voice-clock")).toBeVisible();
  await expect(a.locator("#voice-elapsed")).toHaveText(/^[0-2]:\d\d$/);
  await expect(a.locator("#voice-limit")).toHaveText("10:00");
  await expect(a.locator("#voice-dialog .voice-orbit")).toBeVisible();
  await expect(a.locator("#voice-dialog .voice-bars")).toHaveCount(2);
  await expect(a.getByRole("button", { name: "Dừng & nhận dạng" })).toHaveText("");
  await expect(a.locator("#voice-status")).toBeHidden();
  // Wait for actual encoded data, not AudioContext time that may predate recording.
  await expect
    .poll(() => a.evaluate(() => window.voiceTestBytes))
    .toBeGreaterThan(0);
  await a
    .getByRole("button", { name: "Dừng & nhận dạng", exact: true })
    .click();
  await expect(a.locator("#voice-polished")).toHaveValue("Thêm ý này.");
  await expect(a.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "review");
  await expect(a.locator("#voice-clock")).toBeHidden();
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.screenshot({ path: "test-results/voice-review.png", fullPage: true });
  await expect(a.locator("#idea-content")).toHaveValue("Giữ bản gốc");
  expect(recordedType).toMatch(/^audio\/webm/);
  expect(recordedBytes.subarray(0, 4)).toEqual(Buffer.from([26, 69, 223, 163]));
  expect(
    await a.evaluate(() =>
      window.voiceTestStream
        .getTracks()
        .every((track) => track.readyState === "ended"),
    ),
  ).toBe(true);
  await a
    .getByRole("button", { name: "Chèn tại con trỏ", exact: true })
    .click();
  await expect
    .poll(() => [...server.values()][0].notes)
    .toBe("Thêm ý này. Giữ bản gốc");
  expect(await a.locator("#idea-content").evaluate((el) => el.selectionStart)).toBe(
    12,
  );
  // One-tap microphone creates an entirely new idea without opening the add form.
  const beforeQuick = await a.evaluate(() => window.voiceTestBytes);
  await a.getByRole("button", { name: "Ghi ý tưởng nhanh" }).click();
  await expect(a.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "recording");
  await expect(a.locator("#voice-limit")).toHaveText("10:00");
  await expect.poll(() => a.evaluate(() => window.voiceTestBytes)).toBeGreaterThan(beforeQuick);
  await a.getByRole("button", { name: "Dừng & nhận dạng" }).click();
  await expect(a.locator("#voice-polished")).toHaveValue("Thêm ý này.");
  await expect(a.locator("#voice-dialog .voice-versions [data-voice=replace]")).toBeHidden();
  await a.getByRole("button", { name: "Lưu ý tưởng", exact: true }).click();
  await expect.poll(() => server.size).toBe(2);
  await expect(a.locator(".page-heading h1")).toContainText("Kho ý tưởng");
  await expect(a.locator(".video-row")).toHaveCount(2);
  await expect(a.locator(".video-row")).toContainText("Thêm ý này.");
  await a.evaluate(() => window.voiceTestAudio.close());
  await a.reload();
  await a.locator(".video-main").click();
  await expect(a.locator("#idea-content")).toHaveValue("Thêm ý này. Giữ bản gốc");
  for (const context of clients) await context.close();
});
