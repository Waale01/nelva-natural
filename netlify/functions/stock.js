// ============================================================
// NELVA NATURAL: which products are running low (for the "Only 3 left" badges on the website)
//
// GET /.netlify/functions/stock  ->  { "low": { "Herbal Infused Oil": 3, ... } }
// Only products with 1..low_alert left are listed (low_alert is the "Warn me when only N are left"
// number the owner sets in the dashboard, 5 by default). Products with plenty, none counted or none
// left are never listed, so exact stock numbers stay private.
//
// Stock left is worked out the same way as the dashboard (admin/dashboard.js stockLeft):
//   last "count" + "add" deliveries since - items in PAID orders since.
// Data comes from the PRIVATE repo (NELVA_SALES_TOKEN, see order.js). The answer is cached by
// Netlify for a few minutes, so GitHub is asked at most every few minutes, however busy the site is.
// ============================================================
const REPO = process.env.NELVA_SALES_REPO || 'Waale01/nelva-sales';
const TOKEN = process.env.NELVA_SALES_TOKEN;

let PRODUCTS = {};
try { PRODUCTS = require('./order-products.json'); } catch (e) { /* built by tools/build.js */ }

const reply = (body, ok = true) => ({
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=60',
    // Netlify's CDN keeps the answer for 5 minutes (and may serve it a little longer while refreshing)
    'Netlify-CDN-Cache-Control': ok ? 'public, durable, max-age=300, stale-while-revalidate=600' : 'public, max-age=60',
  },
  body: JSON.stringify(body),
});

function gh(path) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nelva-stock-function',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}
async function readJSON(path) {
  const r = await gh(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const b = await r.json();
  return JSON.parse(Buffer.from(b.content, 'base64').toString('utf8'));
}

exports.handler = async () => {
  if (!TOKEN) return reply({ low: {} }, false);
  try {
    const stock = (await readJSON('stock.json')) || { entries: [] };
    const entries = Array.isArray(stock.entries) ? stock.entries : [];
    const lowAlert = Number(stock.low_alert) || 5;
    if (!entries.length) return reply({ low: {} });

    // paid orders (only the month files from the first stock entry onwards are needed)
    const first = entries.map((e) => e.date).sort()[0].slice(0, 7);
    const list = await gh('orders');
    const files = list.ok ? (await list.json()).filter((f) => /^\d{4}-\d{2}\.json$/.test(f.name) && f.name.slice(0, 7) >= first) : [];
    const months = await Promise.all(files.map((f) => readJSON(f.path)));
    const paid = months.flatMap((m) => (m && Array.isArray(m.orders) ? m.orders : [])).filter((o) => o.status === 'paid');

    const byName = {};
    Object.values(PRODUCTS).forEach((p) => { byName[p.name] = p.id; });
    const nameOf = {};
    Object.values(PRODUCTS).forEach((p) => { nameOf[p.id] = p.name; });

    const low = {};
    for (const id of Object.keys(nameOf)) { // products on sale on the website right now
      const mine = entries.filter((e) => e.id === id).sort((a, b) => (a.date < b.date ? -1 : 1));
      if (!mine.length) continue;
      let last = null;
      mine.forEach((e) => { if (e.type === 'count') last = e; });
      const start = last ? last.date : mine[0].date;
      let n = last ? Number(last.qty) || 0 : 0;
      mine.forEach((e) => { if (e.type === 'add' && (!last || e.date > last.date)) n += Number(e.qty) || 0; });
      paid.forEach((o) => {
        if ((o.paid_at || o.date) < start) return;
        (o.items || []).forEach((i) => { if ((i.id || byName[i.name]) === id) n -= Number(i.qty) || 0; });
      });
      if (n > 0 && n <= lowAlert) low[nameOf[id]] = n;
    }
    return reply({ low });
  } catch (e) {
    console.error('Stock check failed', e.message);
    return reply({ low: {} }, false);
  }
};
