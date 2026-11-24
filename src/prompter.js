import {cloud} from './cloud.js';

const setting = import.meta.env.VITE_PROMPTER_URL;
export const prompterUrl = (() => {
  if (!setting) return null;
  try {
    const url = new URL(setting);
    const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(import.meta.env.DEV && local && url.protocol === 'http:')) return null;
    if (url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
})();

export function scriptLink(id) {
  const url = new URL(prompterUrl);
  url.searchParams.set('script', id);
  return url.href;
}

export async function sendToPrompter(video) {
  const {data, error} = await cloud.rpc('send_to_prompter', {
    content_id: video.id,
    expected_revision: video.revision,
  }).single();
  if (error) throw error;
  return data;
}
