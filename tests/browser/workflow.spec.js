import { test, expect } from "@playwright/test";
const stage = (page, name) =>
  page
    .locator(".mobile-nav:visible,.sidebar:visible")
    .getByRole("button", { name, exact: false })
    .first();
async function add(page, titles) {
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator(".bulk-idea summary").click();
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
test("dark panels have no bright borders, empty-stage icons are blue, and checkboxes are sharp square", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  const primary = page.getByRole("button", { name: "Thêm ý tưởng", exact: true });
  await expect(primary).toHaveCSS("background-color", "rgb(8, 102, 255)");
  await expect(primary).toHaveCSS("border-top-color", "rgb(8, 102, 255)");

  await stage(page, "Kịch bản").click();
  const emptyIcon = page.locator(".empty-icon");
  await expect(emptyIcon).toBeVisible();
  await expect(emptyIcon).toHaveCSS("color", "rgb(47, 130, 255)");
  await expect(emptyIcon).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".panel").first()).toHaveCSS("border-top-width", "0px");
  await stage(page, "Hoàn thiện").click();
  await expect(page.locator(".empty-icon")).toHaveCSS("color", "rgb(47, 130, 255)");

  await stage(page, "Ý tưởng").click();
  await add(page, "Ý tưởng về sức mạnh của hành động");
  const item = page.locator(".row-check").first();
  await expect(item).toHaveCSS("border-top-left-radius", "0px");
  await expect(item).toHaveCSS("border-bottom-right-radius", "0px");
  await item.check();
  await expect(item).toBeChecked();
  await expect(item).toHaveCSS("border-top-color", "rgb(8, 102, 255)");
  const tickColor = await item.evaluate((el) => getComputedStyle(el, "::after").borderBottomColor);
  expect(tickColor).toBe("rgb(38, 125, 255)");
  await page.locator("#select-all").check();
  await expect(page.locator("#select-all")).toHaveCSS("border-top-left-radius", "0px");

  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await expect(page.locator("#dialog")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator("#new-idea-content")).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
});

test("new idea saves content without a title; microphone is icon-only on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await expect(page.locator("#new-idea-title")).toBeVisible();
  await expect(page.locator("#new-idea-content")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo ý tưởng bằng nội dung / ghi âm" })).toHaveCount(0);
  const mic = page.locator("#dialog .voice-icon-only");
  await expect(mic).toBeVisible();
  await expect(mic).toHaveText("🎙");
  await expect(mic).toHaveAttribute("aria-label", "Ghi âm cho Nội dung ý tưởng");
  await page.locator("#new-idea-content").fill("Ý tưởng về việc giữ sự kiên trì mỗi ngày.");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await expect(page.locator(".video-row")).toContainText("Ý tưởng về việc giữ sự kiên trì mỗi ngày.");
  await page.reload();
  await page.locator(".video-main").first().click();
  await expect(page.locator("#idea-content")).toHaveValue("Ý tưởng về việc giữ sự kiên trì mỗi ngày.");
  await expect(page.getByRole("button", { name: "Ghi âm cho Nội dung ý tưởng" })).toBeVisible();
});

test("floating microphone is directly above the mobile navigation and needs login for AI", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  const fab = page.getByRole("button", { name: "Ghi ý tưởng nhanh" });
  await expect(fab).toBeVisible();
  const nav = await page.locator(".mobile-nav").boundingBox();
  const mic = await fab.boundingBox();
  expect(mic.y + mic.height).toBeLessThanOrEqual(nav.y + 3);
  await fab.click();
  await expect(page.getByRole("heading", { name: "Cài đặt" })).toBeVisible();
  await page.locator("#dialog [data-action=close]").click();
  await stage(page, "Kịch bản").click();
  await expect(fab).toBeHidden();
  await stage(page, "Ý tưởng").click();
  await expect(fab).toBeVisible();
  await stage(page, "Chờ quay").click();
  await expect(fab).toBeHidden();
  await stage(page, "Hoàn thiện").click();
  await expect(fab).toBeHidden();
  await stage(page, "Đã đăng").click();
  await expect(fab).toBeHidden();
});
test("iPhone 16 Pro Max: header and bottom nav stay still during list scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await page.goto("./");
  const fab = page.getByRole("button", { name: "Ghi ý tưởng nhanh" });
  await expect(fab).toBeVisible();
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator(".bulk-idea summary").click();
  await page.locator("[name=titles]").fill(Array.from({length:32},(_,i)=>"Ý tưởng "+(i+1)).join("\n"));
  await page.getByRole("button", { name: "Thêm vào kho ý tưởng" }).click();
  // Bulk insertion is asynchronous: wait for all rows before measuring scroll.
  await expect(page.locator(".video-row")).toHaveCount(32);
  const header=page.locator(".topbar"), nav=page.locator(".mobile-nav");
  const top=await header.boundingBox(),bottom=await nav.boundingBox();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const nextTop=await header.boundingBox(),nextBottom=await nav.boundingBox();
  expect(Math.abs(top.y-nextTop.y)).toBeLessThan(2);
  expect(Math.abs(bottom.y-nextBottom.y)).toBeLessThan(2);
  expect(nextTop.y).toBeGreaterThanOrEqual(0);
  expect(nextBottom.y+nextBottom.height).toBeLessThanOrEqual(958);
  await expect(fab).toBeVisible();
  await stage(page, "Kịch bản").click();
  await expect(fab).toBeHidden();
  await expect(header).toBeInViewport();
  await expect(nav).toBeInViewport();
});
test("new idea saves title and content together in one submission", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("#new-idea-title").fill("Bữa ăn cho tâm trí");
  await page.locator("#new-idea-content").fill("Ví dụ so sánh kẹo ngọt với video vô bổ.");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await expect(page.locator(".video-row")).toHaveCount(1);
  await page.locator(".video-main").first().click();
  await expect(page.locator("#video-title")).toHaveValue("Bữa ăn cho tâm trí");
  await expect(page.locator("#idea-content")).toHaveValue("Ví dụ so sánh kẹo ngọt với video vô bổ.");
  await page.reload();
  await page.locator(".video-main").first().click();
  await expect(page.locator("#video-title")).toHaveValue("Bữa ăn cho tâm trí");
  await expect(page.locator("#idea-content")).toHaveValue("Ví dụ so sánh kẹo ngọt với video vô bổ.");
});

test("mobile toolbar has stable Super Content label and accessible archive/trash menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(page.locator(".topbar .breadcrumb")).toHaveText("Super Content");
  await expect(page.locator(".local-notice")).toBeHidden();
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("#new-idea-title").fill("Ý tưởng lưu và xóa");
  await page.locator("#new-idea-content").fill("Nội dung giữ nguyên sau khi khôi phục.");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await page.locator("#select-all").check();
  await page.locator(".selection-bar [data-action=archive]").click();
  await expect(page.locator(".video-row")).toHaveCount(0);
  await page.locator(".utility-dropdown summary").click();
  await expect(page.locator(".utility-popover [data-view=archive]")).toBeVisible();
  await expect(page.locator(".utility-popover [data-view=trash]")).toBeVisible();
  await page.locator(".utility-popover [data-view=archive]").click();
  await expect(page.locator(".page-heading h1")).toContainText("Lưu trữ");
  await expect(page.locator(".video-row")).toHaveCount(1);
  await expect(page.locator(".topbar .breadcrumb")).toHaveText("Super Content");
  await page.locator("#select-all").check();
  await page.locator(".selection-bar [data-action=restore]").click();
  await stage(page, "Ý tưởng").click();
  await page.locator("#select-all").check();
  page.once("dialog", (prompt) => prompt.accept());
  await page.locator(".selection-bar [data-action=delete]").click();
  await page.locator(".utility-dropdown summary").click();
  await page.locator(".utility-popover [data-view=trash]").click();
  await expect(page.locator(".page-heading h1")).toContainText("Thùng rác");
  await expect(page.locator(".video-row")).toHaveCount(1);
  await expect(page.locator(".video-main")).toContainText("Ý tưởng lưu và xóa");
  await page.locator("#select-all").check();
  await page.locator(".selection-bar [data-action=restore]").click();
  await stage(page, "Ý tưởng").click();
  await expect(page.locator(".video-row")).toHaveCount(1);
});
test("production stages show only heading; mobile viewport disallows page zoom", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).toContain("maximum-scale=1");
  expect(viewport).toContain("user-scalable=no");
  const stageTitles = [
    ["Ý tưởng", "Kho ý tưởng"],
    ["Kịch bản", "Lên kịch bản"],
    ["Chờ quay", "Chờ quay"],
    ["Hoàn thiện", "Hoàn thiện"],
    ["Đã đăng", "Đã xuất bản"],
  ];
  for (const [nav, heading] of stageTitles) {
    await stage(page, nav).click();
    await expect(page.locator(".page-heading h1")).toContainText(heading);
    await expect(page.locator(".page-heading .eyebrow")).toHaveCount(0);
    await expect(page.locator(".page-heading p")).toHaveCount(0);
    await expect(page.locator(".list-foot")).toHaveCount(0);
  }
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).touchAction),
  ).toBe("pan-x pan-y");
});

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
  await page.getByRole("button", { name: "Thêm nguồn tham khảo" }).click();
  await page.locator("#reference-input").fill("https://youtube.com/watch?v=example");
  await page.locator("#reference-entry").getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.locator(".reference-link")).toHaveCount(1);
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
  await page.locator("#idea-content").fill("Không được xóa bản viết này");
  await expect(page.locator("#save-state")).toContainText("Lưu thất bại");
  await expect(page.locator("#idea-content")).toHaveValue(
    "Không được xóa bản viết này",
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.originalPut;
  });
  await page
    .locator("#idea-content")
    .fill("Không được xóa bản viết này — thử lưu lại");
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  await page.reload();
  await page.locator(".video-main").first().click();
  await expect(page.locator("#idea-content")).toHaveValue(
    "Không được xóa bản viết này — thử lưu lại",
  );
});
