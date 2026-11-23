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
    // Browser speech recognition is now used inside the idea editor.
    window.webkitSpeechRecognition = class {
      constructor() { this.interimResults = false; this.continuous = false; }
      start() { window.inlineSpeech = this; this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    };
    window.SpeechRecognition = window.webkitSpeechRecognition;
    const script = document.querySelector("#idea-content");
    script.focus();
    script.setSelectionRange(0, 0);
  });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.getByRole("button", { name: "Bắt đầu nhập giọng nói cho Nội dung ý tưởng" }).click();
  await expect(a.locator("#voice-dialog")).toHaveCount(0);
  await expect(a.getByRole("button", { name: "Dừng nhập giọng nói cho Nội dung ý tưởng" })).toHaveAttribute("aria-pressed", "true");
  await a.evaluate(() => {
    window.inlineSpeech.onresult?.({
      results: [{ 0: { transcript: "Thêm ý" }, isFinal: false }],
    });
  });
  await expect(a.locator("#idea-content")).toHaveValue("Thêm ý Giữ bản gốc");
  await a.evaluate(() => {
    window.inlineSpeech.onresult?.({
      results: [{ 0: { transcript: "Thêm ý này." }, isFinal: true }],
    });
  });
  await expect(a.locator("#idea-content")).toHaveValue("Thêm ý này. Giữ bản gốc");
  await a.getByRole("button", { name: "Dừng nhập giọng nói cho Nội dung ý tưởng" }).click();
  await expect(a.getByRole("button", { name: "Bắt đầu nhập giọng nói cho Nội dung ý tưởng" })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => [...server.values()][0].notes).toBe("Thêm ý này. Giữ bản gốc");
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.screenshot({ path: "test-results/live-dictation-review.png", fullPage: true });
  // One-tap microphone creates an entirely new idea without opening the add form.
  await a.evaluate(() => {
    const oscillator = window.voiceTestAudio.createOscillator();
    const output = window.voiceTestAudio.createMediaStreamDestination();
    oscillator.connect(output);
    oscillator.start();
    window.voiceTestStream = output.stream;
    navigator.mediaDevices.getUserMedia = async () => output.stream;
  });
  const beforeQuick = await a.evaluate(() => window.voiceTestBytes);
  // Floating capture is intentionally available only on the Ideas list, not inside editors.
  await a.locator("[data-action=back]").click();
  await expect(a.getByRole("button", { name: "Ghi ý tưởng nhanh" })).toBeVisible();
  await a.getByRole("button", { name: "Ghi ý tưởng nhanh" }).click();
  await expect(a.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "recording");
  await expect(a.locator("#voice-limit")).toHaveText("10:00");
  // Regression: background cloud sync must never discard an ongoing recording.
  await a.evaluate(() => {
    window.unexpectedVoiceDiscardPrompts = 0;
    const previousConfirm = window.confirm.bind(window);
    window.confirm = (msg) => {
      if (String(msg).includes("Bản ghi chưa được lưu")) {
        window.unexpectedVoiceDiscardPrompts++;
        return false;
      }
      return previousConfirm(msg);
    };
    window.dispatchEvent(new Event("online"));
  });
  await a.waitForTimeout(1800);
  await expect(a.locator("#voice-dialog")).toHaveAttribute("data-voice-phase", "recording");
  expect(await a.locator("#quick-idea-content").evaluate((el) => el.isConnected)).toBe(true);
  expect(await a.evaluate(() => window.unexpectedVoiceDiscardPrompts)).toBe(0);
  await expect.poll(() => a.evaluate(() => window.voiceTestBytes)).toBeGreaterThan(beforeQuick);
  await a.getByRole("button", { name: "Gửi bản ghi" }).click();
  // Single tap finishes capture, saves polished text, and returns to the ideas inbox.
  await expect(a.locator("#voice-dialog")).toHaveCount(0);
  expect(recordedType).toMatch(/^audio\/webm/);
  expect(recordedBytes.subarray(0, 4)).toEqual(Buffer.from([26, 69, 223, 163]));
  await expect.poll(() => server.size).toBe(2);
  await expect(a.locator(".page-heading h1")).toContainText("Kho ý tưởng");
  await expect(a.locator(".video-row")).toHaveCount(2);
  await expect(a.locator(".video-row").first()).toContainText("Thêm ý này.");
  await expect.poll(() => [...server.values()].find(v => v.title !== "Video chung")?.title?.length || 0).toBeGreaterThan(0);
  const quickSaved = [...server.values()].find(v => v.title !== "Video chung");
  expect(quickSaved.notes).toBe("Thêm ý này.");
  expect(quickSaved.published_at).toBeNull();
  await a.evaluate(() => window.voiceTestAudio.close());
  await a.reload();
  await a.locator(".video-main").filter({ hasText: "Video chung" }).click();
  await expect(a.locator("#idea-content")).toHaveValue("Thêm ý này. Giữ bản gốc");
  for (const context of clients) await context.close();
});
