import { test, expect } from "@playwright/test";

test("ideas just moved to scripts precede older transitions after reload", async ({page}) => {
  await page.goto("./");
  const text = "Đoạn thứ nhất.  \n\n  Đoạn thứ hai.";
  for (const name of ["Ý tưởng A", "Ý tưởng B"]) {
    await page.getByRole("button", {name:"Thêm ý tưởng", exact:true}).click();
    await page.locator("#new-idea-title").fill(name);
    await page.locator("#new-idea-content").fill("Nội dung ban đầu");
    await page.getByRole("button", {name:"Lưu ý tưởng"}).click();
  }
  for (const name of ["Ý tưởng B", "Ý tưởng A"]) {
    await page.locator('[data-view="ideas"]:visible').click();
    await page.locator(".video-main").filter({hasText:name}).click();
    await page.locator("#idea-content").fill(text);
    await page.getByRole("button", {name:"Chuyển sang Kịch bản"}).click();
    await expect(page.locator("#script")).toHaveValue(text);
  }
  await page.reload();
  await page.locator('[data-view="script"]:visible').click();
  await expect(page.locator(".video-main strong")).toHaveText(["Ý tưởng A","Ý tưởng B"]);
  await page.locator(".video-main").first().click();
  await expect(page.locator("#script")).toHaveValue(text);
});

async function fakeSpeech(page) {
  await page.addInitScript(() => {
    window.dictations = [];
    class Recognition {
      start() {
        window.dictations.push(this);
        this.onstart?.();
      }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
      emit(text, final = false) {
        this.onresult?.({
          results: [{ 0: { transcript: text }, isFinal: final }],
        });
      }
    }
    window.SpeechRecognition = Recognition;
    window.webkitSpeechRecognition = Recognition;
  });
}

async function createIdea(page) {
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("#new-idea-title").fill("Giữ nội dung ý tưởng");
  await page.locator("#new-idea-content").fill("Đây là nội dung ban đầu.");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await page.locator(".video-main").first().click();
}

test("iPhone: idea microphone stays reachable at bottom-right while long content scrolls", async ({ page }) => {
  await fakeSpeech(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await createIdea(page);
  const content = page.locator("#idea-content");
  const mic = page.getByRole("button", { name: "Bắt đầu nhập giọng nói cho Nội dung ý tưởng" });
  await expect(mic).toHaveClass(/idea-dictation-float/);
  await expect(page.locator(".script-toolbar .voice-mic")).toHaveCount(0);
  await content.evaluate(el => {
    el.style.height = "1900px";
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    window.scrollTo(0, document.body.scrollHeight);
  });
  await expect(mic).toHaveCSS("position", "fixed");
  const micBox = await mic.boundingBox();
  const navBox = await page.locator(".mobile-nav").boundingBox();
  expect(micBox).toBeTruthy();
  expect(navBox).toBeTruthy();
  expect(micBox.x).toBeGreaterThan(300);
  expect(micBox.y + micBox.height).toBeLessThan(navBox.y);

  await mic.click();
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
  await page.evaluate(() => window.dictations.at(-1).emit(" đọc nội dung", false));
  await expect(content).toHaveValue("Đây là nội dung ban đầu. đọc nội dung");
  await page.evaluate(() => window.dictations.at(-1).emit(" đọc nội dung thật.", true));
  await expect(content).toHaveValue("Đây là nội dung ban đầu. đọc nội dung thật.");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
});

test("next-stage button is below the idea textarea and opens the same item in script without losing idea text", async ({ page }) => {
  await fakeSpeech(page);
  await page.setViewportSize({ width: 440, height: 956 });
  await createIdea(page);
  const input = page.locator("#idea-content");
  await input.fill("Ý tưởng đã soạn. Có thêm luận điểm quan trọng.");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  const next = page.getByRole("button", { name: "Chuyển sang Kịch bản" });
  await expect(next).toBeVisible();
  const order = await page.evaluate(() => {
    const textarea = document.querySelector("#idea-content");
    const action = document.querySelector(".idea-next-stage");
    return textarea.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
  await next.click();
  await expect(page.locator("#script")).toBeVisible();
  await expect(page.locator("#video-title")).toHaveValue("Giữ nội dung ý tưởng");
  await expect(page.locator("#script")).toHaveValue("Ý tưởng đã soạn. Có thêm luận điểm quan trọng.");
  await expect(page.locator("[data-field=notes]")).toHaveValue("");
  await expect(page.locator(".idea-next-stage")).toHaveCount(0);
  await page.locator("#script").fill("Kịch bản triển khai từ ý tưởng.");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  await page.reload();
  await page.locator('.mobile-nav [data-view="script"]').click();
  await page.locator(".video-main").first().click();
  await expect(page.locator("#script")).toHaveValue("Kịch bản triển khai từ ý tưởng.");
  await expect(page.locator("[data-field=notes]")).toHaveValue("");
});

test("moving to script while live dictation is active flushes visible interim text first", async ({ page }) => {
  await fakeSpeech(page);
  await createIdea(page);
  const input = page.locator("#idea-content");
  await input.evaluate(el => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  await page.getByRole("button", { name: "Bắt đầu nhập giọng nói cho Nội dung ý tưởng" }).click();
  await page.evaluate(() => window.dictations.at(-1).emit(" và đoạn đang đọc", false));
  await expect(input).toHaveValue("Đây là nội dung ban đầu. và đoạn đang đọc");
  await page.getByRole("button", { name: "Chuyển sang Kịch bản" }).click();
  await expect(page.locator("#script")).toBeVisible();
  await expect(page.locator("#script")).toHaveValue("Đây là nội dung ban đầu. và đoạn đang đọc");
});

test("new idea form microphone sits after description rather than above title", async ({ page }) => {
  await fakeSpeech(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  const mic = page.locator("#dialog .voice-icon-only");
  await expect(mic).toHaveCSS("position", "sticky");
  await expect(mic).toBeVisible();
  const following = await page.evaluate(() => {
    const content = document.querySelector("#new-idea-content");
    const mic = document.querySelector("#dialog .voice-icon-only");
    return Boolean(content.compareDocumentPosition(mic) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(following).toBeTruthy();
  await mic.click();
  await expect(page.locator("#voice-dialog")).toHaveCount(0);
});
