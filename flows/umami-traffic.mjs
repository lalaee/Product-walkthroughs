// Umami (github.com/umami-software/umami): find out where a spike in traffic came from.
//
// The real Umami (built from source, on Postgres) with a month of visits to the Taskly site sent
// through its own tracking API (flows/umami/traffic.mjs): the last 30 days show a spike, and one
// click on a referrer says it was Hacker News.
//
// Needs Umami running (UMAMI_URL, default http://localhost:3100; see the README).
import {login, month, send} from './umami/traffic.mjs';

export const name = 'Umami — where did that spike come from?';
export const size = '1440x900';
export const scale = 4 / 3; // 1920×1200: HD, sharp when zoomed
export const aspect = '16:10';
export const lead = 500;

export const plan = {
  what: 'Umami is privacy-first web analytics: traffic, sources and behaviour, without cookies.',
  audience: 'People who run a website and want to know what brings visitors in.',
  hook: 'Open on the answer: the visitors from Hacker News, the spike in the chart.',
  flow: ["Taskly's dashboard in Umami", 'Last 30 days: one day stands out', 'Sources: click news.ycombinator.com', 'The dashboard filters to it: the spike was Hacker News'],
  duration: [12, 22],
  milestones: [{beat: 'Last 30 days', by: 6}, {beat: 'news.ycombinator.com', by: 14}]
};
export const hook = {mark: 'payoff', seconds: 2.5};
export const poster = 'from Hacker News';
// (the number is Umami's own, read off the dashboard at the end)
export let share = n => `One day in the chart towers over the rest. In Umami that is two clicks: last 30 days, then the referrer. ${n} visitors from Hacker News.`;

const BASE = process.env.UMAMI_URL ?? 'http://localhost:3100';
export let url = `${BASE}/websites`;

// Site icons: Umami asks an online service for them, which this machine can't reach. Taskly's own
// gets its logo; every other site a plain grey tile with its initial (not that site's logo).
const TASKLY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b5bf7"/><stop offset="1" stop-color="#9b5bf7"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#g)"/></svg>';
const tile = letter => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#e4e7ec"/><text x="16" y="21.5" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#667085" text-anchor="middle">${letter}</text></svg>`;

/** A fresh Taskly website with a month of traffic, signed in. */
export async function setup(page) {
  const token = await login(BASE).catch(() => {
    throw new Error(`Umami isn't running at ${BASE} (start it: cd umami && pnpm start)`);
  });
  const h = {'content-type': 'application/json', authorization: `Bearer ${token}`};
  // start from one Taskly website and nothing else, so every run is the same
  const sites = await (await fetch(`${BASE}/api/websites?pageSize=100`, {headers: h})).json();
  for (const w of sites.data ?? []) await fetch(`${BASE}/api/websites/${w.id}`, {method: 'DELETE', headers: h});
  const site = await (await fetch(`${BASE}/api/websites`, {method: 'POST', headers: h, body: JSON.stringify({name: 'Taskly', domain: 'taskly.app'})})).json();
  const {failed} = await send(BASE, month({website: site.id}));
  if (failed) throw new Error(`${failed} visits weren't accepted`);
  url = `${BASE}/websites/${site.id}?date=24hour`;

  await page.route('https://icons.duckduckgo.com/**', route => {
    const domain = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()).replace(/\.ico$/, '');
    route.fulfill({contentType: 'image/svg+xml', body: domain.includes('taskly') ? TASKLY_ICON : tile(domain.replace(/^www\./, '')[0].toUpperCase())});
  });
  await page.goto(`${BASE}/login`);
  await page.evaluate(t => localStorage.setItem('umami.auth', JSON.stringify(t)), token);
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  const range = page.getByRole('combobox').filter({hasText: 'Last 24 hours'});
  await range.waitFor();
  await d.click(range, {hold: 900, show: page.getByRole('option', {name: 'Last 30 days'}), label: 'the date range'});
  await d.click(page.getByRole('option', {name: 'Last 30 days'}), {hold: 1500, show: page.locator('canvas').first(), label: 'Last 30 days'});

  // the spike: the tallest bar in the chart, found in its pixels
  const chart = page.locator('canvas').first();
  const spike = await chart.evaluate(c => {
    const g = c.getContext('2d'), {width, height} = c, data = g.getImageData(0, 0, width, height).data;
    let best = {x: 0, top: height};
    for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4;
      if (data[i + 2] > 200 && data[i] < 140 && data[i + 1] < 190) { // the bars' blue
        if (y < best.top) best = {x, top: y};
        break;
      }
    }
    const r = c.getBoundingClientRect(), k = r.width / width;
    return {x: Math.round(r.x + best.x * k), y: Math.round(r.y + (best.top + (height - best.top) * 0.35) * k), top: Math.round(r.y), h: Math.round(r.height)};
  });
  // the spike and the days around it, top to bottom of the chart
  await d.point({x: spike.x, y: spike.y}, {hold: 1500, show: {x: spike.x - 240, y: spike.top, w: 480, h: spike.h}, label: 'the spike', zoom: 1.6});

  // where it came from: the referrers, and the one that stands out
  const hn = page.getByRole('link', {name: 'news.ycombinator.com'}).first();
  await d.scroll(hn, {label: 'Sources'});
  // the dashboard filters to that referrer: a chip at the top says so
  const chip = page.getByText('Referrer', {exact: true}).first().locator('xpath=ancestor::*[3]');
  await d.click(hn, {hold: 1800, show: chip, label: 'news.ycombinator.com'});
  // its visitors: the filter and the number, together
  const visitors = page.getByText('Visitors', {exact: true}).first();
  await d.point(visitors, {hold: 2200, show: [chip, visitors.locator('xpath=ancestor::*[2]')], label: 'from Hacker News', zoom: 1.8});
  d.marks.payoff = d.beats.at(-1).t + 200;
  share = share((await visitors.locator('xpath=ancestor::*[2]').innerText()).split('\n')[1]);
}
