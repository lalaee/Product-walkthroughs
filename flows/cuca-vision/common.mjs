// Shared by the four Cuca Vision flows (github.com/lalaee/cuca-vision): four ways to redesign help on
// Zalando's "Your account" screen, each built as its own app from app/ (Vite, React) and run on its own
// port: A Search (5174), B Guided (5175), C Orders (5176), D Assistant (5177). Start them with
// `npm run dev:search` (…:guided, :orders, :assistant) in app/, or override the URLs below.
//
// The screens are a 375×812 phone (the Figma frames in figma-extract/ are 750 wide at 2×), drawn at 3×
// so the zooms stay sharp, in a 9:16 video. No captions and no narration: the screens speak for
// themselves.
export const size = '375x812';
export const scale = 3;
export const aspect = '9:16';
export const lead = 600;

export const urls = {
  search: process.env.CUCA_SEARCH_URL ?? 'http://localhost:5174/',
  guided: process.env.CUCA_GUIDED_URL ?? 'http://localhost:5175/',
  orders: process.env.CUCA_ORDERS_URL ?? 'http://localhost:5176/',
  assistant: process.env.CUCA_ASSISTANT_URL ?? 'http://localhost:5177/'
};

/** Your account, the screen every approach starts on. */
export async function onAccount(d, page) {
  const title = page.getByRole('heading', {name: 'Your account'});
  await title.waitFor();
  await d.wait(400);
  await d.point(title, {hold: 2300, show: title, label: 'Your account'});
}

/** Down the account menu to "Help and contact", and into it. */
export async function openHelpAndContact(d, page, show) {
  const help = page.getByRole('link', {name: 'Help and contact'});
  await d.scroll(help, {hold: 900, label: 'Help and contact row'});
  await d.click(help, {hold: 1600, show, label: 'Help and contact'});
}
