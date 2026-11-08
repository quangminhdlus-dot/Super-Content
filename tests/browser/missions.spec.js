import { test, expect } from "@playwright/test";
test("natural-language missions persist, separate method/source and preserve long-term criteria", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await page.locator(".research-shortcut").click();
  await expect(page.locator("#search-method")).toHaveValue("description");
  await page
    .getByRole("button", { name: "Tiêu chuẩn nội dung", exact: true })
    .click();
  await page
    .locator("[name=topics]")
    .fill("Tiêu chuẩn lâu dài về giá trị và lãnh đạo");
  await page
    .getByRole("button", { name: "Lưu tiêu chuẩn mới", exact: true })
    .click();
  await expect(page.locator("#personal-status")).toContainText("Đã lưu");
  await page
    .getByRole("button", { name: "Nghiên cứu & Đề xuất", exact: true })
    .click();
  const description =
    "Tôi muốn tìm nội dung dành cho người 30–40 tuổi đã có gia đình nhưng mất phương hướng.\n\nƯu tiên câu chuyện thật, có góc nhìn sâu sắc và hướng hành động thiết thực.";
  await page.locator("#mission-description").fill(description);
  await page.locator("[name=mode]").selectOption("combined");
  await page.locator(".mission-options summary").click();
  await page.locator("#mission-name").fill("Tìm lại ý nghĩa");
  await page.locator("#mission-additional").fill("Loại nội dung giật gân");
  await page.getByRole("button", { name: "Lưu nhiệm vụ", exact: true }).click();
  await expect(page.locator("#research-status")).toContainText(
    "Đã lưu nhiệm vụ",
  );
  await page.locator(".mission-options summary").click();
  await page.getByRole("button", { name: "Nhiệm vụ mới", exact: true }).click();
  await expect(page.locator("#mission-description")).toHaveValue("");
  await page.locator(".mission-options summary").click();
  await page
    .locator("#saved-mission")
    .selectOption({ label: "Tìm lại ý nghĩa" });
  await expect(page.locator("#mission-description")).toHaveValue(description);
  await expect(page.locator("[name=mode]")).toHaveValue("combined");
  await page.locator("#search-method").selectOption("examples");
  await page.locator("#mission-examples").fill("https://youtu.be/video000000");
  await expect(page.locator("#mission-examples")).toBeVisible();
  await page.locator("#search-method").selectOption("keywords");
  await expect(page.locator("#mission-description")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Tiêu chuẩn nội dung", exact: true })
    .click();
  await expect(page.locator("[name=topics]")).toHaveValue(
    "Tiêu chuẩn lâu dài về giá trị và lãnh đạo",
  );
  await expect(page.locator(".history-item")).toHaveCount(1);
  await page.reload();
  await page.locator(".research-shortcut").click();
  await page.locator(".mission-options summary").click();
  await page
    .locator("#saved-mission")
    .selectOption({ label: "Tìm lại ý nghĩa" });
  await expect(page.locator("#mission-description")).toHaveValue(description);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `test-results/${info.project.name}-mission.png`,
  });
  expect(errors).toEqual([]);
});
