const e = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function missionFields(m, tasks, error = "") {
  return `<label class="field">Phương pháp tìm kiếm<select id="search-method">${[
    ["description", "Theo mô tả nhu cầu"],
    ["keywords", "Theo từ khóa"],
    ["examples", "Theo video mẫu"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${m.method === v ? "selected" : ""}>${l}</option>`,
    )
    .join("")}</select></label>
  ${m.method === "description" ? `<label class="field">Bạn muốn tìm nội dung như thế nào?<textarea id="mission-description" rows="8" maxlength="12000" placeholder="Mô tả khán giả, vấn đề, kết quả mong muốn và góc nhìn bạn quan tâm…">${e(m.description)}</textarea></label>` : ""}
  ${m.method === "examples" ? `<label class="field">Video mẫu (tối đa 3 URL, mỗi dòng một video)<textarea id="mission-examples" rows="4" placeholder="https://www.youtube.com/watch?v=…">${e(m.examples.join("\n"))}</textarea></label><p class="muted">AI chỉ dùng tiêu đề và mô tả truy xuất được; chưa xem nội dung đầy đủ.</p>` : ""}
  <details class="mission-options"><summary>Nhiệm vụ đã lưu & tiêu chí bổ sung</summary>${error ? `<p class="warning">${e(error)}</p>` : ""}<label class="field">Mở nhiệm vụ<select id="saved-mission"><option value="">Chọn nhiệm vụ…</option>${tasks.map((t) => `<option value="${e(t.id)}" ${m.task_id === t.id ? "selected" : ""}>${e(t.name)}</option>`).join("")}</select></label><p class="muted">Nghiên cứu gần nhất: ${tasks.find((t) => t.id === m.task_id)?.last_run_at ? e(new Date(tasks.find((t) => t.id === m.task_id).last_run_at).toLocaleString("vi-VN")) : "Chưa chạy"}</p><label class="field">Tên nhiệm vụ<input id="mission-name" maxlength="120" value="${e(m.name)}"></label><label class="field">Tiêu chí bổ sung cho lần tìm này<textarea id="mission-additional" rows="3" maxlength="2000">${e(m.additional)}</textarea></label><div class="research-buttons"><button type="button" data-research="save-mission">Lưu nhiệm vụ</button><button type="button" data-research="new-mission">Nhiệm vụ mới</button><button type="button" data-research="mission-history" ${m.task_id ? "" : "disabled"}>Lịch sử kết quả</button></div><p class="muted">Lưu mô tả, phương pháp, nguồn và tiêu chí riêng; không sửa tiêu chuẩn lâu dài. Lịch hằng ngày/tuần chưa bật.</p></details>
  <details class="search-plan"><summary>Xem chiến lược tìm kiếm</summary><button type="button" data-research="plan">${m.method === "keywords" ? "Xem kế hoạch từ khóa" : "Tạo chiến lược AI"}</button>${
    m.plan
      ? `<dl>${Object.entries(m.plan.intent)
          .map(
            ([k, v]) =>
              `<dt>${e({ audience: "Khán giả", problem: "Vấn đề", outcome: "Kết quả", direct_topics: "Chủ đề trực tiếp", related_topics: "Chủ đề liên quan", selection: "Tiêu chí lựa chọn", exclusions: "Loại trừ" }[k])}</dt><dd>${e(v)}</dd>`,
          )
          .join(
            "",
          )}</dl>${m.plan.groups.map((g, i) => `<div class="plan-group"><label><input type="checkbox" data-plan-enabled="${i}" ${g.enabled !== false ? "checked" : ""}> ${e(g.topic)} · ${e(g.language)} · ${Math.round(g.relevance * 100)}%</label><input aria-label="Truy vấn ${i + 1}" data-plan-query="${i}" maxlength="120" value="${e(g.query)}"><small>${e(g.reason)}</small></div>`).join("")}<label class="field">Thêm hướng tìm kiếm<input id="plan-new-query" maxlength="120"></label><button type="button" data-research="add-plan">Thêm hướng</button><button type="button" data-research="clear-plan">Bỏ chiến lược, tạo lại khi tìm</button>`
      : `<p class="muted">AI tự tạo chiến lược khi Quét ngay; không bắt buộc duyệt trước.</p>`
  }</details>
  <p class="muted">Mô tả, tiêu chuẩn và ghi nhớ đã xác nhận được gửi tới OpenAI khi tìm bằng AI. Tối đa 5 truy vấn YouTube và 20 video đánh giá/lượt; không đọc kịch bản riêng.</p>`;
}
export function captureMission(root, m) {
  const value = (id) => root.querySelector(`#${id}`)?.value;
  const description = value("mission-description") ?? m.description,
    method = value("search-method") ?? m.method;
  const examples =
    value("mission-examples")
      ?.split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean) ?? m.examples;
  if (
    (value("mission-additional") ?? m.additional) !== m.additional ||
    description !== m.description ||
    method !== m.method ||
    JSON.stringify(examples) !== JSON.stringify(m.examples)
  )
    m.plan = null;
  const next = {
    ...m,
    description,
    method,
    examples,
    name: value("mission-name") ?? m.name,
    additional: value("mission-additional") ?? m.additional,
    source:
      { channels: "channels", keywords: "youtube", combined: "combined" }[
        root.querySelector("[name=mode]")?.value
      ] || m.source,
  };
  if (next.plan)
    next.plan = {
      ...next.plan,
      groups: next.plan.groups.map((g, i) => ({
        ...g,
        query: root.querySelector(`[data-plan-query="${i}"]`)?.value ?? g.query,
        enabled:
          root.querySelector(`[data-plan-enabled="${i}"]`)?.checked ??
          g.enabled,
      })),
    };
  return next;
}
