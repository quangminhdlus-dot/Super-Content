/**
 * Show only the user-chosen title after selection.
 * All choices are preserved in DOM to allow an explicit "show again".
 * The persisted title is still controlled by app.js's existing input event.
 */
export function collapseTitleChoices(group, chosen, showAgain) {
  if (!group?.contains(chosen) || !chosen.classList.contains("title-option")) return;
  const buttons = [...group.querySelectorAll(".title-option")];
  for (const button of buttons) {
    const selected = button === chosen;
    button.classList.toggle("selected", selected);
    button.hidden = !selected;
    button.setAttribute("aria-pressed", String(selected));
  }
  if (showAgain) {
    showAgain.hidden = buttons.length < 2;
    showAgain.setAttribute("aria-expanded", "false");
    showAgain.textContent = "Xem lại " + buttons.length + " tiêu đề";
  }
}
export function revealTitleChoices(group, showAgain) {
  if (!group) return;
  for (const button of group.querySelectorAll(".title-option"))
    button.hidden = false;
  if (showAgain) {
    showAgain.hidden = true;
    showAgain.setAttribute("aria-expanded", "true");
  }
}
