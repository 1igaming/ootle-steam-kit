export const HEADER_STICKY_KEY = 'ootle.keepHeaderVisible';

export function readKeepHeaderVisible() {
  try {
    return localStorage.getItem(HEADER_STICKY_KEY) === '1';
  } catch (_) {
    return false;
  }
}

export function writeKeepHeaderVisible(on) {
  try {
    if (on) localStorage.setItem(HEADER_STICKY_KEY, '1');
    else localStorage.removeItem(HEADER_STICKY_KEY);
  } catch (_) {
    // Preference stays off when storage is blocked.
  }
  try {
    window.dispatchEvent(new Event('dapp-header-sticky'));
  } catch (_) {
    // Same-tab listeners are optional.
  }
}
