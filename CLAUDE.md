# NELVA NATURAL website: notes for future work

> **At the start of every chat, tell the user: "This chat is for NELVA NATURAL (nelvanatural.netlify.app)."** This folder is only for NELVA; Mizora is in C:/Users/favou/mizora-space.
- Static site on the DEVELOPER'S Netlify account (nelvanatural.netlify.app), repo Waale01/nelva-natural, branch **master**.
- **Push only when the user says "push".** Every push deploys (shared Netlify credits).
- **Always `git pull` first**: the client edits content/ through the admin.

## Admin / products (built 2026-11-09)
- **/admin** = owner's dashboard (admin/index.html + dashboard.js + dashboard.css, built 2026-11-16): one-screen overview, orders, stock with "Add a new product"/"Edit details" (writes content/products/<id>.json + photos to images/uploads, [skip netlify]). Every website change (product saved, sold-out switch) shows the same "saved, not on the website yet: publish once when done" message (savedNote). When paid orders / counts take a product to 0 it offers "Sold out"; restocking a sold-out product offers "back on sale" (stockPrompt). Orders has a search box (name, phone, order number, product; searches all statuses). Same GitHub login as the editor (token in localStorage `decap-cms-user`). Try it with made-up data at /admin/?demo.
- **/admin/editor/** = Decap CMS 3.17.1 (admin/editor/index.html + admin/editor/config.yml; admin/admin-guards.js, admin/publish.js and admin/guide.html are shared), GitHub login, same setup as the Mizora site.
- **Sales data lives in the PRIVATE repo Waale01/nelva-sales** (orders/YYYY-MM.json, stock.json). Never put it in this public repo. Website orders get there via netlify/functions/order.js, which needs the Netlify env var `NELVA_SALES_TOKEN` (fine-grained GitHub token, nelva-sales only, Contents read/write). The function checks prices against netlify/functions/order-products.json (written by build.js, not in git). A sale = order with status "paid"; stock left = last count + deliveries since - paid sales since.
- Products: content/products/<id>.json (filename = id; page = product-<id>.html). Fields: name (cart name, keep stable), title (short name), category, label, status (available | coming-soon), price, size, badge, image, image_alt, gallery, card_text, description, ingredients, how_to_use, keywords (search), review_text/review_name, sold_out, hidden, order.
- Categories: content/categories.json {id, name, colour} -> homepage "Shop By Need" tiles, footer Shop links, homepage category filter (?category=<id>#shop), admin "Filter by".
- **Build**: `node tools/build.js` writes (between markers) the homepage product cards `<!-- PRODUCTS -->`, category tiles `<!-- CATEGORIES -->`, footer links `<!-- FOOTER-SHOP -->` on every page, the product pages and sitemap.xml. **Re-run after editing content/ by hand.** Netlify runs `node tools/build.js --dist` (netlify.toml) and publishes dist/ (public files only, keeps google9f61c6e45fb7b999.html, resizes uploads in images/uploads with sharp).
- Admin saves use `[skip netlify]`; the admin's "Publish to website" button calls a Netlify build hook (pasted once per browser, stored in localStorage as nelva_build_hook).
- Local admin test: `python -m http.server 5500` + `npx decap-server@3.11.5`, open http://localhost:5500/admin/editor/ (dashboard practice mode: http://localhost:5500/admin/?demo).

## Switched off for now (client asked 2026-11-16) - bring back later
Nothing was deleted: each feature is hidden by a switch at the top of admin/dashboard.js. To bring one back,
set its switch to `true`, check it in practice mode (/admin/?demo), commit, and push when the user says "push".
The HTML buttons stay in admin/index.html; dashboard.js removes them while the switch is off.
- **Money (₦) figures + Money report** -> `var SHOW_MONEY = false;`
  When on: "Money" in the sidebar and bottom tabs (monthly report: money in, money per day, what sold,
  how people paid, every sale with undo); Home cards show Money in / Sales / Items sold / Waiting with ₦ amounts;
  the chart and the monthly goal are in naira (goal stored as `monthly_target` in nelva-sales stock.json;
  the items goal is `monthly_goal_items`); "I sold something" asks for "Money received".
  Now (off): everything counts sales and items. Order cards still show prices.
- **"I sold something"** (recording sales made in person / Instagram / WhatsApp chat) -> `var SHOW_SELL = false;`
  When on: "I sold something" in the sidebar, the big orange Sell button in the bottom tabs, "+ Record a sale"
  at the top; tap product photos -> Next -> Cash / Transfer / POS -> Save (saved as status "paid", source "shop",
  so it counts as a sale and lowers stock). Home chart shows Website vs In person.
  Now (off): only website orders are counted (marked Paid in Orders); the chart shows Sales and Waiting instead.
  Also put the "I sold something" bullet back in admin/guide.html.
