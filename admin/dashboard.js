/* ============================================================
   NELVA owner's dashboard (/admin/)

   Reads and writes JSON files on GitHub with the same login as the editor
   (Decap keeps the GitHub token in localStorage "decap-cms-user", so logging in
   here also logs in the editor and vice versa).

   Data:
     Waale01/nelva-natural (public)  content/products/<id>.json   products (sold_out switch is written here)
     Waale01/nelva-sales   (PRIVATE) orders/YYYY-MM.json           every order, by the month it was placed (Nigeria time)
                                     stock.json                    stock deliveries ("add") and counts ("count")
   Website orders are added by netlify/functions/order.js as status "waiting".
   A sale = an order with status "paid". Stock left = last count + deliveries since - paid sales since.

   Add ?demo to the address to try it with made-up data (nothing is saved).
   ============================================================ */
(function () {
  'use strict';

  var SITE_REPO = 'Waale01/nelva-natural';
  var SITE_BRANCH = 'master';
  var SALES_REPO = 'Waale01/nelva-sales'; // default branch
  var NETLIFY = 'https://api.netlify.com';
  var SITE_ID = 'nelvanatural.netlify.app';
  var RAW = 'https://raw.githubusercontent.com/' + SITE_REPO + '/' + SITE_BRANCH + '/';
  var USER_KEY = 'decap-cms-user';
  var UNPUB_KEY = 'nelva_unpublished';
  var DEMO = /[?&]demo(=|&|$)/.test(location.search);

  var S = {
    user: null, products: [], orders: [], stock: { low_alert: 5, entries: [] },
    view: 'home', ordersTab: 'waiting', month: null, basket: {}, sheet: null, busy: false, loaded: false,
  };
  var cache = {}; // path -> { sha, data } so a refresh only downloads files that changed

  var view = document.getElementById('view');
  var sheetWrap = document.getElementById('sheetWrap');
  var sheetEl = document.getElementById('sheet');

  // ============================================================ helpers
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function naira(n) { return '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG'); }
  function shortNaira(n) {
    n = Math.round(Number(n) || 0);
    if (n >= 1e6) return '₦' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'm';
    if (n >= 1e4) return '₦' + Math.round(n / 1e3) + 'k';
    return naira(n);
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  // Dates are shown in Nigeria time (WAT, UTC+1) wherever the phone is
  function wat(d) { return new Date(new Date(d).getTime() + 3600e3); }
  function dayKey(d) { return wat(d).toISOString().slice(0, 10); }
  function monthKey(d) { return dayKey(d).slice(0, 7); }
  function todayKey() { return dayKey(new Date()); }
  function addDays(key, n) { var d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function addMonths(key, n) { var p = key.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1 + n, 15)); return d.toISOString().slice(0, 7); }
  function monthName(key) { var p = key.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function dateText(key, long) {
    var d = new Date(key + 'T12:00:00Z');
    return (long ? DAYS[d.getUTCDay()] : DAYS[d.getUTCDay()].slice(0, 3)) + ' ' + d.getUTCDate() + ' ' + (long ? MONTHS[d.getUTCMonth()] : MONTHS[d.getUTCMonth()].slice(0, 3));
  }
  function clock(d) {
    var w = wat(d); var h = w.getUTCHours(); var m = w.getUTCMinutes();
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? 'am' : 'pm');
  }
  function whenText(iso) {
    var mins = (Date.now() - new Date(iso).getTime()) / 60000;
    if (mins < 1) return 'Just now';
    if (mins < 60) return Math.floor(mins) + ' min ago';
    var k = dayKey(iso); var t = todayKey();
    if (k === t) return 'Today, ' + clock(iso);
    if (k === addDays(t, -1)) return 'Yesterday, ' + clock(iso);
    return dateText(k) + ', ' + clock(iso);
  }
  function newId(prefix) { return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(); }
  function digits(s) { return String(s || '').replace(/[^\d]/g, ''); }
  function waNumber(phone) {
    var d = digits(phone);
    if (d.length === 11 && d[0] === '0') d = '234' + d.slice(1);
    if (d.length === 10 && d[0] !== '0') d = '234' + d;
    return d.length >= 10 ? d : '';
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }
  function getUnpublished() { try { return localStorage.getItem(UNPUB_KEY) === '1'; } catch (e) { return false; } }
  function setUnpublished(v) { try { if (v) localStorage.setItem(UNPUB_KEY, '1'); else localStorage.removeItem(UNPUB_KEY); } catch (e) { /* ignore */ } }

  // ============================================================ products, sales, stock
  function product(id) { return S.products.find(function (p) { return p.id === id; }); }
  function itemProduct(it) { return product(it.id) || S.products.find(function (p) { return p.name === it.name; }); }
  function pname(p) { return p ? (p.title || p.name || p.id) : ''; }
  function byOrder(a, b) { return (a.order || 999) - (b.order || 999) || pname(a).localeCompare(pname(b)); }
  function sellable() {
    return S.products.filter(function (p) { return !p.hidden && p.status !== 'coming-soon' && p.price > 0; }).sort(byOrder);
  }
  function imgUrl(p) {
    if (!p || !p.image) return '';
    return String(p.image).replace(/^\/+/, '');
  }
  function thumb(p, cls) {
    var src = imgUrl(p);
    cls = 'thumb' + (cls ? ' ' + cls : '');
    if (!src) return '<span class="' + cls + ' blank">🌿</span>';
    return '<img class="' + cls + '" src="/' + esc(src) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'' + RAW + esc(src) + '\'">';
  }

  function paidTime(o) { return o.paid_at || o.date; }
  function paidOrders() { return S.orders.filter(function (o) { return o.status === 'paid'; }); }
  function waiting() { return S.orders.filter(function (o) { return o.status === 'waiting'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }); }
  function qtyOf(o) { return (o.items || []).reduce(function (s, i) { return s + (Number(i.qty) || 0); }, 0); }
  function money(list) { return list.reduce(function (s, o) { return s + (Number(o.total) || 0); }, 0); }
  function itemsCount(list) { return list.reduce(function (s, o) { return s + qtyOf(o); }, 0); }
  function itemsText(o) {
    return (o.items || []).map(function (i) { var p = itemProduct(i); return i.qty + ' × ' + (p ? pname(p) : i.name); }).join(', ');
  }

  function stockLeft(id) {
    var entries = S.stock.entries.filter(function (e) { return e.id === id; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (!entries.length) return null; // never counted
    var last = null;
    entries.forEach(function (e) { if (e.type === 'count') last = e; });
    var start = last ? last.date : entries[0].date;
    var n = last ? Number(last.qty) || 0 : 0;
    entries.forEach(function (e) { if (e.type === 'add' && (!last || e.date > last.date)) n += Number(e.qty) || 0; });
    paidOrders().forEach(function (o) {
      if (paidTime(o) < start) return;
      (o.items || []).forEach(function (i) { var p = itemProduct(i); if (p && p.id === id) n -= Number(i.qty) || 0; });
    });
    return n;
  }
  function lowAlert() { return Number(S.stock.low_alert) || 5; }
  function stockState(n) { if (n == null) return 'none'; if (n <= 0) return 'out'; if (n <= lowAlert()) return 'low'; return 'ok'; }
  function lowProducts() {
    return sellable().filter(function (p) { var s = stockState(stockLeft(p.id)); return s === 'low' || s === 'out'; });
  }

  // ============================================================ GitHub (or the demo store)
  function HttpError(status, msg) { var e = new Error(msg || ('GitHub error ' + status)); e.status = status; return e; }

  function b64decode(s) {
    var bin = atob(String(s).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str); var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function gh(repo, path, opts) {
    opts = opts || {};
    return fetch('https://api.github.com/repos/' + repo + (path ? '/' + path : ''), {
      method: opts.method || 'GET',
      cache: 'no-store',
      headers: {
        Authorization: 'token ' + S.user.token,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: opts.body,
    }).then(function (r) {
      if (r.status === 401) { logout(true); throw HttpError(401, 'Please log in again.'); }
      return r;
    });
  }
  function q(branch) { return branch ? '?ref=' + encodeURIComponent(branch) : ''; }

  async function listDir(repo, path, branch) {
    if (DEMO) return demo.list(repo, path);
    var r = await gh(repo, 'contents/' + path + q(branch));
    if (r.status === 404) return [];
    if (!r.ok) throw HttpError(r.status);
    var list = await r.json();
    return Array.isArray(list) ? list.filter(function (f) { return f.type === 'file'; }) : [];
  }
  async function readJSON(repo, path, branch, sha) {
    var key = repo + ':' + path;
    if (sha && cache[key] && cache[key].sha === sha) return { data: JSON.parse(JSON.stringify(cache[key].data)), sha: sha };
    if (DEMO) return demo.read(repo, path);
    var r = await gh(repo, 'contents/' + path + q(branch));
    if (r.status === 404) return { data: null, sha: null };
    if (!r.ok) throw HttpError(r.status);
    var b = await r.json();
    var data = JSON.parse(b64decode(b.content));
    cache[key] = { sha: b.sha, data: data };
    return { data: JSON.parse(JSON.stringify(data)), sha: b.sha };
  }
  /** Read the newest version, change it with mutate(data) and save. Retries if it changed in the meantime. */
  async function writeJSON(repo, path, mutate, message, branch) {
    if (DEMO) { var dd = mutate(demo.read(repo, path).data); demo.write(repo, path, dd); return dd; }
    for (var attempt = 0; attempt < 4; attempt += 1) {
      delete cache[repo + ':' + path];
      var cur = await readJSON(repo, path, branch);
      var data = mutate(cur.data);
      var body = { message: message, content: b64encode(JSON.stringify(data, null, 2) + '\n') };
      if (cur.sha) body.sha = cur.sha;
      if (branch) body.branch = branch;
      var r = await gh(repo, 'contents/' + path, { method: 'PUT', body: JSON.stringify(body) });
      if (r.ok) {
        var res = await r.json();
        cache[repo + ':' + path] = { sha: res.content && res.content.sha, data: JSON.parse(JSON.stringify(data)) };
        return data;
      }
      if (r.status !== 409 && r.status !== 422) throw HttpError(r.status);
      await new Promise(function (ok) { setTimeout(ok, 400 + Math.random() * 600); });
    }
    throw new Error('Could not save. Please try again.');
  }

  // ============================================================ loading
  async function loadProducts() {
    var files = (await listDir(SITE_REPO, 'content/products', SITE_BRANCH)).filter(function (f) { return /\.json$/.test(f.name); });
    S.products = await Promise.all(files.map(async function (f) {
      var r = await readJSON(SITE_REPO, f.path, SITE_BRANCH, f.sha);
      var p = r.data || {};
      p.id = f.name.replace(/\.json$/, '');
      p.price = Number(p.price) || 0;
      return p;
    }));
  }
  async function loadSales() {
    var files = (await listDir(SALES_REPO, 'orders')).filter(function (f) { return /^\d{4}-\d{2}\.json$/.test(f.name); });
    var all = [];
    await Promise.all(files.map(async function (f) {
      var r = await readJSON(SALES_REPO, f.path, null, f.sha);
      ((r.data && r.data.orders) || []).forEach(function (o) {
        o._file = f.path;
        o.items = Array.isArray(o.items) ? o.items : [];
        all.push(o);
      });
    }));
    S.orders = all.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var st = await readJSON(SALES_REPO, 'stock.json');
    S.stock = st.data || { low_alert: 5, entries: [] };
    if (!Array.isArray(S.stock.entries)) S.stock.entries = [];
  }
  async function checkSalesAccess() {
    if (DEMO) return true;
    var r = await gh(SALES_REPO, '');
    return r.ok;
  }

  async function refresh(quiet) {
    var btn = document.querySelector('[data-act="refresh"]');
    if (btn) btn.classList.add('spin');
    try {
      await Promise.all([loadProducts(), loadSales()]);
      S.loaded = true;
      if (!S.sheet) render();
      else updateDots();
      if (!quiet) toast('Up to date ✓');
    } catch (e) {
      if (e.status === 401) return;
      if (!S.loaded) showError(e);
      else if (!quiet) toast('Could not refresh. Check your internet.');
    } finally {
      if (btn) btn.classList.remove('spin');
    }
  }

  // ============================================================ login
  function getUser() {
    if (DEMO) return { token: 'demo', login: 'demo', name: 'Demo' };
    try {
      var u = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
      return u && u.token && (!u.backendName || u.backendName === 'github') ? u : null;
    } catch (e) { return null; }
  }
  function logout(expired) {
    try { localStorage.removeItem(USER_KEY); } catch (e) { /* ignore */ }
    S.user = null; S.loaded = false;
    showLogin(expired ? 'Your login has expired. Please log in again.' : '');
  }
  function login() {
    // Same Netlify GitHub login the editor (Decap CMS) uses
    var url = NETLIFY + '/auth?provider=github&site_id=' + encodeURIComponent(SITE_ID) + '&scope=repo';
    var w = 960; var h = 640;
    var win = window.open(url, 'Netlify Authorization', 'width=' + w + ',height=' + h + ',top=' + (screen.height / 2 - h / 2) + ',left=' + (screen.width / 2 - w / 2));
    if (!win) { alert('Please allow pop-ups for this page, then try again.'); return; }
    function onMsg(e) {
      if (e.origin !== NETLIFY || typeof e.data !== 'string') return;
      if (e.data === 'authorizing:github') { win.postMessage(e.data, e.origin); return; }
      var ok = 'authorization:github:success:';
      var bad = 'authorization:github:error:';
      if (e.data.indexOf(ok) === 0) {
        window.removeEventListener('message', onMsg);
        win.close();
        finishLogin(JSON.parse(e.data.slice(ok.length)).token);
      } else if (e.data.indexOf(bad) === 0) {
        window.removeEventListener('message', onMsg);
        win.close();
        showLogin('Login did not work. Please try again.');
      }
    }
    window.addEventListener('message', onMsg);
  }
  async function finishLogin(token) {
    view.innerHTML = loadingHtml('Logging in…');
    try {
      var r = await fetch('https://api.github.com/user', { headers: { Authorization: 'token ' + token } });
      var u = r.ok ? await r.json() : {};
      var user = { token: token, backendName: 'github', login: u.login, name: u.name, avatar_url: u.avatar_url };
      localStorage.setItem(USER_KEY, JSON.stringify(user)); // the editor reads this too
      start();
    } catch (e) {
      showLogin('Login did not work. Please try again.');
    }
  }

  // ============================================================ screens
  function loadingHtml(text) { return '<div class="loading"><div class="leaf">🌿</div><p>' + esc(text || 'Loading…') + '</p></div>'; }

  function chrome(on) {
    document.getElementById('tabs').hidden = !on;
    document.getElementById('topActions').hidden = !on;
  }

  function showLogin(msg) {
    chrome(false);
    view.innerHTML =
      '<div class="login">' +
        '<div class="big-emoji">🌿</div>' +
        '<h1>Welcome to NELVA</h1>' +
        '<p>Log in to see your orders, sales and stock.</p>' +
        (msg ? '<div class="alert orange"><span class="ico">⚠️</span><span>' + esc(msg) + '</span></div><br>' : '') +
        '<button type="button" class="btn forest big" data-act="login"><span class="ico">🔑</span>Log in with GitHub</button>' +
        '<p style="margin-top:18px;font-size:0.85rem">Use the same GitHub login as before. A small window opens; click <b>Authorize</b> if it asks.</p>' +
      '</div>';
  }
  function showNoAccess() {
    chrome(false);
    var who = S.user && S.user.login ? ' (' + S.user.login + ')' : '';
    view.innerHTML =
      '<div class="login">' +
        '<div class="big-emoji">🔒</div>' +
        '<h1>Almost there</h1>' +
        '<p>This GitHub account' + esc(who) + ' can’t open the NELVA sales book yet. Ask your web developer to give it access, then log in again.</p>' +
        '<div class="stack" style="display:grid;gap:10px">' +
          '<a class="btn light big" href="/admin/editor/"><span class="ico">✏️</span>Edit products instead</a>' +
          '<button type="button" class="btn light big" data-act="logout"><span class="ico">🚪</span>Log out</button>' +
        '</div>' +
      '</div>';
  }
  function showError(e) {
    chrome(false);
    view.innerHTML =
      '<div class="login"><div class="big-emoji">📶</div><h1>Couldn’t load</h1>' +
      '<p>' + esc(e && e.message ? e.message : 'Something went wrong.') + ' Check your internet and try again.</p>' +
      '<button type="button" class="btn forest big" data-act="retry"><span class="ico">⟳</span>Try again</button></div>';
  }

  function render() {
    if (!S.loaded) return;
    chrome(true);
    document.querySelectorAll('#tabs [data-go]').forEach(function (b) { b.classList.toggle('on', b.dataset.go === S.view); });
    updateDots();
    var html = { home: homeView, orders: ordersView, sell: sellView, stock: stockView, money: moneyView }[S.view] || homeView;
    view.innerHTML = (DEMO ? '<div class="demo-flag">Practice mode: made-up numbers, nothing is saved</div><br>' : '') + html();
    view.classList.toggle('has-basket', S.view === 'sell' && basketCount() > 0);
  }
  function updateDots() {
    var w = waiting().length;
    var od = document.getElementById('ordersDot');
    od.hidden = !w; od.textContent = w;
    var low = lowProducts().length;
    var sd = document.getElementById('stockDot');
    sd.hidden = !low; sd.textContent = low;
    document.title = (w ? '(' + w + ') ' : '') + 'NELVA Dashboard';
  }

  function publishBanner() {
    if (!getUnpublished()) return '';
    return '<div class="banner"><span style="font-size:1.6rem">🚀</span><span><b>Website changes waiting</b><br>Publish to put them on the website.</span>' +
      '<button type="button" class="btn terra small" data-act="publish">Publish</button></div>';
  }

  // ---------- Home
  function homeView() {
    var t = todayKey();
    var weekStart = addDays(t, -6);
    var m = t.slice(0, 7);
    var paid = paidOrders();
    var inDay = paid.filter(function (o) { return dayKey(paidTime(o)) === t; });
    var inWeek = paid.filter(function (o) { return dayKey(paidTime(o)) >= weekStart; });
    var inMonth = paid.filter(function (o) { return monthKey(paidTime(o)) === m; });
    var hour = wat(new Date()).getUTCHours();
    var hi = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    var w = waiting();
    var low = lowProducts();
    var out = low.filter(function (p) { return stockLeft(p.id) <= 0; });
    var counted = sellable().some(function (p) { return stockLeft(p.id) != null; });

    var html = '<div class="hello"><h1>' + hi + ' 👋</h1><p>' + dateText(t, true) + '</p></div>' + publishBanner();

    html += '<div class="stats">' +
      stat('main', '☀️', 'Today', inDay) +
      stat('', '📅', 'Last 7 days', inWeek) +
      stat('', '🗓️', MONTHS[+m.slice(5) - 1], inMonth) +
    '</div>';

    if (w.length) {
      html += '<button type="button" class="alert orange" data-go="orders"><span class="ico">🔔</span><span>' +
        plural(w.length, 'new order') + ' waiting<small>Tap to see who ordered and mark them paid</small></span><span class="go">›</span></button>';
    }
    if (low.length) {
      html += '<button type="button" class="alert ' + (out.length ? 'red' : 'orange') + '" data-go="stock"><span class="ico">' + (out.length ? '🚫' : '⚠️') + '</span><span>' +
        (out.length ? plural(out.length, 'product') + ' finished' + (low.length > out.length ? ', ' + (low.length - out.length) + ' running low' : '') : plural(low.length, 'product') + ' running low') +
        '<small>' + esc(low.map(function (p) { var n = stockLeft(p.id); return pname(p) + (n <= 0 ? ': none left' : ': ' + n + ' left'); }).join(' · ')) + '</small></span><span class="go">›</span></button>';
    }
    if (!counted) {
      html += '<button type="button" class="alert green" data-go="stock"><span class="ico">📦</span><span>Count your products once<small>Then the dashboard tells you when something is running low</small></span><span class="go">›</span></button>';
    }

    html += '<div class="actions">' +
      '<button type="button" class="action sell" data-go="sell"><span class="ico">🛒</span>I sold something</button>' +
      '<button type="button" class="action orders" data-go="orders"><span class="ico">🔔</span>Orders' + (w.length ? '<span class="count">' + w.length + '</span>' : '') + '</button>' +
      '<button type="button" class="action stock" data-go="stock"><span class="ico">📦</span>Stock</button>' +
      '<a class="action edit" href="/admin/editor/" style="text-decoration:none"><span class="ico">✏️</span>Edit shop</a>' +
    '</div>';

    // last 14 days
    var days = [];
    for (var i = 13; i >= 0; i -= 1) {
      var k = addDays(t, -i);
      var v = money(paid.filter(function (o) { return dayKey(paidTime(o)) === k; }));
      days.push({ key: k, label: DAYS[new Date(k + 'T12:00:00Z').getUTCDay()][0], value: v, today: k === t, title: dateText(k) + ': ' + naira(v) });
    }
    html += '<div class="section-title"><h2>Money, last 14 days</h2><small>' + naira(money(paid.filter(function (o) { return dayKey(paidTime(o)) >= addDays(t, -13); }))) + '</small></div>' +
      '<div class="card">' + barChart(days) + '</div>';

    html += '<div class="section-title"><h2>Best sellers this month</h2><button type="button" class="link-btn" data-go="money">See more</button></div>' +
      '<div class="card">' + productRanking(inMonth, 3) + '</div>';

    var recent = paid.slice().sort(function (a, b) { return paidTime(a) < paidTime(b) ? 1 : -1; }).slice(0, 5);
    html += '<div class="section-title"><h2>Latest sales</h2><button type="button" class="link-btn" data-go="money">See all</button></div>' +
      '<div class="card">' + (recent.length ? recent.map(saleRow).join('') : emptyHtml('🌱', 'No sales yet. Tap 🛒 Sell when you sell something.')) + '</div>';
    return html;
  }
  function stat(cls, ico, label, list) {
    return '<div class="stat ' + cls + '"><span class="ico">' + ico + '</span><span class="lbl">' + esc(label) + '</span>' +
      '<span class="big">' + shortNaira(money(list)) + '</span><span class="sub">' + plural(itemsCount(list), 'item') + ' sold</span></div>';
  }
  function emptyHtml(ico, text) { return '<div class="empty"><span class="ico">' + ico + '</span>' + esc(text) + '</div>'; }

  function barChart(days) {
    var max = Math.max.apply(null, days.map(function (d) { return d.value; }).concat([1]));
    var top = days.reduce(function (a, d) { return d.value > a.value ? d : a; }, days[0]);
    return '<div class="chart">' + days.map(function (d) {
      var h = d.value ? Math.max(6, d.value / max * 100) : 3;
      var showVal = d.value && (d === top || d.today);
      return '<div class="col" title="' + esc(d.title) + '"><div class="barbox"><div class="bar' + (d.value ? ' has' : '') + (d.today ? ' today' : '') + '" style="height:' + h.toFixed(1) + '%">' +
        (showVal ? '<span class="val">' + shortNaira(d.value) + '</span>' : '') + '</div></div><span class="day">' + esc(d.label) + '</span></div>';
    }).join('') + '</div>';
  }

  function productRanking(list, limit) {
    var by = {};
    list.forEach(function (o) {
      o.items.forEach(function (i) {
        var p = itemProduct(i); var id = p ? p.id : i.name;
        by[id] = by[id] || { p: p, name: p ? pname(p) : i.name, qty: 0, money: 0 };
        by[id].qty += Number(i.qty) || 0;
        by[id].money += (Number(i.qty) || 0) * (Number(i.price) || 0);
      });
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.qty - a.qty || b.money - a.money; });
    if (limit) rows = rows.slice(0, limit);
    if (!rows.length) return emptyHtml('📭', 'Nothing sold yet this month.');
    var max = rows[0].qty || 1;
    return rows.map(function (r, i) {
      return '<div class="rank">' + thumb(r.p) + '<div class="info"><div class="name">' + (i === 0 ? '🏆 ' : '') + esc(r.name) + '</div>' +
        '<div class="meter"><i style="width:' + (r.qty / max * 100).toFixed(1) + '%"></i></div></div>' +
        '<div class="num">' + r.qty + ' sold<small>' + naira(r.money) + '</small></div></div>';
    }).join('');
  }

  var METHOD_ICON = { Cash: '💵', Transfer: '🏦', POS: '💳', WhatsApp: '💬', 'Card (Paystack)': '💳' };
  function saleRow(o) {
    var first = o.items[0] ? itemProduct(o.items[0]) : null;
    return '<button type="button" class="sale-row" data-act="sale" data-id="' + esc(o.id) + '">' + thumb(first, 'sm') +
      '<span class="info">' + esc(itemsText(o)) + '<small>' + (METHOD_ICON[o.method] || '') + ' ' + esc(o.method || '') + ' · ' + esc(whenText(paidTime(o))) +
      (o.customer && o.customer.name ? ' · ' + esc(o.customer.name) : '') + '</small></span>' +
      '<span class="amt">' + naira(o.total) + '</span></button>';
  }

  // ---------- Orders
  function ordersView() {
    var tab = S.ordersTab;
    var lists = {
      waiting: waiting(),
      paid: S.orders.filter(function (o) { return o.status === 'paid'; }).sort(function (a, b) { return paidTime(a) < paidTime(b) ? 1 : -1; }).slice(0, 40),
      cancelled: S.orders.filter(function (o) { return o.status === 'cancelled'; }).slice(0, 40),
    };
    var html = '<div class="hello"><h1>Orders</h1><p>Orders from the website arrive here by themselves.</p></div>' +
      '<div class="seg">' +
        segBtn('waiting', '🔔 Waiting' + (lists.waiting.length ? ' (' + lists.waiting.length + ')' : '')) +
        segBtn('paid', '✅ Paid') +
        segBtn('cancelled', '❌ Cancelled') +
      '</div>';
    var list = lists[tab];
    if (!list.length) {
      html += emptyHtml(tab === 'waiting' ? '😌' : '📭', tab === 'waiting' ? 'No orders waiting. All done!' : 'Nothing here yet.');
    } else {
      html += list.map(orderCard).join('');
    }
    return html;
  }
  function segBtn(id, label) { return '<button type="button" class="' + (S.ordersTab === id ? 'on' : '') + '" data-act="orders-tab" data-id="' + id + '">' + label + '</button>'; }

  function orderCard(o) {
    var c = o.customer || {};
    var web = o.source === 'website';
    var html = '<article class="order ' + esc(o.status) + '">' +
      '<div class="order-head"><div><h3>' + esc(c.name || (web ? 'Website customer' : 'Customer')) + '</h3>' +
      '<div class="when">' + esc(whenText(o.date)) + ' · ' + esc(o.id) + '</div></div>' +
      '<span class="pill ' + (web ? 'web' : 'shop') + '">' + (web ? '🌐 Website' : '🏪 In person') + '</span></div>' +
      '<div class="order-items">' + o.items.map(function (i) {
        var p = itemProduct(i);
        return '<div class="order-item">' + thumb(p, 'sm') + '<span>' + i.qty + ' × ' + esc(p ? pname(p) : i.name) + '</span><b>' + naira(i.qty * i.price) + '</b></div>';
      }).join('') + '</div>' +
      '<div class="order-total"><span>' + (METHOD_ICON[o.method] || '') + ' ' + esc(o.method || '') + '</span><strong>' + naira(o.total) + '</strong></div>';
    var who = [];
    if (c.phone) who.push('📞 ' + c.phone);
    if (c.address) who.push('📍 ' + c.address);
    if (c.notes) who.push('📝 ' + c.notes);
    if (who.length) html += '<div class="order-who">' + esc(who.join('\n')) + '</div>';

    var wa = waNumber(c.phone);
    var waLink = wa ? 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hello ' + (c.name || '') + ', this is NELVA NATURAL about your order ' + o.id + ' (' + naira(o.total) + ').') : '';
    html += '<div class="order-btns">';
    if (o.status === 'waiting') {
      if (waLink) html += '<a class="btn wa wide" href="' + esc(waLink) + '" target="_blank" rel="noopener"><span class="ico">💬</span>Chat on WhatsApp</a>';
      html += '<button type="button" class="btn green" data-act="ask-paid" data-id="' + esc(o.id) + '"><span class="ico">✅</span>Paid</button>' +
        '<button type="button" class="btn red" data-act="ask-cancel" data-id="' + esc(o.id) + '"><span class="ico">❌</span>Cancel</button>';
    } else if (o.status === 'paid') {
      html += '<div class="wide muted" style="font-size:0.9rem">✅ Paid ' + esc(whenText(paidTime(o))) + '</div>' +
        '<button type="button" class="btn light small wide" data-act="sale" data-id="' + esc(o.id) + '">↩ Undo</button>';
    } else {
      html += '<button type="button" class="btn light small wide" data-act="restore" data-id="' + esc(o.id) + '">↩ Bring this order back</button>';
    }
    return html + '</div></article>';
  }

  // ---------- Sell
  function basketCount() { return Object.keys(S.basket).reduce(function (s, k) { return s + S.basket[k]; }, 0); }
  function basketTotal() { return Object.keys(S.basket).reduce(function (s, k) { var p = product(k); return s + (p ? p.price * S.basket[k] : 0); }, 0); }

  function sellView() {
    var list = sellable();
    var html = '<div class="hello"><h1>I sold something 🛒</h1><p>For sales outside the website (in person, Instagram, WhatsApp chat…)</p></div>' +
      '<p class="tap-hint">👆 Tap a product once for each one you sold</p>';
    if (!list.length) return html + emptyHtml('🧴', 'No products to sell yet. Add them in ✏️ Edit shop.');
    html += '<div class="pick-grid">' + list.map(function (p) {
      var n = S.basket[p.id] || 0;
      var left = stockLeft(p.id);
      var src = imgUrl(p);
      return '<button type="button" class="pick' + (n ? ' on' : '') + '" data-act="pick" data-id="' + esc(p.id) + '" aria-label="Add one ' + esc(pname(p)) + '">' +
        (src ? '<img src="/' + esc(src) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'' + RAW + esc(src) + '\'">' : '<span class="noimg">🧴</span>') +
        (n ? '<span class="badge">' + n + '</span><span class="minus" data-act="unpick" data-id="' + esc(p.id) + '" role="button" aria-label="Remove one">−</span>' : '') +
        '<span class="pinfo"><span class="pname">' + esc(pname(p)) + '</span><span class="pprice" style="display:block">' + naira(p.price) + '</span>' +
        (left != null ? '<span class="pleft">' + (left > 0 ? left + ' left' : 'None left') + '</span>' : '') + '</span></button>';
    }).join('') + '</div>';
    var n = basketCount();
    if (n) {
      html += '<div class="basket"><div class="inner"><span class="sum"><small>' + plural(n, 'item') + '</small><strong>' + naira(basketTotal()) + '</strong></span>' +
        '<button type="button" class="btn light small" data-act="clear-basket" aria-label="Start again">✕</button>' +
        '<button type="button" class="btn terra" data-act="sell-next">Next →</button></div></div>';
    }
    return html;
  }

  // ---------- Stock
  function stockView() {
    var list = sellable();
    var low = lowProducts();
    if (!list.length) return '<div class="hello"><h1>Stock 📦</h1></div>' + emptyHtml('🧴', 'No products to count yet. Add them in ✏️ Edit shop, then Publish.');
    var html = '<div class="hello"><h1>Stock 📦</h1><p>' + (low.length ? '⚠️ ' + plural(low.length, 'product') + ' need more stock' : 'How many of each product you have left') + '</p></div>' + publishBanner();
    if (!list.some(function (p) { return stockLeft(p.id) != null; })) {
      html += '<div class="alert green" style="margin:0 0 14px"><span class="ico">👋</span><span>Start here<small>Count what you have on the shelf, then tap ✏️ Count on each product. After that, every sale takes 1 away by itself.</small></span></div>';
    }
    html += list.map(function (p) {
      var n = stockLeft(p.id);
      var st = stockState(n);
      var badge = st === 'none' ? '<span class="left-num none">Not counted yet</span>' :
        '<span class="left-num ' + st + '">' + (n <= 0 ? '<b>0</b> left' : '<b>' + n + '</b> left') + (st === 'out' ? ' 🚫' : st === 'low' ? ' ⚠️' : '') + '</span>';
      return '<div class="stock-row">' + thumb(p) +
        '<div class="info"><div class="name">' + esc(pname(p)) + '</div>' + badge +
        '</div>' +
        '<div class="stock-btns"><button type="button" class="btn terra small" data-act="ask-add" data-id="' + esc(p.id) + '">➕ Add</button>' +
        '<button type="button" class="btn light small" data-act="ask-count" data-id="' + esc(p.id) + '">✏️ Count</button></div>' +
        '<button type="button" class="web" data-act="ask-soldout" data-id="' + esc(p.id) + '"><span class="switch' + (p.sold_out ? ' off' : '') + '"></span>' +
        (p.sold_out ? '<span>Website: <b style="color:var(--red)">Sold out</b></span>' : '<span>Website: <b style="color:var(--green)">Can be ordered</b></span>') + '</button>' + '</div>';
    }).join('');
    html += '<button type="button" class="btn light" style="width:100%;margin-top:6px" data-act="ask-low">⚠️ Warn me when only ' + lowAlert() + ' are left</button>';
    return html;
  }

  // ---------- Money (monthly report)
  function moneyView() {
    var m = S.month || todayKey().slice(0, 7);
    var paid = paidOrders().filter(function (o) { return monthKey(paidTime(o)) === m; })
      .sort(function (a, b) { return paidTime(a) < paidTime(b) ? 1 : -1; });
    var thisMonth = todayKey().slice(0, 7);
    var html = '<div class="month"><button type="button" class="nav" data-act="month" data-id="-1" aria-label="Previous month">‹</button>' +
      '<h1>' + monthName(m) + '</h1>' +
      '<button type="button" class="nav" data-act="month" data-id="1" aria-label="Next month"' + (m >= thisMonth ? ' disabled' : '') + '>›</button></div>';
    html += '<div class="stats">' +
      '<div class="stat main"><span class="ico">💰</span><span class="lbl">Money in</span><span class="big">' + shortNaira(money(paid)) + '</span><span class="sub">' + naira(money(paid)) + '</span></div>' +
      '<div class="stat"><span class="ico">🧴</span><span class="lbl">Items sold</span><span class="big">' + itemsCount(paid) + '</span></div>' +
      '<div class="stat"><span class="ico">🧾</span><span class="lbl">Sales</span><span class="big">' + paid.length + '</span></div>' +
    '</div>';

    // money per day of the month
    var p = m.split('-');
    var nDays = new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate();
    var days = [];
    for (var d = 1; d <= nDays; d += 1) {
      var k = m + '-' + String(d).padStart(2, '0');
      var v = money(paid.filter(function (o) { return dayKey(paidTime(o)) === k; }));
      days.push({ key: k, label: d === 1 || d % 5 === 0 ? String(d) : '', value: v, today: k === todayKey(), title: dateText(k) + ': ' + naira(v) });
    }
    html += '<div class="section-title"><h2>Money each day</h2></div><div class="card">' + barChart(days) + '</div>';
    html += '<div class="section-title"><h2>What sold</h2></div><div class="card">' + productRanking(paid) + '</div>';

    // how people paid
    var by = {};
    paid.forEach(function (o) {
      var k = o.source === 'website' ? 'Website (' + (o.method || 'WhatsApp') + ')' : (o.method || 'Other');
      by[k] = by[k] || { n: 0, money: 0, ico: o.source === 'website' ? '🌐' : (METHOD_ICON[o.method] || '•') };
      by[k].n += 1; by[k].money += Number(o.total) || 0;
    });
    var keys = Object.keys(by).sort(function (a, b) { return by[b].money - by[a].money; });
    if (keys.length) {
      var max = by[keys[0]].money || 1;
      html += '<div class="section-title"><h2>How people paid</h2></div><div class="card">' + keys.map(function (k) {
        return '<div class="rank"><span class="thumb blank">' + by[k].ico + '</span><div class="info"><div class="name">' + esc(k) + '</div>' +
          '<div class="meter"><i style="width:' + (by[k].money / max * 100).toFixed(1) + '%;background:var(--forest-2)"></i></div></div>' +
          '<div class="num">' + naira(by[k].money) + '<small>' + plural(by[k].n, 'sale') + '</small></div></div>';
      }).join('') + '</div>';
    }

    html += '<div class="section-title"><h2>Every sale</h2><small>Tap one to undo a mistake</small></div>' +
      '<div class="card">' + (paid.length ? paid.map(saleRow).join('') : emptyHtml('📭', 'No sales in ' + monthName(m) + '.')) + '</div>';
    return html;
  }

  // ============================================================ pop-up sheets
  function openSheet(state) { S.sheet = state; drawSheet(); sheetWrap.hidden = false; }
  function closeSheet() { S.sheet = null; sheetWrap.hidden = true; sheetEl.innerHTML = ''; }
  function drawSheet() {
    var s = S.sheet; if (!s) return;
    var fn = SHEETS[s.type];
    sheetEl.innerHTML = '<div class="grab"></div>' + fn(s);
    var f = sheetEl.querySelector('[autofocus]');
    if (f && window.matchMedia('(min-width: 600px)').matches) f.focus();
  }
  function stepper() {
    return '<div class="stepper"><button type="button" data-act="step" data-id="-1" aria-label="One less">−</button>' +
      '<output>' + S.sheet.qty + '</output><button type="button" data-act="step" data-id="1" aria-label="One more">+</button></div>';
  }
  function order(id) { return S.orders.find(function (o) { return o.id === id; }); }

  var SHEETS = {
    menu: function () {
      return '<h2>Menu</h2><div class="menu-list">' +
        '<button type="button" class="btn" data-act="publish"><span class="ico">🚀</span><span>Publish website<small>Put saved product changes on the website</small></span></button>' +
        '<a class="btn" href="/admin/editor/"><span class="ico">✏️</span><span>Edit products & photos<small>Prices, pictures, descriptions, new products</small></span></a>' +
        '<a class="btn" href="/" target="_blank" rel="noopener"><span class="ico">🌐</span><span>Open the website</span></a>' +
        '<a class="btn" href="/admin/guide.html" target="_blank" rel="noopener"><span class="ico">❓</span><span>Help</span></a>' +
        (DEMO ? '<a class="btn" href="/admin/"><span class="ico">🚪</span><span>Leave practice mode</span></a>' :
          '<button type="button" class="btn" data-act="logout"><span class="ico">🚪</span><span>Log out' + (S.user && S.user.login ? '<small>' + esc(S.user.login) + '</small>' : '') + '</span></button>') +
        '</div>';
    },
    paid: function (s) {
      var o = order(s.id);
      return '<div class="big-emoji">💰</div><h2>Did they pay?</h2>' +
        '<p class="lead">' + esc((o.customer && o.customer.name) || 'The customer') + ' · <b>' + naira(o.total) + '</b><br>' + esc(itemsText(o)) + '</p>' +
        '<div class="stack"><button type="button" class="btn green big" data-act="do-paid" data-id="' + esc(o.id) + '"' + (S.busy ? ' disabled' : '') + '><span class="ico">✅</span>' + (S.busy ? 'Saving…' : 'Yes, I got the money') + '</button>' +
        '<button type="button" class="btn light big" data-act="close-sheet">Not yet</button></div>';
    },
    cancel: function (s) {
      var o = order(s.id);
      return '<div class="big-emoji">🗑️</div><h2>Cancel this order?</h2>' +
        '<p class="lead">' + esc((o.customer && o.customer.name) || 'Customer') + ' · ' + naira(o.total) + '<br>Use this if they changed their mind or never paid.</p>' +
        '<div class="stack"><button type="button" class="btn red big" data-act="do-cancel" data-id="' + esc(o.id) + '"' + (S.busy ? ' disabled' : '') + '><span class="ico">❌</span>' + (S.busy ? 'Saving…' : 'Yes, cancel it') + '</button>' +
        '<button type="button" class="btn light big" data-act="close-sheet">No, keep it</button></div>';
    },
    sale: function (s) {
      var o = order(s.id);
      var web = o.source === 'website';
      return '<div class="big-emoji">🧾</div><h2>' + naira(o.total) + '</h2>' +
        '<p class="lead">' + esc(itemsText(o)) + '<br>' + (METHOD_ICON[o.method] || '') + ' ' + esc(o.method || '') + ' · ' + esc(whenText(paidTime(o))) +
        (o.customer && o.customer.name ? '<br>' + esc(o.customer.name) : '') + '</p>' +
        '<div class="stack">' +
        (web
          ? '<button type="button" class="btn red big" data-act="do-unpaid" data-id="' + esc(o.id) + '"' + (S.busy ? ' disabled' : '') + '>↩ ' + (S.busy ? 'Saving…' : 'Not paid after all') + '</button>'
          : '<button type="button" class="btn red big" data-act="do-cancel" data-id="' + esc(o.id) + '"' + (S.busy ? ' disabled' : '') + '>🗑️ ' + (S.busy ? 'Saving…' : 'Delete this sale (mistake)') + '</button>') +
        '<button type="button" class="btn light big" data-act="close-sheet">Keep it</button></div>';
    },
    checkout: function (s) {
      var lines = Object.keys(S.basket).map(function (id) {
        var p = product(id);
        return '<div class="order-item">' + thumb(p, 'sm') + '<span>' + S.basket[id] + ' × ' + esc(pname(p)) + '</span><b>' + naira(p.price * S.basket[id]) + '</b></div>';
      }).join('');
      var methods = [['Cash', '💵'], ['Transfer', '🏦'], ['POS', '💳']];
      return '<h2>Almost done!</h2><div class="card" style="margin:10px 0 4px">' + lines + '</div>' +
        '<div class="field"><span>How did they pay?</span><div class="choices">' + methods.map(function (m) {
          return '<button type="button" class="choice' + (s.method === m[0] ? ' on' : '') + '" data-act="method" data-id="' + m[0] + '"><span class="ico">' + m[1] + '</span>' + m[0] + '</button>';
        }).join('') + '</div></div>' +
        '<label class="field"><span>Money received (₦)</span><input id="sellAmount" inputmode="numeric" value="' + esc(Number(s.amount).toLocaleString('en-NG')) + '"></label>' +
        '<label class="field"><span>Customer name <small class="muted">(you can skip this)</small></span><input id="sellName" autocomplete="off" value="' + esc(s.name || '') + '"></label>' +
        '<div class="stack"><button type="button" class="btn green big" data-act="do-sell"' + (S.busy ? ' disabled' : '') + '><span class="ico">✅</span>' + (S.busy ? 'Saving…' : 'Save sale') + '</button>' +
        '<button type="button" class="btn light big" data-act="close-sheet">← Back</button></div>';
    },
    sold: function (s) {
      return '<div class="big-emoji">🎉</div><h2>Sale saved!</h2><p class="lead">' + naira(s.amount) + ' added to your money for today.</p>' +
        '<div class="stack"><button type="button" class="btn terra big" data-act="close-sheet">🛒 Sell more</button>' +
        '<button type="button" class="btn light big" data-act="go-home">🏠 Home</button></div>';
    },
    add: function (s) {
      var p = product(s.id);
      return '<div style="display:flex;justify-content:center">' + thumb(p) + '</div><h2>New stock</h2>' +
        '<p class="lead">How many <b>' + esc(pname(p)) + '</b> did you get?</p>' + stepper() +
        '<div class="chips">' + [6, 12, 24].map(function (n) { return '<button type="button" data-act="set-qty" data-id="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
        '<div class="stack"><button type="button" class="btn green big" data-act="do-add"' + (S.busy || s.qty < 1 ? ' disabled' : '') + '><span class="ico">✅</span>' + (S.busy ? 'Saving…' : 'Add ' + s.qty) + '</button>' +
        '<button type="button" class="btn light big" data-act="close-sheet">Cancel</button></div>';
    },
    count: function (s) {
      var p = product(s.id);
      return '<div style="display:flex;justify-content:center">' + thumb(p) + '</div><h2>Count</h2>' +
        '<p class="lead">How many <b>' + esc(pname(p)) + '</b> do you have <b>right now</b>?</p>' + stepper() +
        '<div class="chips">' + [0, 10, 20, 50].map(function (n) { return '<button type="button" data-act="set-qty" data-id="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
        '<div class="stack"><button type="button" class="btn green big" data-act="do-count"' + (S.busy ? ' disabled' : '') + '><span class="ico">✅</span>' + (S.busy ? 'Saving…' : 'I have ' + s.qty) + '</button>' +
        '<button type="button" class="btn light big" data-act="close-sheet">Cancel</button></div>';
    },
    low: function (s) {
      return '<div class="big-emoji">⚠️</div><h2>Running-low warning</h2><p class="lead">Warn me when this many (or fewer) are left:</p>' + stepper() +
        '<div class="stack"><button type="button" class="btn green big" data-act="do-low"' + (S.busy ? ' disabled' : '') + '><span class="ico">✅</span>' + (S.busy ? 'Saving…' : 'Save') + '</button>' +
        '<button type="button" class="btn light big" data-act="close-sheet">Cancel</button></div>';
    },
    soldout: function (s) {
      var p = product(s.id);
      var makeOut = !p.sold_out;
      return '<div style="display:flex;justify-content:center">' + thumb(p) + '</div>' +
        '<h2>' + (makeOut ? 'Show “Sold out”?' : 'Sell it again?') + '</h2>' +
        '<p class="lead">' + (makeOut ? 'Customers will see <b>' + esc(pname(p)) + '</b> as Sold out and can’t order it.' : 'Customers will be able to order <b>' + esc(pname(p)) + '</b> again.') +
        '<br>It changes on the website after you <b>Publish</b>.</p>' +
        '<div class="stack"><button type="button" class="btn ' + (makeOut ? 'red' : 'green') + ' big" data-act="do-soldout" data-id="' + esc(p.id) + '"' + (S.busy ? ' disabled' : '') + '>' +
        (S.busy ? 'Saving…' : makeOut ? '🚫 Yes, sold out' : '✅ Yes, can be ordered') + '</button>' +
        '<button type="button" class="btn light big" data-act="close-sheet">Cancel</button></div>';
    },
    published: function (s) {
      return '<div class="big-emoji">' + (s.ok ? '🚀' : '📶') + '</div><h2>' + esc(s.title) + '</h2><p class="lead">' + esc(s.detail) + '</p>' +
        '<div class="stack"><button type="button" class="btn forest big" data-act="close-sheet">OK</button></div>';
    },
  };

  // ============================================================ saving
  async function saving(fn) {
    if (S.busy) return;
    S.busy = true; drawSheet();
    try { await fn(); } catch (e) {
      if (e.status !== 401) {
        alert((e.status === 403 || e.status === 404) ? 'This account is not allowed to save here. Ask your web developer.' : (e.message || 'Could not save. Check your internet and try again.'));
      }
    } finally {
      S.busy = false;
      if (S.sheet) drawSheet();
    }
  }
  function changeOrder(o, change, message) {
    return writeJSON(SALES_REPO, o._file, function (d) {
      var t = d && Array.isArray(d.orders) && d.orders.find(function (x) { return x.id === o.id; });
      if (!t) throw new Error('This order has changed. Tap ⟳ to refresh, then try again.');
      change(t);
      return d;
    }, message).then(function () { change(o); });
  }
  function addOrder(o) {
    var file = 'orders/' + monthKey(o.date) + '.json';
    return writeJSON(SALES_REPO, file, function (d) {
      d = d && Array.isArray(d.orders) ? d : { orders: [] };
      d.orders.push(o);
      return d;
    }, 'Sale ' + o.id + ' (' + o.method + ', ' + naira(o.total) + ')').then(function () {
      o._file = file; S.orders.unshift(o);
    });
  }
  function changeStock(change, message) {
    return writeJSON(SALES_REPO, 'stock.json', function (d) {
      d = d || { low_alert: 5, entries: [] };
      if (!Array.isArray(d.entries)) d.entries = [];
      change(d);
      return d;
    }, message).then(function (d) { S.stock = d; });
  }

  var ACTIONS = {
    login: login,
    logout: function () { closeSheet(); if (confirm('Log out of the dashboard?')) logout(false); },
    retry: function () { start(); },
    refresh: function () { refresh(false); },
    menu: function () { openSheet({ type: 'menu' }); },
    'close-sheet': closeSheet,
    'go-home': function () { closeSheet(); go('home'); },
    publish: function () {
      closeSheet();
      window.nelvaPublish(function (title, detail, state) {
        if (state === 'busy') { toast(title); return; }
        if (state === 'done') setUnpublished(false);
        openSheet({ type: 'published', title: title, detail: detail, ok: state !== 'error' });
        render();
      });
    },
    'orders-tab': function (el) { S.ordersTab = el.dataset.id; render(); },
    month: function (el) { S.month = addMonths(S.month || todayKey().slice(0, 7), +el.dataset.id); render(); },

    'ask-paid': function (el) { openSheet({ type: 'paid', id: el.dataset.id }); },
    'ask-cancel': function (el) { openSheet({ type: 'cancel', id: el.dataset.id }); },
    sale: function (el) { openSheet({ type: 'sale', id: el.dataset.id }); },
    restore: function (el) {
      var o = order(el.dataset.id);
      saving(function () {
        return changeOrder(o, function (t) { t.status = 'waiting'; delete t.paid_at; delete t.cancelled_at; }, 'Order ' + o.id + ': back to waiting')
          .then(function () { toast('Order is back in Waiting'); render(); });
      });
    },
    'do-paid': function (el) {
      var o = order(el.dataset.id); var now = new Date().toISOString();
      saving(function () {
        return changeOrder(o, function (t) { t.status = 'paid'; t.paid_at = now; }, 'Order ' + o.id + ': paid (' + naira(o.total) + ')')
          .then(function () { closeSheet(); toast('Money recorded! 🎉'); render(); });
      });
    },
    'do-unpaid': function (el) {
      var o = order(el.dataset.id);
      saving(function () {
        return changeOrder(o, function (t) { t.status = 'waiting'; delete t.paid_at; }, 'Order ' + o.id + ': not paid after all')
          .then(function () { closeSheet(); toast('Moved back to Waiting'); render(); });
      });
    },
    'do-cancel': function (el) {
      var o = order(el.dataset.id); var now = new Date().toISOString();
      saving(function () {
        return changeOrder(o, function (t) { t.status = 'cancelled'; t.cancelled_at = now; delete t.paid_at; }, 'Order ' + o.id + ': cancelled')
          .then(function () { closeSheet(); toast(o.source === 'website' ? 'Order cancelled' : 'Sale deleted'); render(); });
      });
    },

    pick: function (el) {
      var id = el.dataset.id; S.basket[id] = (S.basket[id] || 0) + 1; render();
    },
    unpick: function (el) { var id = el.dataset.id; S.basket[id] = (S.basket[id] || 0) - 1; if (S.basket[id] <= 0) delete S.basket[id]; render(); },
    'clear-basket': function () { S.basket = {}; render(); },
    'sell-next': function () { openSheet({ type: 'checkout', method: 'Transfer', amount: basketTotal(), name: '' }); },
    method: function (el) { keepInputs(); S.sheet.method = el.dataset.id; drawSheet(); },
    'do-sell': function () {
      keepInputs();
      var s = S.sheet;
      var amount = Number(digits(s.amount));
      if (!(amount > 0)) { alert('Please type how much money you received.'); return; }
      var now = new Date().toISOString();
      var items = Object.keys(S.basket).map(function (id) { var p = product(id); return { id: id, name: p.name, qty: S.basket[id], price: p.price }; });
      var o = { id: newId('S'), date: now, paid_at: now, source: 'shop', method: s.method, status: 'paid', items: items, total: amount, customer: { name: (s.name || '').trim() } };
      saving(function () {
        return addOrder(o).then(function () {
          S.basket = {}; render();
          openSheet({ type: 'sold', amount: amount });
        });
      });
    },

    'ask-add': function (el) { openSheet({ type: 'add', id: el.dataset.id, qty: 1 }); },
    'ask-count': function (el) { var n = stockLeft(el.dataset.id); openSheet({ type: 'count', id: el.dataset.id, qty: n != null && n > 0 ? n : 0 }); },
    'ask-low': function () { openSheet({ type: 'low', qty: lowAlert() }); },
    'ask-soldout': function (el) { openSheet({ type: 'soldout', id: el.dataset.id }); },
    step: function (el) { S.sheet.qty = Math.max(0, Math.min(9999, S.sheet.qty + Number(el.dataset.id))); drawSheet(); },
    'set-qty': function (el) { S.sheet.qty = Number(el.dataset.id); drawSheet(); },
    'do-add': function () {
      var s = S.sheet; var p = product(s.id);
      saving(function () {
        return changeStock(function (d) { d.entries.push({ date: new Date().toISOString(), id: s.id, type: 'add', qty: s.qty }); }, 'Stock: +' + s.qty + ' ' + p.name)
          .then(function () { closeSheet(); toast('Added ' + s.qty + ' ✓'); render(); });
      });
    },
    'do-count': function () {
      var s = S.sheet; var p = product(s.id);
      saving(function () {
        return changeStock(function (d) { d.entries.push({ date: new Date().toISOString(), id: s.id, type: 'count', qty: s.qty }); }, 'Stock: counted ' + s.qty + ' ' + p.name)
          .then(function () { closeSheet(); toast('Saved: ' + s.qty + ' left ✓'); render(); });
      });
    },
    'do-low': function () {
      var s = S.sheet;
      saving(function () {
        return changeStock(function (d) { d.low_alert = Math.max(1, s.qty); }, 'Stock: warn at ' + s.qty)
          .then(function () { closeSheet(); toast('Saved ✓'); render(); });
      });
    },
    'do-soldout': function (el) {
      var p = product(el.dataset.id); var val = !p.sold_out;
      saving(function () {
        return writeJSON(SITE_REPO, 'content/products/' + p.id + '.json', function (d) {
          if (!d) throw new Error('Product not found. Tap ⟳ to refresh.');
          d.sold_out = val; return d;
        }, 'Admin: update products "' + p.id + '" [skip netlify]', SITE_BRANCH).then(function () {
          p.sold_out = val; setUnpublished(true); closeSheet(); render();
          toast(val ? 'Saved. Now tap Publish 🚀' : 'Saved. Now tap Publish 🚀');
        });
      });
    },
  };
  // keep what was typed in the checkout sheet when it is redrawn
  function keepInputs() {
    var a = document.getElementById('sellAmount'); var n = document.getElementById('sellName');
    if (a) S.sheet.amount = digits(a.value) || 0;
    if (n) S.sheet.name = n.value;
  }

  function go(v) {
    if (location.hash !== '#' + v) location.hash = v; // the phone's Back button works between sections
    else { S.view = v; render(); window.scrollTo(0, 0); }
  }
  window.addEventListener('hashchange', function () {
    var v = location.hash.slice(1);
    if (!/^(home|orders|sell|stock|money)$/.test(v)) v = 'home';
    closeSheet();
    S.view = v; render(); window.scrollTo(0, 0);
  });

  document.addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); return; }
    var a = e.target.closest('[data-act]');
    if (!a || a.disabled) return;
    var fn = ACTIONS[a.dataset.act];
    if (fn) { e.preventDefault(); fn(a, e); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.sheet && !S.busy) closeSheet(); });
  sheetEl.addEventListener('input', function (e) {
    if (e.target.id === 'sellAmount') {
      var n = digits(e.target.value);
      e.target.value = n ? Number(n).toLocaleString('en-NG') : '';
    }
  });

  // New website orders: check every 2 minutes while the page is open
  setInterval(function () { if (S.loaded && !S.sheet && !S.busy && document.visibilityState === 'visible') refresh(true); }, 120000);
  document.addEventListener('visibilitychange', function () { if (S.loaded && !S.sheet && document.visibilityState === 'visible') refresh(true); });

  // ============================================================ start
  async function start() {
    S.user = getUser();
    if (!S.user) { showLogin(); return; }
    view.innerHTML = loadingHtml();
    try {
      if (!(await checkSalesAccess())) { showNoAccess(); return; }
      var v = location.hash.slice(1);
      S.view = /^(home|orders|sell|stock|money)$/.test(v) ? v : 'home';
      await refresh(true);
    } catch (e) {
      if (e.status !== 401) showError(e);
    }
  }

  // ============================================================ practice mode (?demo): made-up data, kept in memory
  var demo = (function () {
    if (!DEMO) return null;
    var files = {};
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    var prods = {
      'herbal-oil': { name: 'Herbal Infused Oil', status: 'available', price: 20000, image: '/images/product-herbal-oil.jpg', order: 10 },
      'herbal-bloom': { name: 'Herbal Bloom Moisturizing Hair Butter', title: 'Herbal Bloom Hair Butter', status: 'available', price: 25000, image: '/images/product-herbal-bloom.jpg', order: 20 },
      'cleansing-shampoo': { name: 'Cleansing Shampoo', status: 'coming-soon', order: 30 },
    };
    Object.keys(prods).forEach(function (id) { files[SITE_REPO + ':content/products/' + id + '.json'] = prods[id]; });
    var now = Date.now(); var orders = [];
    var names = ['Amara O.', 'Tolu A.', 'Chioma E.', 'Funmi B.', 'Ngozi K.', 'Kemi S.', 'Ada N.'];
    for (var d = 45; d >= 0; d -= 1) {
      var n = Math.floor(rnd() * 3.2);
      for (var i = 0; i < n; i += 1) {
        var t = new Date(now - d * 864e5 - rnd() * 8 * 36e5).toISOString();
        var oil = rnd() < 0.6;
        var qty = 1 + Math.floor(rnd() * 2);
        var p = oil ? prods['herbal-oil'] : prods['herbal-bloom'];
        var web = rnd() < 0.5;
        orders.push({ id: (web ? 'NN-' : 'S-') + Math.floor(rnd() * 1e6), date: t, paid_at: t, source: web ? 'website' : 'shop',
          method: web ? 'WhatsApp' : ['Cash', 'Transfer', 'POS'][Math.floor(rnd() * 3)], status: 'paid',
          items: [{ id: oil ? 'herbal-oil' : 'herbal-bloom', name: p.name, qty: qty, price: p.price }], total: qty * p.price,
          customer: { name: names[Math.floor(rnd() * names.length)] } });
      }
    }
    [[0.4, 'Bisi Adeyemi', '08031234567', 'Plot 4, Admiralty Way, Lekki, Lagos'], [3, 'Zainab Musa', '07062345678', '12 Ahmadu Bello Way, Kaduna']].forEach(function (w, i) {
      orders.push({ id: 'NN-DEMO' + (i + 1), date: new Date(now - w[0] * 36e5).toISOString(), source: 'website', method: 'WhatsApp', status: 'waiting',
        items: [{ id: 'herbal-oil', name: 'Herbal Infused Oil', qty: 1, price: 20000 }].concat(i ? [] : [{ id: 'herbal-bloom', name: 'Herbal Bloom Moisturizing Hair Butter', qty: 1, price: 25000 }]),
        total: i ? 20000 : 45000, customer: { name: w[1], phone: w[2], address: w[3], notes: i ? '' : 'Please call before delivery' } });
    });
    orders.forEach(function (o) {
      var f = SALES_REPO + ':orders/' + monthKey(o.date) + '.json';
      files[f] = files[f] || { orders: [] };
      files[f].orders.push(o);
    });
    files[SALES_REPO + ':stock.json'] = { low_alert: 5, entries: [
      { date: new Date(now - 50 * 864e5).toISOString(), id: 'herbal-oil', type: 'count', qty: 80 },
      { date: new Date(now - 50 * 864e5).toISOString(), id: 'herbal-bloom', type: 'count', qty: 26 },
    ] };
    return {
      list: function (repo, path) {
        var pre = repo + ':' + path + '/';
        return Promise.resolve(Object.keys(files).filter(function (k) { return k.indexOf(pre) === 0; }).map(function (k) {
          var p = k.slice(repo.length + 1); return { name: p.split('/').pop(), path: p, type: 'file' };
        }));
      },
      read: function (repo, path) {
        var v = files[repo + ':' + path];
        return { data: v ? JSON.parse(JSON.stringify(v)) : null, sha: null };
      },
      write: function (repo, path, data) { files[repo + ':' + path] = JSON.parse(JSON.stringify(data)); },
    };
  })();

  start();
})();
