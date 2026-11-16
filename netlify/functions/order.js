// ============================================================
// NELVA NATURAL: website order -> private sales repo
//
// checkout.html (js/script.js) POSTs each confirmed order here. The order is saved as
// "waiting" in orders/YYYY-MM.json of the PRIVATE repo (NELVA_SALES_REPO), where the
// /admin dashboard shows it so the owner can tap "Paid" or "Cancel".
//
// Netlify environment variables (Site configuration -> Environment variables):
//   NELVA_SALES_TOKEN  GitHub fine-grained token: repository Waale01/nelva-sales only, Contents = Read and write
//   NELVA_SALES_REPO   optional, defaults to Waale01/nelva-sales
//
// Prices are never trusted from the browser: every item is looked up in
// order-products.json, which tools/build.js writes from content/products on each build.
// ============================================================
const REPO = process.env.NELVA_SALES_REPO || 'Waale01/nelva-sales';
const TOKEN = process.env.NELVA_SALES_TOKEN;

let PRODUCTS = {};
try { PRODUCTS = require('./order-products.json'); } catch (e) { /* built by tools/build.js */ }

const json = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const strLines = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim().slice(0, max);

// Month in Nigeria (WAT, UTC+1), e.g. 2026-11
const lagosMonth = (d) => new Date(d.getTime() + 3600e3).toISOString().slice(0, 7);

function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nelva-order-function',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}

async function appendOrder(order) {
  const file = `orders/${lagosMonth(new Date(order.date))}.json`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await gh(`contents/${file}`);
    let data = { orders: [] };
    let sha;
    if (res.ok) {
      const body = await res.json();
      sha = body.sha;
      data = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      if (!Array.isArray(data.orders)) data.orders = [];
    } else if (res.status !== 404) {
      throw new Error(`GitHub read ${res.status}`);
    }
    if (data.orders.some((o) => o.id === order.id)) return 'duplicate';
    data.orders.push(order);
    const put = await gh(`contents/${file}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Website order ${order.id}`,
        content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    });
    if (put.ok) return 'saved';
    if (put.status !== 409 && put.status !== 422) throw new Error(`GitHub write ${put.status}`);
    // someone else saved the same month file at the same moment: read it again and retry
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
  }
  throw new Error('GitHub write kept conflicting');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  if (!TOKEN) return json(503, { error: 'Order saving is not set up yet' });
  if ((event.body || '').length > 20000) return json(413, { error: 'Too large' });

  let b;
  try { b = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body); } catch (e) {
    return json(400, { error: 'Bad JSON' });
  }

  const ref = str(b.ref, 40);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(ref)) return json(400, { error: 'Bad order reference' });
  const method = b.method === 'Card (Paystack)' ? 'Card (Paystack)' : 'WhatsApp';

  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return json(400, { error: 'No items' });
  const items = [];
  for (const it of b.items) {
    const p = PRODUCTS[str(it && it.name, 200)];
    const qty = Number(it && it.qty);
    if (!p || !p.price) return json(400, { error: `Unknown product: ${str(it && it.name, 80)}` });
    if (!Number.isInteger(qty) || qty < 1 || qty > 100) return json(400, { error: 'Bad quantity' });
    const same = items.find((x) => x.id === p.id);
    if (same) same.qty += qty;
    else items.push({ id: p.id, name: p.name, qty, price: p.price });
  }

  const c = b.customer || {};
  const now = new Date();
  const order = {
    id: ref,
    date: now.toISOString(),
    source: 'website',
    method,
    status: 'waiting',
    items,
    total: items.reduce((s, i) => s + i.qty * i.price, 0),
    customer: {
      name: str(c.name, 120),
      phone: str(c.phone, 40),
      email: str(c.email, 160),
      address: strLines(c.address, 500),
      notes: strLines(c.notes, 800),
    },
  };

  try {
    const result = await appendOrder(order);
    return json(200, { ok: true, result });
  } catch (e) {
    console.error('Order not saved', ref, e.message);
    return json(502, { error: 'Could not save the order' });
  }
};
