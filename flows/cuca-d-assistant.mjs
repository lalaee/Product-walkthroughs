// Cuca Vision, approach D · Assistant (assistant.html, port 5177): help from an AI assistant. Your
// account → the floating AI button → the Assistant → ask "Where is my order?" → loading → a reply
// with your orders → help on that order (AssistantScreen.tsx). Figma: figma-extract/d/{d0-account,
// d1-landing,d2,d3,d4-help-on-order}. The real app (app/, `npm run dev:assistant`); the reply is the
// app's designed one (it answers every question with your three latest orders).
import {onAccount, urls} from './cuca-vision/common.mjs';
export {size, scale, aspect, lead} from './cuca-vision/common.mjs';

export const name = 'Cuca Vision D — the Assistant';
export const plan = {
  what: 'Approach D for help on Zalando: ask the Assistant, and it brings up your orders.',
  audience: 'The team comparing four ways to redesign help.',
  flow: ['Your account', 'The AI button', 'The Assistant', 'Where is my order?', 'Loading', 'The reply: your orders', 'Help on that order'],
  duration: [18, 40],
  milestones: [{beat: 'the reply', by: 16}]
};
export const poster = 'the reply';
export const share = 'Approach D, the Assistant: tap the AI button, ask "Where is my order?", and it answers with your latest orders, one tap from help on that order.';
export const url = urls.assistant;

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  await onAccount(d, page);
  const ai = page.getByRole('link', {name: 'Open the Assistant'});
  await d.point(ai, {hold: 1200, label: 'the AI button'});
  await d.click(ai, {hold: 1800, show: [page.getByRole('heading', {name: /Hi Lekan/}), page.getByRole('textbox', {name: 'Enter your message'})], label: 'the Assistant'});

  await d.click(page.getByRole('button', {name: 'Where is my order?'}), {hold: 700,
    show: page.getByRole('status', {name: 'The Assistant is writing'}), label: 'loading'});
  const reply = page.locator('.reply');
  await reply.waitFor();
  await d.wait(500);
  await d.point(page.locator('.reply__card').first(), {hold: 2600, show: [page.locator('.reply .bubble').first(), page.locator('.reply__card').first()], label: 'the reply'});

  await d.click(page.getByRole('link', {name: 'Need help with this order?'}).first(), {hold: 3000,
    show: page.getByText('What was wrong with this parcel?'), label: 'help on that order'});
}
