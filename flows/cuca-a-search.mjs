// Cuca Vision, approach A · Search (search.html, port 5174): help led by search. Your account →
// Help and contact → search "I want to cancel my order" → results → the article → "Need more help?"
// opens the contact options (HelpScreens.tsx). Figma: figma-extract/{account,help,search-results,
// article,article-contact}. The real app, run from the repo (app/, `npm run dev:search`).
import {onAccount, openHelpAndContact, urls} from './cuca-vision/common.mjs';
export {size, scale, aspect, lead} from './cuca-vision/common.mjs';

export const name = 'Cuca Vision A — search-led help';
export const plan = {
  what: 'Approach A for help on Zalando: search first, then the article, then contact.',
  audience: 'The team comparing four ways to redesign help.',
  flow: ['Your account', 'Help and contact', 'Search: I want to cancel my order', 'Search results', 'The article', 'Need more help? Contact options'],
  duration: [18, 40],
  milestones: [{beat: 'search results', by: 16}]
};
export const poster = 'contact options';
export const share = 'Approach A, search-led help: from Your account to Help, search "I want to cancel my order", open the answer, and if that isn’t enough, the contact options are right there.';
export const url = urls.search;

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  await onAccount(d, page);
  await openHelpAndContact(d, page, page.getByRole('heading', {name: /how can we/}));

  const field = page.getByRole('searchbox', {name: 'Search for an answer'});
  await d.type(field, 'I want to cancel my order', {hold: 700, show: field, label: 'search'});
  await d.press('Enter', {hold: 2800, show: page.locator('.result-row').first(), label: 'search results'});

  await d.click(page.locator('.result-row__link[href*="cancel-or-modify"]'), {hold: 2600,
    show: page.getByRole('heading', {name: /Can I cancel or modify/}), label: 'the article'});
  const more = page.getByRole('button', {name: 'Need more help?'});
  await d.scroll(more, {hold: 1400, label: 'end of the article'});
  await d.click(more, {hold: 3200, show: [page.locator('.contact__question'), page.getByRole('button', {name: 'Send email'})], label: 'contact options'});
}
