# NELVA NATURAL website: notes for future work

> **At the start of every chat, tell the user: "This chat is for NELVA NATURAL (nelvanatural.netlify.app)."** This folder is only for NELVA; Mizora is in C:/Users/favou/mizora-space.
- Static site on the DEVELOPER'S Netlify account (nelvanatural.netlify.app), repo Waale01/nelva-natural, branch **master**.
- **Push only when the user says "push".** Every push deploys (shared Netlify credits).
- **Always `git pull` first**: the client edits content/ through the admin.

## Admin / products (built 2026-11-09)
- **/admin** = owner's dashboard (admin/index.html + dashboard.js + dashboard.css, built 2026-11-16): one-screen overview, orders, "I sold something", stock with "Add a new product"/"Edit details" (writes content/products/<id>.json + photos to images/uploads, [skip netlify]). Money (₦) figures and the Money report are OFF for now at the client's request: `SHOW_MONEY` in dashboard.js (plus re-add the Money nav buttons in admin/index.html). Same GitHub login as the editor (token in localStorage `decap-cms-user`). Try it with made-up data at /admin/?demo.
- **/admin/editor/** = Decap CMS 3.17.1 (admin/editor/index.html + admin/editor/config.yml; admin/admin-guards.js, admin/publish.js and admin/guide.html are shared), GitHub login, same setup as the Mizora site.
- **Sales data lives in the PRIVATE repo Waale01/nelva-sales** (orders/YYYY-MM.json, stock.json). Never put it in this public repo. Website orders get there via netlify/functions/order.js, which needs the Netlify env var `NELVA_SALES_TOKEN` (fine-grained GitHub token, nelva-sales only, Contents read/write). The function checks prices against netlify/functions/order-products.json (written by build.js, not in git). A sale = order with status "paid"; stock left = last count + deliveries since - paid sales since.
- Products: content/products/<id>.json (filename = id; page = product-<id>.html). Fields: name (cart name, keep stable), title (short name), category, label, status (available | coming-soon), price, size, badge, image, image_alt, gallery, card_text, description, ingredients, how_to_use, keywords (search), review_text/review_name, sold_out, hidden, order.
- Categories: content/categories.json {id, name, colour} -> homepage "Shop By Need" tiles, footer Shop links, homepage category filter (?category=<id>#shop), admin "Filter by".
- **Build**: `node tools/build.js` writes (between markers) the homepage product cards `<!-- PRODUCTS -->`, category tiles `<!-- CATEGORIES -->`, footer links `<!-- FOOTER-SHOP -->` on every page, the product pages and sitemap.xml. **Re-run after editing content/ by hand.** Netlify runs `node tools/build.js --dist` (netlify.toml) and publishes dist/ (public files only, keeps google9f61c6e45fb7b999.html, resizes uploads in images/uploads with sharp).
- Admin saves use `[skip netlify]`; the admin's "Publish to website" button calls a Netlify build hook (pasted once per browser, stored in localStorage as nelva_build_hook).
- Local admin test: `python -m http.server 5500` + `npx decap-server@3.11.5`, open http://localhost:5500/admin/editor/ (dashboard practice mode: http://localhost:5500/admin/?demo).
