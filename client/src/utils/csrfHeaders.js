function readCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

/** CSRF headers for same-origin JSON POSTs. */
export function csrfHeaders(extra) {
  return {
    'X-Requested-With': 'XMLHttpRequest',
    'X-XSRF-Token': readCookie('XSRF-TOKEN'),
    ...(extra || {})
  };
}
