import { test, expect } from "@playwright/test";
async function openResearch(page) {
  await page.locator(".research-shortcut").click();
  await expect(
    page.getByRole("heading", { name: "Nghiên cứu YouTube", exact: true }),
  ).toBeVisible();
}
async function seed(page) {
  await page.evaluate(async () => {
    const request = indexedDB.open("super-content-v1", 1);
    await new Promise((resolve, reject) => {
      request.onsuccess = resolve;
      request.onerror = reject;
    });
    const db = request.result;
    const tx = db.transaction("videos", "readwrite");
    const proposals = [0, 1, 2].map((i) => ({
      youtube_id: `video00000${i}`,
      status: "suggested",
      collected_at: "2026-11-08T00:00:00Z",
      sources: ["Kênh: Nghiên cứu thử"],
      data: {
        title: `Đề xuất nghiên cứu ${i + 1}`,
        channel: "Kênh nghiên cứu",
        published_at: "2026-11-01T00:00:00Z",
        url: `https://www.youtube.com/watch?v=video00000${i}`,
        thumbnail: "",
        views: 10000,
        likes: null,
        comments: 30,
      },
      analysis: {
        score: 55,
        confidence: "low",
        eligible: false,
        reasons: ["Chưa đủ mẫu để kết luận vượt trội."],
        angle: "Bổ sung dữ liệu thực tế riêng.",
        angle_source: "editorial_template",
      },
    }));
    tx.objectStore("videos").put({
      key: "research:demo:settings",
      scope: "research:demo",
      id: "settings",
      value: {
        settings: {
          channels: [],
          keywords: [],
          mode: "channels",
          published_after: "2026-10-01",
          published_before: "2026-11-08",
          result_limit: 10,
        },
        proposals,
        runs: [],
      },
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
    db.close();
  });
}
test("research settings persist; proposals remain separate and selected imports are idempotent", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await seed(page);
  await openResearch(page);
  await expect(page.locator(".proposal-card")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "Quét ngay", exact: true }),
  ).toBeDisabled();
  await page.locator("#channel-url").fill("https://evil.test/@channel");
  await page.getByRole("button", { name: "+ Thêm kênh", exact: true }).click();
  await expect(page.locator("#research-status")).toContainText("YouTube");
  await page.locator("#channel-url").fill("https://www.youtube.com/@example");
  await page.getByRole("button", { name: "+ Thêm kênh", exact: true }).click();
  await page.locator("#new-keyword").fill("Nội dung thực tế");
  await page
    .getByRole("button", { name: "+ Thêm từ khóa", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Từ khóa 1", exact: true })
    .fill("Nghiên cứu thực tế");
  await page.locator("[name=mode]").selectOption("combined");
  await page.getByRole("button", { name: "Lưu cấu hình", exact: true }).click();
  await expect(page.locator("#research-status")).toContainText(
    "Đã lưu trên thiết bị",
  );
  await page.reload();
  await openResearch(page);
  await expect(
    page.getByRole("textbox", { name: "Từ khóa 1", exact: true }),
  ).toHaveValue("Nghiên cứu thực tế");
  await expect(page.locator("[name=mode]")).toHaveValue("combined");
  await page.locator("[data-proposal]").nth(0).check();
  await page.locator("[data-proposal]").nth(1).check();
  await page
    .getByRole("button", { name: "Chuyển vào Kho ý tưởng", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await page.locator("#proposal-filter").selectOption("accepted");
  await expect(page.locator(".proposal-card")).toHaveCount(2);
  await page
    .locator(".mobile-nav:visible,.sidebar:visible")
    .getByRole("button", { name: /Ý tưởng/ })
    .first()
    .click();
  await expect(page.locator(".video-row")).toHaveCount(2);
  await page.locator(".video-main").first().click();
  await expect(page.locator("[data-field=source_url]")).toHaveValue(
    /youtube.com/,
  );
  await expect(page.locator(".research-provenance")).toContainText(
    "Bổ sung dữ liệu thực tế riêng.",
  );
  await page.locator("#script").fill("Giữ nguyên kịch bản đã viết");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  // Simulate a repeated recommendation receipt; reimport must not replace the existing record.
  await seed(page);
  await openResearch(page);
  await page.locator("#proposal-filter").selectOption("suggested");
  await page.locator("[data-proposal]").nth(0).check();
  await page
    .getByRole("button", { name: "Chuyển vào Kho ý tưởng", exact: true })
    .click();
  await expect(page.locator("#research-status")).toContainText(
    "không tạo bản sao",
  );
  await page.locator("#proposal-filter").selectOption("suggested");
  await page.locator("[data-proposal]").first().check();
  await page.getByRole("button", { name: "Bỏ qua", exact: true }).click();
  await page.locator("#proposal-filter").selectOption("ignored");
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await page.locator("[data-proposal]").check();
  await page
    .getByRole("button", { name: "Lưu trữ đề xuất", exact: true })
    .click();
  await page.locator("#proposal-filter").selectOption("archived");
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/${info.project.name}-research.png`,
    fullPage: true,
  });
  await page
    .locator(".mobile-nav:visible,.sidebar:visible")
    .getByRole("button", { name: /Ý tưởng/ })
    .first()
    .click();
  await expect(page.locator(".video-row")).toHaveCount(2);
  await page.locator(".video-main").first().click();
  await expect(page.locator("#script")).toHaveValue(
    "Giữ nguyên kịch bản đã viết",
  );
  expect(errors).toEqual([]);
});
