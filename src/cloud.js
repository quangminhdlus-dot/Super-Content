import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloud =
  url && key
    ? createClient(url, key, {
        global: {
          fetch: (input, init = {}) =>
            fetch(input, {
              ...init,
              signal: AbortSignal.any([
                ...(init.signal ? [init.signal] : []),
                AbortSignal.timeout(15000),
              ]),
            }),
        },
      })
    : null;
export async function fetchVideos() {
  const result = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await cloud
      .from("content_videos")
      .select("*")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    result.push(...data);
    if (data.length < 1000) return result;
  }
}
export async function saveVideo(video, expected) {
  const { data, error } = await cloud.rpc("save_content_video", {
    payload: video,
    expected_revision: expected,
  });
  if (error) throw error;
  return data?.[0] || null;
}
