import { test, expect } from "@playwright/test";
async function tab(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
}
test("500 channel rows remain searchable and the limit does not discard saved channels", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await page.locator(".research-shortcut").click();
  await tab(page, "Kênh theo dõi");
  await page
    .locator("#bulk-channels")
    .fill(
      Array.from(
        { length: 500 },
        (_, i) => `https://youtube.com/@scale${i}`,
      ).join("\n"),
    );
  await tab(page, "Nhập danh sách kênh");
  await expect(page.locator(".channel-row")).toHaveCount(500);
  await page.locator("#bulk-channels").fill("https://youtube.com/@overflow");
  await tab(page, "Nhập danh sách kênh");
  await expect(page.locator("#personal-status")).toContainText(
    "Tối đa 500 kênh",
  );
  await expect(page.locator(".channel-row")).toHaveCount(500);
  await page.locator("#channel-search").fill("scale499");
  await expect(page.locator(".channel-row")).toHaveCount(1);
  await page.reload();
  await page.locator(".research-shortcut").click();
  await tab(page, "Kênh theo dõi");
  await expect(page.locator(".channel-row")).toHaveCount(500);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test("100 channels, criteria history and confirmed memory can be managed on desktop and mobile", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (d) => d.accept());
  await page.goto("./");
  await page.locator(".research-shortcut").click();
  await tab(page, "Kênh theo dõi");
  const urls =
    Array.from(
      { length: 100 },
      (_, i) => `https://youtube.com/@testchannel${i}`,
    ).join("\n") + "\nhttps://www.youtube.com/@TESTCHANNEL1/videos";
  await page.locator("#bulk-channels").fill(urls);
  await page.locator("#bulk-group").fill("Khoa học");
  await tab(page, "Nhập danh sách kênh");
  await expect(page.locator(".channel-row")).toHaveCount(100);
  await expect(page.locator("#personal-status")).toContainText("1 kênh trùng");
  await page.locator("#channel-search").fill("testchannel99");
  await expect(page.locator(".channel-row")).toHaveCount(1);
  await page.locator("[data-channel-toggle]").uncheck();
  await expect(page.locator("[data-channel-toggle]").last()).not.toBeChecked();
  await tab(page, "Tiêu chuẩn nội dung");
  await page.locator("[name=topics]").fill("Khoa học và dinh dưỡng");
  await page
    .locator("[name=avoid]")
    .fill("Không dùng thông tin chưa kiểm chứng");
  await tab(page, "Lưu tiêu chuẩn mới");
  await expect(page.locator("#personal-status")).toContainText(
    "Đã lưu phiên bản",
  );
  await page.locator("[name=topics]").fill("Lịch sử và văn hóa");
  await tab(page, "Lưu tiêu chuẩn mới");
  await expect(page.locator(".history-item")).toHaveCount(2);
  await page.reload();
  await page.locator(".research-shortcut").click();
  await tab(page, "Tiêu chuẩn nội dung");
  await expect(page.locator("[name=topics]")).toHaveValue("Lịch sử và văn hóa");
  // Seed a previously collected recommendation, never a production app fixture.
  await page.evaluate(async () => {
    const request = indexedDB.open("super-content-v1", 1);
    await new Promise((r) => (request.onsuccess = r));
    const db = request.result,
      tx = db.transaction("videos", "readwrite"),
      s = tx.objectStore("videos");
    const get = s.get("research:demo:settings");
    get.onsuccess = () => {
      const row = get.result || {
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
          proposals: [],
          runs: [],
        },
      };
      row.value.proposals = [
        {
          youtube_id: "video000000",
          status: "suggested",
          sources: ["Kênh: Khoa học"],
          data: {
            title: "Lịch sử và văn hóa Việt Nam",
            url: "https://youtube.com/watch?v=video000000",
            channel: "Example",
            views: 1000,
            likes: null,
            comments: null,
            published_at: "2026-11-01T00:00:00Z",
          },
          analysis: {
            group: "strategic",
            ranking_engine: "rules",
            personal_reasons: ["Phù hợp tiêu chuẩn lịch sử"],
            criteria_version: null,
          },
        },
      ];
      s.put(row);
    };
    await new Promise((r) => (tx.oncomplete = r));
    db.close();
  });
  await tab(page, "Nghiên cứu & Đề xuất");
  await page
    .getByRole("button", { name: "Tải lại dữ liệu", exact: true })
    .click();
  await page.locator("[data-feedback-choice]").selectOption("excellent");
  await page
    .locator("[data-feedback-reason]")
    .fill("Tôi ưu tiên góc nhìn văn hóa có nguồn rõ ràng");
  await tab(page, "Lưu lựa chọn");
  await expect(page.locator("#research-status")).toContainText(
    "Đã lưu lựa chọn",
  );
  await tab(page, "Bộ nhớ học hỏi");
  await expect(page.locator(".memory-item")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Xác nhận ghi nhớ từ lựa chọn này",
      exact: true,
    })
    .click();
  await expect(page.locator(".memory-item")).toHaveCount(1);
  await expect(page.locator("[data-memory-confirmed]")).toBeChecked();
  await page.locator("[data-memory-text]").fill("Ưu tiên lịch sử có chứng cứ");
  await tab(page, "Lưu ghi nhớ");
  await expect(page.locator("[data-memory-text]")).toHaveValue(
    "Ưu tiên lịch sử có chứng cứ",
  );
  await tab(page, "Xóa ghi nhớ");
  await expect(page.locator(".memory-item")).toHaveCount(0);
  await page.locator("[data-edit-decision]").selectOption("rejected");
  await page
    .locator("[data-edit-reason]")
    .fill("Không còn phù hợp với định hướng");
  await tab(page, "Lưu phản hồi đã sửa");
  await expect(page.locator("[data-edit-reason]")).toHaveValue(
    "Không còn phù hợp với định hướng",
  );
  await tab(page, "Xóa phản hồi");
  await expect(page.locator("[data-edit-reason]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/${info.project.name}-personal.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
