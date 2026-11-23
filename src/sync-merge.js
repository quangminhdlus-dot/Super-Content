// A conservative three-way sync merge: if both sides changed the same
// field differently, stop and preserve the copies for manual resolution.
export const SYNC_FIELDS = [
  "title", "stage", "source_url", "notes", "script",
  "postproduction_notes", "draft_url", "youtube_url", "published_at",
  "archived_at", "deleted_at", "purged_at",
];
const same = (a, b) => (a ?? null) === (b ?? null);
export function sameVideoContent(a, b) {
  return !!a && !!b && a.id === b.id && a.user_id === b.user_id &&
    SYNC_FIELDS.every((key) => same(a[key], b[key]));
}
export function mergeCloudVideo(local, base, remote) {
  if (!local || !remote || local.id !== remote.id || local.user_id !== remote.user_id) return null;
  if (!base) return sameVideoContent(local, remote) ? { ...remote } : null;
  if (base.id !== local.id || base.user_id !== local.user_id) return null;
  const combined = { ...remote };
  for (const field of SYNC_FIELDS) {
    const localChanged = !same(local[field], base[field]);
    const serverChanged = !same(remote[field], base[field]);
    if (localChanged && serverChanged && !same(local[field], remote[field])) return null;
    if (localChanged) combined[field] = local[field];
  }
  return combined;
}
