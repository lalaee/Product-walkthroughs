// Rottoways (github.com/lalaee/Rottoways): what the design system pack does to an AI-built
// landing page, as a visitor to its site sees it. The site's own demo has a Before / After toggle:
// the same landing page as AI tools build it by default, then rendered through the pack.
//
// The real site, built from its repo (vite build) and served locally (ROTTOWAYS_URL, default
// http://localhost:4321; see the README). Its analytics (PostHog) are blocked so the recording
// doesn't count as visits, and the checkout isn't opened: the video ends on the price.
export const name = 'Rottoways: before and after';
export const size = '1440x900';
export const scale = 4 / 3; // 1920×1200: HD, sharp when zoomed
export const aspect = '16:10';
export const lead = 600;
// narration (optional): ElevenLabs, with ELEVENLABS_API_KEY set; this voice unless --voice / ELEVENLABS_VOICE
export const voice = 'Xb7hH8MSUJpSbSDYk0k2';

export const plan = {
  what: 'Rottoways is a design system pack you paste into Lovable, Cursor or Claude so an AI-built landing page stops looking like AI slop.',
  audience: 'Founders and indie builders with a vibecoded landing page.',
  flow: ['The pitch', 'Before: the page as AI tools build it', 'After: the same page with the pack', 'Your copy stays, the design changes', 'How you use it: renovate or start new', "What's in the pack", 'The price'],
  duration: [25, 50],
  milestones: [{beat: 'Before', by: 10}, {beat: 'After', by: 22}]
};
export const poster = 'After';
export const share = 'Your AI-built landing page, before and after Rottoways: same copy, a design that doesn\'t look like every other vibecoded site. $19, once.';

export const url = process.env.ROTTOWAYS_URL ?? 'http://localhost:4321/';

export async function setup(page) {
  // the site's analytics: blocked, so a recording isn't counted as a visitor
  await page.route(/posthog/, route => route.abort());
}

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  const hero = page.getByRole('heading', {name: /Stop your website/});
  await hero.waitFor();
  // 1. the pitch
  await d.point(hero, {hold: 2200, show: [hero, page.getByText(/A design system you paste into/)], label: 'the pitch',
    caption: 'Stop your site looking like AI slop', narrate: 'This is Rottoways. It stops your website from looking like AI slop.'});

  // 2. before: the demo landing page as AI tools build it
  const toggle = name => page.getByRole('button', {name: new RegExp(`^${name}`)});
  const demoHero = page.getByRole('heading', {name: 'Automations in plain English.'});
  await d.click(toggle('Before'), {hold: 900, show: toggle('Before'), label: 'Before',
    caption: 'Before: a typical AI-built landing page', narrate: "Here's a landing page the way AI tools build it by default:"});
  await d.scroll(demoHero, {hold: 2000, show: demoHero, label: 'the AI default',
    caption: 'Purple gradients, everything centred', narrate: 'purple gradients, and everything centred.'});

  // 3. after: the same page through the design system
  await d.click(toggle('After'), {hold: 2600, show: demoHero, label: 'After',
    caption: 'After: the same page, with the design system', narrate: 'Switch to After: the same page, with the Rottoways design system.'});
  const section = page.getByRole('heading', {name: 'Automate anything. In plain English.'});
  await d.scroll(section, {hold: 2400, show: section, label: 'same copy, new design',
    caption: 'Your copy stays; only the design changes', narrate: 'Your copy stays word for word. Only the design changes.'});

  // 4. how you use it, and what you get
  const how = page.getByRole('heading', {name: /Renovate what you already vibecoded/});
  await d.scroll(how, {hold: 2600, show: how, label: 'how it works',
    caption: 'Renovate your site, or start a new one', narrate: "Use it to renovate a site you've already built, or to start a new one."});
  const pack = page.getByRole('heading', {name: "What's in the pack"});
  await d.scroll(pack, {hold: 2800, show: pack, label: "what's in the pack",
    caption: 'The design system, prompts and tutorials', narrate: 'The pack has the design system, paste-ready prompts, and video tutorials.'});

  // 5. the price (not clicked: it opens a real checkout)
  const cta = page.getByText('Remove the AI-slop look from your AI generated website.');
  const buy = cta.locator('xpath=following::button[1]');
  const terms = cta.locator('xpath=following::*[contains(text(), "14 days refund")][1]');
  // (the whole call to action: its line, the button and the terms, so nothing's cut at the edge)
  await d.point(buy, {hold: 2600, show: [cta, buy, terms], label: 'the price', zoom: 1.3,
    caption: '$19 once, for unlimited projects', narrate: "It's nineteen dollars, once, for unlimited projects."});
}
