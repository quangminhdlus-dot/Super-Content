const DAY = 86400000;
const median = (values) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length
    ? (a[Math.floor((a.length - 1) / 2)] + a[Math.ceil((a.length - 1) / 2)]) / 2
    : null;
};
export const durationBucket = (seconds) =>
  seconds === null
    ? "unknown"
    : seconds <= 180
      ? "short"
      : seconds <= 1200
        ? "medium"
        : "long";
export function velocity(video, snapshots, now) {
  const previous = snapshots
    .filter(
      (s) =>
        s.youtube_id === video.youtube_id &&
        now - Date.parse(s.captured_at) >= 3600000 &&
        now - Date.parse(s.captured_at) <= 30 * DAY,
    )
    .sort((a, b) => Date.parse(b.captured_at) - Date.parse(a.captured_at))[0];
  return previous && Number(previous.views) <= video.views
    ? (video.views - Number(previous.views)) /
        ((now - Date.parse(previous.captured_at)) / DAY)
    : null;
}
export function scoringContext(pool, snapshots, now) {
  const byId = new Map();
  for (const snapshot of snapshots) {
    const list = byId.get(snapshot.youtube_id) || [];
    list.push(snapshot);
    byId.set(snapshot.youtube_id, list);
  }
  return new Map(
    pool.map((video) => [
      video.youtube_id,
      velocity(
        video,
        byId.get(video.youtube_id) || [],
        video.collected_at ? Date.parse(video.collected_at) : now,
      ),
    ]),
  );
}
export function scoreVideo(
  video,
  pool,
  snapshots,
  keywords,
  now = Date.now(),
  context = null,
) {
  const age = Math.max(1 / 24, (now - Date.parse(video.published_at)) / DAY),
    bucket = durationBucket(video.duration_seconds);
  const peers = pool.filter(
    (p) =>
      p.youtube_id !== video.youtube_id &&
      (!p.collected_at || now - Date.parse(p.collected_at) <= DAY) &&
      now - Date.parse(video.published_at) >= 3600000 &&
      now - Date.parse(p.published_at) >= 3600000 &&
      p.channel_id === video.channel_id &&
      !!video.category_id &&
      p.category_id === video.category_id &&
      bucket !== "unknown" &&
      durationBucket(p.duration_seconds) === bucket &&
      Math.max(1 / 24, (now - Date.parse(p.published_at)) / DAY) / age >= 0.5 &&
      Math.max(1 / 24, (now - Date.parse(p.published_at)) / DAY) / age <= 2,
  );
  const baseline = median(peers.map((v) => v.views)),
    ratio = peers.length >= 5 && baseline > 0 ? video.views / baseline : null;
  const speed = context
      ? context.get(video.youtube_id)
      : velocity(video, snapshots, now),
    peerSpeeds = peers
      .map((p) =>
        context ? context.get(p.youtube_id) : velocity(p, snapshots, now),
      )
      .filter((v) => v !== null),
    baseSpeed = median(peerSpeeds),
    growthRatio =
      peerSpeeds.length >= 5 && baseSpeed > 0 && speed !== null
        ? speed / baseSpeed
        : null;
  const text = `${video.title} ${video.description}`.toLocaleLowerCase("vi"),
    tokens = keywords
      .flatMap((k) => k.toLocaleLowerCase("vi").split(/\s+/))
      .filter((t) => t.length > 1),
    matches = tokens.filter((t) => text.includes(t)).length;
  const relevance = tokens.length
    ? matches / tokens.length
    : video.sources.some((s) => s.startsWith("Kênh:"))
      ? 1
      : 0;
  const likes =
      video.likes === null ? null : video.likes / Math.max(video.views, 1),
    comments =
      video.comments === null
        ? null
        : video.comments / Math.max(video.views, 1);
  const eligible =
    (ratio !== null && ratio >= 2) ||
    (growthRatio !== null && growthRatio >= 2);
  const score = Math.round(
    Math.min(40, (ratio || 0) * 10) +
      Math.min(25, (growthRatio || 0) * 8) +
      Math.min(10, (likes || 0) * 200) +
      Math.min(5, (comments || 0) * 500) +
      relevance * 20,
  );
  const reasons = [
    ratio === null
      ? `Chưa đủ mẫu cùng kênh, danh mục, độ dài và tuổi video (${peers.length}/5 mẫu).`
      : `Lượt xem bằng ${ratio.toFixed(2)}× trung vị ${peers.length} video tương đồng (${Math.round(baseline).toLocaleString("vi-VN")} lượt).`,
    speed === null
      ? "Chưa có hai lần ghi nhận cách nhau ít nhất 1 giờ để đo tăng trưởng."
      : `Tăng khoảng ${Math.round(speed).toLocaleString("vi-VN")} lượt/ngày giữa các lần ghi nhận; ${growthRatio === null ? "chưa đủ mẫu để kết luận tăng trưởng vượt trội." : `${growthRatio.toFixed(2)}× tốc độ trung vị nhóm so sánh.`}`,
    comments === null
      ? "Kênh không cung cấp số bình luận."
      : `Mật độ bình luận ${(comments * 100).toFixed(2)}%; số lượng không chứng minh có tranh luận.`,
    tokens.length
      ? `Khớp ${matches}/${tokens.length} thành phần từ khóa (đối chiếu văn bản, chưa hiểu ngữ nghĩa).`
      : "Phù hợp nguồn kênh đã chọn.",
  ];
  return {
    score,
    eligible,
    confidence:
      ratio !== null && growthRatio !== null
        ? "medium"
        : ratio !== null
          ? "limited"
          : "low",
    peers: peers.length,
    view_ratio: ratio,
    views_per_day: speed,
    growth_ratio: growthRatio,
    relevance,
    reasons,
    angle: `Đối chiếu luận điểm của “${video.title}” với trải nghiệm hoặc dữ liệu riêng của bạn; bổ sung ví dụ thực tế và tránh sao chép kịch bản.`,
    angle_source: "editorial_template",
    method: "age-duration-v1",
    note: "Danh mục YouTube và độ dài chỉ là đại diện cho loại nội dung, không xác định chắc chắn Shorts hay cùng thể loại chi tiết. Đây là sàng lọc cơ hội, không phải dự báo thành công.",
  };
}
