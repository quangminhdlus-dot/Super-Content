const iconPaths = {
  back: "M19 12H5m7 7-7-7 7-7",
  camera: "M4 7h4l2-2h4l2 2h4v12H4z M15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  mic: "M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M5 11a7 7 0 0 0 14 0m-7 7v4m-3 0h6",
  gear: "M9 3h6l1 3 3 1 2 4-2 2v3l-4 3-3-1-3 1-4-3v-3l-2-2 2-4 3-1z M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  close: "m6 6 12 12m0-12L6 18",
  font: "M3 18l5-12 5 12M5 14h6m3 4 3.5-9 3.5 9m-5.7-3h4.4",
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[name]}"/></svg>`;
const iconButton = (name, label, id) => `<button type="button" class="sc-p-icon" data-p="${id}" aria-label="${label}">${icon(name)}</button>`;

export function createStudioView(readOnly) {
  const overlay = document.createElement("dialog");
  overlay.className = "prompter-overlay";
  overlay.setAttribute("aria-label", readOnly ? "Nhắc chữ" : "Quay với Prompter");
  overlay.innerHTML = `
    <div class="sc-p-backdrop" data-p="background" aria-hidden="true">
      <div class="sc-p-camera-frame" data-p="cameraFrame" hidden>
        <video data-p="camera" class="sc-p-camera-video" autoplay muted playsinline aria-hidden="true"></video>
        <div class="sc-p-blackout" data-p="blackout"></div>
        <div class="sc-p-camera-grid"></div>
      </div>
    </div>
    <header class="sc-p-top">
      ${iconButton("back", "Về kịch bản", "back")}
      <div class="sc-p-status">
        <span class="sc-p-device" data-p="cameraState" title="Camera">${icon("camera")}</span>
        <span class="sc-p-device" data-p="micState" title="Micro">${icon("mic")}<meter data-p="signal" min="0" max="1" value="0" aria-label="Tín hiệu micro"></meter></span>
        <span data-p="recordTime" class="sc-p-live" hidden></span>
        <span data-p="status" class="sc-p-message" role="status"></span>
      </div>
    </header>
    <div class="sc-p-stage" data-p="stage">
      <div class="sc-p-scroll" data-p="scroll" tabindex="0" aria-label="Nội dung kịch bản">
        <div class="sc-p-script" data-p="script" data-testid="reader"></div>
      </div>
      <div class="sc-p-guide" data-p="guide">
        <button type="button" class="sc-p-grip" role="slider" aria-label="Vị trí đọc bên trái" aria-orientation="vertical"></button>
        <button type="button" class="sc-p-grip" role="slider" aria-label="Vị trí đọc bên phải" aria-orientation="vertical"></button>
      </div>
      <div data-p="count" class="sc-p-count" role="status" hidden></div>
    </div>
    <footer class="sc-p-bottom">
      <button type="button" data-p="retry" class="sc-p-secondary" hidden>Thử lại</button>
      <label class="sc-p-range">${icon("font")}<input type="range" min="24" max="100" data-p="font" aria-label="Cỡ chữ"><output data-p="fontValue"></output></label>
      <div class="sc-p-modes" role="group" aria-label="Chế độ nhắc chữ">
        <button type="button" data-mode="voice">Theo giọng nói</button>
        <button type="button" data-mode="fixed">Tốc độ cố định</button>
        <button type="button" data-mode="manual">Thủ công</button>
      </div>
      <label class="sc-p-range" data-p="speedRow" hidden><span>WPM</span><input type="range" min="50" max="260" step="5" data-p="speed" aria-label="Tốc độ đọc"><output data-p="speedValue"></output></label>
      <div class="sc-p-actions">
        ${iconButton("camera", "Đổi camera", "flip")}
        <button type="button" class="sc-p-record" data-p="record" aria-label="Bắt đầu quay"><span></span></button>
        ${iconButton("gear", "Cài đặt", "settingsBtn")}
      </div>
    </footer>
    <section class="sc-p-sheet" data-p="settings" role="region" aria-label="Cài đặt Prompter" hidden>
      <header><h2>Cài đặt</h2>${iconButton("close", "Đóng cài đặt", "settingsClose")}</header>
      <label data-p="countdownRow">Đếm ngược <input type="number" aria-label="Đếm ngược" min="1" max="10" data-p="countdown"> giây</label>
      <label data-p="framingRow">Hướng quay <select data-p="framing"><option value="portrait">Dọc 9:16</option><option value="landscape">Ngang 16:9</option></select></label>
      <label class="sc-p-cover-row" data-p="coverRow">
        Độ phủ đen của camera
        <span><input type="range" min="0" max="100" step="1" data-p="cover" aria-label="Độ phủ đen của camera"><output data-p="coverValue"></output></span>
      </label>
      <label>Giữ màn hình sáng <input type="checkbox" data-p="wake"></label>
      <details data-p="advanced"><summary>Micro</summary><label>Thiết bị <select data-p="mic" aria-label="Micro"><option value="">Micro hệ thống</option></select></label></details>
      <button type="button" data-p="draftsBtn" class="sc-p-secondary">Kho Video</button>
    </section>
    <section class="sc-p-sheet sc-p-review" data-p="review" role="region" aria-label="Xem lại video" hidden>
      <header><h2 data-p="reviewTitle">Xem lại video</h2>${iconButton("close", "Đóng xem lại", "reviewClose")}</header>
      <video data-p="reviewVideo" controls playsinline preload="metadata"></video>
      <p data-p="reviewOrientation"></p>
      <p data-p="reviewMessage" role="status"></p>
      <div class="sc-p-review-actions">
        <button type="button" data-p="save" class="sc-p-primary">Lưu vào iPhone</button>
        <button type="button" data-p="download" class="sc-p-secondary">Tải xuống</button>
        <button type="button" data-p="retake" class="sc-p-secondary">Quay lại</button>
        <button type="button" data-p="discard" class="sc-p-secondary">Xóa</button>
        <button type="button" data-p="draftsFromReview" class="sc-p-secondary">Kho Video</button>
      </div>
      <div class="sc-p-review-actions">
        <button type="button" data-p="confirmSaved" class="sc-p-primary" hidden>Đã lưu trên thiết bị</button>
        <button type="button" data-p="complete" class="sc-p-primary" hidden>Chuyển sang Hoàn thiện</button>
      </div>
    </section>`;
  const el = Object.fromEntries([...overlay.querySelectorAll("[data-p]")].map(node => [node.dataset.p, node]));
  const modeButtons = [...overlay.querySelectorAll("[data-mode]")];
  const backdrop = [el.settings, el.review];
  return {overlay, el, backdrop, modeButtons};
}
