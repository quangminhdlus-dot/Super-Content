import { test, expect } from "@playwright/test";

test("compact Info panel saves icon-only clickable references and preserves hidden metadata", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("#new-idea-title").fill("Sức mạnh của sự kiên trì");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await page.locator(".video-main").first().click();

  await expect(page.locator(".details h2")).toHaveText("Thông tin");
  for (const name of ["Thông tin video", "Liên kết bản dựng", "Đường dẫn YouTube", "Ngày xuất bản"]) {
    await expect(page.locator(".details")).not.toContainText(name);
  }
  await expect(page.locator(".details [data-field=source_url]")).toHaveCount(0);
  await expect(page.locator(".details [data-field=draft_url]")).toHaveCount(0);
  await expect(page.locator(".details [data-field=youtube_url]")).toHaveCount(0);
  await expect(page.locator(".details [data-field=published_at]")).toHaveCount(0);
  const collapsed = page.locator(".details-expand");
  await expect(collapsed).not.toHaveAttribute("open", "");

  await page.getByRole("button", { name: "Thêm nguồn tham khảo" }).click();
  await page.locator("#reference-input").fill(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://example.com/research/story\nhttps://docs.google.com/document/d/1example/edit",
  );
  await page.locator("#reference-entry").getByRole("button", { name: "Thêm", exact: true }).click();
  await expect(page.locator(".reference-link")).toHaveCount(3);
  await expect(page.locator(".reference-link").first()).toHaveAttribute("title", /youtube.com\/watch/);
  await expect(page.locator(".reference-link").first().locator(".reference-youtube")).toHaveCount(1);
  for (const link of await page.locator(".reference-link").all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("href", /^https:\/\//);
    const label = await link.getAttribute("aria-label");
    expect(label).toMatch(/^Mở nguồn tham khảo/);
    expect(await link.innerText()).toBe("");
  }
  await context.route("https://example.com/research/story", route => route.fulfill({
    status: 200, contentType: "text/html", body: "<title>Tham khảo</title><h1>Tham khảo</h1>",
  }));
  const popupPromise = page.waitForEvent("popup");
  await page.locator(".reference-link[href='https://example.com/research/story']").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.com/research/story");
  await popup.close();
  await expect(page.locator(".reference-chip")).toHaveCount(3);

  await page.locator(".reference-remove").nth(1).click();
  await expect(page.locator(".reference-link")).toHaveCount(2);
  await expect(page.locator(".reference-link[href*='example.com']")).toHaveCount(0);
  await expect(page.locator("#save-state")).toContainText("Đã lưu");
  await page.getByRole("button", { name: "Danh sách" }).click();
  await page.locator(".video-main").first().click();
  await expect(page.locator(".reference-link")).toHaveCount(2);
  await page.reload();
  await page.locator(".video-main").first().click();
  await expect(page.locator(".reference-link")).toHaveCount(2);
  await expect(page.locator(".reference-link[href*='youtube.com']")).toHaveCount(1);
  await expect(page.locator(".reference-link[href*='docs.google.com']")).toHaveCount(1);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
});

test("invalid or duplicate reference input is handled without erasing saved sources", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Thêm ý tưởng", exact: true }).click();
  await page.locator("#new-idea-title").fill("Một ý tưởng mới");
  await page.getByRole("button", { name: "Lưu ý tưởng" }).click();
  await page.locator(".video-main").first().click();
  await page.getByRole("button", { name: "Thêm nguồn tham khảo" }).click();
  const field = page.locator("#reference-input");
  const addButton = page.locator("#reference-entry").getByRole("button", { name: "Thêm", exact: true });
  await field.fill("javascript:alert(1)");
  await addButton.click();
  await expect(page.locator("#reference-feedback")).toContainText("không hợp lệ");
  await expect(page.locator(".reference-link")).toHaveCount(0);

  await field.fill("https://example.org/story");
  await addButton.click();
  await expect(page.locator(".reference-link")).toHaveCount(1);
  await page.getByRole("button", { name: "Thêm nguồn tham khảo" }).click();
  await field.fill("https://example.org/story");
  await addButton.click();
  await expect(page.locator(".reference-link")).toHaveCount(1);
});
