/**
 * Sturex Storefront Client Script (Vanilla JS)
 * Handles catalog filtering/sorting, localStorage cart, checkout, and order tracking.
 */

(function () {
  var CART_KEY = 'sturex_cart_v1';
  var products = [];
  var categories = [];
  var selectedCategory = 'all';
  var drawerStep = 'cart'; // 'cart' | 'checkout' | 'confirmed'
  var confirmedOrder = null;

  function loadCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveCart(cart) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (e) {}
    updateCartBadge();
  }

  function updateCartBadge() {
    var cart = loadCart();
    var count = cart.reduce(function (s, i) { return s + i.quantity; }, 0);
    var el = document.getElementById('header-cart-count');
    if (el) el.textContent = '(' + count + ')';
  }

  async function fetchCategories() {
    var res = await fetch('/api/categories');
    categories = await res.json();
    renderCategoryTabs();
  }

  function renderCategoryTabs() {
    var container = document.getElementById('category-tabs');
    if (!container) return;
    var items = [{ slug: 'all', name: 'All Objects' }].concat(categories);
    container.innerHTML = items.map(function (c) {
      var active = c.slug === selectedCategory;
      var cls = active
        ? 'bg-white dark:bg-[#27272A] text-[#141413] dark:text-white shadow-sm'
        : 'text-[#63635E] dark:text-[#A1A1AA]';
      return '<button type="button" data-cat="' + SturexUI.escapeHtml(c.slug) + '" class="cat-tab px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 ' + cls + '">' + SturexUI.escapeHtml(c.name) + '</button>';
    }).join('');

    container.querySelectorAll('.cat-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedCategory = btn.getAttribute('data-cat') || 'all';
        renderCategoryTabs();
        fetchProducts();
      });
    });
  }

  async function fetchProducts() {
    var grid = document.getElementById('product-grid');
    if (!grid) return;

    // Skeleton loader
    grid.innerHTML = [1, 2, 3, 4, 5, 6].map(function () {
      return '<div class="rounded-2xl border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] overflow-hidden animate-pulse"><div class="aspect-[4/3] bg-[#E4E4E0]/60 dark:bg-[#27272A]"></div><div class="p-5 space-y-3"><div class="h-3 w-24 bg-[#E4E4E0]/70 dark:bg-[#27272A] rounded"></div><div class="h-5 w-48 bg-[#E4E4E0]/70 dark:bg-[#27272A] rounded"></div></div></div>';
    }).join('');

    var q = (document.getElementById('catalog-search')?.value || '').trim();
    var sort = document.getElementById('catalog-sort')?.value || 'featured';
    var params = new URLSearchParams({ sort: sort });
    if (q) params.set('q', q);
    if (selectedCategory !== 'all') params.set('category', selectedCategory);

    var res = await fetch('/api/products?' + params.toString());
    products = await res.json();
    renderProducts();
  }

  function renderProducts() {
    var grid = document.getElementById('product-grid');
    if (!grid) return;

    if (products.length === 0) {
      grid.innerHTML = '<div class="col-span-full rounded-2xl border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] p-12 text-center"><p class="font-display font-semibold text-lg">No matching studio objects</p><p class="text-sm text-[#63635E] dark:text-[#A1A1AA] mt-1">Clear your search or choose another category.</p></div>';
      return;
    }

    grid.innerHTML = products.map(function (p) {
      var stockText = p.stock === 0 ? 'Sold Out' : p.stock <= 5 ? 'Only ' + p.stock + ' left' : 'In Stock';
      return (
        '<article class="group flex flex-col bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-2xl overflow-hidden transition-transform duration-200 hover:-translate-y-0.5">' +
          '<a href="/product/' + encodeURIComponent(p.slug) + '" class="aspect-[4/3] w-full overflow-hidden bg-[#EFEFED] dark:bg-[#1E1E22] block">' +
            '<img src="' + SturexUI.escapeHtml(p.image_url) + '" alt="' + SturexUI.escapeHtml(p.name) + '" class="w-full h-full object-cover" />' +
          '</a>' +
          '<div class="p-5 flex-1 flex flex-col justify-between gap-4">' +
            '<div>' +
              '<div class="text-xs text-[#63635E] dark:text-[#A1A1AA]">' + SturexUI.escapeHtml(p.category_name) + ' · ' + stockText + '</div>' +
              '<a href="/product/' + encodeURIComponent(p.slug) + '" class="mt-1.5 block font-display text-base font-semibold hover:text-[#2563EB]">' + SturexUI.escapeHtml(p.name) + '</a>' +
            '</div>' +
            '<div class="flex items-center justify-between pt-3 border-t border-[#E4E4E0] dark:border-[#27272A]">' +
              '<span class="font-mono tabular-nums text-sm font-semibold">' + SturexUI.formatMoney(p.price) + '</span>' +
              '<button type="button" data-add-id="' + p.id + '" ' + (p.stock < 1 ? 'disabled' : '') + ' class="add-cart-btn px-3.5 py-1.5 rounded-lg bg-[#141413] dark:bg-[#F4F4F2] text-white dark:text-[#141413] text-xs font-medium disabled:opacity-40">' + (p.stock > 0 ? 'Add' : 'Sold Out') + '</button>' +
            '</div>' +
          '</div>' +
        '</article>'
      );
    }).join('');

    grid.querySelectorAll('.add-cart-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-add-id'));
        var prod = products.find(function (x) { return x.id === id; });
        if (prod) addToCart(prod);
      });
    });
  }

  function addToCart(product) {
    var cart = loadCart();
    var existing = cart.find(function (i) { return i.product.id === product.id; });
    if (existing) {
      existing.quantity = Math.min(product.stock, existing.quantity + 1);
    } else {
      cart.push({ product: product, quantity: 1 });
    }
    saveCart(cart);
    drawerStep = 'cart';
    window.openCartDrawer();
    SturexUI.toast('Added ' + product.name + ' to cart', 'success');
  }

  function renderDrawer() {
    var title = document.getElementById('drawer-title');
    var body = document.getElementById('drawer-body');
    var footer = document.getElementById('drawer-footer');
    if (!title || !body || !footer) return;

    var cart = loadCart();
    var subtotal = cart.reduce(function (s, i) { return s + i.product.price * i.quantity; }, 0);
    var shipping = subtotal === 0 ? 0 : (subtotal >= 150 ? 0 : 12);
    var total = subtotal + shipping;

    if (drawerStep === 'confirmed' && confirmedOrder) {
      title.textContent = 'Order Confirmed';
      body.innerHTML =
        '<div class="rounded-xl border border-[#16A34A]/30 bg-[#16A34A]/5 p-5 mb-4">' +
          '<p class="font-semibold text-[#16A34A] text-sm">Order #' + SturexUI.escapeHtml(confirmedOrder.order_number) + ' Received</p>' +
          '<p class="mt-2 text-xs text-[#63635E] dark:text-[#A1A1AA]">' + SturexUI.escapeHtml(confirmedOrder.payment.instructions) + '</p>' +
        '</div>' +
        '<div class="flex justify-between font-semibold text-base"><span>Total Due</span><span class="font-mono">' + SturexUI.formatMoney(confirmedOrder.total) + '</span></div>';
      footer.innerHTML = '<button type="button" onclick="closeCartDrawer()" class="w-full py-3 rounded-lg bg-[#2563EB] text-white text-sm font-medium">Continue Shopping</button>';
      return;
    }

    if (drawerStep === 'checkout') {
      title.textContent = 'Checkout Details';
      body.innerHTML =
        '<form id="flask-checkout-form" class="space-y-4">' +
          '<button type="button" id="back-to-cart" class="text-xs text-[#63635E]">&larr; Back to Cart</button>' +
          '<input id="co-name" required placeholder="Full Name" class="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm" />' +
          '<input id="co-email" type="email" required placeholder="Email Address" class="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm" />' +
          '<input id="co-phone" required placeholder="Phone Number" class="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm" />' +
          '<textarea id="co-addr" required rows="3" placeholder="Delivery Address" class="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm"></textarea>' +
          '<select id="co-pay" class="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm">' +
            '<option value="pay_on_delivery">Pay on Delivery</option>' +
            '<option value="bank_transfer">Bank Transfer</option>' +
          '</select>' +
        '</form>';
      footer.innerHTML = '<button type="submit" form="flask-checkout-form" class="w-full py-3 rounded-lg bg-[#2563EB] text-white text-sm font-medium">Place Order · ' + SturexUI.formatMoney(total) + '</button>';

      document.getElementById('back-to-cart')?.addEventListener('click', function () {
        drawerStep = 'cart';
        renderDrawer();
      });
      document.getElementById('flask-checkout-form')?.addEventListener('submit', async function (e) {
        e.preventDefault();
        var res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_name: document.getElementById('co-name').value,
            customer_email: document.getElementById('co-email').value,
            customer_phone: document.getElementById('co-phone').value,
            shipping_address: document.getElementById('co-addr').value,
            payment_method: document.getElementById('co-pay').value,
            items: cart.map(function (i) { return { product_id: i.product.id, quantity: i.quantity }; }),
          }),
        });
        var data = await res.json();
        if (!res.ok) {
          SturexUI.toast(data.error || 'Checkout failed', 'error');
          return;
        }
        confirmedOrder = data;
        drawerStep = 'confirmed';
        saveCart([]);
        renderDrawer();
        fetchProducts();
      });
      return;
    }

    title.textContent = 'Your Cart (' + cart.reduce(function (s, i) { return s + i.quantity; }, 0) + ')';
    if (cart.length === 0) {
      body.innerHTML = '<p class="text-sm text-[#63635E] dark:text-[#A1A1AA] py-12 text-center">Your cart is empty.</p>';
      footer.innerHTML = '';
      return;
    }

    body.innerHTML = cart.map(function (item) {
      return (
        '<div class="py-3 border-b border-[#E4E4E0] dark:border-[#27272A] flex items-center justify-between gap-3">' +
          '<div><p class="text-sm font-medium">' + SturexUI.escapeHtml(item.product.name) + '</p>' +
          '<p class="font-mono text-xs text-[#63635E]">' + SturexUI.formatMoney(item.product.price) + ' × ' + item.quantity + '</p></div>' +
          '<div class="flex items-center gap-2">' +
            '<button type="button" data-dec="' + item.product.id + '" class="px-2 py-1 border rounded text-xs">-</button>' +
            '<button type="button" data-inc="' + item.product.id + '" class="px-2 py-1 border rounded text-xs">+</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    body.querySelectorAll('[data-dec]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-dec'));
        var next = loadCart().map(function (i) { return i.product.id === id ? { product: i.product, quantity: i.quantity - 1 } : i; }).filter(function (i) { return i.quantity > 0; });
        saveCart(next);
        renderDrawer();
      });
    });
    body.querySelectorAll('[data-inc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.getAttribute('data-inc'));
        var next = loadCart().map(function (i) { return i.product.id === id ? { product: i.product, quantity: Math.min(i.product.stock, i.quantity + 1) } : i; });
        saveCart(next);
        renderDrawer();
      });
    });

    footer.innerHTML =
      '<div class="flex justify-between text-sm font-semibold mb-3"><span>Total</span><span class="font-mono">' + SturexUI.formatMoney(total) + '</span></div>' +
      '<button type="button" id="go-checkout" class="w-full py-3 rounded-lg bg-[#2563EB] text-white text-sm font-medium">Proceed to Checkout</button>';
    document.getElementById('go-checkout')?.addEventListener('click', function () {
      drawerStep = 'checkout';
      renderDrawer();
    });
  }

  window.openCartDrawer = function () {
    var el = document.getElementById('cart-drawer');
    if (el) { el.classList.remove('hidden'); el.classList.add('flex'); renderDrawer(); }
  };
  window.closeCartDrawer = function () {
    var el = document.getElementById('cart-drawer');
    if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
  };
  window.openTrackerModal = function () {
    var el = document.getElementById('tracker-modal');
    if (el) { el.classList.remove('hidden'); el.classList.add('flex'); }
  };
  window.closeTrackerModal = function () {
    var el = document.getElementById('tracker-modal');
    if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
  };

  document.getElementById('tracker-form')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    var num = document.getElementById('track-number').value;
    var email = document.getElementById('track-email').value;
    var res = await fetch('/api/orders/track?order_number=' + encodeURIComponent(num) + '&email=' + encodeURIComponent(email));
    var data = await res.json();
    var out = document.getElementById('tracker-result');
    if (!res.ok) {
      out.innerHTML = '<p class="text-[#DC2626] text-xs">' + SturexUI.escapeHtml(data.error) + '</p>';
      return;
    }
    out.innerHTML = '<div class="p-3 rounded-lg border border-[#E4E4E0] dark:border-[#27272A]"><div class="flex justify-between font-semibold"><span class="font-mono">' + SturexUI.escapeHtml(data.order_number) + '</span><span class="text-[#2563EB]">' + SturexUI.escapeHtml(data.status) + '</span></div><p class="text-xs text-[#63635E] mt-1">Total: ' + SturexUI.formatMoney(data.total) + '</p></div>';
  });

  document.getElementById('catalog-search')?.addEventListener('input', fetchProducts);
  document.getElementById('catalog-sort')?.addEventListener('change', fetchProducts);

  updateCartBadge();
  fetchCategories();
  fetchProducts();
})();
