import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Download,
  Edit3,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Moon,
  Package,
  PiggyBank,
  Plus,
  Printer,
  Receipt,
  Search,
  ShoppingCart,
  Sun,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { apiRequest, clearAuthTokens, formatMoney, setAuthTokens } from '../lib/api';
import {
  AdminOverviewData,
  AuthStatus,
  Category,
  LedgerTransaction,
  Order,
  OrderStatus,
  Product,
  SavingsEntry,
} from '../types';
import {
  OrdersStatusChart,
  RevenueExpensesChart,
  SalesByProductChart,
} from './AdminCharts';
import { ImageWithFallback } from './ImageWithFallback';
import { useToast } from './Toast';

type AdminTab = 'overview' | 'orders' | 'products' | 'ledger' | 'savings';

interface AdminDashboardProps {
  darkMode: boolean;
  onToggleTheme: () => void;
  onBackToStore: () => void;
}

const ORDER_STATUSES: OrderStatus[] = [
  'Pending',
  'Paid',
  'Processing',
  'Shipped',
  'Delivered',
  'Cancelled',
];

function statusStyle(status: string): string {
  switch (status) {
    case 'Paid':
    case 'Delivered':
      return 'text-[#16A34A]';
    case 'Pending':
      return 'text-[#D97706]';
    case 'Processing':
    case 'Shipped':
      return 'text-[#2563EB] dark:text-[#60A5FA]';
    case 'Cancelled':
      return 'text-[#DC2626]';
    default:
      return 'text-[#63635E]';
  }
}

export function AdminDashboard({
  darkMode,
  onToggleTheme,
  onBackToStore,
}: AdminDashboardProps) {
  const { showToast } = useToast();

  // Auth state
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('Studio Owner');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Dashboard navigation
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  // Domain datasets
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [ledger, setLedger] = useState<LedgerTransaction[]>([]);
  const [savingsData, setSavingsData] = useState<{
    balance: number;
    goal: number;
    percentage: number;
    history: SavingsEntry[];
  } | null>(null);

  // Orders filters & slide-over
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('All');
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);

  // Product modal & delete confirm
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteTargetProduct, setDeleteTargetProduct] = useState<Product | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [prodForm, setProdForm] = useState({
    sku: '',
    name: '',
    description: '',
    category_id: 1,
    price: '',
    cost_price: '',
    stock: '',
    image_url: '',
    featured: false,
  });

  // Ledger filters & manual entry form
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'all' | 'in' | 'out'>('all');
  const [ledgerCatFilter, setLedgerCatFilter] = useState('All');
  const [expForm, setExpForm] = useState({
    type: 'out' as 'out' | 'in',
    amount: '',
    category: 'Restock',
    date: new Date().toISOString().slice(0, 10),
    note: '',
  });

  // Savings settings & transaction form
  const [goalInput, setGoalInput] = useState('5000');
  const [pctInput, setPctInput] = useState('15');
  const [savForm, setSavForm] = useState({
    type: 'deposit' as 'deposit' | 'withdrawal',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    note: '',
  });

  const checkAuth = useCallback(async () => {
    setAuthLoading(true);
    try {
      const status = await apiRequest<AuthStatus>('/api/auth/status');
      setAuthStatus(status);
      if (status.authenticated && status.csrfToken) {
        setAuthTokens(status.csrfToken);
      } else {
        clearAuthTokens();
      }
    } catch {
      setAuthStatus({ needsSetup: false, authenticated: false, user: null, csrfToken: null });
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loadAllAdminData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [ov, ord, prod, cats, ledg, sav] = await Promise.all([
        apiRequest<AdminOverviewData>('/api/admin/overview'),
        apiRequest<Order[]>('/api/admin/orders'),
        apiRequest<Product[]>('/api/admin/products'),
        apiRequest<Category[]>('/api/categories'),
        apiRequest<LedgerTransaction[]>('/api/admin/ledger'),
        apiRequest<{
          balance: number;
          goal: number;
          percentage: number;
          history: SavingsEntry[];
        }>('/api/admin/savings'),
      ]);
      setOverview(ov);
      setOrders(ord);
      setProducts(prod);
      setCategories(cats);
      setLedger(ledg);
      setSavingsData(sav);
      setGoalInput(String(sav.goal));
      setPctInput(String(sav.percentage));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load dashboard data', 'error');
    } finally {
      setLoadingData(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (authStatus?.authenticated) {
      loadAllAdminData();
    }
  }, [authStatus?.authenticated, loadAllAdminData]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthSubmitting(true);
    try {
      const endpoint = authStatus?.needsSetup ? '/api/auth/setup' : '/api/auth/login';
      const res = await apiRequest<{
        authenticated: boolean;
        user: { email: string; name: string };
        csrfToken: string;
        token: string;
      }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
          name: authName,
        }),
      });
      setAuthTokens(res.csrfToken, res.token);
      setAuthStatus({
        needsSetup: false,
        authenticated: true,
        user: res.user,
        csrfToken: res.csrfToken,
      });
      setAuthPassword('');
      showToast(
        authStatus?.needsSetup ? 'Owner account created & signed in.' : 'Welcome back to Sturex.',
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Authentication failed.', 'error');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    clearAuthTokens();
    setAuthStatus({ needsSetup: false, authenticated: false, user: null, csrfToken: null });
    showToast('Signed out of Owner Studio', 'info');
  };

  // Update order status inline
  const handleOrderStatusChange = async (orderId: number, status: OrderStatus) => {
    try {
      const updated = await apiRequest<Order>(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(updated);
      }
      if (status === 'Paid') {
        showToast(
          `Order ${updated.order_number} marked Paid — revenue & auto-savings recorded.`,
          'success'
        );
      } else {
        showToast(`Order ${updated.order_number} updated to ${status}.`, 'success');
      }
      // Refresh overview, ledger, savings, and product stock silently
      loadAllAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update status', 'error');
    }
  };

  const openAddProduct = () => {
    setEditingProduct(null);
    setProdForm({
      sku: `STX-OBJ-${Math.floor(100 + Math.random() * 900)}`,
      name: '',
      description: '',
      category_id: categories[0]?.id || 1,
      price: '',
      cost_price: '',
      stock: '10',
      image_url: '',
      featured: false,
    });
    setProductModalOpen(true);
  };

  const openEditProduct = (product: Product) => {
    setEditingProduct(product);
    setProdForm({
      sku: product.sku,
      name: product.name,
      description: product.description,
      category_id: product.category_id,
      price: String(product.price),
      cost_price: String(product.cost_price ?? 0),
      stock: String(product.stock),
      image_url: product.image_url,
      featured: product.featured === 1,
    });
    setProductModalOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await apiRequest<{ imageUrl: string }>('/api/admin/upload', {
        method: 'POST',
        body: fd,
      });
      setProdForm((prev) => ({ ...prev, image_url: res.imageUrl }));
      showToast('Image uploaded successfully', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Image upload failed', 'error');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        sku: prodForm.sku,
        name: prodForm.name,
        description: prodForm.description,
        category_id: Number(prodForm.category_id),
        price: Number(prodForm.price),
        cost_price: Number(prodForm.cost_price),
        stock: Number(prodForm.stock),
        image_url: prodForm.image_url,
        featured: prodForm.featured,
      };
      if (editingProduct) {
        await apiRequest(`/api/admin/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast('Product updated', 'success');
      } else {
        await apiRequest('/api/admin/products', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast('Product created', 'success');
      }
      setProductModalOpen(false);
      loadAllAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to save product', 'error');
    }
  };

  const handleConfirmDeleteProduct = async () => {
    if (!deleteTargetProduct) return;
    try {
      await apiRequest(`/api/admin/products/${deleteTargetProduct.id}`, {
        method: 'DELETE',
      });
      showToast(`Deleted ${deleteTargetProduct.name}`, 'success');
      setDeleteTargetProduct(null);
      loadAllAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to delete product', 'error');
      setDeleteTargetProduct(null);
    }
  };

  const handleAddLedgerEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/ledger', {
        method: 'POST',
        body: JSON.stringify({
          type: expForm.type,
          amount: Number(expForm.amount),
          category: expForm.category,
          date: expForm.date,
          note: expForm.note,
        }),
      });
      setExpForm((prev) => ({ ...prev, amount: '', note: '' }));
      showToast('Ledger entry recorded', 'success');
      loadAllAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to record entry', 'error');
    }
  };

  const handleDeleteLedgerEntry = async (id: number) => {
    try {
      await apiRequest(`/api/admin/ledger/${id}`, { method: 'DELETE' });
      showToast('Entry removed', 'info');
      loadAllAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cannot delete entry', 'error');
    }
  };

  const handleSaveSavingsSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          savings_goal: Number(goalInput),
          savings_percentage: Number(pctInput),
        }),
      });
      showToast('Savings goal & auto-save rate updated', 'success');
      loadAllAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update settings', 'error');
    }
  };

  const handleAddSavingsTx = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/savings', {
        method: 'POST',
        body: JSON.stringify({
          type: savForm.type,
          amount: Number(savForm.amount),
          date: savForm.date,
          note: savForm.note,
        }),
      });
      setSavForm((prev) => ({ ...prev, amount: '', note: '' }));
      showToast(
        savForm.type === 'deposit' ? 'Savings deposit recorded' : 'Withdrawal recorded',
        'success'
      );
      loadAllAdminData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update savings', 'error');
    }
  };

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (orderStatusFilter !== 'All' && o.status !== orderStatusFilter) return false;
      if (orderSearch.trim()) {
        const q = orderSearch.trim().toLowerCase();
        return (
          o.order_number.toLowerCase().includes(q) ||
          o.customer_name.toLowerCase().includes(q) ||
          o.customer_email.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [orders, orderStatusFilter, orderSearch]);

  const filteredLedger = useMemo(() => {
    return ledger.filter((tx) => {
      if (ledgerTypeFilter !== 'all' && tx.type !== ledgerTypeFilter) return false;
      if (ledgerCatFilter !== 'All' && tx.category !== ledgerCatFilter) return false;
      return true;
    });
  }, [ledger, ledgerTypeFilter, ledgerCatFilter]);

  const printInvoice = (order: Order) => {
    setInvoiceOrder(order);
    window.setTimeout(() => {
      window.print();
    }, 120);
  };

  // ============================================================================
  // LOADING OR AUTH GATE VIEW
  // ============================================================================

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F8F6] dark:bg-[#0E0E0F]">
        <div className="w-80 space-y-4 animate-pulse">
          <div className="h-6 w-32 bg-[#E4E4E0] dark:bg-[#27272A] rounded mx-auto" />
          <div className="h-44 bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!authStatus?.authenticated) {
    const isSetup = authStatus?.needsSetup;
    return (
      <div className="min-h-screen flex flex-col justify-between bg-[#F8F8F6] dark:bg-[#0E0E0F] text-[#141413] dark:text-[#F4F4F2] p-6">
        <div className="flex items-center justify-between max-w-5xl w-full mx-auto">
          <button
            type="button"
            onClick={onBackToStore}
            className="inline-flex items-center gap-2 text-sm font-medium text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Storefront</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            className="p-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] text-[#63635E] dark:text-[#A1A1AA] cursor-pointer"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <div className="max-w-md w-full mx-auto bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-2xl p-8 shadow-sm">
          <div className="flex items-center gap-2.5 text-[#2563EB] mb-3">
            <Lock className="w-5 h-5" />
            <span className="text-xs font-semibold tracking-wide uppercase">
              {isSetup ? 'First-Run Owner Setup' : 'Owner Studio Access'}
            </span>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {isSetup ? 'Claim Your Sturex Studio' : 'Sign in to Sturex'}
          </h1>
          <p className="text-sm text-[#63635E] dark:text-[#A1A1AA] mt-2 leading-relaxed">
            {isSetup
              ? 'Create the single owner credentials for this store. Public admin registration is permanently locked afterward.'
              : 'Enter your owner credentials to manage orders, inventory, money ledger, and savings.'}
          </p>

          <form onSubmit={handleAuthSubmit} className="mt-6 space-y-4">
            {isSetup && (
              <div>
                <label className="block text-xs font-medium mb-1.5" htmlFor="auth-name">
                  Owner Name
                </label>
                <input
                  id="auth-name"
                  required
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-1.5" htmlFor="auth-email">
                Owner Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="owner@sturex.store"
                className="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" htmlFor="auth-pass">
                Password
              </label>
              <input
                id="auth-pass"
                type="password"
                required
                minLength={8}
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
              />
            </div>

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
            >
              {authSubmitting
                ? 'Authenticating...'
                : isSetup
                ? 'Create Owner Account'
                : 'Sign In'}
            </button>
          </form>
        </div>

        <div className="text-center text-xs text-[#63635E] dark:text-[#A1A1AA]">
          Sturex · Private Business Operations
        </div>
      </div>
    );
  }

  // ============================================================================
  // AUTHENTICATED OWNER DASHBOARD SHELL
  // ============================================================================

  const navItems: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'orders', label: 'Orders', icon: <ShoppingCart className="w-4 h-4" /> },
    { id: 'products', label: 'Products', icon: <Package className="w-4 h-4" /> },
    { id: 'ledger', label: 'Money Ledger', icon: <Wallet className="w-4 h-4" /> },
    { id: 'savings', label: 'Savings', icon: <PiggyBank className="w-4 h-4" /> },
  ];

  const tabTitles: Record<AdminTab, string> = {
    overview: 'Overview',
    orders: 'Orders Management',
    products: 'Products & Margin Insights',
    ledger: 'Money In / Out Ledger',
    savings: 'Savings & Goals',
  };

  const savingsPctProgress =
    savingsData && savingsData.goal > 0
      ? Math.min(100, Math.round((savingsData.balance / savingsData.goal) * 100))
      : 0;

  return (
    <div className="min-h-screen bg-[#F8F8F6] dark:bg-[#0E0E0F] text-[#141413] dark:text-[#F4F4F2]">
      {/* PRINTABLE INVOICE VIEW (only visible during print) */}
      {invoiceOrder && (
        <div className="hidden print-only p-8 bg-white text-[#141413]">
          <div className="flex justify-between items-start border-b border-[#E4E4E0] pb-6 mb-6">
            <div>
              <h1 className="font-display text-2xl font-bold">Sturex</h1>
              <p className="text-xs text-[#63635E] mt-1">Studio Objects &amp; Hardware</p>
            </div>
            <div className="text-right">
              <p className="font-mono font-semibold text-lg">
                INVOICE #{invoiceOrder.order_number}
              </p>
              <p className="text-xs text-[#63635E] mt-1">
                Date: {invoiceOrder.created_at.slice(0, 10)} · Status: {invoiceOrder.status}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-8 text-sm">
            <div>
              <p className="text-xs font-semibold text-[#63635E] mb-1">Billed &amp; Shipped To</p>
              <p className="font-semibold">{invoiceOrder.customer_name}</p>
              <p>{invoiceOrder.customer_email}</p>
              <p>{invoiceOrder.customer_phone}</p>
              <p className="mt-1">{invoiceOrder.shipping_address}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-[#63635E] mb-1">Payment Details</p>
              <p>
                Method:{' '}
                {invoiceOrder.payment_method === 'bank_transfer'
                  ? 'Bank Transfer'
                  : 'Pay on Delivery'}
              </p>
              <p className="font-mono text-xs mt-1">Ref: {invoiceOrder.payment_reference}</p>
            </div>
          </div>

          <table className="w-full text-sm border-collapse mb-6">
            <thead>
              <tr className="border-b border-[#141413] text-left">
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Unit Price</th>
                <th className="py-2 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {invoiceOrder.items.map((item, idx) => (
                <tr key={idx} className="border-b border-[#E4E4E0]">
                  <td className="py-2.5">{item.product_name}</td>
                  <td className="py-2.5 text-right font-mono">{item.quantity}</td>
                  <td className="py-2.5 text-right font-mono">{formatMoney(item.unit_price)}</td>
                  <td className="py-2.5 text-right font-mono">
                    {formatMoney(item.unit_price * item.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="max-w-xs ml-auto space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="font-mono">{formatMoney(invoiceOrder.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span className="font-mono">
                {invoiceOrder.shipping_fee === 0 ? 'Free' : formatMoney(invoiceOrder.shipping_fee)}
              </span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-[#141413] pt-2">
              <span>Total</span>
              <span className="font-mono">{formatMoney(invoiceOrder.total)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="no-print flex min-h-screen">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex w-60 shrink-0 flex-col justify-between border-r border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] p-5 sticky top-0 h-screen">
          <div>
            <div className="px-2 pb-6 border-b border-[#E4E4E0] dark:border-[#27272A]">
              <span className="font-display text-xl font-bold tracking-tight">Sturex</span>
              <p className="text-xs text-[#63635E] dark:text-[#A1A1AA] mt-0.5 truncate">
                {authStatus.user?.email}
              </p>
            </div>

            <nav aria-label="Owner dashboard navigation" className="mt-5 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    activeTab === item.id
                      ? 'bg-[#2563EB] text-white'
                      : 'text-[#63635E] dark:text-[#A1A1AA] hover:bg-[#F8F8F6] dark:hover:bg-[#27272A]/60 hover:text-[#141413] dark:hover:text-white'
                  }`}
                >
                  {item.icon}
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="space-y-1.5 pt-4 border-t border-[#E4E4E0] dark:border-[#27272A]">
            <button
              type="button"
              onClick={onBackToStore}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>View Storefront</span>
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{darkMode ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-[#DC2626] hover:bg-[#DC2626]/10 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        {/* Mobile Sidebar Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside className="relative z-10 w-64 bg-white dark:bg-[#171719] h-full p-5 flex flex-col justify-between border-r border-[#E4E4E0] dark:border-[#27272A]">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-[#E4E4E0] dark:border-[#27272A]">
                  <span className="font-display text-lg font-bold">Sturex</span>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    aria-label="Close navigation menu"
                    className="p-1.5"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <nav className="mt-4 space-y-1">
                  {navItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                        activeTab === item.id
                          ? 'bg-[#2563EB] text-white'
                          : 'text-[#63635E] dark:text-[#A1A1AA]'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </nav>
              </div>
              <div className="space-y-2 border-t border-[#E4E4E0] dark:border-[#27272A] pt-4">
                <button
                  type="button"
                  onClick={onBackToStore}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#63635E] dark:text-[#A1A1AA]"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>View Storefront</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[#DC2626]"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Main Workspace Viewport */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Dashboard Top Header */}
          <header className="h-16 px-4 sm:px-8 border-b border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] flex items-center justify-between gap-4 sticky top-0 z-20">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open menu"
                className="lg:hidden p-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A]"
              >
                <Menu className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2 text-sm truncate">
                <span className="text-[#63635E] dark:text-[#A1A1AA] hidden sm:inline">
                  Owner Studio
                </span>
                <span className="text-[#63635E] dark:text-[#A1A1AA] hidden sm:inline">/</span>
                <h1 className="font-display font-semibold truncate">{tabTitles[activeTab]}</h1>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label="Toggle color theme"
                className="lg:hidden p-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A]"
              >
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('products');
                  openAddProduct();
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Product</span>
              </button>
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto space-y-8">
            {loadingData && !overview ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 animate-pulse">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="h-28 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A]"
                  />
                ))}
              </div>
            ) : null}

            {/* ============================================================== */}
            {/* TAB 1: OVERVIEW                                                */}
            {/* ============================================================== */}
            {activeTab === 'overview' && overview && (
              <>
                {/* 6 Overview KPI Cards */}
                <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5">
                    <div className="flex items-center justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      <span>Total Revenue (Money In)</span>
                      <ArrowUpRight className="w-4 h-4 text-[#16A34A]" />
                    </div>
                    <p className="mt-3 font-mono tabular-nums text-2xl font-semibold">
                      {formatMoney(overview.kpis.totalRevenue)}
                    </p>
                    <p className="mt-1 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      Recorded automatically from Paid orders
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5">
                    <div className="flex items-center justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      <span>Total Expenses (Money Out)</span>
                      <ArrowDownLeft className="w-4 h-4 text-[#DC2626]" />
                    </div>
                    <p className="mt-3 font-mono tabular-nums text-2xl font-semibold">
                      {formatMoney(overview.kpis.totalExpenses)}
                    </p>
                    <p className="mt-1 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      Restock, delivery, ads &amp; operations
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5">
                    <div className="flex items-center justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      <span>Net Profit</span>
                      <BarChart3 className="w-4 h-4 text-[#2563EB]" />
                    </div>
                    <p
                      className={`mt-3 font-mono tabular-nums text-2xl font-semibold ${
                        overview.kpis.netProfit >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'
                      }`}
                    >
                      {formatMoney(overview.kpis.netProfit)}
                    </p>
                    <p className="mt-1 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      Revenue minus operating ledger expenses
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5">
                    <div className="flex items-center justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      <span>Savings Balance</span>
                      <PiggyBank className="w-4 h-4 text-[#2563EB]" />
                    </div>
                    <p className="mt-3 font-mono tabular-nums text-2xl font-semibold">
                      {formatMoney(overview.kpis.savingsBalance)}
                    </p>
                    <p className="mt-1 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      Goal: {formatMoney(overview.kpis.savingsGoal)} ·{' '}
                      {overview.kpis.savingsPercentage}% auto-save
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-5">
                    <div className="flex items-center justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      <span>Orders Today</span>
                      <ShoppingCart className="w-4 h-4 text-[#2563EB]" />
                    </div>
                    <p className="mt-3 font-mono tabular-nums text-2xl font-semibold">
                      {overview.kpis.ordersToday}
                    </p>
                    <p className="mt-1 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      {orders.filter((o) => o.status === 'Pending').length} pending review total
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveTab('products')}
                    className="text-left rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] hover:border-[#D97706] p-5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                      <span>Low-Stock Alerts</span>
                      <Package className="w-4 h-4 text-[#D97706]" />
                    </div>
                    <p className="mt-3 font-mono tabular-nums text-2xl font-semibold text-[#D97706]">
                      {overview.kpis.lowStockCount}
                    </p>
                    <p className="mt-1 text-xs text-[#63635E] dark:text-[#A1A1AA] truncate">
                      {overview.lowStockProducts.length > 0
                        ? overview.lowStockProducts.map((p) => p.name).join(', ')
                        : `All products above ${overview.kpis.lowStockThreshold} units`}
                    </p>
                  </button>
                </section>

                {/* Charts Row */}
                <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-6 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6">
                    <h2 className="font-display text-base font-semibold mb-4">
                      Revenue vs Expenses Over Time
                    </h2>
                    <RevenueExpensesChart data={overview.dailySeries} darkMode={darkMode} />
                  </div>

                  <div className="lg:col-span-6 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6">
                    <h2 className="font-display text-base font-semibold mb-4">
                      Sales &amp; Profit by Product
                    </h2>
                    <SalesByProductChart
                      products={overview.productInsights}
                      darkMode={darkMode}
                    />
                  </div>
                </section>

                {/* Orders by Status + Top Sellers */}
                <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-4 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6">
                    <h2 className="font-display text-base font-semibold mb-4">
                      Orders by Status
                    </h2>
                    <OrdersStatusChart statuses={overview.ordersByStatus} darkMode={darkMode} />
                  </div>

                  <div className="lg:col-span-8 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6 overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-display text-base font-semibold">
                        Top Sellers &amp; Per-Product Insights
                      </h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab('products')}
                        className="text-xs font-medium text-[#2563EB] hover:underline cursor-pointer"
                      >
                        Manage Products
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#E4E4E0] dark:border-[#27272A] text-left text-xs text-[#63635E] dark:text-[#A1A1AA]">
                            <th className="pb-3 font-medium">Product</th>
                            <th className="pb-3 font-medium text-right">Units Sold</th>
                            <th className="pb-3 font-medium text-right">Revenue</th>
                            <th className="pb-3 font-medium text-right">Gross Profit</th>
                            <th className="pb-3 font-medium text-right">Stock</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">
                          {overview.productInsights.slice(0, 6).map((item) => (
                            <tr key={item.id}>
                              <td className="py-3 pr-4">
                                <div className="font-medium">{item.name}</div>
                                <div className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                                  {item.category_name} · {item.sku}
                                </div>
                              </td>
                              <td className="py-3 text-right font-mono tabular-nums">
                                {item.units_sold}
                              </td>
                              <td className="py-3 text-right font-mono tabular-nums">
                                {formatMoney(item.revenue)}
                              </td>
                              <td className="py-3 text-right font-mono tabular-nums text-[#16A34A]">
                                {formatMoney(item.profit)}
                              </td>
                              <td
                                className={`py-3 text-right font-mono tabular-nums ${
                                  item.stock <= overview.kpis.lowStockThreshold
                                    ? 'text-[#D97706] font-semibold'
                                    : ''
                                }`}
                              >
                                {item.stock}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ============================================================== */}
            {/* TAB 2: ORDERS                                                  */}
            {/* ============================================================== */}
            {activeTab === 'orders' && (
              <section className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-xl overflow-x-auto">
                    {['All', ...ORDER_STATUSES].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setOrderStatusFilter(st)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                          orderStatusFilter === st
                            ? 'bg-[#2563EB] text-white'
                            : 'text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="relative flex-1 sm:flex-initial">
                      <Search className="w-4 h-4 text-[#63635E] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="search"
                        value={orderSearch}
                        onChange={(e) => setOrderSearch(e.target.value)}
                        placeholder="Search order # or customer..."
                        className="w-full sm:w-60 pl-9 pr-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] text-sm focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>
                    <a
                      href="/api/admin/orders/export"
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] hover:border-[#2563EB] text-xs font-medium whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </a>
                  </div>
                </div>

                <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] overflow-hidden">
                  {filteredOrders.length === 0 ? (
                    <div className="p-12 text-center text-sm text-[#63635E] dark:text-[#A1A1AA]">
                      No orders match the current filter.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#E4E4E0] dark:border-[#27272A] text-left text-xs text-[#63635E] dark:text-[#A1A1AA]">
                            <th className="px-5 py-3.5 font-medium">Order</th>
                            <th className="px-5 py-3.5 font-medium">Customer</th>
                            <th className="px-5 py-3.5 font-medium">Payment</th>
                            <th className="px-5 py-3.5 font-medium">Date</th>
                            <th className="px-5 py-3.5 font-medium text-right">Total</th>
                            <th className="px-5 py-3.5 font-medium">Status</th>
                            <th className="px-5 py-3.5 font-medium text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">
                          {filteredOrders.map((order) => (
                            <tr
                              key={order.id}
                              className="hover:bg-[#F8F8F6]/70 dark:hover:bg-[#27272A]/25"
                            >
                              <td className="px-5 py-3.5 font-mono font-semibold whitespace-nowrap">
                                {order.order_number}
                              </td>
                              <td className="px-5 py-3.5">
                                <div className="font-medium">{order.customer_name}</div>
                                <div className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                                  {order.customer_email}
                                </div>
                              </td>
                              <td className="px-5 py-3.5 text-xs text-[#63635E] dark:text-[#A1A1AA] whitespace-nowrap">
                                {order.payment_method === 'bank_transfer'
                                  ? 'Bank Transfer'
                                  : 'Pay on Delivery'}
                              </td>
                              <td className="px-5 py-3.5 font-mono text-xs text-[#63635E] dark:text-[#A1A1AA] whitespace-nowrap">
                                {order.created_at.slice(0, 10)}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap">
                                {formatMoney(order.total)}
                              </td>
                              <td className="px-5 py-3.5">
                                <select
                                  aria-label={`Status for order ${order.order_number}`}
                                  value={order.status}
                                  onChange={(e) =>
                                    handleOrderStatusChange(
                                      order.id,
                                      e.target.value as OrderStatus
                                    )
                                  }
                                  className={`px-2.5 py-1.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-xs font-medium cursor-pointer ${statusStyle(
                                    order.status
                                  )}`}
                                >
                                  {ORDER_STATUSES.map((st) => (
                                    <option key={st} value={st}>
                                      {st}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => setSelectedOrder(order)}
                                  className="text-xs font-medium text-[#2563EB] hover:underline mr-3 cursor-pointer"
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={() => printInvoice(order)}
                                  aria-label={`Print invoice for ${order.order_number}`}
                                  className="text-xs text-[#63635E] hover:text-[#141413] dark:hover:text-white cursor-pointer"
                                >
                                  <Printer className="w-4 h-4 inline" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* ============================================================== */}
            {/* TAB 3: PRODUCTS & INSIGHTS                                     */}
            {/* ============================================================== */}
            {activeTab === 'products' && (
              <section className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm text-[#63635E] dark:text-[#A1A1AA]">
                    Manage inventory, unit costs, profit margins, and per-product sales performance.
                  </p>
                  <button
                    type="button"
                    onClick={openAddProduct}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Product</span>
                  </button>
                </div>

                <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[#E4E4E0] dark:border-[#27272A] text-left text-xs text-[#63635E] dark:text-[#A1A1AA]">
                          <th className="px-5 py-3.5 font-medium">Product</th>
                          <th className="px-5 py-3.5 font-medium text-right">Price</th>
                          <th className="px-5 py-3.5 font-medium text-right">Cost</th>
                          <th className="px-5 py-3.5 font-medium text-right">Margin</th>
                          <th className="px-5 py-3.5 font-medium text-right">Stock</th>
                          <th className="px-5 py-3.5 font-medium text-right">Sold</th>
                          <th className="px-5 py-3.5 font-medium text-right">Revenue</th>
                          <th className="px-5 py-3.5 font-medium text-right">Profit</th>
                          <th className="px-5 py-3.5 font-medium text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">
                        {products.map((p) => {
                          const cost = p.cost_price ?? 0;
                          const marginDollar = p.price - cost;
                          const marginPct = p.price > 0 ? Math.round((marginDollar / p.price) * 100) : 0;
                          const threshold = overview?.kpis.lowStockThreshold ?? 5;

                          return (
                            <tr
                              key={p.id}
                              className="hover:bg-[#F8F8F6]/70 dark:hover:bg-[#27272A]/25"
                            >
                              <td className="px-5 py-3.5">
                                <div className="flex items-center gap-3">
                                  <div className="w-12 h-10 rounded-lg overflow-hidden border border-[#E4E4E0] dark:border-[#27272A] shrink-0">
                                    <ImageWithFallback
                                      src={p.image_url}
                                      alt={p.name}
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                  <div>
                                    <div className="font-medium">{p.name}</div>
                                    <div className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                                      {p.category_name} · <span className="font-mono">{p.sku}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                                {formatMoney(p.price)}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums text-[#63635E] dark:text-[#A1A1AA]">
                                {formatMoney(cost)}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums text-[#16A34A]">
                                {marginPct}% ({formatMoney(marginDollar)})
                              </td>
                              <td
                                className={`px-5 py-3.5 text-right font-mono tabular-nums ${
                                  p.stock <= threshold
                                    ? 'text-[#D97706] font-semibold'
                                    : ''
                                }`}
                              >
                                {p.stock}
                                {p.stock <= threshold && (
                                  <span className="block text-[11px] font-sans">Low Stock</span>
                                )}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                                {p.units_sold ?? 0}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                                {formatMoney(p.total_revenue ?? 0)}
                              </td>
                              <td className="px-5 py-3.5 text-right font-mono tabular-nums text-[#16A34A]">
                                {formatMoney(p.total_profit ?? 0)}
                              </td>
                              <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => openEditProduct(p)}
                                  aria-label={`Edit ${p.name}`}
                                  className="p-1.5 text-[#63635E] hover:text-[#2563EB] cursor-pointer"
                                >
                                  <Edit3 className="w-4 h-4 inline" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteTargetProduct(p)}
                                  aria-label={`Delete ${p.name}`}
                                  className="p-1.5 text-[#63635E] hover:text-[#DC2626] ml-1 cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4 inline" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}

            {/* ============================================================== */}
            {/* TAB 4: MONEY IN / OUT LEDGER                                   */}
            {/* ============================================================== */}
            {activeTab === 'ledger' && (
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-4 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6">
                  <h2 className="font-display text-base font-semibold mb-1">
                    Record Manual Entry
                  </h2>
                  <p className="text-xs text-[#63635E] dark:text-[#A1A1AA] mb-5">
                    Paid orders log automatically. Use this form for restocks, delivery fees, ads,
                    or manual income.
                  </p>
                  <form onSubmit={handleAddLedgerEntry} className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setExpForm((f) => ({ ...f, type: 'out', category: 'Restock' }))}
                        className={`py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                          expForm.type === 'out'
                            ? 'border-[#DC2626] bg-[#DC2626]/10 text-[#DC2626]'
                            : 'border-[#E4E4E0] dark:border-[#27272A]'
                        }`}
                      >
                        Money Out (Expense)
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpForm((f) => ({ ...f, type: 'in', category: 'Other' }))}
                        className={`py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                          expForm.type === 'in'
                            ? 'border-[#16A34A] bg-[#16A34A]/10 text-[#16A34A]'
                            : 'border-[#E4E4E0] dark:border-[#27272A]'
                        }`}
                      >
                        Money In (Income)
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" htmlFor="exp-amount">
                        Amount ($)
                      </label>
                      <input
                        id="exp-amount"
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={expForm.amount}
                        onChange={(e) => setExpForm((f) => ({ ...f, amount: e.target.value }))}
                        placeholder="120.00"
                        className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" htmlFor="exp-cat">
                        Category
                      </label>
                      <select
                        id="exp-cat"
                        value={expForm.category}
                        onChange={(e) => setExpForm((f) => ({ ...f, category: e.target.value }))}
                        className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
                      >
                        <option value="Restock">Restock</option>
                        <option value="Delivery">Delivery</option>
                        <option value="Ads">Ads</option>
                        <option value="Operations">Operations</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" htmlFor="exp-date">
                        Date
                      </label>
                      <input
                        id="exp-date"
                        type="date"
                        required
                        value={expForm.date}
                        onChange={(e) => setExpForm((f) => ({ ...f, date: e.target.value }))}
                        className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" htmlFor="exp-note">
                        Note
                      </label>
                      <input
                        id="exp-note"
                        value={expForm.note}
                        onChange={(e) => setExpForm((f) => ({ ...f, note: e.target.value }))}
                        placeholder="Supplier invoice #402"
                        className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium cursor-pointer"
                    >
                      Save Entry
                    </button>
                  </form>
                </div>

                <div className="lg:col-span-8 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Filter ledger by type"
                        value={ledgerTypeFilter}
                        onChange={(e) =>
                          setLedgerTypeFilter(e.target.value as 'all' | 'in' | 'out')
                        }
                        className="px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] text-xs font-medium"
                      >
                        <option value="all">All Entries</option>
                        <option value="in">Money In</option>
                        <option value="out">Money Out</option>
                      </select>

                      <select
                        aria-label="Filter ledger by category"
                        value={ledgerCatFilter}
                        onChange={(e) => setLedgerCatFilter(e.target.value)}
                        className="px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] text-xs font-medium"
                      >
                        <option value="All">All Categories</option>
                        <option value="Order Revenue">Order Revenue</option>
                        <option value="Restock">Restock</option>
                        <option value="Delivery">Delivery</option>
                        <option value="Ads">Ads</option>
                        <option value="Operations">Operations</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    <a
                      href="/api/admin/ledger/export"
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] hover:border-[#2563EB] text-xs font-medium"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export Ledger CSV</span>
                    </a>
                  </div>

                  <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#E4E4E0] dark:border-[#27272A] text-left text-xs text-[#63635E] dark:text-[#A1A1AA]">
                            <th className="px-5 py-3.5 font-medium">Date</th>
                            <th className="px-5 py-3.5 font-medium">Category</th>
                            <th className="px-5 py-3.5 font-medium">Note</th>
                            <th className="px-5 py-3.5 font-medium text-right">Amount</th>
                            <th className="px-5 py-3.5 font-medium text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">
                          {filteredLedger.map((tx) => (
                            <tr key={tx.id}>
                              <td className="px-5 py-3 font-mono text-xs whitespace-nowrap">
                                {tx.date}
                              </td>
                              <td className="px-5 py-3 text-xs font-medium whitespace-nowrap">
                                {tx.category}
                              </td>
                              <td className="px-5 py-3 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                                {tx.note || '—'}
                              </td>
                              <td
                                className={`px-5 py-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                                  tx.type === 'in' ? 'text-[#16A34A]' : 'text-[#DC2626]'
                                }`}
                              >
                                {tx.type === 'in' ? '+' : '-'}
                                {formatMoney(tx.amount)}
                              </td>
                              <td className="px-5 py-3 text-right">
                                {tx.order_id === null ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteLedgerEntry(tx.id)}
                                    aria-label="Delete manual transaction"
                                    className="text-[#63635E] hover:text-[#DC2626] cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4 inline" />
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-[#63635E] dark:text-[#A1A1AA]">
                                    Auto
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ============================================================== */}
            {/* TAB 5: SAVINGS & GOALS                                         */}
            {/* ============================================================== */}
            {activeTab === 'savings' && savingsData && (
              <section className="space-y-6">
                {/* Progress Card */}
                <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6 sm:p-8">
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                    <div>
                      <span className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                        Studio Savings Reserve
                      </span>
                      <div className="mt-1 flex items-baseline gap-3">
                        <span className="font-mono tabular-nums text-3xl font-semibold">
                          {formatMoney(savingsData.balance)}
                        </span>
                        <span className="text-sm text-[#63635E] dark:text-[#A1A1AA] font-mono tabular-nums">
                          of {formatMoney(savingsData.goal)} goal
                        </span>
                      </div>
                    </div>
                    <span className="font-mono tabular-nums text-lg font-semibold text-[#2563EB]">
                      {savingsPctProgress}% achieved
                    </span>
                  </div>

                  <div className="mt-5 h-3 w-full rounded-full bg-[#EFEFED] dark:bg-[#27272A] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#2563EB] transition-all duration-300"
                      style={{ width: `${savingsPctProgress}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                  <div className="lg:col-span-5 space-y-6">
                    {/* Goal & Auto-Save Configuration */}
                    <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6">
                      <h2 className="font-display text-base font-semibold mb-4">
                        Auto-Save Rules &amp; Target
                      </h2>
                      <form onSubmit={handleSaveSavingsSettings} className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium mb-1" htmlFor="sav-goal">
                            Savings Goal ($)
                          </label>
                          <input
                            id="sav-goal"
                            type="number"
                            min="1"
                            step="0.01"
                            required
                            value={goalInput}
                            onChange={(e) => setGoalInput(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1" htmlFor="sav-pct">
                            Auto-Set-Aside % Per Paid Order
                          </label>
                          <input
                            id="sav-pct"
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            required
                            value={pctInput}
                            onChange={(e) => setPctInput(e.target.value)}
                            className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono"
                          />
                        </div>
                        <button
                          type="submit"
                          className="w-full py-2.5 rounded-lg bg-[#141413] dark:bg-[#F4F4F2] text-white dark:text-[#141413] text-sm font-medium cursor-pointer"
                        >
                          Update Savings Settings
                        </button>
                      </form>
                    </div>

                    {/* Manual Deposit / Withdrawal */}
                    <div className="rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6">
                      <h2 className="font-display text-base font-semibold mb-4">
                        Manual Deposit / Withdrawal
                      </h2>
                      <form onSubmit={handleAddSavingsTx} className="space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setSavForm((f) => ({ ...f, type: 'deposit' }))}
                            className={`py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                              savForm.type === 'deposit'
                                ? 'border-[#16A34A] bg-[#16A34A]/10 text-[#16A34A]'
                                : 'border-[#E4E4E0] dark:border-[#27272A]'
                            }`}
                          >
                            Deposit
                          </button>
                          <button
                            type="button"
                            onClick={() => setSavForm((f) => ({ ...f, type: 'withdrawal' }))}
                            className={`py-2 rounded-lg text-xs font-medium border cursor-pointer ${
                              savForm.type === 'withdrawal'
                                ? 'border-[#DC2626] bg-[#DC2626]/10 text-[#DC2626]'
                                : 'border-[#E4E4E0] dark:border-[#27272A]'
                            }`}
                          >
                            Withdraw
                          </button>
                        </div>

                        <div>
                          <label className="block text-xs font-medium mb-1" htmlFor="sav-amt">
                            Amount ($)
                          </label>
                          <input
                            id="sav-amt"
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            value={savForm.amount}
                            onChange={(e) => setSavForm((f) => ({ ...f, amount: e.target.value }))}
                            placeholder="250.00"
                            className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium mb-1" htmlFor="sav-note">
                            Note
                          </label>
                          <input
                            id="sav-note"
                            value={savForm.note}
                            onChange={(e) => setSavForm((f) => ({ ...f, note: e.target.value }))}
                            placeholder="Monthly reserve transfer"
                            className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm"
                          />
                        </div>

                        <button
                          type="submit"
                          className="w-full py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium cursor-pointer"
                        >
                          {savForm.type === 'deposit' ? 'Add Deposit' : 'Record Withdrawal'}
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Savings History Table */}
                  <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] overflow-hidden">
                    <div className="px-6 py-4 border-b border-[#E4E4E0] dark:border-[#27272A]">
                      <h2 className="font-display text-base font-semibold">Savings History</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[#E4E4E0] dark:border-[#27272A] text-left text-xs text-[#63635E] dark:text-[#A1A1AA]">
                            <th className="px-5 py-3 font-medium">Date</th>
                            <th className="px-5 py-3 font-medium">Type</th>
                            <th className="px-5 py-3 font-medium">Note</th>
                            <th className="px-5 py-3 font-medium text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">
                          {savingsData.history.map((s) => (
                            <tr key={s.id}>
                              <td className="px-5 py-3 font-mono text-xs whitespace-nowrap">
                                {s.date}
                              </td>
                              <td className="px-5 py-3 text-xs font-medium capitalize">
                                {s.type === 'auto' ? 'Auto Set-Aside' : s.type}
                              </td>
                              <td className="px-5 py-3 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                                {s.note}
                              </td>
                              <td
                                className={`px-5 py-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                                  s.type === 'withdrawal' ? 'text-[#DC2626]' : 'text-[#16A34A]'
                                }`}
                              >
                                {s.type === 'withdrawal' ? '-' : '+'}
                                {formatMoney(s.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </main>
        </div>
      </div>

      {/* ORDER DETAIL SLIDE-OVER PANEL */}
      {selectedOrder && (
        <div className="no-print fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={() => setSelectedOrder(null)}
          />
          <aside className="relative z-10 w-full max-w-lg bg-white dark:bg-[#171719] border-l border-[#E4E4E0] dark:border-[#27272A] h-full flex flex-col shadow-2xl">
            <div className="px-6 py-5 border-b border-[#E4E4E0] dark:border-[#27272A] flex items-center justify-between">
              <div>
                <h2 className="font-mono font-semibold text-lg">{selectedOrder.order_number}</h2>
                <p className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                  Placed {selectedOrder.created_at.slice(0, 10)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                aria-label="Close order details"
                className="p-2 rounded-lg text-[#63635E] hover:text-[#141413] dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-[#F8F8F6] dark:bg-[#0E0E0F] border border-[#E4E4E0] dark:border-[#27272A]">
                <span className="text-xs font-medium text-[#63635E] dark:text-[#A1A1AA]">
                  Order Status
                </span>
                <select
                  value={selectedOrder.status}
                  onChange={(e) =>
                    handleOrderStatusChange(selectedOrder.id, e.target.value as OrderStatus)
                  }
                  className={`px-3 py-1.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] text-xs font-semibold ${statusStyle(
                    selectedOrder.status
                  )}`}
                >
                  {ORDER_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5 text-sm">
                <h3 className="text-xs font-semibold text-[#63635E] dark:text-[#A1A1AA]">
                  Customer &amp; Shipping
                </h3>
                <p className="font-medium">{selectedOrder.customer_name}</p>
                <p className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                  {selectedOrder.customer_email} · {selectedOrder.customer_phone}
                </p>
                <p className="text-sm pt-1">{selectedOrder.shipping_address}</p>
              </div>

              <div className="space-y-3 border-t border-[#E4E4E0] dark:border-[#27272A] pt-4">
                <h3 className="text-xs font-semibold text-[#63635E] dark:text-[#A1A1AA]">
                  Line Items
                </h3>
                {selectedOrder.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <span>
                      {item.product_name}{' '}
                      <span className="font-mono text-xs text-[#63635E]">× {item.quantity}</span>
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(item.unit_price * item.quantity)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-[#E4E4E0] dark:border-[#27272A] pt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                    <span>Subtotal</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(selectedOrder.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                    <span>Shipping</span>
                    <span className="font-mono tabular-nums">
                      {selectedOrder.shipping_fee === 0
                        ? 'Free'
                        : formatMoney(selectedOrder.shipping_fee)}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold text-base pt-1">
                    <span>Total</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(selectedOrder.total)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-[#E4E4E0] dark:border-[#27272A] flex gap-3">
              <button
                type="button"
                onClick={() => printInvoice(selectedOrder)}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium cursor-pointer"
              >
                <Receipt className="w-4 h-4" />
                <span>Print / Export Invoice</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ADD / EDIT PRODUCT MODAL */}
      {productModalOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setProductModalOpen(false)}
          />
          <div className="relative z-10 w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-lg font-semibold">
                {editingProduct ? `Edit ${editingProduct.name}` : 'Add New Product'}
              </h2>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-[#63635E] hover:text-[#141413] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1" htmlFor="p-name">
                    Product Name
                  </label>
                  <input
                    id="p-name"
                    required
                    value={prodForm.name}
                    onChange={(e) => setProdForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" htmlFor="p-sku">
                    SKU
                  </label>
                  <input
                    id="p-sku"
                    required
                    value={prodForm.sku}
                    onChange={(e) => setProdForm((f) => ({ ...f, sku: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1" htmlFor="p-cat">
                    Category
                  </label>
                  <select
                    id="p-cat"
                    value={prodForm.category_id}
                    onChange={(e) =>
                      setProdForm((f) => ({ ...f, category_id: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" htmlFor="p-stock">
                    Stock Quantity
                  </label>
                  <input
                    id="p-stock"
                    type="number"
                    min="0"
                    required
                    value={prodForm.stock}
                    onChange={(e) => setProdForm((f) => ({ ...f, stock: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1" htmlFor="p-price">
                    Selling Price ($)
                  </label>
                  <input
                    id="p-price"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={prodForm.price}
                    onChange={(e) => setProdForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" htmlFor="p-cost">
                    Cost Price ($)
                  </label>
                  <input
                    id="p-cost"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={prodForm.cost_price}
                    onChange={(e) => setProdForm((f) => ({ ...f, cost_price: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono"
                  />
                </div>
              </div>

              {Number(prodForm.price) > 0 && (
                <div className="text-xs text-[#16A34A] font-mono">
                  Estimated Margin:{' '}
                  {Math.round(
                    ((Number(prodForm.price) - Number(prodForm.cost_price || 0)) /
                      Number(prodForm.price)) *
                      100
                  )}
                  % ({formatMoney(Number(prodForm.price) - Number(prodForm.cost_price || 0))} per
                  unit)
                </div>
              )}

              <div>
                <label className="block text-xs font-medium mb-1" htmlFor="p-desc">
                  Description
                </label>
                <textarea
                  id="p-desc"
                  rows={3}
                  required
                  value={prodForm.description}
                  onChange={(e) => setProdForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" htmlFor="p-img">
                  Product Image (Upload or URL)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="p-img"
                    required
                    value={prodForm.image_url}
                    onChange={(e) => setProdForm((f) => ({ ...f, image_url: e.target.value }))}
                    placeholder="/uploads/... or https://..."
                    className="flex-1 px-3 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm"
                  />
                  <label className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] hover:border-[#2563EB] text-xs font-medium cursor-pointer whitespace-nowrap shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingImage ? 'Uploading...' : 'Upload Image'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={prodForm.featured}
                  onChange={(e) => setProdForm((f) => ({ ...f, featured: e.target.checked }))}
                />
                <span>Feature this object on the storefront homepage</span>
              </label>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#E4E4E0] dark:border-[#27272A]">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] text-sm font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium cursor-pointer"
                >
                  {editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE PRODUCT CONFIRMATION MODAL */}
      {deleteTargetProduct && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setDeleteTargetProduct(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] p-6 shadow-2xl">
            <h3 className="font-display text-base font-semibold">Delete Product?</h3>
            <p className="text-sm text-[#63635E] dark:text-[#A1A1AA] mt-2">
              Are you sure you want to delete <strong>{deleteTargetProduct.name}</strong>?
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTargetProduct(null)}
                className="px-4 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteProduct}
                className="px-4 py-2 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-xs font-medium cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
