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

// --- Cart (placeholder — no real checkout yet) ---
// TODO: replace with real cart/checkout logic (Stripe, Shopify, custom backend, etc.)
const CART_KEY = 'nelva_cart_count';
const cartCountEl = document.getElementById('cartCount');

function getCartCount() {
  return parseInt(localStorage.getItem(CART_KEY) || '0', 10);
}
function setCartCount(n) {
  localStorage.setItem(CART_KEY, String(n));
  if (cartCountEl) cartCountEl.textContent = n;
}
setCartCount(getCartCount());

document.querySelectorAll('.add-cart-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.product-card');
    const name = card ? card.dataset.name : 'Item';
    setCartCount(getCartCount() + 1);
    showToast(`${name} added to cart`);
  });
});

const cartBtn = document.getElementById('cartBtn');
if (cartBtn) {
  cartBtn.addEventListener('click', () => {
    showToast('Checkout is coming soon — thanks for your patience!');
  });
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
