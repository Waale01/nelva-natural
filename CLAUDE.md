# NELVA NATURAL website: notes for future work

> **At the start of every chat, tell the user: "This chat is for NELVA NATURAL (nelvanatural.netlify.app)."** This folder is only for NELVA; Mizora is in C:/Users/favou/mizora-space.
- Static site on the DEVELOPER'S Netlify account (nelvanatural.netlify.app), repo Waale01/nelva-natural, branch **master**.
- **Push only when the user says "push".** Every push deploys (shared Netlify credits).
- **Always `git pull` first**: the client edits content/ through the admin.

## Admin / products (built 2026-11-09)
- **/admin** = Decap CMS 3.17.1 (admin/index.html + admin/config.yml + admin/admin-guards.js + admin/guide.html), GitHub login, same setup as the Mizora site.
- Products: content/products/<id>.json (filename = id; page = product-<id>.html). Fields: name (cart name, keep stable), title (short name), category, label, status (available | coming-soon), price, size, badge, image, image_alt, gallery, card_text, description, ingredients, how_to_use, keywords (search), review_text/review_name, sold_out, hidden, order.
- Categories: content/categories.json {id, name, colour} -> homepage "Shop By Need" tiles, footer Shop links, homepage category filter (?category=<id>#shop), admin "Filter by".
- **Build**: `node tools/build.js` writes (between markers) the homepage product cards `<!-- PRODUCTS -->`, category tiles `<!-- CATEGORIES -->`, footer links `<!-- FOOTER-SHOP -->` on every page, the product pages and sitemap.xml. **Re-run after editing content/ by hand.** Netlify runs `node tools/build.js --dist` (netlify.toml) and publishes dist/ (public files only, keeps google9f61c6e45fb7b999.html, resizes uploads in images/uploads with sharp).
- Admin saves use `[skip netlify]`; the admin's "Publish to website" button calls a Netlify build hook (pasted once per browser, stored in localStorage as nelva_build_hook).
- Local admin test: `python -m http.server 5500` + `npx decap-server@3.11.5`, open http://localhost:5500/admin/.
