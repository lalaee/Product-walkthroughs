// Cuca Vision, approach C · Orders (orders.html, port 5176): help from the order itself. Your account →
// Orders → order details → help on that order, whose answers are B's (OrdersScreens.tsx). Figma:
// figma-extract/c/{orders-list,order-details,help-on-order}. The real app (app/, `npm run dev:orders`).
import {onAccount, urls} from './cuca-vision/common.mjs';
export {size, scale, aspect, lead} from './cuca-vision/common.mjs';

export const name = 'Cuca Vision C — help from the order';
export const plan = {
  what: 'Approach C for help on Zalando: go to the order, and get help with that order.',
  audience: 'The team comparing four ways to redesign help.',
  flow: ['Your account', 'Orders', 'Order details', 'Get help with this order', 'I did not receive this parcel'],
  duration: [18, 40],
  milestones: [{beat: 'help on the order', by: 18}]
};
export const poster = 'help on the order';
export const share = 'Approach C, help from the order: Orders, open the order, and "Get help with this order" asks what went wrong with that parcel.';
export const url = urls.orders;

/** @param {import('../walkthrough/lib/director.mjs').Director} d */
export async function run(d, page) {
  await onAccount(d, page);
  await d.click(page.getByRole('link', {name: 'Orders', exact: true}), {hold: 1600,
    show: page.getByRole('heading', {name: 'Orders', exact: true}), label: 'Orders'});

  const view = page.locator('a[href^="#/orders/"]').filter({hasText: 'View Order'}).first();
  await d.scroll(view, {hold: 1000, label: 'the latest order'});
  await d.click(view, {hold: 3000, show: page.getByText('Order number').first(), label: 'order details'});

  const help = page.getByRole('link', {name: 'Get help with this order'});
  await d.scroll(help, {hold: 1200, label: 'down the order'});
  await d.click(help, {hold: 2400, show: page.getByText('What was wrong with this parcel?'), label: 'help on the order'});

  await d.click(page.getByRole('link', {name: 'I did not receive this parcel'}), {hold: 3000,
    show: page.getByRole('heading', {name: /delivered to a neighbour/}), label: 'not received'});
}
