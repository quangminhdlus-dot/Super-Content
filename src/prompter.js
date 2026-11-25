export function openPrompter(source, callbacks) {
  const overlay = document.createElement("dialog");
  overlay.className = "prompter-overlay";
  overlay.setAttribute("aria-label", source.mode === "read" ? "Nhắc chữ" : "Quay với Prompter");
  const frame = document.createElement("iframe");
  frame.title = overlay.getAttribute("aria-label");
  frame.allow = "camera 'self'; microphone 'self'; web-share 'self'; fullscreen 'self'";
  const loading = document.createElement("button");
  loading.type = "button";
  loading.textContent = "Đang mở Prompter… · Về kịch bản";
  frame.hidden = true;
  overlay.append(loading, frame);
  document.body.append(overlay);
  let finishing = false;
  function close() {
    clearTimeout(timeout);
    window.removeEventListener("message", onMessage);
    overlay.close();
    overlay.remove();
    callbacks.closed();
  }
  async function onMessage(event) {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    if (event.data?.type === "super-content:prompter-ready") {
      clearTimeout(timeout);
      frame.contentWindow.postMessage({ ...source, type: "super-content:load-prompter" }, location.origin);
      frame.hidden = false;
      loading.remove();
      frame.focus();
    } else if (event.data?.type === "super-content:close-prompter" && !finishing) {
      close();
    } else if (event.data?.type === "super-content:complete-filming" && source.canComplete && !finishing) {
      finishing = true;
      try {
        await callbacks.complete();
      } catch {
        frame.contentWindow?.postMessage({ type: "super-content:completion-error" }, location.origin);
      } finally {
        finishing = false;
      }
    }
  }
  const timeout = setTimeout(() => { close(); callbacks.error(); }, 15000);
  loading.addEventListener("click", close);
  overlay.addEventListener("cancel", (event) => event.preventDefault());
  window.addEventListener("message", onMessage);
  frame.src = new URL("./prompter/index.html", document.baseURI);
  overlay.showModal();
  return close;
}
