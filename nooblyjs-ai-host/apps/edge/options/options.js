// Settings: where NooblyJS is. Any address other than the localhost default needs the person's permission
// for that one origin (optional_host_permissions), asked for when they save.
import { checkNoobly, nooblyUrl, setNooblyUrl } from '../shared.js';

const form = document.getElementById('settings');
const input = document.getElementById('noobly-url');
const result = document.getElementById('result');

input.value = await nooblyUrl();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  let url;
  try {
    url = new URL(input.value);
  } catch {
    result.textContent = 'That is not a web address.';
    return;
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    result.textContent = 'Use an https address (http is only for localhost).';
    return;
  }
  if (url.hostname !== 'localhost') {
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) {
      result.textContent = `Not saved: the extension needs your permission to reach ${url.origin}.`;
      return;
    }
  }
  await setNooblyUrl(url.origin);
  const check = await checkNoobly();
  result.textContent = check.ok ? `Saved. Connected to NooblyJS at ${check.url}.` : `Saved, but ${check.reason?.toLowerCase() || 'NooblyJS is not reachable'} at ${check.url}.`;
});
