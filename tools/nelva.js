#!/usr/bin/env node
// ============================================================
// NELVA admin from the command line (used by Claude Code; see .claude/skills/nelva-admin/SKILL.md)
//
// Works on exactly the same data as the /admin dashboard, through the GitHub API:
//   Waale01/nelva-natural (public)  content/products/<id>.json, images/uploads/   (commits use [skip netlify])
//   Waale01/nelva-sales   (PRIVATE) orders/YYYY-MM.json, stock.json
// so a change made here shows in the dashboard after a refresh, and the other way round.
//
// Every command that changes something only PREVIEWS the change unless --yes is given.
//
//   node tools/nelva.js help
// ============================================================
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SITE_REPO = 'Waale01/nelva-natural';
const SITE_BRANCH = 'master';
const SALES_REPO = 'Waale01/nelva-sales';
const ROOT = path.join(__dirname, '..');
const HOOK_FILE = path.join(ROOT, '.nelva', 'build-hook');

const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--') && ['status', 'search', 'limit', 'id', 'days', 'method', 'name'].includes(k)) flags[k] = argv[++i];
    else flags[k] = true;
  } else args.push(a);
}
const YES = !!flags.yes;

// ------------------------------------------------------------ helpers
const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const wat = (d) => new Date(new Date(d).getTime() + 3600e3); // Nigeria time
const dayKey = (d) => wat(d).toISOString().slice(0, 10);
const monthKey = (d) => dayKey(d).slice(0, 7);
const addDays = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const when = (iso) => { const w = wat(iso); return `${dayKey(iso)} ${String(w.getUTCHours()).padStart(2, '0')}:${String(w.getUTCMinutes()).padStart(2, '0')}`; };
const digits = (s) => String(s || '').replace(/\D/g, '');
function die(msg) { console.error('✖ ' + msg); process.exit(1); }
function preview(lines) {
  console.log((YES ? '✔ DONE:' : 'PREVIEW (nothing changed yet; run again with --yes to do it):'));
  lines.forEach((l) => console.log('  ' + l));
}

let TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) {
  try { TOKEN = execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* below */ }
}

async function gh(repo, p, opts = {}) {
  if (!TOKEN) die('No GitHub login. Run `gh auth login` (or set GITHUB_TOKEN).');
  const r = await fetch(`https://api.github.com/repos/${repo}/${p}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'nelva-cli', 'X-GitHub-Api-Version': '2022-11-28' },
    body: opts.body,
  });
  if (r.status === 401) die('GitHub login expired. Run `gh auth login`.');
  return r;
}
const ref = (branch) => (branch ? `?ref=${branch}` : '');
async function listDir(repo, p, branch) {
  const r = await gh(repo, `contents/${p}${ref(branch)}`);
  if (r.status === 404) return null;
  if (!r.ok) die(`GitHub ${r.status} reading ${p}`);
  return (await r.json()).filter((f) => f.type === 'file');
}
async function readJSON(repo, p, branch) {
  const r = await gh(repo, `contents/${p}${ref(branch)}`);
  if (r.status === 404) return { data: null, sha: null };
  if (!r.ok) die(`GitHub ${r.status} reading ${p}`);
  const b = await r.json();
  return { data: JSON.parse(Buffer.from(b.content, 'base64').toString('utf8')), sha: b.sha };
}
async function putFile(repo, p, base64, message, sha, branch) {
  const body = { message, content: base64 };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;
  return gh(repo, `contents/${p}`, { method: 'PUT', body: JSON.stringify(body) });
}
// read newest -> change -> save; retries if someone (the dashboard, a website order) saved meanwhile
async function writeJSON(repo, p, mutate, message, branch) {
  for (let i = 0; i < 4; i += 1) {
    const cur = await readJSON(repo, p, branch);
    const data = mutate(cur.data);
    const r = await putFile(repo, p, Buffer.from(JSON.stringify(data, null, 2) + '\n').toString('base64'), message, cur.sha, branch);
    if (r.ok) return data;
    if (r.status !== 409 && r.status !== 422) die(`GitHub ${r.status} saving ${p}`);
    await new Promise((ok) => setTimeout(ok, 500));
  }
  die(`Could not save ${p}, please try again.`);
}

// ------------------------------------------------------------ data
let cache = null;
async function load() {
  if (cache) return cache;
  // products: from GitHub (what the dashboard and the website use); local files only as a fallback
  let products = [];
  let productsOnGitHub = true;
  const files = await listDir(SITE_REPO, 'content/products', SITE_BRANCH);
  if (files) {
    products = await Promise.all(files.filter((f) => f.name.endsWith('.json')).map(async (f) => ({ ...(await readJSON(SITE_REPO, f.path, SITE_BRANCH)).data, id: f.name.replace(/\.json$/, '') })));
  } else {
    productsOnGitHub = false;
    const dir = path.join(ROOT, 'content/products');
    products = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), id: f.replace(/\.json$/, '') }));
  }
  products.forEach((p) => { p.price = Number(p.price) || 0; });
  const cats = await readJSON(SITE_REPO, 'content/categories.json', SITE_BRANCH);
  const categories = (cats.data && cats.data.categories) || JSON.parse(fs.readFileSync(path.join(ROOT, 'content/categories.json'), 'utf8')).categories;

  const orderFiles = (await listDir(SALES_REPO, 'orders')) || [];
  const orders = [];
  for (const f of orderFiles.filter((x) => /^\d{4}-\d{2}\.json$/.test(x.name))) {
    const { data } = await readJSON(SALES_REPO, f.path);
    ((data && data.orders) || []).forEach((o) => { o._file = f.path; o.items = o.items || []; orders.push(o); });
  }
  orders.sort((a, b) => (a.date < b.date ? 1 : -1));
  const st = (await readJSON(SALES_REPO, 'stock.json')).data || { low_alert: 5, entries: [] };
  st.entries = st.entries || [];
  cache = { products, productsOnGitHub, categories, orders, stock: st };
  return cache;
}
const pname = (p) => (p ? p.title || p.name : '?');
function findProduct(d, q) {
  if (!q) die('Which product? Use its id (see `products`).');
  const s = q.toLowerCase();
  const exact = d.products.find((p) => p.id === s);
  if (exact) return exact;
  const hits = d.products.filter((p) => (p.id + ' ' + p.name + ' ' + (p.title || '')).toLowerCase().includes(s));
  if (hits.length === 1) return hits[0];
  if (!hits.length) die(`No product matches "${q}". Products: ${d.products.map((p) => p.id).join(', ')}`);
  die(`"${q}" matches several products: ${hits.map((p) => p.id).join(', ')}. Use the id.`);
}
function findOrder(d, q) {
  if (!q) die('Which order? Use its order number (see `orders`).');
  const o = d.orders.find((x) => x.id.toLowerCase() === q.toLowerCase());
  if (!o) die(`No order "${q}". Search with: orders --search <name or phone>`);
  return o;
}
const itemProduct = (d, i) => d.products.find((p) => p.id === i.id) || d.products.find((p) => p.name === i.name);
const paidTime = (o) => o.paid_at || o.date;
const qty = (o) => o.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
const itemsText = (d, o) => o.items.map((i) => `${i.qty} x ${pname(itemProduct(d, i)) || i.name}`).join(', ');

// same maths as the dashboard (stockLeft) and netlify/functions/stock.js
function stockLeft(d, id) {
  const mine = d.stock.entries.filter((e) => e.id === id).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!mine.length) return null;
  let last = null;
  mine.forEach((e) => { if (e.type === 'count') last = e; });
  const start = last ? last.date : mine[0].date;
  let n = last ? Number(last.qty) || 0 : 0;
  mine.forEach((e) => { if (e.type === 'add' && (!last || e.date > last.date)) n += Number(e.qty) || 0; });
  d.orders.filter((o) => o.status === 'paid' && paidTime(o) >= start).forEach((o) => o.items.forEach((i) => {
    const p = itemProduct(d, i); if (p && p.id === id) n -= Number(i.qty) || 0;
  }));
  return n;
}
const sellable = (d) => d.products.filter((p) => !p.hidden && p.status !== 'coming-soon' && p.price > 0);

function orderLine(d, o) {
  const c = o.customer || {};
  return `${o.id}  [${o.status.toUpperCase()}]  ${when(o.date)}  ${c.name || '(no name)'}  ${c.phone || ''}  ${naira(o.total)}  ${itemsText(d, o)}`;
}
function orderDetail(d, o) {
  const c = o.customer || {};
  console.log(`Order ${o.id}  ${o.status.toUpperCase()}  (${o.source === 'website' ? 'website' : 'in person'}, ${o.method || ''})`);
  console.log(`  Placed: ${when(o.date)}${o.paid_at ? '   Paid: ' + when(o.paid_at) : ''}${o.cancelled_at ? '   Cancelled: ' + when(o.cancelled_at) : ''}`);
  o.items.forEach((i) => console.log(`  ${i.qty} x ${pname(itemProduct(d, i)) || i.name} @ ${naira(i.price)}`));
  console.log(`  Total: ${naira(o.total)}`);
  if (c.name || c.phone) console.log(`  Customer: ${c.name || ''}  ${c.phone || ''}  ${c.email || ''}`);
  if (c.address) console.log(`  Address: ${c.address.replace(/\n/g, ', ')}`);
  if (c.notes) console.log(`  Notes: ${c.notes}`);
}
// after a stock change: say if the website switch should change (the dashboard asks the same)
function stockAdvice(d, ids) {
  ids.forEach((id) => {
    const p = d.products.find((x) => x.id === id); const n = stockLeft(d, id);
    if (!p || n == null) return;
    if (n <= 0 && !p.sold_out) console.log(`  ⚠ ${pname(p)} now has none left but can still be ordered. Suggest: soldout ${p.id} on`);
    if (n > 0 && p.sold_out) console.log(`  ℹ ${pname(p)} is back in stock (${n}) but the website says Sold out. Suggest: soldout ${p.id} off`);
    if (n > 0 && n <= (Number(d.stock.low_alert) || 5)) console.log(`  🔥 ${pname(p)}: ${n} left, the website shows "Running out".`);
  });
}

// ------------------------------------------------------------ commands
const C = {};

C.help = () => console.log(`NELVA admin (same data as nelvanatural.netlify.app/admin). Changes only preview unless --yes.

LOOK
  summary                         sales (today, 7 and 30 days), waiting orders, stock warnings, goal
  orders [--status waiting|paid|cancelled|all] [--search text] [--limit n]
  order <order-id>                one order in full (customer, address, items)
  stock                           stock left for every product
  products                        all products with id, price, status
  product <id>                    one product's full details (JSON)
  categories                      category ids and names

CHANGE (add --yes to really do it)
  paid <order-id>                 customer paid -> counts as a sale, stock goes down
  unpaid <order-id>               back to waiting
  cancel <order-id>               never paid / changed mind
  restore <order-id>              cancelled -> waiting
  stock-add <product> <n>         new stock arrived (+n)
  stock-count <product> <n>       counted the shelf: exactly n left
  low-alert <n>                   "running low" at n or fewer (also the website's "Running out")
  goal <items>                    monthly goal (items to sell)
  soldout <product> on|off        website shows Sold out / on sale        (needs publish)
  photo <image-file> --id <product-id>   resize + upload a photo, prints its path for product-save
  product-save <file.json> [--id <id>] [--new]   create or update a product from a JSON file (needs publish)
  hide <product> on|off           take a product off the website without deleting it (needs publish)
  publish                         put saved product changes on the website (Netlify build)`);

C.summary = async () => {
  const d = await load();
  const t = dayKey(new Date());
  const paid = d.orders.filter((o) => o.status === 'paid');
  const inRange = (from) => paid.filter((o) => dayKey(paidTime(o)) >= from);
  const fmt = (l) => `${plural(l.length, 'sale')}, ${plural(l.reduce((s, o) => s + qty(o), 0), 'item')}, ${naira(l.reduce((s, o) => s + (Number(o.total) || 0), 0))}`;
  console.log(`Today (${t}):  ${fmt(inRange(t))}`);
  console.log(`Last 7 days:   ${fmt(inRange(addDays(t, -6)))}`);
  console.log(`Last 30 days:  ${fmt(inRange(addDays(t, -29)))}`);
  const month = paid.filter((o) => monthKey(paidTime(o)) === t.slice(0, 7));
  const goal = Number(d.stock.monthly_goal_items) || 0;
  const mItems = month.reduce((s, o) => s + qty(o), 0);
  console.log(`This month:    ${plural(mItems, 'item')} sold${goal ? ` of a goal of ${goal} (${Math.round(mItems / goal * 100)}%)` : ' (no monthly goal set)'}`);
  const w = d.orders.filter((o) => o.status === 'waiting');
  console.log(`\nWaiting for payment: ${w.length}`);
  w.forEach((o) => console.log('  ' + orderLine(d, o)));
  console.log('\nStock:');
  sellable(d).forEach((p) => {
    const n = stockLeft(d, p.id); const low = Number(d.stock.low_alert) || 5;
    const tag = n == null ? 'not counted' : n <= 0 ? 'NONE LEFT' + (p.sold_out ? ' (website: Sold out)' : ' (still on sale!)') : n <= low ? `${n} left (running low)` : `${n} left`;
    console.log(`  ${p.id.padEnd(22)} ${tag}`);
  });
  if (!d.productsOnGitHub) console.log('\nNote: products are read from this computer; they are not on GitHub until you push.');
};

C.orders = async () => {
  const d = await load();
  const status = flags.status || 'waiting';
  let list = d.orders;
  if (flags.search) {
    const q = String(flags.search).toLowerCase(); const qd = digits(q);
    list = list.filter((o) => {
      const c = o.customer || {};
      const text = [o.id, c.name, c.phone, c.email, c.address, ...o.items.map((i) => i.name + ' ' + pname(itemProduct(d, i)))].join(' ').toLowerCase();
      const ph = digits(c.phone);
      return text.includes(q) || (qd.length >= 4 && (ph.includes(qd) || ph.includes(qd.replace(/^0/, ''))));
    });
  } else if (status !== 'all') list = list.filter((o) => o.status === status);
  const limit = Number(flags.limit) || 30;
  console.log(`${plural(list.length, 'order')}${flags.search ? ` matching "${flags.search}"` : ` (${status})`}${list.length > limit ? `, showing ${limit}` : ''}:`);
  list.slice(0, limit).forEach((o) => console.log('  ' + orderLine(d, o)));
};

C.order = async () => { const d = await load(); orderDetail(d, findOrder(d, args[1])); };

C.stock = async () => {
  const d = await load();
  console.log(`Running low at ${Number(d.stock.low_alert) || 5} or fewer.`);
  d.products.filter((p) => !p.hidden).forEach((p) => {
    const n = stockLeft(d, p.id);
    console.log(`  ${p.id.padEnd(22)} ${(n == null ? 'not counted' : n + ' left').padEnd(14)} ${p.status === 'coming-soon' ? 'coming soon' : p.sold_out ? 'website: SOLD OUT' : 'website: on sale'}`);
  });
};

C.products = async () => {
  const d = await load();
  d.products.sort((a, b) => (a.order || 999) - (b.order || 999)).forEach((p) => console.log(
    `  ${p.id.padEnd(22)} ${pname(p).padEnd(34)} ${(p.price ? naira(p.price) : 'no price').padEnd(10)} ${p.category || ''}  ${p.status === 'coming-soon' ? '[coming soon]' : ''}${p.sold_out ? '[sold out]' : ''}${p.hidden ? '[hidden]' : ''}`));
  if (!d.productsOnGitHub) console.log('\nNote: read from this computer; products are not on GitHub until you push.');
};
C.product = async () => { const d = await load(); const p = findProduct(d, args[1]); const { id, ...rest } = p; console.log(JSON.stringify({ id, ...rest }, null, 2)); };
C.categories = async () => { const d = await load(); d.categories.forEach((c) => console.log(`  ${c.id.padEnd(16)} ${c.name}`)); };

async function changeOrder(label, change, check) {
  const d = await load(); const o = findOrder(d, args[1]);
  const problem = check && check(o);
  if (problem) die(problem);
  orderDetail(d, o);
  preview([`${label}: ${o.id} (${(o.customer || {}).name || 'no name'}, ${naira(o.total)})`]);
  if (!YES) return;
  const now = new Date().toISOString();
  await writeJSON(SALES_REPO, o._file, (data) => {
    const t = data && data.orders && data.orders.find((x) => x.id === o.id);
    if (!t) die('Order not found any more; refresh and try again.');
    change(t, now); return data;
  }, `Order ${o.id}: ${label.toLowerCase()} (from Claude Code)`);
  change(o, now);
  stockAdvice(d, o.items.map((i) => (itemProduct(d, i) || {}).id).filter(Boolean));
}
C.paid = () => changeOrder('Mark PAID', (t, now) => { t.status = 'paid'; t.paid_at = now; delete t.cancelled_at; }, (o) => (o.status === 'paid' ? 'Already paid.' : null));
C.unpaid = () => changeOrder('Back to WAITING (not paid)', (t) => { t.status = 'waiting'; delete t.paid_at; }, (o) => (o.status !== 'paid' ? 'This order is not marked paid.' : null));
C.cancel = () => changeOrder('CANCEL', (t, now) => { t.status = 'cancelled'; t.cancelled_at = now; delete t.paid_at; }, (o) => (o.status === 'cancelled' ? 'Already cancelled.' : null));
C.restore = () => changeOrder('Bring back to WAITING', (t) => { t.status = 'waiting'; delete t.cancelled_at; delete t.paid_at; }, (o) => (o.status !== 'cancelled' ? 'Only cancelled orders can be restored.' : null));

async function changeStock(lines, change, message, ids) {
  const d = await load();
  preview(lines);
  if (!YES) return;
  await writeJSON(SALES_REPO, 'stock.json', (s) => { s = s || { low_alert: 5, entries: [] }; s.entries = s.entries || []; change(s); return s; }, message);
  change(d.stock);
  if (ids) stockAdvice(d, ids);
}
C['stock-add'] = async () => {
  const d = await load(); const p = findProduct(d, args[1]); const n = Number(args[2]);
  if (!Number.isInteger(n) || n < 1) die('How many arrived? e.g. stock-add herbal-oil 24');
  const before = stockLeft(d, p.id);
  if (before == null) console.log(`Note: ${pname(p)} has never been counted. Adding stock starts the count at ${n}; use stock-count if you know the exact total.`);
  await changeStock([`${pname(p)}: +${n}${before != null ? ` (${before} -> ${before + n})` : ''}`],
    (s) => s.entries.push({ date: new Date().toISOString(), id: p.id, type: 'add', qty: n }), `Stock: +${n} ${p.name} (from Claude Code)`, [p.id]);
};
C['stock-count'] = async () => {
  const d = await load(); const p = findProduct(d, args[1]); const n = Number(args[2]);
  if (!Number.isInteger(n) || n < 0) die('How many are on the shelf? e.g. stock-count herbal-oil 30');
  const before = stockLeft(d, p.id);
  await changeStock([`${pname(p)}: exactly ${n} left${before != null ? ` (was ${before})` : ''}`],
    (s) => s.entries.push({ date: new Date().toISOString(), id: p.id, type: 'count', qty: n }), `Stock: counted ${n} ${p.name} (from Claude Code)`, [p.id]);
};
C['low-alert'] = async () => {
  const n = Number(args[1]); if (!Number.isInteger(n) || n < 1) die('e.g. low-alert 5');
  await changeStock([`Running low (dashboard warning and website "Running out") at ${n} or fewer`], (s) => { s.low_alert = n; }, `Stock: warn at ${n} (from Claude Code)`);
};
C.goal = async () => {
  const n = Number(args[1]); if (!Number.isInteger(n) || n < 1) die('e.g. goal 100');
  await changeStock([`Monthly goal: sell ${n} items`], (s) => { s.monthly_goal_items = n; }, `Monthly goal: ${n} items (from Claude Code)`);
};

function needProductsOnGitHub(d) {
  if (!YES) return; // previews are fine
  if (!d.productsOnGitHub) die('Products are not on GitHub yet (the admin commits have not been pushed). Push first, then try again.');
}
async function saveProductFields(id, change, label, isNew) {
  const p = `content/products/${id}.json`;
  await writeJSON(SITE_REPO, p, (data) => {
    if (isNew && data) die(`A product with id "${id}" already exists.`);
    if (!isNew && !data) die(`No product "${id}".`);
    return change(data || {});
  }, `Admin: ${isNew ? 'add' : 'update'} products "${id}" [skip netlify]`, SITE_BRANCH);
  console.log(`  Saved ${label}. It shows on the website after: publish`);
  console.log('  (Run `git pull` in this folder to get the change locally.)');
}
C.soldout = async () => {
  const d = await load(); needProductsOnGitHub(d); const p = findProduct(d, args[1]);
  const on = { on: true, yes: true, off: false, no: false }[String(args[2]).toLowerCase()];
  if (on === undefined) die('soldout <product> on|off');
  preview([`${pname(p)}: website shows ${on ? 'SOLD OUT (cannot be ordered)' : 'ON SALE (can be ordered)'}`]);
  if (!YES) return;
  await saveProductFields(p.id, (x) => { x.sold_out = on; return x; }, `${pname(p)} sold out = ${on}`);
};
C.hide = async () => {
  const d = await load(); needProductsOnGitHub(d); const p = findProduct(d, args[1]);
  const on = { on: true, yes: true, off: false, no: false }[String(args[2]).toLowerCase()];
  if (on === undefined) die('hide <product> on|off');
  preview([`${pname(p)}: ${on ? 'HIDDEN from the website (not deleted)' : 'shown on the website again'}`]);
  if (!YES) return;
  await saveProductFields(p.id, (x) => { x.hidden = on; return x; }, `${pname(p)} hidden = ${on}`);
};

C.photo = async () => {
  const file = args[1]; const id = flags.id;
  if (!file || !fs.existsSync(file)) die('photo <image-file> --id <product-id>');
  if (!id || !/^[a-z0-9-]+$/.test(id)) die('Give the product id: --id scalp-serum');
  const sharp = require('sharp');
  const buf = await sharp(fs.readFileSync(file)).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const p = `images/uploads/${id}-${Date.now().toString(36)}.jpg`;
  preview([`Upload ${path.basename(file)} (resized to ${Math.round(buf.length / 1024)} KB) as /${p}`]);
  if (!YES) return;
  const r = await putFile(SITE_REPO, p, buf.toString('base64'), `Admin: upload "${p}" [skip netlify]`, null, SITE_BRANCH);
  if (!r.ok) die(`Upload failed (GitHub ${r.status})`);
  console.log(`  Photo path: /${p}`);
};

const FIELDS = ['name', 'title', 'category', 'label', 'status', 'price', 'size', 'badge', 'image', 'image_alt', 'gallery', 'card_text', 'description', 'ingredients', 'how_to_use', 'keywords', 'review_text', 'review_name', 'sold_out', 'hidden', 'order'];
C['product-save'] = async () => {
  const d = await load(); needProductsOnGitHub(d);
  const file = args[1]; if (!file || !fs.existsSync(file)) die('product-save <file.json> [--id <id>] [--new]');
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  const unknown = Object.keys(input).filter((k) => !FIELDS.includes(k) && k !== 'id');
  if (unknown.length) die(`Unknown fields: ${unknown.join(', ')}. Allowed: ${FIELDS.join(', ')}`);
  const isNew = !!flags.new;
  const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const id = flags.id || input.id || (isNew ? slug(input.name || '') : null);
  if (!id) die('Which product? --id <id>');
  delete input.id;
  const existing = d.products.find((p) => p.id === id);
  if (isNew && existing) die(`"${id}" already exists. Use another --id, or leave out --new to update it.`);
  if (!isNew && !existing) die(`No product "${id}". Add --new to create it.`);
  const merged = { ...(existing || {}), ...input };
  if (input.price !== undefined) merged.price = Number(digits(input.price)) || '';
  // checks the website needs
  if (!merged.name) die('A product needs a name.');
  if (!d.categories.some((c) => c.id === merged.category)) die(`Category must be one of: ${d.categories.map((c) => c.id).join(', ')}`);
  if (merged.status !== 'coming-soon' && !(Number(merged.price) > 0)) die('A product that is for sale needs a price (or status "coming-soon").');
  if (isNew) {
    merged.status = merged.status || 'available';
    merged.sold_out = merged.sold_out || false;
    merged.hidden = merged.hidden || false;
    merged.order = merged.order || d.products.reduce((m, p) => Math.max(m, Number(p.order) || 0), 0) + 10;
    if (!merged.card_text && merged.description) merged.card_text = merged.description.split('\n')[0].split('. ')[0].slice(0, 140);
    if (!merged.image_alt) merged.image_alt = `NELVA ${merged.title || merged.name}${merged.size ? ', ' + merged.size : ''}`;
  }
  if (existing && input.name && input.name !== existing.name) console.log('  ⚠ Changing the full name: customers who already ordered it keep the old name in their orders.');
  const lines = Object.keys(input).map((k) => `${k}: ${existing && existing[k] !== undefined ? JSON.stringify(existing[k]).slice(0, 60) + ' -> ' : ''}${JSON.stringify(merged[k]).slice(0, 100)}`);
  preview([`${isNew ? 'NEW product' : 'Update'} ${id}  (${merged.title || merged.name})`, ...lines]);
  if (!YES) return;
  await saveProductFields(id, (x) => {
    const out = isNew ? {} : x;
    FIELDS.forEach((k) => { if (merged[k] === undefined || merged[k] === '' || (Array.isArray(merged[k]) && !merged[k].length)) delete out[k]; else out[k] = merged[k]; });
    return out;
  }, `${merged.title || merged.name}`, isNew);
};

C.publish = async () => {
  let hook = process.env.NELVA_BUILD_HOOK || (fs.existsSync(HOOK_FILE) ? fs.readFileSync(HOOK_FILE, 'utf8').trim() : '');
  if (flags.hook) {
    if (!/^https:\/\/api\.netlify\.com\/build_hooks\/[a-z0-9]+$/i.test(flags.hook)) die('That is not a Netlify build hook link.');
    fs.mkdirSync(path.dirname(HOOK_FILE), { recursive: true });
    fs.writeFileSync(HOOK_FILE, flags.hook + '\n');
    hook = flags.hook; console.log('Saved the publish link on this computer (.nelva/build-hook, not in git).');
  }
  if (!hook) die('No publish link yet. Get it from Netlify (Project configuration -> Build & deploy -> Build hooks), then: publish --hook <link>');
  preview(['Publish all saved product changes to the website (one Netlify build, live in 1-2 minutes)']);
  if (!YES) return;
  const r = await fetch(hook, { method: 'POST' });
  if (!r.ok) die(`Netlify said ${r.status}`);
  console.log('  Publishing started. The website updates in about 1-2 minutes.');
};

(async () => {
  const cmd = args[0] || 'help';
  if (!C[cmd]) die(`Unknown command "${cmd}". Run: node tools/nelva.js help`);
  await C[cmd]();
})().catch((e) => die(e.message));
