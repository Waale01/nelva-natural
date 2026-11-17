---
name: nelva-admin
description: Run the NELVA NATURAL shop admin from Claude Code - orders (mark paid / cancel / find), stock (add, count, running low), products (add a new product with photos, change price or details, sold out, hide), monthly goal, sales summaries, and publishing the website. Use whenever the user asks about NELVA orders, sales, customers, stock or products, or asks to change any of them, e.g. "mark Bisi's order paid", "we got 24 oil", "add a new product", "how many did we sell this week".
---

# NELVA admin from Claude Code

`node tools/nelva.js <command>` changes the same data as the dashboard at nelvanatural.netlify.app/admin
(products in the public repo, orders and stock in the PRIVATE repo Waale01/nelva-sales). Run
`node tools/nelva.js help` for every command. It uses the `gh` login (or `GITHUB_TOKEN`).

## The rule: preview, ask, then do

Every command that changes something only PREVIEWS unless `--yes` is added. The user chose
"always ask first", so for every change:

1. Find the right thing first (`orders --search <name/phone>`, `products`, `stock`). Never guess an
   order number or product id; if two match, ask which.
2. Run the command WITHOUT `--yes` and tell the user in plain words what will change
   (e.g. "Mark Bisi Adeyemi's order NN-4K2P (₦45,000, 1 Herbal Oil + 1 Hair Butter) as paid?").
3. Only after they say yes, run it again WITH `--yes`, then confirm what happened and pass on any
   advice the command prints (e.g. "none left, suggest Sold out").

Questions ("how many sold this week", "any orders waiting", "what's low") need no confirmation:
just run `summary`, `orders`, `stock` and answer briefly in plain words.

## Common jobs

- **Customer paid**: `orders --search <name or phone>` -> `paid <order-id>` -> confirm -> `--yes`.
  If it prints "none left", offer `soldout <product> on`.
- **Stock arrived**: `stock-add <product> <n>`. **Counted the shelf**: `stock-count <product> <n>`.
- **New product**: collect name, price (₦), category (`categories`), size, and ideally description,
  ingredients, how to use, a photo. Ask only for what's missing among name, price and category;
  the rest is optional. Photo: `photo <file> --id <product-id>` (preview, then `--yes`), and put the
  printed path in `"image"` (more photos go in `"gallery": ["/images/uploads/..."]`). Write the
  fields to a JSON file in the scratchpad, then `product-save <file> --new` (preview, then `--yes`).
  If the user sends a photo in the chat that isn't a file on disk, ask them to save it in the
  project folder (or give its path) so it can be uploaded.
- **Change a product** (price, words, badge): JSON with just the changed fields ->
  `product-save <file> --id <id>`. Avoid changing `name` of a product people have ordered
  (change `title` instead).
- **Website switches**: `soldout <product> on|off`, `hide <product> on|off`.
- **Goal / warning level**: `goal <items>`, `low-alert <n>` (also controls the website's "Running out").

## Publishing

Product changes (new product, price, words, photos, sold out, hide) are saved but only appear on the
website after `publish`. Saving keeps progress; publish ONCE when the user has finished all their
changes. Ask before publishing ("Shall I put these on the website now?"). Orders and stock need no
publish. The first time, `publish` needs the Netlify build hook link:
`publish --hook <https://api.netlify.com/build_hooks/...>` (stored in `.nelva/build-hook`, not in git).

Product saves are commits to GitHub with `[skip netlify]` (exactly what the dashboard does), not
code pushes, so they are allowed without the "push" instruction. Afterwards run `git pull --rebase`
so this folder has the change (do NOT push; code pushes still wait for the user's "push").

## Privacy

Orders hold customer names, phones and addresses. Show them to the user here when needed, but never
put them in commit messages of the public repo, files in the public repo, or anything sent outside.
