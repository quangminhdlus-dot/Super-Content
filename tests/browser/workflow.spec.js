import { test, expect } from "@playwright/test";
const stage = (page, name) =>
  page
    .locator(".mobile-nav:visible,.sidebar:visible")
    .getByRole("button", { name, exact: false })
    .first();
async function add(page, titles) {
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("[name=titles]").fill(titles);
  await page.getByRole("button", { name: "Thêm vào kho ý tưởng" }).click();
}
async function selectAll(page) {
  await page.locator("#select-all").check();
}
async function settings(page) {
  await page.getByRole("button", { name: "Cài đặt", exact: true }).click();
}
async function utility(page, name) {
  await settings(page);
  await page
    .locator("#dialog")
    .getByRole("button", { name: new RegExp(`^${name} \\(`) })
    .click();
}
test("full 20 → 7 workflow, stable IDs, script, offline persistence, archive and trash", async ({
  page,
  context,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Kho ý tưởng" }),
  ).toBeVisible();
  await add(
    page,
    Array.from({ length: 20 }, (_, i) => `Tiêu đề ${i + 1}`).join("\n"),
  );
  await expect(page.locator(".video-row")).toHaveCount(20);
  const ids = await page
    .locator(".row-check")
    .evaluateAll((xs) => xs.map((x) => x.dataset.id));
  for (let i = 0; i < 7; i++) await page.locator(".row-check").nth(i).check();
  await page.getByRole("button", { name: "Chuyển sang Lên kịch bản" }).click();
  await expect(page.locator(".video-row")).toHaveCount(13);
  await stage(page, "Kịch bản").click();
  await expect(page.locator(".video-row")).toHaveCount(7);
  await page.locator(".video-main").first().click();
  await page.locator("#video-title").fill("Câu chuyện được lưu");
  const script =
    "Mở đầu — một câu chuyện.\n" +
    "Kịch bản dài cần được giữ nguyên. ".repeat(200);
  await page.locator("#script").fill(script);
  await page
    .locator("[data-field=source_url]")
    .fill("https://youtube.com/watch?v=example");
  await page.locator("[data-field=notes]").fill("Luận điểm cần giữ");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  const cursor = await page.locator("#script").evaluate((el) => {
    el.focus();
    el.setSelectionRange(8, 8);
    return el.selectionStart;
  });
  await page.keyboard.type("X");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  expect(
    await page.locator("#script").evaluate((el) => el.selectionStart),
  ).toBe(cursor + 1);
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  await page.getByRole("button", { name: /^Câu chuyện được lưu/ }).click();
  await expect(page.locator("#script")).toHaveValue(
    script.slice(0, 8) + "X" + script.slice(8),
  );
  await page.screenshot({
    path: `test-results/${info.project.name}-editor.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  await selectAll(page);
  await page.getByRole("button", { name: "Chuyển sang Chờ quay" }).click();
  await stage(page, "Chờ quay").click();
  await expect(page.locator(".video-row")).toHaveCount(7);
  await selectAll(page);
  await page.getByRole("button", { name: "Đã quay xong → Hoàn thiện" }).click();
  await stage(page, "Hoàn thiện").click();
  await selectAll(page);
  await page.getByRole("button", { name: "Chuyển sang Đã xuất bản" }).click();
  await stage(page, "Đã đăng").click();
  await expect(page.locator(".video-row")).toHaveCount(7);
  await selectAll(page);
  await page.getByRole("button", { name: "Về Hoàn thiện" }).click();
  await stage(page, "Hoàn thiện").click();
  await selectAll(page);
  await page
    .getByRole("button", { name: "Lưu trữ", exact: true })
    .last()
    .click();
  await utility(page, "Lưu trữ");
  await expect(page.locator(".video-row")).toHaveCount(7);
  await selectAll(page);
  await page.getByRole("button", { name: "Khôi phục", exact: true }).click();
  await stage(page, "Hoàn thiện").click();
  await selectAll(page);
  await page.getByRole("button", { name: "Xóa", exact: true }).click();
  await utility(page, "Thùng rác");
  await expect(page.locator(".video-row")).toHaveCount(7);
  await selectAll(page);
  await page.getByRole("button", { name: "Khôi phục", exact: true }).click();
  await stage(page, "Hoàn thiện").click();
  expect(
    (
      await page
        .locator(".row-check")
        .evaluateAll((xs) => xs.map((x) => x.dataset.id))
    ).every((id) => ids.includes(id)),
  ).toBeTruthy();
  await expect(page.locator(".video-row")).toHaveCount(7);
  // Wait for the production service worker, then verify a fresh offline launch.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await stage(page, "Hoàn thiện").click();
  await page.getByRole("button", { name: /^Câu chuyện được lưu/ }).click();
  await expect(page.locator("[data-field=notes]")).toHaveValue(
    "Luận điểm cần giữ",
  );
  await page.locator("#script").fill("Bản viết khi ngoại tuyến");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  await page.reload();
  await stage(page, "Hoàn thiện").click();
  await page.getByRole("button", { name: /^Câu chuyện được lưu/ }).click();
  await expect(page.locator("#script")).toHaveValue("Bản viết khi ngoại tuyến");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});
test("duplicates, search selection, safe text rendering and permanent-delete confirmation", async ({
  page,
}, info) => {
  await page.goto("./");
  await add(page, "Một tiêu đề");
  await expect(page.locator(".video-row")).toHaveCount(1);
  await add(
    page,
    "một TIÊU ĐỀ\nNội dung mới\nNội dung mới\n\n<img src=x onerror=alert(1)>",
  );
  await expect(page.locator(".duplicate")).toHaveCount(2);
  await page.locator(".duplicate input").first().check();
  await page.getByRole("button", { name: "Thêm vào kho ý tưởng" }).click();
  await expect(page.locator(".video-row")).toHaveCount(4);
  expect(await page.locator(".video-row img").count()).toBe(0);
  await page
    .getByRole("textbox", { name: "Tìm kiếm", exact: true })
    .fill("mới");
  await expect(page.locator(".video-row")).toHaveCount(1);
  await selectAll(page);
  await page.getByRole("button", { name: "Chuyển sang Lên kịch bản" }).click();
  await stage(page, "Kịch bản").click();
  await expect(page.locator(".video-row")).toHaveCount(1);
  await selectAll(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Xóa", exact: true }).click();
  await utility(page, "Thùng rác");
  await selectAll(page);
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Xóa vĩnh viễn", exact: true })
    .click();
  await expect(page.locator(".video-row")).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Xóa vĩnh viễn", exact: true })
    .click();
  await expect(page.locator(".video-row")).toHaveCount(0);
  await stage(page, "Ý tưởng").click();
  await settings(page);
  await page.getByRole("button", { name: "Lớn", exact: true }).click();
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-size", "large");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/${info.project.name}-ideas.png`,
    fullPage: true,
  });
});
test("storage failure does not claim success and keeps the unsaved script on screen", async ({
  page,
}) => {
  await page.goto("./");
  await add(page, "Bảo toàn kịch bản");
  await page.locator(".video-main").first().click();
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.locator("#script").fill("Không được xóa bản viết này");
  await expect(page.locator("#save-state")).toContainText("Lưu thất bại");
  await expect(page.locator("#script")).toHaveValue(
    "Không được xóa bản viết này",
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.originalPut;
  });
  await page
    .locator("#script")
    .fill("Không được xóa bản viết này — thử lưu lại");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  await page.reload();
  await page.locator(".video-main").first().click();
  await expect(page.locator("#script")).toHaveValue(
    "Không được xóa bản viết này — thử lưu lại",
  );
});
