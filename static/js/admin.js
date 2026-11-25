/**
 * Sturex Owner Dashboard Script (Vanilla JS + Chart.js CDN)
 * Single-page live updates via fetch() against protected JSON endpoints.
 */

(function () {
  var csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  var currentTab = 'overview';
  var state = { overview: null, orders: [], products: [], categories: [], ledger: [], savings: null };
  var charts = [];

  async function api(url, opts) {
    var o = opts || {};
    var headers = Object.assign({ 'X-CSRF-Token': csrf }, o.headers || {});
    if (o.body && !(o.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    var res = await fetch(url, Object.assign({}, o, { headers: headers }));
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function refreshAll() {
    var results = await Promise.all([
      api('/api/admin/overview'),
      api('/api/admin/orders'),
      api('/api/admin/products'),
      api('/api/categories'),
      api('/api/admin/ledger'),
      api('/api/admin/savings'),
    ]);
    state.overview = results[0];
    state.orders = results[1];
    state.products = results[2];
    state.categories = results[3];
    state.ledger = results[4];
    state.savings = results[5];
    populateCategorySelect();
    renderCurrentTab();
  }

  function populateCategorySelect() {
    var sel = document.getElementById('pf-cat');
    if (!sel) return;
    sel.innerHTML = state.categories.map(function (c) {
      return '<option value="' + c.id + '">' + SturexUI.escapeHtml(c.name) + '</option>';
    }).join('');
  }

  function destroyCharts() {
    charts.forEach(function (c) { c.destroy(); });
    charts = [];
  }

  function renderCurrentTab() {
    destroyCharts();
    var ws = document.getElementById('admin-workspace');
    var titleEl = document.getElementById('admin-page-title');
    if (!ws || !state.overview) return;

    document.querySelectorAll('.admin-nav-btn').forEach(function (b) {
      var active = b.getAttribute('data-tab') === currentTab;
      b.className = 'admin-nav-btn w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium ' +
        (active ? 'bg-[#2563EB] text-white' : 'text-[#63635E] dark:text-[#A1A1AA]');
    });

    if (currentTab === 'overview') {
      titleEl.textContent = 'Overview';
      var k = state.overview.kpis;
      ws.innerHTML =
        '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">' +
          kpiCard('Total Revenue (In)', SturexUI.formatMoney(k.totalRevenue), 'From Paid orders') +
          kpiCard('Total Expenses (Out)', SturexUI.formatMoney(k.totalExpenses), 'Manual ledger expenses') +
          kpiCard('Net Profit', SturexUI.formatMoney(k.netProfit), 'Revenue minus expenses') +
          kpiCard('Savings Balance', SturexUI.formatMoney(k.savingsBalance), 'Goal: ' + SturexUI.formatMoney(k.savingsGoal)) +
          kpiCard('Orders Today', String(k.ordersToday), 'Live store orders') +
          kpiCard('Low-Stock Alerts', String(k.lowStockCount), 'Threshold <= ' + k.lowStockThreshold + ' units') +
        '</div>' +
        '<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">' +
          '<div class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5"><h2 class="font-display text-sm font-semibold mb-3">Revenue vs Expenses</h2><div class="h-56"><canvas id="c-rev"></canvas></div></div>' +
          '<div class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5"><h2 class="font-display text-sm font-semibold mb-3">Sales by Product</h2><div class="h-56"><canvas id="c-prod"></canvas></div></div>' +
          '<div class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5"><h2 class="font-display text-sm font-semibold mb-3">Orders by Status</h2><div class="h-56"><canvas id="c-stat"></canvas></div></div>' +
        '</div>';
      renderCharts();
    } else if (currentTab === 'orders') {
      titleEl.textContent = 'Orders Management';
      ws.innerHTML =
        '<div class="flex justify-end"><a href="/api/admin/orders/export" class="px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] text-xs font-medium">Export Orders CSV</a></div>' +
        '<div class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] overflow-x-auto"><table class="w-full text-sm">' +
        '<thead><tr class="border-b border-[#E4E4E0] dark:border-[#27272A] text-left text-xs text-[#63635E]"><th class="p-4">Order</th><th class="p-4">Customer</th><th class="p-4 text-right">Total</th><th class="p-4">Status</th><th class="p-4 text-right">Actions</th></tr></thead>' +
        '<tbody class="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">' +
        state.orders.map(function (o) {
          var opts = ['Pending', 'Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].map(function (s) {
            return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + s + '</option>';
          }).join('');
          return '<tr><td class="p-4 font-mono font-semibold">' + SturexUI.escapeHtml(o.order_number) + '</td><td class="p-4">' + SturexUI.escapeHtml(o.customer_name) + '</td><td class="p-4 text-right font-mono">' + SturexUI.formatMoney(o.total) + '</td><td class="p-4"><select data-ord-id="' + o.id + '" class="ord-status px-2 py-1 rounded border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-xs">' + opts + '</select></td><td class="p-4 text-right"><button type="button" data-view-ord="' + o.id + '" class="view-ord text-xs text-[#2563EB]">View / Invoice</button></td></tr>';
        }).join('') +
        '</tbody></table></div>';

      ws.querySelectorAll('.ord-status').forEach(function (sel) {
        sel.addEventListener('change', async function () {
          try {
            await api('/api/admin/orders/' + sel.getAttribute('data-ord-id') + '/status', {
              method: 'PATCH',
              body: JSON.stringify({ status: sel.value }),
            });
            SturexUI.toast('Order status updated', 'success');
            refreshAll();
          } catch (e) { SturexUI.toast(e.message, 'error'); }
        });
      });
      ws.querySelectorAll('.view-ord').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var o = state.orders.find(function (x) { return x.id === Number(btn.getAttribute('data-view-ord')); });
          if (o) openOrderDrawer(o);
        });
      });
    } else if (currentTab === 'products') {
      titleEl.textContent = 'Products & Insights';
      ws.innerHTML =
        '<div class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] overflow-x-auto"><table class="w-full text-sm">' +
        '<thead><tr class="border-b border-[#E4E4E0] dark:border-[#27272A] text-left text-xs text-[#63635E]"><th class="p-4">Product</th><th class="p-4 text-right">Price</th><th class="p-4 text-right">Cost</th><th class="p-4 text-right">Stock</th><th class="p-4 text-right">Sold</th><th class="p-4 text-right">Profit</th><th class="p-4 text-right">Actions</th></tr></thead>' +
        '<tbody class="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">' +
        state.products.map(function (p) {
          return '<tr><td class="p-4 font-medium">' + SturexUI.escapeHtml(p.name) + ' <span class="text-xs text-[#63635E] font-mono">(' + SturexUI.escapeHtml(p.sku) + ')</span></td><td class="p-4 text-right font-mono">' + SturexUI.formatMoney(p.price) + '</td><td class="p-4 text-right font-mono">' + SturexUI.formatMoney(p.cost_price) + '</td><td class="p-4 text-right font-mono">' + p.stock + '</td><td class="p-4 text-right font-mono">' + p.units_sold + '</td><td class="p-4 text-right font-mono text-[#16A34A]">' + SturexUI.formatMoney(p.total_profit) + '</td><td class="p-4 text-right"><button type="button" data-edit-p="' + p.id + '" class="edit-p text-xs text-[#2563EB] mr-2">Edit</button><button type="button" data-del-p="' + p.id + '" class="del-p text-xs text-[#DC2626]">Delete</button></td></tr>';
        }).join('') +
        '</tbody></table></div>';

      ws.querySelectorAll('.edit-p').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = state.products.find(function (x) { return x.id === Number(b.getAttribute('data-edit-p')); });
          if (p) window.openProductModal(p);
        });
      });
      ws.querySelectorAll('.del-p').forEach(function (b) {
        b.addEventListener('click', async function () {
          try {
            await api('/api/admin/products/' + b.getAttribute('data-del-p'), { method: 'DELETE' });
            SturexUI.toast('Product deleted', 'success');
            refreshAll();
          } catch (e) { SturexUI.toast(e.message, 'error'); }
        });
      });
    } else if (currentTab === 'ledger') {
      titleEl.textContent = 'Money In / Out Ledger';
      ws.innerHTML =
        '<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">' +
          '<form id="exp-form" class="lg:col-span-4 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6 space-y-3">' +
            '<h2 class="font-display font-semibold text-base">Add Expense</h2>' +
            '<input id="ex-amt" type="number" step="0.01" min="0.01" required placeholder="Amount ($)" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono" />' +
            '<select id="ex-cat" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm"><option>Restock</option><option>Delivery</option><option>Ads</option><option>Operations</option></select>' +
            '<input id="ex-date" type="date" value="' + new Date().toISOString().slice(0, 10) + '" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono" />' +
            '<input id="ex-note" placeholder="Note" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm" />' +
            '<button type="submit" class="w-full py-2.5 rounded-lg bg-[#2563EB] text-white text-sm font-medium">Save Expense</button>' +
            '<a href="/api/admin/ledger/export" class="block text-center text-xs text-[#2563EB] pt-2">Export Ledger CSV</a>' +
          '</form>' +
          '<div class="lg:col-span-8 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] overflow-x-auto"><table class="w-full text-sm">' +
            '<thead><tr class="border-b border-[#E4E4E0] dark:border-[#27272A] text-left text-xs text-[#63635E]"><th class="p-4">Date</th><th class="p-4">Category</th><th class="p-4">Note</th><th class="p-4 text-right">Amount</th></tr></thead>' +
            '<tbody class="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">' +
            state.ledger.map(function (t) {
              var cls = t.type === 'in' ? 'text-[#16A34A]' : 'text-[#DC2626]';
              return '<tr><td class="p-4 font-mono text-xs">' + SturexUI.escapeHtml(t.date) + '</td><td class="p-4 text-xs">' + SturexUI.escapeHtml(t.category) + '</td><td class="p-4 text-xs">' + SturexUI.escapeHtml(t.note) + '</td><td class="p-4 text-right font-mono ' + cls + '">' + (t.type === 'in' ? '+' : '-') + SturexUI.formatMoney(t.amount) + '</td></tr>';
            }).join('') +
          '</tbody></table></div>' +
        '</div>';

      document.getElementById('exp-form')?.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await api('/api/admin/ledger', {
            method: 'POST',
            body: JSON.stringify({
              type: 'out',
              amount: Number(document.getElementById('ex-amt').value),
              category: document.getElementById('ex-cat').value,
              date: document.getElementById('ex-date').value,
              note: document.getElementById('ex-note').value,
            }),
          });
          SturexUI.toast('Expense recorded', 'success');
          refreshAll();
        } catch (err) { SturexUI.toast(err.message, 'error'); }
      });
    } else if (currentTab === 'savings') {
      titleEl.textContent = 'Savings & Goals';
      var sav = state.savings;
      var pct = sav.goal > 0 ? Math.min(100, Math.round(sav.balance / sav.goal * 100)) : 0;
      ws.innerHTML =
        '<div class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6"><div class="flex justify-between items-end"><div><p class="text-xs text-[#63635E]">Savings Balance</p><p class="font-mono text-3xl font-semibold">' + SturexUI.formatMoney(sav.balance) + '</p></div><span class="font-mono text-sm text-[#2563EB]">' + pct + '% of ' + SturexUI.formatMoney(sav.goal) + '</span></div><div class="mt-4 h-3 rounded-full bg-[#EFEFED] dark:bg-[#27272A] overflow-hidden"><div class="h-full bg-[#2563EB]" style="width:' + pct + '%"></div></div></div>' +
        '<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">' +
          '<form id="sav-set-form" class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6 space-y-3"><h2 class="font-display font-semibold">Savings Goal &amp; Auto %</h2><input id="sg-goal" type="number" value="' + sav.goal + '" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono" /><input id="sg-pct" type="number" value="' + sav.percentage + '" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono" /><button type="submit" class="w-full py-2.5 rounded-lg bg-[#141413] dark:bg-[#F4F4F2] text-white dark:text-[#141413] text-sm font-medium">Update Settings</button></form>' +
          '<form id="sav-tx-form" class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6 space-y-3"><h2 class="font-display font-semibold">Manual Deposit / Withdrawal</h2><select id="st-type" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm"><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option></select><input id="st-amt" type="number" step="0.01" min="0.01" required placeholder="Amount" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono" /><input id="st-note" placeholder="Note" class="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm" /><button type="submit" class="w-full py-2.5 rounded-lg bg-[#2563EB] text-white text-sm font-medium">Submit</button></form>' +
        '</div>';

      document.getElementById('sav-set-form')?.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await api('/api/admin/settings', {
            method: 'PUT',
            body: JSON.stringify({
              savings_goal: Number(document.getElementById('sg-goal').value),
              savings_percentage: Number(document.getElementById('sg-pct').value),
            }),
          });
          SturexUI.toast('Settings updated', 'success');
          refreshAll();
        } catch (err) { SturexUI.toast(err.message, 'error'); }
      });
      document.getElementById('sav-tx-form')?.addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          await api('/api/admin/savings', {
            method: 'POST',
            body: JSON.stringify({
              type: document.getElementById('st-type').value,
              amount: Number(document.getElementById('st-amt').value),
              note: document.getElementById('st-note').value,
            }),
          });
          SturexUI.toast('Savings updated', 'success');
          refreshAll();
        } catch (err) { SturexUI.toast(err.message, 'error'); }
      });
    }
  }

  function kpiCard(label, value, sub) {
    return '<div class="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5"><p class="text-xs text-[#63635E] dark:text-[#A1A1AA]">' + SturexUI.escapeHtml(label) + '</p><p class="mt-2 font-mono tabular-nums text-2xl font-semibold">' + SturexUI.escapeHtml(value) + '</p><p class="mt-1 text-xs text-[#63635E] dark:text-[#A1A1AA]">' + SturexUI.escapeHtml(sub) + '</p></div>';
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') return;
    var revEl = document.getElementById('c-rev');
    var prodEl = document.getElementById('c-prod');
    var statEl = document.getElementById('c-stat');
    if (revEl) {
      charts.push(new Chart(revEl, {
        type: 'bar',
        data: {
          labels: state.overview.dailySeries.map(function (d) { return d.date.slice(5); }),
          datasets: [
            { label: 'Revenue', data: state.overview.dailySeries.map(function (d) { return d.revenue; }), backgroundColor: '#2563EB' },
            { label: 'Expenses', data: state.overview.dailySeries.map(function (d) { return d.expenses; }), backgroundColor: '#DC2626' },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false },
      }));
    }
    if (prodEl) {
      var top = state.overview.productInsights.slice(0, 5);
      charts.push(new Chart(prodEl, {
        type: 'bar',
        data: {
          labels: top.map(function (p) { return p.name; }),
          datasets: [{ label: 'Revenue', data: top.map(function (p) { return p.revenue; }), backgroundColor: '#2563EB' }],
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false },
      }));
    }
    if (statEl) {
      charts.push(new Chart(statEl, {
        type: 'doughnut',
        data: {
          labels: state.overview.ordersByStatus.map(function (s) { return s.status; }),
          datasets: [{ data: state.overview.ordersByStatus.map(function (s) { return s.count; }), backgroundColor: ['#D97706', '#2563EB', '#16A34A', '#6366F1', '#DC2626'] }],
        },
        options: { responsive: true, maintainAspectRatio: false },
      }));
    }
  }

  function openOrderDrawer(order) {
    var d = document.getElementById('order-drawer');
    document.getElementById('order-drawer-title').textContent = order.order_number;
    document.getElementById('order-drawer-body').innerHTML =
      '<p class="text-sm font-medium">' + SturexUI.escapeHtml(order.customer_name) + '</p>' +
      '<p class="text-xs text-[#63635E]">' + SturexUI.escapeHtml(order.customer_email) + ' · ' + SturexUI.escapeHtml(order.shipping_address) + '</p>' +
      '<div class="border-t pt-3 space-y-1">' + order.items.map(function (i) {
        return '<div class="flex justify-between text-xs"><span>' + SturexUI.escapeHtml(i.product_name) + ' × ' + i.quantity + '</span><span class="font-mono">' + SturexUI.formatMoney(i.unit_price * i.quantity) + '</span></div>';
      }).join('') + '</div>' +
      '<button type="button" id="print-inv-btn" class="w-full py-2.5 rounded-lg bg-[#2563EB] text-white text-sm font-medium">Print / Export Invoice</button>';
    document.getElementById('print-inv-btn').onclick = function () {
      document.getElementById('invoice-print-area').innerHTML = '<h1 class="text-2xl font-bold mb-2">Sturex Invoice #' + SturexUI.escapeHtml(order.order_number) + '</h1><p class="mb-4">' + SturexUI.escapeHtml(order.customer_name) + ' — ' + SturexUI.formatMoney(order.total) + '</p>';
      window.print();
    };
    d.classList.remove('hidden'); d.classList.add('flex');
  }

  window.closeOrderDrawer = function () {
    var d = document.getElementById('order-drawer');
    if (d) { d.classList.add('hidden'); d.classList.remove('flex'); }
  };

  window.openProductModal = function (product) {
    var m = document.getElementById('product-modal');
    document.getElementById('product-modal-title').textContent = product ? 'Edit Product' : 'Add Product';
    document.getElementById('pf-id').value = product ? product.id : '';
    document.getElementById('pf-name').value = product ? product.name : '';
    document.getElementById('pf-sku').value = product ? product.sku : '';
    document.getElementById('pf-cat').value = product ? product.category_id : (state.categories[0]?.id || 1);
    document.getElementById('pf-stock').value = product ? product.stock : '10';
    document.getElementById('pf-price').value = product ? product.price : '';
    document.getElementById('pf-cost').value = product ? product.cost_price : '';
    document.getElementById('pf-desc').value = product ? product.description : '';
    document.getElementById('pf-img').value = product ? product.image_url : '';
    document.getElementById('pf-featured').checked = product ? Boolean(product.featured) : false;
    m.classList.remove('hidden'); m.classList.add('flex');
  };

  window.closeProductModal = function () {
    var m = document.getElementById('product-modal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
  };

  document.getElementById('pf-file')?.addEventListener('change', async function (e) {
    var file = e.target.files?.[0];
    if (!file) return;
    var fd = new FormData();
    fd.append('image', file);
    try {
      var res = await api('/api/admin/upload', { method: 'POST', body: fd });
      document.getElementById('pf-img').value = res.imageUrl;
      SturexUI.toast('Image uploaded', 'success');
    } catch (err) { SturexUI.toast(err.message, 'error'); }
  });

  document.getElementById('product-form')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    var id = document.getElementById('pf-id').value;
    var payload = {
      name: document.getElementById('pf-name').value,
      sku: document.getElementById('pf-sku').value,
      category_id: Number(document.getElementById('pf-cat').value),
      stock: Number(document.getElementById('pf-stock').value),
      price: Number(document.getElementById('pf-price').value),
      cost_price: Number(document.getElementById('pf-cost').value),
      description: document.getElementById('pf-desc').value,
      image_url: document.getElementById('pf-img').value,
      featured: document.getElementById('pf-featured').checked,
    };
    try {
      await api(id ? '/api/admin/products/' + id : '/api/admin/products', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      window.closeProductModal();
      SturexUI.toast('Product saved', 'success');
      refreshAll();
    } catch (err) { SturexUI.toast(err.message, 'error'); }
  });

  document.querySelectorAll('.admin-nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      currentTab = btn.getAttribute('data-tab') || 'overview';
      renderCurrentTab();
    });
  });

  document.getElementById('mobile-tab-select')?.addEventListener('change', function (e) {
    currentTab = e.target.value;
    renderCurrentTab();
  });

  refreshAll();
})();
