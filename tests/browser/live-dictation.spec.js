import { test, expect } from "@playwright/test";

async function mockRecognition(page) {
  await page.addInitScript(() => {
    window.liveInstances = [];
    class FakeSpeechRecognition {
      constructor() {
        this.continuous = false;
        this.interimResults = false;
        this.lang = "";
        this.stopped = false;
      }
      start() {
        window.liveInstances.push(this);
        this.onstart?.();
      }
      stop() {
        this.stopped = true;
        this.onend?.();
      }
      abort() {
        this.stopped = true;
        this.onend?.();
      }
      emit(text, final = false) {
        this.onresult?.({ results: [{ 0: { transcript: text }, isFinal: final }] });
      }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  });
}

test("iPhone: add-idea microphone types interim words directly in textarea and saves without opening modal", async ({ page }) => {
  await mockRecognition(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  const content = page.locator("#new-idea-content");
  await page.locator("#new-idea-title").fill("Thói quen hành động");
  await content.fill("Tôi muốn nói rằng");
  await content.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  const start = page.getByRole("button", { name: "Bắt đầu nhập giọng nói cho Nội dung ý tưởng" });
  await start.click();
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dừng nhập giọng nói cho Nội dung ý tưởng" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => ({
    lang: window.liveInstances.at(-1).lang,
    continuous: window.liveInstances.at(-1).continuous,
    interim: window.liveInstances.at(-1).interimResults,
  }))).toEqual({ lang: "vi-VN", continuous: true, interim: true });

  await page.evaluate(() => window.liveInstances.at(-1).emit("hành động", false));
  await expect(content).toHaveValue("Tôi muốn nói rằng hành động");
  await page.evaluate(() => window.liveInstances.at(-1).emit("hành động tạo nên động lực.", true));
  await expect(content).toHaveValue("Tôi muốn nói rằng hành động tạo nên động lực.");
  await page.getByRole("button", { name: "Dừng nhập giọng nói cho Nội dung ý tưởng" }).click();
  await expect(start).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#voice-dialog")).toHaveCount(0);

  // A second spoken segment is appended after keyboard editing, not written into the title.
  await content.fill("Tôi muốn nói rằng hành động tạo nên động lực. Sự kiên trì");
  await content.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
  await start.click();
  await page.evaluate(() => window.liveInstances.at(-1).emit("là một kỹ năng.", true));
  await expect(content).toHaveValue("Tôi muốn nói rằng hành động tạo nên động lực. Sự kiên trì là một kỹ năng.");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await expect(page.locator("#dialog")).not.toBeVisible();
  await page.locator(".video-main").first().click();
  await expect(page.locator("#video-title")).toHaveValue("Thói quen hành động");
  await expect(page.locator("#idea-content")).toHaveValue("Tôi muốn nói rằng hành động tạo nên động lực. Sự kiên trì là một kỹ năng.");
  await page.reload();
  await page.locator(".video-main").first().click();
  await expect(page.locator("#idea-content")).toHaveValue("Tôi muốn nói rằng hành động tạo nên động lực. Sự kiên trì là một kỹ năng.");
});

test("existing idea: final dictation persists, interim preview never overwrites typed content", async ({ page }) => {
  await mockRecognition(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("#new-idea-title").fill("Ý tưởng nguyên bản");
  await page.locator("#new-idea-content").fill("Mở đầu ");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await page.locator(".video-main").first().click();
  const content = page.locator("#idea-content");
  await content.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.getByRole("button", { name: "Bắt đầu nhập giọng nói cho Nội dung ý tưởng" }).click();
  await page.evaluate(() => window.liveInstances.at(-1).emit("thói quen thay đổi", false));
  await expect(content).toHaveValue("Mở đầu thói quen thay đổi");
  await page.evaluate(() => window.liveInstances.at(-1).emit("thói quen thay đổi cuộc đời.", true));
  await expect(content).toHaveValue("Mở đầu thói quen thay đổi cuộc đời.");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");

  // Typing during recognition terminates speech safely; late recognition output
  // is ignored and cannot replace the user's later keyboard edits.
  await content.fill("Mở đầu thói quen thay đổi cuộc đời. Gõ thêm.");
  await expect(page.getByRole("button", { name: "Bắt đầu nhập giọng nói cho Nội dung ý tưởng" })).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => window.liveInstances.at(-1).emit("Đoạn đến muộn", true));
  await expect(content).toHaveValue("Mở đầu thói quen thay đổi cuộc đời. Gõ thêm.");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  await page.reload();
  await page.locator(".video-main").first().click();
  await expect(page.locator("#idea-content")).toHaveValue("Mở đầu thói quen thay đổi cuộc đời. Gõ thêm.");
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
});

test("unsupported dictation falls back to iPhone keyboard microphone without audio modal", async ({ page }) => {
  await page.addInitScript(() => {
    // Explicitly suppress any native browser recognition constructor.
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  });
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.getByRole("button", { name: "Bắt đầu nhập giọng nói cho Nội dung ý tưởng" }).click();
  await expect(page.locator(".live-dictation-status")).toContainText("micro trên bàn phím");
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
});
