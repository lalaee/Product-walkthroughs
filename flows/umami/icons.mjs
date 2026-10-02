// Site icons for Umami: it asks an online service for them (icons.duckduckgo.com), which this
// machine can't reach. Taskly's own gets its logo; every other site a plain grey tile with its
// initial (not that site's logo).
const TASKLY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b5bf7"/><stop offset="1" stop-color="#9b5bf7"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#g)"/></svg>';
const tile = letter => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#e4e7ec"/><text x="16" y="21.5" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#667085" text-anchor="middle">${letter}</text></svg>`;

export function routeIcons(page) {
  return page.route('https://icons.duckduckgo.com/**', route => {
    const domain = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()).replace(/\.ico$/, '');
    route.fulfill({contentType: 'image/svg+xml', body: domain.includes('taskly') ? TASKLY_ICON : tile(domain.replace(/^www\./, '')[0].toUpperCase())});
  });
}
