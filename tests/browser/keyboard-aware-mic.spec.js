import { test, expect } from "@playwright/test";

async function mockKeyboardAndSpeech(page) {
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    viewport.height = 844;
    viewport.width = 390;
    viewport.offsetTop = 0;
    viewport.offsetLeft = 0;
    try {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        get: () => viewport,
      });
    } catch {
      // The fallback test below separately verifies missing visualViewport.
    }
    window.testVisualViewport = viewport;
    window.setTestKeyboard = ({ height, offsetTop = 0, width = viewport.width }) => {
      viewport.height = height;
      viewport.offsetTop = offsetTop;
      viewport.width = width;
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    };
    window.recognizers = [];
    class FakeSpeechRecognition {
      start() {
        window.recognizers.push(this);
        this.onstart?.();
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
      emit(text) {
        this.onresult?.({
          results: [{ 0: { transcript: text }, isFinal: true }],
        });
      }
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  });
}

async function openIdea(page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("#new-idea-title").fill("Kiên trì và hành động");
  await page.locator("#new-idea-content").fill("Tôi bắt đầu hôm nay");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await page.locator(".video-main").first().click();
}

test("iPhone 16 Pro Max viewport: mic rises above keyboard when caret enters idea text and preserves insertion point", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await mockKeyboardAndSpeech(page);
  await openIdea(page);

  const field = page.locator("#idea-content");
  const mic = page.locator(".idea-dictation-float");
  await expect(mic).toBeVisible();
  await field.evaluate((el) => {
    el.focus();
    el.setSelectionRange(4, 4);
  });

  await page.evaluate(() => window.setTestKeyboard({
    width: 440, height: 475, offsetTop: 22,
  }));
  await expect(mic).toHaveClass(/keyboard-mic-visible/);
  await expect(mic).toHaveCSS("position", "fixed");
  const box = await mic.boundingBox();
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThan(300);
  expect(box.y + box.height).toBeLessThanOrEqual(22 + 475 - 10);

  // Simulate a user tapping the lifted mic while the keyboard is still open.
  await mic.click();
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => window.recognizers.at(-1).emit("nói thật"));
  await expect(field).toHaveValue("Tôi nói thật bắt đầu hôm nay");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  await expect(mic).toHaveClass(/keyboard-mic-visible/);
  await mic.click();
  await expect(mic).toHaveAttribute("aria-pressed", "false");
});

test("mic follows Safari visual viewport scroll and restores original bottom when keyboard closes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockKeyboardAndSpeech(page);
  await openIdea(page);
  const field = page.locator("#idea-content");
  const mic = page.locator(".idea-dictation-float");
  await field.evaluate((el) => {
    el.style.height = "1900px";
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.evaluate(() => window.setTestKeyboard({
    width: 390, height: 390, offsetTop: 110,
  }));
  await expect(mic).toHaveClass(/keyboard-mic-visible/);
  let buttonTop = await mic.evaluate(el => el.getBoundingClientRect().top);
  expect(Math.abs(buttonTop - (110 + 390 - 55 - 14))).toBeLessThanOrEqual(2);

  await page.evaluate(() => window.setTestKeyboard({
    width: 390, height: 460, offsetTop: 45,
  }));
  await expect.poll(() => mic.evaluate(el => el.getBoundingClientRect().top))
    .toBe(45 + 460 - 55 - 14);

  // WebKit can leave stale offsetTop after dismissal. Full height must win.
  await page.evaluate(() => window.setTestKeyboard({
    width: 390, height: 844, offsetTop: 24,
  }));
  await expect(mic).not.toHaveClass(/keyboard-mic-visible/);
  await expect(mic).toHaveCSS("position", "fixed");
  await expect(mic).not.toHaveCSS("bottom", "auto");
  await expect(page.locator("#idea-content")).toHaveValue("Tôi bắt đầu hôm nay");
});

test("add-idea dialog microphone also remains above keyboard without losing text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockKeyboardAndSpeech(page);
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  const mic = page.locator("#dialog .voice-icon-only");
  const field = page.locator("#new-idea-content");
  await field.fill("Nội dung chuẩn bị ghi âm");
  await field.evaluate(el => el.setSelectionRange(8, 8));
  await page.evaluate(() => window.setTestKeyboard({
    width: 390, height: 415, offsetTop: 15,
  }));
  await expect(mic).toHaveClass(/keyboard-mic-visible/);
  await expect(mic).toHaveCSS("position", "fixed");
  const box = await mic.boundingBox();
  expect(box).toBeTruthy();
  expect(box.y + box.height).toBeLessThan(15 + 415);
  await mic.click();
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
  await page.evaluate(() => window.recognizers.at(-1).emit("tuyệt vời"));
  await expect(field).toHaveValue("Nội dung tuyệt vời chuẩn bị ghi âm");
});

test("rotating to touch landscape recalculates keyboard position rather than keeping portrait height", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Landscape iPhone requires a touch device");
  await page.setViewportSize({ width: 390, height: 844 });
  await mockKeyboardAndSpeech(page);
  await openIdea(page);
  const field = page.locator("#idea-content");
  const mic = page.locator(".idea-dictation-float");
  await field.focus();
  await page.evaluate(() => window.setTestKeyboard({
    width: 390, height: 435,
  }));
  await expect(mic).toHaveClass(/keyboard-mic-visible/);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => window.setTestKeyboard({
    width: 844, height: 390,
  }));
  await expect(mic).not.toHaveClass(/keyboard-mic-visible/);
  await page.evaluate(() => window.setTestKeyboard({
    width: 844, height: 205, offsetTop: 15,
  }));
  await expect(mic).toHaveClass(/keyboard-mic-visible/);
  const box = await mic.boundingBox();
  expect(box.y + box.height).toBeLessThan(15 + 205);
});
