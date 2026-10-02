// Traffic for an Umami walkthrough: a month of plausible visits to a site, sent through Umami's own
// tracking API (/api/send, the same endpoint its tracker script calls) with the time, visitor IP
// and browser of each one, so Umami does everything else itself: sessions, countries, devices.
//
// The site is Taskly (the demo app): visits grow over the month, dip at weekends, spike the day it
// was on Hacker News, and come from search, links and social; some visitors sign up.

const DAY = 86_400_000;

/** A small seeded random generator, so every run makes the same month. */
export function rng(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pick = (r, weighted) => {
  const total = weighted.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of weighted) if ((x -= w) <= 0) return v;
  return weighted.at(-1)[0];
};

// visitors' networks: a base address in each country (GeoLite places these there); the last part varies
const PLACES = [
  ['24.48.0', 6], ['99.79.0', 3], ['45.33.32', 14], ['8.8.8', 10], ['185.199.108', 6], // CA, US
  ['81.2.69', 6], ['178.62.0', 4], ['85.214.132', 5], ['37.120.0', 4], ['5.9.0', 2], // GB, DE
  ['195.154.0', 3], ['62.210.0', 3], ['51.15.0', 4], ['122.160.0', 6], ['49.205.0', 3], // FR, NL, IN
  ['200.160.2', 3], ['187.1.0', 2], ['139.130.4', 2], ['110.33.0', 2], ['133.242.0', 2], ['202.12.27', 2], // BR, AU, JP
  ['102.89.0', 2], ['41.58.0', 2], ['196.25.1', 2], ['223.130.195', 2] // NG, ZA, KR
];
const BROWSERS = [
  [{ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', screen: '1920x1080'}, 30],
  [{ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', screen: '1512x982'}, 17],
  [{ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', screen: '1440x900'}, 11],
  [{ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', screen: '393x852'}, 16],
  [{ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', screen: '412x915'}, 11],
  [{ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', screen: '1536x864'}, 6],
  [{ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', screen: '1920x1080'}, 7],
  [{ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', screen: '2560x1440'}, 2]
];
const LANGUAGES = [['en-US', 55], ['en-GB', 12], ['de-DE', 9], ['fr-FR', 7], ['pt-BR', 5], ['ja-JP', 4], ['hi-IN', 4], ['es-ES', 4]];
const REFERRERS = [['https://www.google.com/', 34], ['', 26], ['https://github.com/', 9], ['https://x.com/', 7], ['https://www.reddit.com/', 5], ['https://www.producthunt.com/', 4], ['https://duckduckgo.com/', 4], ['https://www.bing.com/', 3], ['https://news.ycombinator.com/', 3]];
const PAGES = {
  '/': 'Taskly — projects and tasks, simply',
  '/features': 'Features — Taskly',
  '/pricing': 'Pricing — Taskly',
  '/blog/launch-week': 'Launch week — Taskly blog',
  '/docs/getting-started': 'Getting started — Taskly docs',
  '/signup': 'Sign up — Taskly'
};
// where a visit goes next, from each page
const NEXT = {
  '/': [['/features', 30], ['/pricing', 30], ['/blog/launch-week', 10], [null, 30]],
  '/features': [['/pricing', 45], ['/docs/getting-started', 15], [null, 40]],
  '/pricing': [['/signup', 30], ['/features', 10], [null, 60]],
  '/blog/launch-week': [['/', 25], ['/pricing', 15], [null, 60]],
  '/docs/getting-started': [['/signup', 20], [null, 80]],
  '/signup': [[null, 100]]
};

/** One visit: its pageviews (and a signup event when it signs up), as /api/send payloads. */
function visit(r, {website, hostname, at, referrer}) {
  const b = pick(r, BROWSERS);
  const ip = `${pick(r, PLACES)}.${1 + Math.floor(r() * 250)}`;
  const base = {website, hostname, language: pick(r, LANGUAGES), screen: b.screen, ip, userAgent: b.ua};
  let url = referrer.includes('ycombinator') ? '/blog/launch-week' : pick(r, [['/', 60], ['/features', 12], ['/pricing', 12], ['/blog/launch-week', 8], ['/docs/getting-started', 8]]);
  const out = [];
  let t = at, ref = referrer;
  for (let i = 0; url && i < 6; i++) {
    out.push({...base, url, title: PAGES[url], referrer: ref, timestamp: Math.floor(t / 1000)});
    if (url === '/signup' && r() < 0.55) out.push({...base, url, title: PAGES[url], name: 'signup', timestamp: Math.floor((t + 20_000 + r() * 60_000) / 1000)});
    ref = `https://${hostname}${url}`;
    t += 15_000 + r() * 120_000;
    url = pick(r, NEXT[url]);
  }
  return out;
}

/** The month of visits up to `now`: [{payload}] in time order. */
export function month({website, hostname = 'taskly.app', now = Date.now(), days = 30, seed = 7}) {
  const r = rng(seed);
  const events = [];
  for (let d = days; d >= 0; d--) {
    const day = new Date(now - d * DAY);
    day.setUTCHours(0, 0, 0, 0);
    const weekend = [0, 6].includes(day.getUTCDay());
    let n = Math.round((55 + (days - d) * 2.2) * (weekend ? 0.62 : 1) * (0.85 + r() * 0.3));
    const hn = d === 9; // the day it was on Hacker News
    for (let i = 0; i < n + (hn ? 420 : 0); i++) {
      const hackerNews = hn && i >= n;
      // visits peak in the afternoon and evening (UTC); the HN crowd arrives through the day
      const hour = hackerNews ? 9 + r() * 14 : pick(r, Array.from({length: 24}, (_, h) => [h, 2 + 6 * Math.exp(-((h - 16) ** 2) / 30)])) + r();
      const at = day.getTime() + hour * 3_600_000;
      if (at > now) continue;
      events.push(...visit(r, {website, hostname, at, referrer: hackerNews ? 'https://news.ycombinator.com/' : pick(r, REFERRERS)}));
    }
  }
  return events.filter(e => e.timestamp * 1000 <= now).sort((a, b) => a.timestamp - b.timestamp);
}

/** A few visits arriving right now (no timestamp: Umami stamps them as they come). */
export function live({website, hostname = 'taskly.app', seed = 99, n = 5}) {
  const r = rng(seed);
  return Array.from({length: n}, () => visit(r, {website, hostname, at: Date.now(), referrer: pick(r, REFERRERS)})[0]).map(({timestamp, ...e}) => e);
}

/** Sends events to Umami, a few at a time. */
export async function send(base, events, {concurrency = 12} = {}) {
  let i = 0, failed = 0;
  const worker = async () => {
    while (i < events.length) {
      const payload = events[i++];
      const res = await fetch(`${base}/api/send`, {method: 'POST', headers: {'content-type': 'application/json', 'user-agent': payload.userAgent}, body: JSON.stringify({type: 'event', payload})});
      if (!res.ok) failed++;
    }
  };
  await Promise.all(Array.from({length: concurrency}, worker));
  return {sent: events.length, failed};
}

/** Logs in and returns the token for Umami's API. */
export async function login(base, username = 'admin', password = 'umami') {
  const res = await fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username, password})});
  if (!res.ok) throw new Error(`Umami login failed: ${res.status}`);
  return (await res.json()).token;
}
