// ============================================
// NELVA NATURAL — site interactions
// ============================================

document.getElementById('year').textContent = new Date().getFullYear();

// Sticky header shadow on scroll
const header = document.getElementById('siteHeader');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 10);
});

// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');
if (navToggle) {
  navToggle.addEventListener('click', () => {
    mainNav.style.display = mainNav.style.display === 'flex' ? 'none' : 'flex';
    mainNav.style.flexDirection = 'column';
    mainNav.style.position = 'absolute';
    mainNav.style.top = '100%';
    mainNav.style.left = '0';
    mainNav.style.right = '0';
    mainNav.style.background = '#fff';
    mainNav.style.padding = '20px 24px';
    mainNav.style.gap = '18px';
    mainNav.style.boxShadow = '0 10px 20px rgba(0,0,0,0.08)';
  });
}

// Toast helper
const toast = document.getElementById('toast');
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ============================================
// Cart + checkout
// ============================================

// --- Business config — REPLACE THESE with live values ---
const WHATSAPP_NUMBER = '2348123354382';                 // international format, no + or spaces
const PAYSTACK_PUBLIC_KEY = 'pk_test_REPLACE_WITH_YOUR_KEY'; // from dashboard.paystack.com → Settings → API Keys
const ORDER_EMAIL_ENDPOINT = 'https://formspree.io/f/mljerrjp'; // Formspree form that receives order emails (business copy)
// EmailJS — sends the customer their order confirmation (emailjs.com, free tier). Fill in from your EmailJS dashboard.
const EMAILJS_PUBLIC_KEY = 'zTwFD8aaBqCOWG_i5';           // Account → General → Public Key
const EMAILJS_SERVICE_ID = 'service_qjbgny3';              // Email Services → Service ID
const EMAILJS_TEMPLATE_ID = 'template_u859tz8';           // Email Templates → Template ID
// --------------------------------------------------------

const CART_KEY = 'nelva_cart';
const DETAILS_KEY = 'nelva_checkout_details';
const cartCountEl = document.getElementById('cartCount');

function getCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}
function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}
function cartQuantity() {
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}
function cartSubtotal() {
  return getCart().reduce((sum, item) => sum + item.price * item.qty, 0);
}
function updateCartCount() {
  if (cartCountEl) cartCountEl.textContent = cartQuantity();
}
function formatNaira(amount) {
  return '₦' + Number(amount).toLocaleString('en-NG');
}
function addToCart(name, price, image) {
  const cart = getCart();
  const existing = cart.find((item) => item.name === name);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ name, price, image: image || '', qty: 1 });
  }
  saveCart(cart);
}
function generateOrderRef() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i += 1) s += chars[Math.floor(Math.random() * chars.length)];
  return 'NN-' + s;
}

updateCartCount();

document.querySelectorAll('.add-cart-btn').forEach((btn) => {
  if (btn.disabled) return;
  btn.addEventListener('click', () => {
    const card = btn.closest('.product-card');
    if (!card) return;
    const name = card.dataset.name || 'Item';
    const price = parseInt(card.dataset.price || '0', 10);
    const img = card.querySelector('.product-photo img');
    addToCart(name, price, img ? img.getAttribute('src') : '');
    showToast(`${name} added to cart`);
  });
});

// ============================================
// Checkout page
// ============================================
const checkoutGrid = document.getElementById('checkoutGrid');
if (checkoutGrid) {
  const cartEmpty = document.getElementById('cartEmpty');
  const orderConfirm = document.getElementById('orderConfirm');
  const cartItemsEl = document.getElementById('cartItems');
  const subtotalEl = document.getElementById('summarySubtotal');
  const totalEl = document.getElementById('summaryTotal');
  const form = document.getElementById('checkoutForm');
  const noteEl = document.getElementById('checkoutNote');
  const whatsappBtn = document.getElementById('whatsappBtn');
  const paystackBtn = document.getElementById('paystackBtn');
  const waConfirm = document.getElementById('waConfirm');
  const waConfirmBtn = document.getElementById('waConfirmBtn');
  const waBackBtn = document.getElementById('waBackBtn');
  let pendingWa = null; // { d, ref } — a WhatsApp order opened but not yet confirmed sent
  const FIELDS = ['name', 'phone', 'email', 'address', 'notes'];
  const emailjsReady = typeof emailjs !== 'undefined' && !EMAILJS_PUBLIC_KEY.includes('REPLACE');
  if (emailjsReady) emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });

  // Restore previously entered delivery details
  try {
    const saved = JSON.parse(localStorage.getItem(DETAILS_KEY) || '{}');
    FIELDS.forEach((k) => {
      if (saved[k] && form.elements[k]) form.elements[k].value = saved[k];
    });
  } catch (e) { /* ignore */ }

  function getDetails() {
    return {
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      email: form.elements.email.value.trim(),
      address: form.elements.address.value.trim(),
      notes: form.elements.notes.value.trim(),
    };
  }

  form.addEventListener('input', () => {
    localStorage.setItem(DETAILS_KEY, JSON.stringify(getDetails()));
  });

  function renderCheckout() {
    const cart = getCart();

    if (cart.length === 0) {
      checkoutGrid.hidden = true;
      cartEmpty.hidden = false;
      return;
    }
    checkoutGrid.hidden = false;
    cartEmpty.hidden = true;
    orderConfirm.hidden = true;
    resetWaConfirm(); // any change to the cart invalidates a half-finished WhatsApp order

    cartItemsEl.innerHTML = cart.map((item, i) => `
      <div class="cart-item" data-index="${i}">
        <div class="cart-item-media">${item.image ? `<img src="${item.image}" alt="">` : ''}</div>
        <div class="cart-item-info">
          <h4>${item.name}</h4>
          <span class="cart-item-price">${formatNaira(item.price)} each</span>
        </div>
        <div class="qty-stepper">
          <button type="button" class="qty-btn" data-action="dec" aria-label="Decrease quantity">&minus;</button>
          <span class="qty-value">${item.qty}</span>
          <button type="button" class="qty-btn" data-action="inc" aria-label="Increase quantity">&plus;</button>
        </div>
        <span class="cart-item-total">${formatNaira(item.price * item.qty)}</span>
        <button type="button" class="cart-item-remove" data-action="remove" aria-label="Remove item">&times;</button>
      </div>
    `).join('');

    const subtotal = cartSubtotal();
    subtotalEl.textContent = formatNaira(subtotal);
    totalEl.textContent = formatNaira(subtotal);
  }

  cartItemsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.cart-item');
    const index = parseInt(row.dataset.index, 10);
    const cart = getCart();
    if (!cart[index]) return;

    const action = btn.dataset.action;
    if (action === 'inc') cart[index].qty += 1;
    if (action === 'dec') cart[index].qty -= 1;
    if (action === 'remove') cart[index].qty = 0;
    if (cart[index].qty <= 0) cart.splice(index, 1);

    saveCart(cart);
    renderCheckout();
  });

  function validate(requireEmail) {
    const d = getDetails();
    if (!d.name || !d.phone || !d.address) {
      noteEl.textContent = 'Please fill in your name, phone and delivery address.';
      noteEl.classList.add('error');
      return null;
    }
    if (requireEmail && !d.email) {
      noteEl.textContent = 'Card payment needs a valid email for your receipt.';
      noteEl.classList.add('error');
      return null;
    }
    noteEl.classList.remove('error');
    return d;
  }

  function itemLines() {
    return getCart().map(
      (item) => `- ${item.name} x${item.qty} = ${formatNaira(item.price * item.qty)}`
    );
  }

  function orderSummaryText(d, ref) {
    return [
      'Hi NELVA NATURAL, I would like to place an order:',
      '',
      `Order ref: ${ref}`,
      '',
      ...itemLines(),
      '',
      `Total: ${formatNaira(cartSubtotal())}`,
      '',
      `Name: ${d.name}`,
      `Phone: ${d.phone}`,
      d.email ? `Email: ${d.email}` : null,
      `Address: ${d.address}`,
      d.notes ? `Notes: ${d.notes}` : null,
    ].filter(Boolean).join('\n');
  }

  // Emails the order: always notifies the business (Formspree); emails the
  // customer their confirmation when they gave an address and EmailJS is set up.
  function emailOrder(d, ref, method) {
    const data = {
      order_reference: ref,
      payment_method: method,
      customer_name: d.name,
      customer_phone: d.phone,
      customer_email: d.email || '(not provided)',
      delivery_address: d.address,
      order_notes: d.notes || '(none)',
      items: itemLines().join('\n'),
      total: formatNaira(cartSubtotal()),
    };

    // 1. Business notification — no setup needed.
    fetch(ORDER_EMAIL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        _subject:
          method === 'WhatsApp'
            ? `New order ${ref} — WhatsApp (confirm payment in chat)`
            : `New order ${ref} — Paid via Paystack`,
        email: d.email || '',
        _replyto: d.email || '',
        ...data,
      }),
    }).catch(() => { /* non-blocking */ });

    // 2. Customer confirmation — EmailJS free tier, shaped for the
    //    "Order Confirmation" template (order_id, orders list, cost.total).
    if (d.email && emailjsReady) {
      const origin = location.origin && location.origin.indexOf('http') === 0 ? location.origin : '';
      emailjs
        .send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
          ...data,
          to_email: d.email,
          email: d.email,
          order_id: ref,
          orders: getCart().map((i) => ({
            name: i.name,
            units: i.qty,
            price: (i.price * i.qty).toLocaleString('en-NG'),
            image_url: i.image
              ? (origin ? origin + '/' + i.image.replace(/^\//, '') : i.image)
              : '',
          })),
          cost: {
            shipping: '0',
            tax: '0',
            total: cartSubtotal().toLocaleString('en-NG'),
          },
        })
        .catch(() => { /* non-blocking: on-screen + WhatsApp confirmation still stands */ });
    }
  }

  function completeOrder(title, message, ref) {
    localStorage.removeItem(CART_KEY);
    updateCartCount();
    noteEl.classList.remove('error');
    noteEl.textContent = '';
    pendingWa = null;
    checkoutGrid.hidden = true;
    cartEmpty.hidden = true;
    document.getElementById('orderConfirmTitle').textContent = title;
    document.getElementById('orderConfirmMessage').textContent = message;
    document.getElementById('orderConfirmRef').textContent = ref;
    orderConfirm.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Return the summary to its default state (buttons shown, WhatsApp step hidden).
  function resetWaConfirm() {
    pendingWa = null;
    if (waConfirm) waConfirm.hidden = true;
    whatsappBtn.hidden = false;
    paystackBtn.hidden = false;
  }

  // Step 1: open WhatsApp with the order pre-filled. Nothing is emailed and the
  // cart is kept — the order is only real once the customer confirms they sent it.
  whatsappBtn.addEventListener('click', () => {
    const d = validate(false);
    if (!d) return;
    const ref = generateOrderRef();
    window.open(
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(orderSummaryText(d, ref))}`,
      '_blank'
    );
    pendingWa = { d: d, ref: ref };
    whatsappBtn.hidden = true;
    paystackBtn.hidden = true;
    noteEl.textContent = '';
    noteEl.classList.remove('error');
    waConfirm.hidden = false;
  });

  // Step 2: the customer confirms they actually sent the WhatsApp message.
  waConfirmBtn.addEventListener('click', () => {
    if (!pendingWa) return;
    emailOrder(pendingWa.d, pendingWa.ref, 'WhatsApp');
    completeOrder(
      'Order confirmed',
      pendingWa.d.email
        ? 'Thanks! We emailed your order confirmation to you and our team, and we will follow up on WhatsApp shortly.'
        : 'Thanks! We sent your order to our team and will follow up on WhatsApp shortly.',
      pendingWa.ref
    );
  });

  if (waBackBtn) waBackBtn.addEventListener('click', resetWaConfirm);

  paystackBtn.addEventListener('click', () => {
    const d = validate(true);
    if (!d) return;

    if (typeof PaystackPop === 'undefined') {
      noteEl.textContent = 'Payment library failed to load. Please try WhatsApp or refresh.';
      noteEl.classList.add('error');
      return;
    }
    if (PAYSTACK_PUBLIC_KEY.includes('REPLACE')) {
      noteEl.textContent = 'Card payment is not configured yet. Please order via WhatsApp for now.';
      noteEl.classList.add('error');
      return;
    }

    const ref = generateOrderRef();
    const handler = PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email: d.email,
      amount: cartSubtotal() * 100, // kobo
      currency: 'NGN',
      ref: ref,
      metadata: {
        custom_fields: [
          { display_name: 'Name', variable_name: 'name', value: d.name },
          { display_name: 'Phone', variable_name: 'phone', value: d.phone },
          { display_name: 'Address', variable_name: 'address', value: d.address },
          { display_name: 'Notes', variable_name: 'notes', value: d.notes || '-' },
          { display_name: 'Items', variable_name: 'items', value: getCart().map((i) => `${i.name} x${i.qty}`).join(', ') },
        ],
      },
      callback: function (response) {
        const finalRef = response.reference || ref;
        emailOrder(d, finalRef, 'Card (Paystack)');
        completeOrder(
          'Payment received',
          'Thank you! We emailed your receipt and order details to you and our team. We will confirm delivery shortly.',
          finalRef
        );
      },
      onClose: function () {
        noteEl.textContent = 'Payment window closed before completing.';
      },
    });
    handler.openIframe();
  });

  renderCheckout();
}

// Newsletter form (placeholder submit)
const newsletterForm = document.getElementById('newsletterForm');
if (newsletterForm) {
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast('Thanks for subscribing!');
    newsletterForm.reset();
  });
}

// Contact form — submits to Formspree (https://formspree.io/f/mljerrjp)
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('formStatus');
    const submitBtn = contactForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    status.classList.remove('success', 'error');
    status.textContent = 'Sending...';

    try {
      const response = await fetch(contactForm.action, {
        method: 'POST',
        body: new FormData(contactForm),
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        status.textContent = "Thanks for reaching out! We'll get back to you within 1 business day.";
        status.classList.add('success');
        contactForm.reset();
      } else {
        const data = await response.json().catch(() => null);
        status.textContent = (data && data.errors)
          ? data.errors.map((err) => err.message).join(', ')
          : 'Something went wrong. Please try again or email us directly.';
        status.classList.add('error');
      }
    } catch (err) {
      status.textContent = 'Network error — please try again or email us directly.';
      status.classList.add('error');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
