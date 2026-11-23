/**
 * Keep the in-editor dictation button above the iOS software keyboard.
 *
 * iOS Safari and Home Screen PWAs shrink/pan the visual viewport without
 * consistently resizing the layout viewport. A fixed CSS bottom is therefore
 * insufficient: use visualViewport.height + offsetTop whenever the keyboard
 * is detected. Fall back to the original CSS bottom when it is dismissed.
 *
 * This module never focuses or blurs the textarea and does not change the
 * selection: its parent dictation handler owns the caret.
 */
export function keyboardMicTop({
  baselineHeight, visibleHeight, offsetTop = 0,
  buttonHeight = 55, margin = 14,
}) {
  if (![baselineHeight, visibleHeight, offsetTop, buttonHeight]
    .every(Number.isFinite) || baselineHeight <= 0 || visibleHeight <= 0) return null;

  // A Safari URL bar animation can change 30–100px; do not treat it as a
  // software keyboard. The relative threshold also covers landscape mode.
  const threshold = Math.max(125, baselineHeight * 0.17);
  if (baselineHeight - visibleHeight < threshold) return null;

  const top = Math.max(
    Math.max(0, offsetTop) + 8,
    Math.max(0, offsetTop) + visibleHeight - buttonHeight - margin,
  );
  return Math.round(top);
}

export function attachKeyboardAwareMic({
  target,
  button,
  win = window,
  doc = document,
  minWidthChange = 35,
} = {}) {
  if (!target || !button || !win || !doc) return () => {};

  const viewport = win.visualViewport;
  const frame = win.requestAnimationFrame?.bind(win) ||
    ((callback) => win.setTimeout(callback, 0));
  const cancelFrame = win.cancelAnimationFrame?.bind(win) ||
    win.clearTimeout?.bind(win);
  let baseline = Math.max(
    Number(win.innerHeight) || 0,
    Number(doc.documentElement?.clientHeight) || 0,
    Number(viewport?.height) || 0,
  );
  let lastWidth = Number(viewport?.width) || Number(win.innerWidth) || 0;
  let pendingFrame = null;
  let pendingDelays = new Set();
  let isPressing = false;
  let releaseTimer = null;
  let disposed = false;

  const restore = () => {
    button.classList.remove("keyboard-mic-visible");
    button.style.removeProperty("--keyboard-mic-top");
  };

  const measure = () => {
    if (disposed) return;
    if (!button.isConnected || !target.isConnected) {
      detach();
      return;
    }
    if (!win.matchMedia?.("(max-width: 800px), (pointer: coarse)").matches) {
      restore();
      return;
    }
    if (isPressing) return; // Avoid repositioning between touchstart and click.

    const vv = win.visualViewport;
    const currentHeight = Number(vv?.height) || Number(win.innerHeight) || 0;
    const width = Number(vv?.width) || Number(win.innerWidth) || 0;
    const layoutHeight = Math.max(
      Number(win.innerHeight) || 0,
      Number(doc.documentElement?.clientHeight) || 0,
    );
    if (Math.abs(width - lastWidth) > minWidthChange) {
      // Rotation changes the reference viewport height entirely.
      lastWidth = width;
      baseline = Math.max(currentHeight, layoutHeight);
    } else if (currentHeight > baseline) {
      baseline = currentHeight;
    } else if (layoutHeight > baseline) {
      baseline = layoutHeight;
    }

    const top = keyboardMicTop({
      baselineHeight: baseline,
      visibleHeight: currentHeight,
      offsetTop: Number(vv?.offsetTop) || 0,
      buttonHeight: button.getBoundingClientRect().height || 55,
    });
    // The dialog can exist in the DOM while closed. It must never leak a
    // floating microphone into an unrelated editor or a dialog backdrop.
    const owningDialog = target.closest("dialog");
    if (top == null || (owningDialog && !owningDialog.open)) {
      restore();
      return;
    }
    button.classList.add("keyboard-mic-visible");
    button.style.setProperty("--keyboard-mic-top", top + "px");
  };

  const schedule = () => {
    if (disposed || pendingFrame != null) return;
    pendingFrame = frame(() => {
      pendingFrame = null;
      measure();
    });
  };

  // Safari can publish visualViewport dimensions *after* keyboard animation.
  const onFocus = () => {
    schedule();
    for (const ms of [80, 250, 500, 850]) {
      const token = win.setTimeout(() => {
        pendingDelays.delete(token);
        schedule();
      }, ms);
      pendingDelays.add(token);
    }
  };
  const onPressStart = () => {
    isPressing = true;
    if (releaseTimer != null) win.clearTimeout(releaseTimer);
  };
  const onPressEnd = () => {
    if (releaseTimer != null) win.clearTimeout(releaseTimer);
    // A premature layout jump after the textarea loses focus can cancel
    // an iPhone tap. Release only after the click has had time to fire.
    releaseTimer = win.setTimeout(() => {
      releaseTimer = null;
      isPressing = false;
      schedule();
    }, 180);
  };

  target.addEventListener("focus", onFocus);
  target.addEventListener("blur", onFocus);
  button.addEventListener("pointerdown", onPressStart);
  button.addEventListener("pointerup", onPressEnd);
  button.addEventListener("pointercancel", onPressEnd);
  viewport?.addEventListener?.("resize", schedule);
  viewport?.addEventListener?.("scroll", schedule);
  win.addEventListener("resize", schedule);
  win.addEventListener("scroll", schedule, { passive: true });
  win.addEventListener("orientationchange", onFocus);

  function detach() {
    if (disposed) return;
    disposed = true;
    if (pendingFrame != null && cancelFrame) cancelFrame(pendingFrame);
    for (const token of pendingDelays) win.clearTimeout(token);
    pendingDelays.clear();
    if (releaseTimer != null) win.clearTimeout(releaseTimer);
    target.removeEventListener("focus", onFocus);
    target.removeEventListener("blur", onFocus);
    button.removeEventListener("pointerdown", onPressStart);
    button.removeEventListener("pointerup", onPressEnd);
    button.removeEventListener("pointercancel", onPressEnd);
    viewport?.removeEventListener?.("resize", schedule);
    viewport?.removeEventListener?.("scroll", schedule);
    win.removeEventListener("resize", schedule);
    win.removeEventListener("scroll", schedule);
    win.removeEventListener("orientationchange", onFocus);
    restore();
  }
  schedule();
  return detach;
}
