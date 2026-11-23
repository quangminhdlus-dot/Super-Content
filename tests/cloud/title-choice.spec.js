import { test, expect } from "@playwright/test";

test("choosing one of three title suggestions hides other two and keeps the chosen one", async ({ page }) => {
  await page.goto("./");
  await page.evaluate(async () => {
    const { collapseTitleChoices, revealTitleChoices } = await import("/super-content/src/title-choices.js");
    const host = document.createElement("section");
    host.id = "title-choices-test";
    const title = document.createElement("input");
    title.id = "test-video-title";
    const group = document.createElement("div");
    group.className = "title-option-list";
    const reopen = document.createElement("button");
    reopen.className = "title-choice-reopen";
    reopen.hidden = true;
    for (let i = 1; i <= 3; i++) {
      const button = document.createElement("button");
      button.className = "title-option";
      button.textContent = "Tiêu đề " + i;
      button.addEventListener("click", () => {
        title.value = button.textContent;
        title.dispatchEvent(new Event("input", { bubbles: true }));
        collapseTitleChoices(group, button, reopen);
      });
      group.append(button);
    }
    reopen.addEventListener("click", () => revealTitleChoices(group, reopen));
    host.append(title, group, reopen);
    document.body.append(host);
  });

  const options = page.locator("#title-choices-test .title-option");
  const reopen = page.locator("#title-choices-test .title-choice-reopen");
  await expect(options).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(options.nth(i)).toBeVisible();
  await options.nth(1).click();

  await expect(page.locator("#test-video-title")).toHaveValue("Tiêu đề 2");
  await expect(options.nth(0)).toBeHidden();
  await expect(options.nth(1)).toBeVisible();
  await expect(options.nth(2)).toBeHidden();
  await expect(options.nth(1)).toHaveClass(/selected/);
  await expect(options.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(reopen).toBeVisible();
  await expect(reopen).toHaveText("Xem lại 3 tiêu đề");

  await reopen.click();
  for (let i = 0; i < 3; i++) await expect(options.nth(i)).toBeVisible();
  await expect(reopen).toBeHidden();
  await options.nth(2).click();
  await expect(page.locator("#test-video-title")).toHaveValue("Tiêu đề 3");
  await expect(options.nth(0)).toBeHidden();
  await expect(options.nth(1)).toBeHidden();
  await expect(options.nth(2)).toBeVisible();
  await expect(reopen).toBeVisible();
});

test("single title suggestion does not show a redundant reopen control", async ({ page }) => {
  await page.goto("./");
  const state = await page.evaluate(async () => {
    const { collapseTitleChoices } = await import("/super-content/src/title-choices.js");
    const group = document.createElement("div");
    const chosen = document.createElement("button");
    chosen.className = "title-option";
    group.append(chosen);
    const reopen = document.createElement("button");
    reopen.hidden = true;
    collapseTitleChoices(group, chosen, reopen);
    return { chosenHidden: chosen.hidden, isSelected: chosen.classList.contains("selected"), reopenHidden: reopen.hidden };
  });
  expect(state).toEqual({ chosenHidden: false, isSelected: true, reopenHidden: true });
});
