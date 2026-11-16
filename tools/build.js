// ============================================================
// NELVA NATURAL build: run by Netlify on every update (and locally with `node tools/build.js`).
//
//  content/products/*.json + content/categories.json (edited in /admin) ->
//    - homepage product cards and category tiles   (index.html, between markers)
//    - footer "Shop" links on every page           (between FOOTER-SHOP markers)
//    - one page per available product              (product-<id>.html)
//    - sitemap.xml
//    - netlify/functions/order-products.json (prices the order function trusts)
//  With --dist: copy the public site into dist/ and resize photos uploaded through the admin.
//  Netlify publishes dist/ (netlify.toml), so tools, notes and content files never go online.
// ============================================================
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rel = (...p) => path.join(root, ...p);
const read = (f) => fs.readFileSync(rel(f), 'utf8');
const SITE = 'https://nelvanatural.netlify.app/';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (p) => (p ? String(p).replace(/^\/+/, '') : '');
const naira = (n) => '&#8358;' + Number(n).toLocaleString('en-NG');
const paras = (text) => String(text || '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)
  .map((t) => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('\n            ');
const replaceBetween = (src, name, html, file) => {
  const re = new RegExp(`(<!-- ${name}:START[^>]*-->)[\\s\\S]*?(\\s*<!-- ${name}:END -->)`);
  if (!re.test(src)) throw new Error(`${file}: markers ${name} not found`);
  return src.replace(re, (m, a, b) => a + '\n' + html + b);
};

// ---------- Read content ----------
const problems = [];
const categories = JSON.parse(read('content/categories.json')).categories || [];
const catIds = new Set(categories.map((c) => c.id));
const catName = (id) => (categories.find((c) => c.id === id) || {}).name || '';

const products = fs.readdirSync(rel('content/products')).filter((f) => f.endsWith('.json')).map((f) => {
  const id = f.replace(/\.json$/, '');
  let p;
  try { p = JSON.parse(fs.readFileSync(rel('content/products', f), 'utf8')); } catch (e) {
    problems.push(`${f}: could not be read (${e.message})`); return null;
  }
  if (p.hidden || !p.name) return null;
  if (!catIds.has(p.category)) problems.push(`${p.name}: category "${p.category}" does not exist`);
  const price = p.price === '' || p.price == null ? null : Number(p.price);
  const gallery = (Array.isArray(p.gallery) ? p.gallery : []).map((g) => clean(typeof g === 'object' && g ? g.photo : g)).filter(Boolean);
  const available = p.status !== 'coming-soon' && Number.isFinite(price) && price > 0;
  return {
    id,
    name: p.name,                                   // cart name: keep it stable once customers order
    title: p.title || p.name,                       // name shown on cards and the product page
    category: p.category,
    label: p.label || catName(p.category).replace(/s$/, ''),
    available,
    soldOut: !!p.sold_out,
    price: available ? price : null,
    size: p.size || '',
    badge: p.badge || '',
    image: clean(p.image),
    images: [clean(p.image), ...gallery].filter((g, i, a) => g && a.indexOf(g) === i),
    alt: p.image_alt || `NELVA ${p.title || p.name}`,
    cardText: p.card_text || '',
    description: p.description || p.card_text || '',
    ingredients: p.ingredients || '',
    howToUse: p.how_to_use || '',
    keywords: p.keywords || '',
    review: p.review_text ? { text: p.review_text, name: p.review_name || 'Verified Customer' } : null,
    order: Number.isFinite(Number(p.order)) ? Number(p.order) : 9999,
  };
}).filter(Boolean).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const pageFile = (p) => `product-${p.id}.html`;
const hasPage = (p) => p.available; // "coming soon" products have no page yet

// ---------- Admin: one "Filter by" button per category (between markers in admin/editor/config.yml) ----------
(function writeCategoryFilters() {
  const file = rel('admin/editor/config.yml');
  if (!fs.existsSync(file)) return;
  const yml = fs.readFileSync(file, 'utf8');
  const re = /( *)# CATEGORY_FILTERS_START\r?\n[\s\S]*?# CATEGORY_FILTERS_END/;
  const m = yml.match(re);
  if (!m) return;
  const pad = m[1];
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const block = [`${pad}# CATEGORY_FILTERS_START`,
    ...categories.map((c) => `${pad}- { label: ${q(c.name)}, field: category, pattern: ${q('^' + c.id + '$')} }`),
    `${pad}# CATEGORY_FILTERS_END`].join('\n');
  const next = yml.replace(re, () => block); // function, so "$" in patterns isn't a replace code
  if (next !== yml) fs.writeFileSync(file, next);
})();

// ---------- Order function: price list it checks website orders against ----------
// (netlify/functions/order.js; Netlify bundles functions after this build runs; the file is not in git)
fs.writeFileSync(rel('netlify/functions/order-products.json'), JSON.stringify(Object.fromEntries(
  products.filter((p) => p.available && !p.soldOut).map((p) => [p.name, { id: p.id, name: p.name, price: p.price }])
), null, 2) + '\n');

// ---------- Shared HTML ----------
const bottle = '<svg class="bottle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M9 2h6v3l1.5 2v13a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V7L9 5V2z"/><line x1="8" y1="11" x2="16" y2="11"/></svg>';
const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
const tileBgs = ['linear-gradient(160deg,#e7e0cd,#cdbf9c)', 'linear-gradient(160deg,#e9e3d3,#d3c6a3)'];

function card(p, i, indent = '      ') {
  const link = hasPage(p) ? pageFile(p) : '';
  const buyable = p.available && !p.soldOut;
  const badge = p.soldOut ? 'Sold Out' : p.available ? p.badge : 'Coming Soon';
  const photo = p.image
    ? (link ? `<a href="${link}" class="product-link"><img src="${esc(p.image)}" alt="${esc(p.alt)}"></a>` : `<img src="${esc(p.image)}" alt="${esc(p.alt)}">`)
    : bottle;
  const lines = [
    `<article class="product-card${p.available ? '' : ' coming-soon'}" data-name="${esc(p.name)}"${p.available ? ` data-price="${p.price}"` : ''} data-category="${esc(p.category)}" data-keywords="${esc(p.keywords)}">`,
    `  <div class="product-photo"${p.image ? '' : ` style="--tile-bg: ${tileBgs[i % 2]};"`}>`,
    badge ? `    <span class="product-badge">${esc(badge)}</span>` : null,
    `    ${photo}`,
    '  </div>',
    '  <div class="product-info">',
    `    <span class="cat">${esc(p.label)}</span>`,
    `    <h4>${link ? `<a href="${link}">${esc(p.title)}</a>` : esc(p.title)}</h4>`,
    `    <p class="desc">${esc(p.cardText)}</p>`,
    '    <div class="price-row">',
    `      <span class="price">${p.available ? naira(p.price) : 'TBA'}</span>`,
    buyable
      ? '      <button class="add-cart-btn">Add to Cart</button>'
      : `      <button class="add-cart-btn" disabled>${p.soldOut ? 'Sold Out' : 'Coming Soon'}</button>`,
    '    </div>',
    '  </div>',
    '</article>',
  ].filter((l) => l !== null);
  return lines.map((l) => indent + l).join('\n');
}

const tiles = categories.map((c) => `      <a href="index.html?category=${esc(c.id)}#shop" class="category-tile" data-category="${esc(c.id)}" style="--tile-bg: linear-gradient(160deg,${esc(c.colour || '#3c5c46')},#1c3624);">
        <div><span>Shop</span><h3>${esc(c.name)}</h3></div>
      </a>`).join('\n');
const footerShop = categories.map((c) => `          <li><a href="index.html?category=${esc(c.id)}#shop">${esc(c.name)}</a></li>`).join('\n');

// ---------- Homepage + footers ----------
let index = read('index.html');
index = replaceBetween(index, 'PRODUCTS', products.map((p, i) => card(p, i)).join('\n\n'), 'index.html');
index = replaceBetween(index, 'CATEGORIES', tiles, 'index.html');
fs.writeFileSync(rel('index.html'), index);

for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.html') && !x.startsWith('google') && !/^product-/.test(x))) {
  const src = read(f);
  if (!src.includes('<!-- FOOTER-SHOP:START')) continue;
  const next = replaceBetween(src, 'FOOTER-SHOP', footerShop, f);
  if (next !== src) fs.writeFileSync(rel(f), next);
}

// ---------- Product pages ----------
const contact = read('contact.html');
const bodyStart = contact.indexOf('<body>');
const searchEnd = contact.indexOf('</div>\n</div>', contact.indexOf('id="searchBar"')) + '</div>\n</div>'.length;
const chromeTop = contact.slice(bodyStart, searchEnd).replace('<body>', '<body class="product-page">');
const chromeBottom = contact.slice(contact.indexOf('<!-- FOOTER -->'));
const headTail = contact.slice(contact.indexOf('<link rel="preconnect"'), contact.indexOf('</head>'));

function productPage(p) {
  const url = SITE + pageFile(p);
  const pageTitle = `${p.title} | NELVA NATURAL`;
  const metaDesc = `NELVA ${p.title}${p.size ? ` (${p.size})` : ''}: ${p.description} Sulfate-free, paraben-free, cruelty-free and vegan.`;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    image: p.images.map((i) => SITE + i),
    description: metaDesc,
    brand: { '@type': 'Brand', name: 'NELVA NATURAL' },
    category: p.label,
    offers: {
      '@type': 'Offer', url, priceCurrency: 'NGN', price: String(p.price),
      availability: p.soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
    },
  };
  // Keep each product's position (and so its tile colour) the same as on the homepage
  const related = products.filter((x) => x.id !== p.id).map((x) => card(x, products.indexOf(x), '        ')).join('\n\n');
  const gallery = p.images.length > 1
    ? `\n      <div class="pd-thumbs">${p.images.map((src, i) => `<button type="button" class="pd-thumb${i ? '' : ' active'}" data-src="${esc(src)}" aria-label="Show photo ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>`
    : '';
  const accordion = [
    `        <details class="accordion-item" open>
          <summary><span>Details</span>${chevron}</summary>
          <div class="accordion-body">
            ${paras(p.description)}${p.size ? `\n            <p><strong>Size:</strong> ${esc(p.size)}</p>` : ''}
          </div>
        </details>`,
    p.ingredients ? `        <details class="accordion-item">
          <summary><span>Ingredients</span>${chevron}</summary>
          <div class="accordion-body">
            ${paras(p.ingredients)}
          </div>
        </details>` : null,
    p.howToUse ? `        <details class="accordion-item">
          <summary><span>How to use</span>${chevron}</summary>
          <div class="accordion-body">
            ${paras(p.howToUse)}
          </div>
        </details>` : null,
  ].filter(Boolean).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!-- Built by tools/build.js from content/products/${p.id}.json. Edit the product in /admin, not this file. -->
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<meta property="og:type" content="product">
<meta property="og:site_name" content="NELVA NATURAL">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE + p.image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(pageTitle)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${SITE + p.image}">
<script type="application/ld+json">
${JSON.stringify(schema, null, 2)}
</script>
${headTail}</head>
${chromeTop}

<nav class="breadcrumb" aria-label="Breadcrumb">
  <div class="container">
    <a href="index.html">Home</a><span aria-hidden="true">/</span><a href="index.html#shop">Shop</a><span aria-hidden="true">/</span><span aria-current="page">${esc(p.title)}</span>
  </div>
</nav>

<!-- PRODUCT -->
<section class="pd-section">
  <div class="container product-detail" data-name="${esc(p.name)}" data-price="${p.price}" data-image="${esc(p.image)}">
    <div class="pd-gallery-wrap">
      <div class="pd-gallery">
        ${p.soldOut ? '<span class="product-badge">Sold Out</span>' : p.badge ? `<span class="product-badge">${esc(p.badge)}</span>` : ''}
        <img src="${esc(p.image)}" alt="${esc(p.alt)}" id="pdMainImg">
      </div>${gallery}
    </div>

    <div class="pd-info">
      <span class="eyebrow">${esc(p.label)}</span>
      <h1>${esc(p.title)}</h1>
      <div class="pd-price-row">
        <span class="pd-price">${naira(p.price)}</span>
        ${p.size ? `<span class="pd-size">${esc(p.size)}</span>` : ''}
      </div>
      <p class="pd-lead">${esc(p.description)}</p>

      ${p.soldOut ? `<div class="pd-buy">
        <button type="button" class="btn btn-primary pd-add" disabled>Sold Out</button>
      </div>` : `<div class="pd-buy">
        <div class="qty-stepper" aria-label="Quantity">
          <button type="button" class="qty-btn" id="pdDec" aria-label="Decrease quantity">&minus;</button>
          <span class="qty-value" id="pdQty" aria-live="polite">1</span>
          <button type="button" class="qty-btn" id="pdInc" aria-label="Increase quantity">&plus;</button>
        </div>
        <button type="button" class="btn btn-primary pd-add" id="pdAdd">Add to Cart</button>
      </div>`}

      <ul class="pd-free">
        <li>${check}No Sulfates</li>
        <li>${check}No Parabens</li>
        <li>${check}Cruelty-Free</li>
        <li>${check}100% Vegan</li>
      </ul>

      <div class="accordion">
${accordion}
      </div>
    </div>
  </div>
</section>
${p.review ? `
<!-- REVIEW -->
<section class="section section-tight pd-review-section">
  <div class="container">
    <div class="testimonial-card pd-review">
      <div class="stars">★★★★★</div>
      <p>"${esc(p.review.text)}"</p>
      <div class="testimonial-name">${esc(p.review.name)}</div>
      <div class="testimonial-role">Verified Customer</div>
    </div>
  </div>
</section>
` : ''}
<!-- RELATED -->
<section class="section section-cream">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">Complete Your Routine</span>
      <h2>You may also like</h2>
    </div>
    <div class="product-grid pd-related">
${related}
    </div>
  </div>
</section>

${chromeBottom.replace(/(<!-- FOOTER-SHOP:START[^>]*-->)[\s\S]*?(\s*<!-- FOOTER-SHOP:END -->)/, (m, a, b) => a + '\n' + footerShop + b)}`;
}

const wanted = new Set();
for (const p of products.filter(hasPage)) {
  wanted.add(pageFile(p));
  fs.writeFileSync(rel(pageFile(p)), productPage(p));
}
// Remove pages of products that were deleted, hidden or set to "coming soon"
let removed = 0;
for (const f of fs.readdirSync(root)) {
  if (/^product-[a-z0-9-]+\.html$/.test(f) && !wanted.has(f)) { fs.unlinkSync(rel(f)); removed += 1; }
}

// ---------- Sitemap ----------
const today = new Date().toISOString().slice(0, 10);
const urls = ['', ...[...wanted], 'contact.html', 'help.html', 'policies.html'];
fs.writeFileSync(rel('sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${SITE}${u}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join('\n')}
</urlset>
`);

console.log(`NELVA: ${products.length} products (${wanted.size} with pages${removed ? `, ${removed} old page(s) removed` : ''}), ${categories.length} categories`);
problems.forEach((p) => console.warn('  ! ' + p));

// ---------- dist/ for Netlify ----------
if (process.argv.includes('--dist')) {
  const dist = rel('dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const copy = (from, to) => {
    if (!fs.existsSync(from)) return;
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      fs.readdirSync(from).forEach((f) => copy(path.join(from, f), path.join(to, f)));
    } else fs.copyFileSync(from, to);
  };
  // Every page (incl. the Google verification file), plus public folders and files
  fs.readdirSync(root).filter((f) => f.endsWith('.html')).forEach((f) => copy(rel(f), path.join(dist, f)));
  ['images', 'css', 'js', 'admin', 'favicon.svg', 'robots.txt', 'sitemap.xml', '_redirects'].forEach((p) => copy(rel(p), path.join(dist, p)));
  console.log('Copied the public site into dist/');
  resizeUploads(path.join(dist, 'images', 'uploads'))
    .then((n) => console.log(`Optimised ${n} uploaded photo(s)`))
    .catch((e) => console.warn('Photo optimisation skipped: ' + e.message));
}

async function resizeUploads(dir) {
  if (!fs.existsSync(dir)) return 0;
  const sharp = require('sharp');
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(jpe?g|png|webp)$/i.test(f)) continue;
    const file = path.join(dir, f);
    const input = fs.readFileSync(file);
    const meta = await sharp(input).metadata();
    if ((meta.width || 0) <= 1200 && input.length <= 400 * 1024) continue;
    const ext = path.extname(f).toLowerCase();
    let img = sharp(input).rotate().resize({ width: 1200, height: 1500, fit: 'inside', withoutEnlargement: true });
    img = ext === '.png' ? img.png({ compressionLevel: 9, palette: true }) : ext === '.webp' ? img.webp({ quality: 78 }) : img.jpeg({ quality: 80, progressive: true, mozjpeg: true });
    fs.writeFileSync(file, await img.toBuffer());
    n += 1;
  }
  return n;
}
