// Cuca Vision, approach B · Guided (guided.html, port 5175): help that starts from your orders. Your
// account → Help and contact → pick an order → pick the problem: not received, then different item →
// each answer → and the returns hub (GuidedHelpScreens.tsx). Figma: figma-extract/b/{help-landing,
// order-parcel,not-received,different-item,returns-hub}. The real app (app/, `npm run dev:guided`).
import {onAccount, openHelpAndContact, urls} from './cuca-vision/common.mjs';
export {size, scale, aspect, lead} from './cuca-vision/common.mjs';

export const name = 'Cuca Vision B — guided help';
export const plan = {
  what: 'Approach B for help on Zalando: pick the order, then what went wrong, and get the answer.',
  audience: 'The team comparing four ways to redesign help.',
  flow: ['Your account', 'Help and contact: your orders', 'Pick an order', 'I did not receive this parcel', 'Item is different from the order', 'Returns and refunds'],
  duration: [25, 50],
  milestones: [{beat: 'not received', by: 18}]
};
export const poster = 'not received';
export const share = 'Approach B, guided help: pick the order, say what went wrong, get the answer for that parcel. Not received, a different item, and the returns hub.';
export const url = urls.guided;

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  await onAccount(d, page);
  const firstOrder = page.getByRole('link', {name: 'Need help with this order?'}).first();
  await openHelpAndContact(d, page, firstOrder);
  await d.point(firstOrder, {hold: 1200, label: 'the orders'});
  await d.click(firstOrder, {hold: 1800, show: page.getByRole('heading', {name: 'Parcel 1 of 1'}), label: 'order and parcel'});

  const question = page.getByText('What was wrong with this parcel?');
  await d.scroll(question, {hold: 1200, label: 'what went wrong'});
  await d.click(page.getByRole('link', {name: 'I did not receive this parcel'}), {hold: 2800,
    show: page.getByRole('heading', {name: /delivered to a neighbour/}), label: 'not received'});

  const back = page.getByRole('button', {name: 'Back'});
  await d.click(back, {hold: 900, show: question, label: 'back to the parcel'});
  await d.click(page.getByRole('link', {name: 'Item is different from the order'}), {hold: 2800,
    show: page.getByRole('heading', {name: 'Item is different from the order'}), label: 'different item'});

  await d.click(back, {hold: 900, show: question, label: 'back again'});
  await d.click(page.getByRole('link', {name: 'Returns and refunds'}), {hold: 3200,
    show: page.getByText('Your active returns'), label: 'returns hub'});
}
