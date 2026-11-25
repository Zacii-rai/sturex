import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Minus,
  Moon,
  Plus,
  Search,
  ShoppingBag,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, formatMoney } from '../lib/api';
import { CartItem, Category, Order, Product } from '../types';
import { ImageWithFallback } from './ImageWithFallback';
import { useToast } from './Toast';

interface StorefrontProps {
  darkMode: boolean;
  onToggleTheme: () => void;
  onNavigateAdmin: () => void;
}

const CART_STORAGE_KEY = 'sturex_cart_v1';

export function Storefront({
  darkMode,
  onToggleTheme,
  onNavigateAdmin,
}: StorefrontProps) {
  const { showToast } = useToast();

  // Catalog state
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [sortBy, setSortBy] = useState<'featured' | 'price_asc' | 'price_desc'>('featured');

  // Product Detail Page state
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const [pdpQuantity, setPdpQuantity] = useState(1);

  // Cart & Checkout Drawer state
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [checkoutStep, setCheckoutStep] = useState<'cart' | 'checkout' | 'confirmed'>('cart');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);

  // Checkout form fields
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'pay_on_delivery' | 'bank_transfer'>(
    'pay_on_delivery'
  );

  // Order Tracker modal
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [trackNumber, setTrackNumber] = useState('');
  const [trackEmail, setTrackEmail] = useState('');
  const [trackedOrder, setTrackedOrder] = useState<Order | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  // Sync cart to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignore storage quota errors
    }
  }, [cart]);

  // Fetch categories once
  useEffect(() => {
    apiRequest<Category[]>('/api/categories')
      .then(setCategories)
      .catch(() => {});
  }, []);

  // Fetch filtered products
  const loadProducts = async (q: string, category: string, sort: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (category !== 'all') params.set('category', category);
      params.set('sort', sort);
      const data = await apiRequest<Product[]>(`/api/products?${params.toString()}`);
      setProducts(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to load catalog', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadProducts(searchQuery, selectedCategory, sortBy);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchQuery, selectedCategory, sortBy]);

  const featuredProducts = useMemo(() => {
    const list = products.filter((p) => p.featured === 1);
    return (list.length >= 3 ? list : products).slice(0, 3);
  }, [products]);

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
    [cart]
  );
  const freeShippingRemaining = Math.max(0, 150 - cartSubtotal);
  const shippingFee = cartSubtotal === 0 ? 0 : cartSubtotal >= 150 ? 0 : 12;
  const cartTotal = cartSubtotal + shippingFee;

  const addToCart = (product: Product, qty = 1) => {
    if (product.stock < 1) {
      showToast(`${product.name} is currently out of stock.`, 'error');
      return;
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        const nextQty = Math.min(product.stock, existing.quantity + qty);
        if (nextQty === existing.quantity) {
          showToast(`Maximum available stock (${product.stock}) reached in cart.`, 'info');
          return prev;
        }
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: nextQty } : i
        );
      }
      return [...prev, { product, quantity: Math.min(product.stock, qty) }];
    });
    setCheckoutStep('cart');
    setCartOpen(true);
    showToast(`Added ${product.name} to cart`, 'success');
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const next = item.quantity + delta;
          if (next <= 0) return null;
          return { ...item, quantity: Math.min(item.product.stock, next) };
        })
        .filter((x): x is CartItem => x !== null)
    );
  };

  const removeFromCart = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;

    setSubmittingOrder(true);
    try {
      const created = await apiRequest<Order>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          shipping_address: shippingAddress,
          payment_method: paymentMethod,
          items: cart.map((c) => ({
            product_id: c.product.id,
            quantity: c.quantity,
          })),
        }),
      });

      setConfirmedOrder(created);
      setCheckoutStep('confirmed');
      setCart([]);
      setCustomerName('');
      setCustomerEmail('');
      setCustomerPhone('');
      setShippingAddress('');
      // Refresh products so updated stock reflects immediately
      loadProducts(searchQuery, selectedCategory, sortBy);
      if (activeProduct) {
        const refreshed = await apiRequest<Product>(`/api/products/${activeProduct.id}`);
        setActiveProduct(refreshed);
      }
      showToast(`Order ${created.order_number} confirmed!`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to place order.', 'error');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleTrackOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrackingLoading(true);
    setTrackedOrder(null);
    try {
      const params = new URLSearchParams({
        order_number: trackNumber.trim(),
        email: trackEmail.trim(),
      });
      const data = await apiRequest<Order>(`/api/orders/track?${params.toString()}`);
      setTrackedOrder(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Order not found.', 'error');
    } finally {
      setTrackingLoading(false);
    }
  };

  const openProductDetail = (product: Product) => {
    setActiveProduct(product);
    setPdpQuantity(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToSection = (id: string) => {
    setActiveProduct(null);
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F8F6] text-[#141413] dark:bg-[#0E0E0F] dark:text-[#F4F4F2] transition-colors duration-200">
      {/* Top Bar Contract: Brand wordmark — 4 concise nav links — Primary Cart CTA */}
      <header className="sticky top-0 z-30 border-b border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6]/90 dark:bg-[#0E0E0F]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => {
              setActiveProduct(null);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display text-xl font-bold tracking-tight text-[#141413] dark:text-[#F4F4F2] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2563EB]"
          >
            Sturex
          </button>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-[#63635E] dark:text-[#A1A1AA]"
          >
            <button
              type="button"
              onClick={() => {
                setActiveProduct(null);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="hover:text-[#141413] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Home
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('catalog')}
              className="hover:text-[#141413] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Catalog
            </button>
            <button
              type="button"
              onClick={() => setTrackerOpen(true)}
              className="hover:text-[#141413] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Track Order
            </button>
            <button
              type="button"
              onClick={onNavigateAdmin}
              className="hover:text-[#141413] dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Owner Studio
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white transition-colors cursor-pointer"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setCheckoutStep('cart');
                setCartOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Cart</span>
              <span className="font-mono tabular-nums text-xs opacity-90">({cartCount})</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {activeProduct ? (
          /* PRODUCT DETAIL PAGE (PDP) */
          <section className="max-w-7xl mx-auto px-4 sm:px-8 py-10 sm:py-14">
            <button
              type="button"
              onClick={() => setActiveProduct(null)}
              className="inline-flex items-center gap-2 text-sm font-medium text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white mb-8 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Catalog</span>
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-start">
              {/* Sticky Product Gallery Left */}
              <div className="lg:col-span-7 lg:sticky lg:top-24 rounded-2xl overflow-hidden border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] aspect-[4/3]">
                <ImageWithFallback
                  src={activeProduct.image_url}
                  alt={activeProduct.name}
                  label={activeProduct.name}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Contiguous Purchase Module Right */}
              <div className="lg:col-span-5 flex flex-col gap-6 bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-2xl p-6 sm:p-8">
                <div className="flex items-center gap-2 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                  <span>{activeProduct.category_name}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeProduct.sku}</span>
                </div>

                <div>
                  <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-[#141413] dark:text-[#F4F4F2]">
                    {activeProduct.name}
                  </h1>
                  <p className="mt-3 font-mono tabular-nums text-2xl font-semibold text-[#141413] dark:text-[#F4F4F2]">
                    {formatMoney(activeProduct.price)}
                  </p>
                </div>

                <div className="text-sm">
                  {activeProduct.stock > 5 ? (
                    <span className="text-[#16A34A] font-medium">
                      In Stock · {activeProduct.stock} units ready to ship
                    </span>
                  ) : activeProduct.stock > 0 ? (
                    <span className="text-[#D97706] font-medium">
                      Low Stock · Only {activeProduct.stock} left
                    </span>
                  ) : (
                    <span className="text-[#DC2626] font-medium">
                      Out of Stock · Restocking soon
                    </span>
                  )}
                </div>

                <p className="text-sm sm:text-base leading-relaxed text-[#63635E] dark:text-[#A1A1AA] border-t border-[#E4E4E0] dark:border-[#27272A] pt-5">
                  {activeProduct.description}
                </p>

                <div className="flex items-center gap-4 pt-2">
                  <div className="inline-flex items-center border border-[#E4E4E0] dark:border-[#27272A] rounded-lg">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      disabled={pdpQuantity <= 1}
                      onClick={() => setPdpQuantity((q) => Math.max(1, q - 1))}
                      className="p-3 text-[#63635E] hover:text-[#141413] dark:text-[#A1A1AA] dark:hover:text-white disabled:opacity-40 cursor-pointer"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center font-mono tabular-nums text-sm font-medium">
                      {pdpQuantity}
                    </span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      disabled={pdpQuantity >= activeProduct.stock}
                      onClick={() =>
                        setPdpQuantity((q) => Math.min(activeProduct.stock, q + 1))
                      }
                      className="p-3 text-[#63635E] hover:text-[#141413] dark:text-[#A1A1AA] dark:hover:text-white disabled:opacity-40 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={activeProduct.stock < 1}
                    onClick={() => addToCart(activeProduct, pdpQuantity)}
                    className="flex-1 py-3 px-6 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#E4E4E0] disabled:text-[#63635E] dark:disabled:bg-[#27272A] dark:disabled:text-[#71717A] text-white text-sm font-semibold transition-colors cursor-pointer"
                  >
                    {activeProduct.stock > 0 ? 'Add to Cart' : 'Out of Stock'}
                  </button>
                </div>

                <div className="border-t border-[#E4E4E0] dark:border-[#27272A] pt-5 space-y-2 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                  <p>Complimentary express courier shipping on orders over $150.</p>
                  <p>Pay on Delivery or Direct Bank Transfer available at checkout.</p>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <>
            {/* SECTION 1: EDITORIAL HERO */}
            <section className="max-w-7xl mx-auto px-4 sm:px-8 pt-8 pb-14 sm:pt-12 sm:pb-20">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
                <div className="lg:col-span-5 flex flex-col justify-between bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-2xl p-8 sm:p-10">
                  <div>
                    <p className="text-xs font-medium text-[#63635E] dark:text-[#A1A1AA] mb-4">
                      Autumn / Studio Edition · Precision Everyday Objects
                    </p>
                    <h1
                      className="font-display font-semibold tracking-tight text-[#141413] dark:text-[#F4F4F2] leading-[1.08]"
                      style={{
                        fontSize: 'clamp(2.25rem, 3.8vw, 3.4rem)',
                        textWrap: 'balance',
                      }}
                    >
                      Tactile hardware for focused workspaces.
                    </h1>
                    <p className="mt-5 text-base leading-relaxed text-[#63635E] dark:text-[#A1A1AA] max-w-md">
                      Machined aluminum, stoneware ceramics, and vegetable-tanned leather designed
                      to age with your daily craft.
                    </p>
                  </div>

                  <div className="mt-8 pt-6 border-t border-[#E4E4E0] dark:border-[#27272A] flex flex-wrap items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => scrollToSection('catalog')}
                      className="inline-flex items-center gap-2.5 px-6 py-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>Explore Collection</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <div className="text-xs text-[#63635E] dark:text-[#A1A1AA] font-mono tabular-nums">
                      Free shipping $150+
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-7 rounded-2xl overflow-hidden border border-[#E4E4E0] dark:border-[#27272A] bg-[#EFEFED] dark:bg-[#171719] min-h-[280px] sm:min-h-[380px]">
                  <ImageWithFallback
                    src="/src/assets/images/sturex_hero_studio_1795599004896.jpg"
                    alt="Sturex architectural studio workspace featuring brushed aluminum lamp, mechanical keyboard, and ceramic pour-over"
                    label="Sturex Studio Collection"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </section>

            {/* SECTION 2: FEATURED OBJECTS */}
            <section className="max-w-7xl mx-auto px-4 sm:px-8 pb-16">
              <div className="flex items-end justify-between gap-4 mb-8 border-b border-[#E4E4E0] dark:border-[#27272A] pb-4">
                <div>
                  <h2 className="font-display text-2xl font-semibold tracking-tight">
                    Featured Editions
                  </h2>
                  <p className="text-sm text-[#63635E] dark:text-[#A1A1AA] mt-1">
                    Signature desk instruments selected by our studio.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => scrollToSection('catalog')}
                  className="text-sm font-medium text-[#2563EB] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  View all 12 objects
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {featuredProducts.map((product) => (
                  <article
                    key={`feat-${product.id}`}
                    className="group flex flex-col bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-2xl overflow-hidden transition-transform duration-200 hover:-translate-y-0.5"
                  >
                    <button
                      type="button"
                      onClick={() => openProductDetail(product)}
                      className="aspect-[4/3] w-full overflow-hidden bg-[#EFEFED] dark:bg-[#1E1E22] cursor-pointer text-left"
                    >
                      <ImageWithFallback
                        src={product.image_url}
                        alt={product.name}
                        label={product.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    </button>
                    <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                          <span>{product.category_name}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openProductDetail(product)}
                          className="mt-1.5 font-display text-base font-semibold text-left text-[#141413] dark:text-[#F4F4F2] group-hover:text-[#2563EB] transition-colors cursor-pointer"
                        >
                          {product.name}
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#E4E4E0] dark:border-[#27272A]">
                        <span className="font-mono tabular-nums text-sm font-semibold">
                          {formatMoney(product.price)}
                        </span>
                        <button
                          type="button"
                          disabled={product.stock < 1}
                          onClick={() => addToCart(product, 1)}
                          className="px-3.5 py-1.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-40 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Add to Cart
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* SECTION 3: INTERACTIVE CATALOG */}
            <section id="catalog" className="max-w-7xl mx-auto px-4 sm:px-8 pb-20">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
                <div>
                  <h2 className="font-display text-2xl font-semibold tracking-tight">
                    Complete Catalog
                  </h2>
                  <p className="text-sm text-[#63635E] dark:text-[#A1A1AA] mt-1">
                    Filter by discipline, search specifications, or sort by price.
                  </p>
                </div>

                {/* Search + Sort Toolbar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="relative">
                    <Search className="w-4 h-4 text-[#63635E] dark:text-[#A1A1AA] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search objects or SKU..."
                      aria-label="Search products"
                      className="w-full sm:w-64 pl-10 pr-4 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] text-sm focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  <select
                    aria-label="Sort products by price"
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(e.target.value as 'featured' | 'price_asc' | 'price_desc')
                    }
                    className="px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] text-sm focus:outline-none focus:border-[#2563EB]"
                  >
                    <option value="featured">Sort: Featured</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                  </select>
                </div>
              </div>

              {/* Category Filter Segmented Control */}
              <div
                role="tablist"
                aria-label="Filter by category"
                className="flex items-center gap-1.5 p-1 bg-[#EFEFED] dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-xl overflow-x-auto mb-8 w-fit max-w-full"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedCategory === 'all'}
                  onClick={() => setSelectedCategory('all')}
                  className={`px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    selectedCategory === 'all'
                      ? 'bg-white dark:bg-[#27272A] text-[#141413] dark:text-white shadow-sm'
                      : 'text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white'
                  }`}
                >
                  All Objects
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === cat.slug}
                    onClick={() => setSelectedCategory(cat.slug)}
                    className={`px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      selectedCategory === cat.slug
                        ? 'bg-white dark:bg-[#27272A] text-[#141413] dark:text-white shadow-sm'
                        : 'text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {/* Product Grid with Skeleton Loader & Empty State */}
              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <div
                      key={n}
                      className="rounded-2xl border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] overflow-hidden animate-pulse"
                    >
                      <div className="aspect-[4/3] bg-[#E4E4E0]/60 dark:bg-[#27272A]" />
                      <div className="p-5 space-y-3">
                        <div className="h-3 w-24 bg-[#E4E4E0]/70 dark:bg-[#27272A] rounded" />
                        <div className="h-5 w-48 bg-[#E4E4E0]/70 dark:bg-[#27272A] rounded" />
                        <div className="h-4 w-20 bg-[#E4E4E0]/70 dark:bg-[#27272A] rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : products.length === 0 ? (
                <div className="rounded-2xl border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] p-12 text-center">
                  <p className="font-display text-lg font-semibold">No matching studio objects</p>
                  <p className="text-sm text-[#63635E] dark:text-[#A1A1AA] mt-2">
                    Try clearing your search query or switching to another category.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedCategory('all');
                      setSortBy('featured');
                    }}
                    className="mt-5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium cursor-pointer"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                  {products.map((product) => (
                    <article
                      key={product.id}
                      className="group flex flex-col bg-white dark:bg-[#171719] border border-[#E4E4E0] dark:border-[#27272A] rounded-2xl overflow-hidden transition-transform duration-200 hover:-translate-y-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => openProductDetail(product)}
                        className="aspect-[4/3] w-full overflow-hidden bg-[#EFEFED] dark:bg-[#1E1E22] cursor-pointer text-left"
                      >
                        <ImageWithFallback
                          src={product.image_url}
                          alt={product.name}
                          label={product.name}
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      </button>

                      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-[#63635E] dark:text-[#A1A1AA]">
                            <span>{product.category_name}</span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                product.stock === 0
                                  ? 'text-[#DC2626]'
                                  : product.stock <= 5
                                  ? 'text-[#D97706]'
                                  : ''
                              }
                            >
                              {product.stock === 0
                                ? 'Sold Out'
                                : product.stock <= 5
                                ? `Only ${product.stock} left`
                                : 'In Stock'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openProductDetail(product)}
                            className="mt-1.5 font-display text-base font-semibold text-left text-[#141413] dark:text-[#F4F4F2] group-hover:text-[#2563EB] transition-colors cursor-pointer"
                          >
                            {product.name}
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-3 border-t border-[#E4E4E0] dark:border-[#27272A]">
                          <span className="font-mono tabular-nums text-sm font-semibold">
                            {formatMoney(product.price)}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openProductDetail(product)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white cursor-pointer"
                            >
                              Details
                            </button>
                            <button
                              type="button"
                              disabled={product.stock < 1}
                              onClick={() => addToCart(product, 1)}
                              className="px-3.5 py-1.5 rounded-lg bg-[#141413] dark:bg-[#F4F4F2] text-white dark:text-[#141413] hover:bg-[#2563EB] dark:hover:bg-[#3B82F6] dark:hover:text-white disabled:opacity-40 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {product.stock > 0 ? 'Add' : 'Sold Out'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719]">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-[#63635E] dark:text-[#A1A1AA]">
          <div className="flex items-center gap-3">
            <span className="font-display font-semibold text-sm text-[#141413] dark:text-[#F4F4F2]">
              Sturex
            </span>
            <span aria-hidden="true">·</span>
            <span>Studio Objects &amp; Hardware</span>
          </div>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setTrackerOpen(true)}
              className="hover:text-[#141413] dark:hover:text-white cursor-pointer"
            >
              Track Order
            </button>
            <button
              type="button"
              onClick={onNavigateAdmin}
              className="hover:text-[#141413] dark:hover:text-white cursor-pointer"
            >
              Owner Studio
            </button>
            <button
              type="button"
              onClick={onToggleTheme}
              className="hover:text-[#141413] dark:hover:text-white cursor-pointer"
            >
              {darkMode ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>
      </footer>

      {/* SLIDE-OVER CART & CHECKOUT DRAWER */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={() => setCartOpen(false)}
          />
          <aside
            aria-label="Shopping cart and checkout"
            className="relative z-10 w-full max-w-md bg-white dark:bg-[#171719] text-[#141413] dark:text-[#F4F4F2] border-l border-[#E4E4E0] dark:border-[#27272A] h-full flex flex-col shadow-2xl"
          >
            <div className="px-6 py-5 border-b border-[#E4E4E0] dark:border-[#27272A] flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold">
                {checkoutStep === 'cart' && `Your Cart (${cartCount})`}
                {checkoutStep === 'checkout' && 'Checkout Details'}
                {checkoutStep === 'confirmed' && 'Order Confirmed'}
              </h2>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Close drawer"
                className="p-2 rounded-lg text-[#63635E] hover:text-[#141413] dark:text-[#A1A1AA] dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {checkoutStep === 'confirmed' && confirmedOrder ? (
                <div className="space-y-6">
                  <div className="rounded-xl border border-[#16A34A]/30 bg-[#16A34A]/5 p-5">
                    <div className="flex items-center gap-2.5 text-[#16A34A] font-semibold text-sm">
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Order #{confirmedOrder.order_number} Received</span>
                    </div>
                    <p className="mt-2 text-xs text-[#63635E] dark:text-[#A1A1AA] leading-relaxed">
                      Status: <strong className="text-[#141413] dark:text-white">{confirmedOrder.status}</strong>.{' '}
                      {confirmedOrder.payment?.instructions}
                    </p>
                  </div>

                  <div className="space-y-3 border-t border-[#E4E4E0] dark:border-[#27272A] pt-4">
                    <h3 className="text-xs font-semibold text-[#63635E] dark:text-[#A1A1AA]">
                      Items Summary
                    </h3>
                    {confirmedOrder.items.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span>
                          {item.product_name} × {item.quantity}
                        </span>
                        <span className="font-mono tabular-nums">
                          {formatMoney(item.unit_price * item.quantity)}
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-[#E4E4E0] dark:border-[#27272A] pt-3 flex justify-between text-sm">
                      <span className="text-[#63635E] dark:text-[#A1A1AA]">Shipping</span>
                      <span className="font-mono tabular-nums">
                        {confirmedOrder.shipping_fee === 0
                          ? 'Free'
                          : formatMoney(confirmedOrder.shipping_fee)}
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold text-base">
                      <span>Total Due</span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(confirmedOrder.total)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCartOpen(false)}
                    className="w-full py-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium cursor-pointer"
                  >
                    Continue Shopping
                  </button>
                </div>
              ) : checkoutStep === 'checkout' ? (
                <form id="checkout-form" onSubmit={handleCheckoutSubmit} className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setCheckoutStep('cart')}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#63635E] dark:text-[#A1A1AA] hover:text-[#141413] dark:hover:text-white mb-1 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Cart</span>
                  </button>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" htmlFor="co-name">
                      Full Name
                    </label>
                    <input
                      id="co-name"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Alex Morgan"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" htmlFor="co-email">
                      Email Address
                    </label>
                    <input
                      id="co-email"
                      type="email"
                      required
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="alex@example.com"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" htmlFor="co-phone">
                      Phone Number
                    </label>
                    <input
                      id="co-phone"
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+1 (555) 234-5678"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium mb-1.5" htmlFor="co-address">
                      Delivery Address
                    </label>
                    <textarea
                      id="co-address"
                      required
                      rows={3}
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      placeholder="Street, Apartment, City, Postal Code"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>

                  <div>
                    <span className="block text-xs font-medium mb-2">Payment Method</span>
                    <div className="grid grid-cols-1 gap-2.5">
                      <label
                        className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
                          paymentMethod === 'pay_on_delivery'
                            ? 'border-[#2563EB] bg-[#2563EB]/5'
                            : 'border-[#E4E4E0] dark:border-[#27272A]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="payment_method"
                          checked={paymentMethod === 'pay_on_delivery'}
                          onChange={() => setPaymentMethod('pay_on_delivery')}
                          className="mt-1"
                        />
                        <div>
                          <div className="text-sm font-medium">Pay on Delivery</div>
                          <div className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                            Cash or contactless card terminal upon courier arrival.
                          </div>
                        </div>
                      </label>

                      <label
                        className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
                          paymentMethod === 'bank_transfer'
                            ? 'border-[#2563EB] bg-[#2563EB]/5'
                            : 'border-[#E4E4E0] dark:border-[#27272A]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="payment_method"
                          checked={paymentMethod === 'bank_transfer'}
                          onChange={() => setPaymentMethod('bank_transfer')}
                          className="mt-1"
                        />
                        <div>
                          <div className="text-sm font-medium">Direct Bank Transfer</div>
                          <div className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                            Receive studio account instructions with your order number.
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>
                </form>
              ) : cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-12">
                  <ShoppingBag className="w-10 h-10 text-[#63635E] dark:text-[#A1A1AA] opacity-50 mb-4" />
                  <p className="font-display font-semibold text-base">Your cart is empty</p>
                  <p className="text-sm text-[#63635E] dark:text-[#A1A1AA] mt-1 max-w-xs">
                    Add desk hardware, lighting, or carry essentials to start an order.
                  </p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-xl bg-[#F8F8F6] dark:bg-[#0E0E0F] border border-[#E4E4E0] dark:border-[#27272A] p-3.5 text-xs">
                    {freeShippingRemaining > 0 ? (
                      <p className="text-[#63635E] dark:text-[#A1A1AA]">
                        Add{' '}
                        <span className="font-mono tabular-nums font-semibold text-[#141413] dark:text-white">
                          {formatMoney(freeShippingRemaining)}
                        </span>{' '}
                        more for complimentary express shipping.
                      </p>
                    ) : (
                      <p className="text-[#16A34A] font-medium">
                        Complimentary express shipping unlocked.
                      </p>
                    )}
                  </div>

                  <div className="divide-y divide-[#E4E4E0] dark:divide-[#27272A]">
                    {cart.map(({ product, quantity }) => (
                      <div key={product.id} className="py-4 flex gap-4">
                        <div className="w-20 h-16 rounded-lg overflow-hidden border border-[#E4E4E0] dark:border-[#27272A] shrink-0">
                          <ImageWithFallback
                            src={product.image_url}
                            alt={product.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-medium truncate">{product.name}</h3>
                            <button
                              type="button"
                              onClick={() => removeFromCart(product.id)}
                              aria-label={`Remove ${product.name}`}
                              className="text-[#63635E] hover:text-[#DC2626] transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <p className="font-mono tabular-nums text-xs text-[#63635E] dark:text-[#A1A1AA] mt-0.5">
                            {formatMoney(product.price)}
                          </p>
                          <div className="mt-2.5 flex items-center justify-between">
                            <div className="inline-flex items-center border border-[#E4E4E0] dark:border-[#27272A] rounded-md">
                              <button
                                type="button"
                                aria-label="Decrease item quantity"
                                onClick={() => updateCartQty(product.id, -1)}
                                className="p-1.5 text-[#63635E] hover:text-[#141413] dark:hover:text-white cursor-pointer"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="w-7 text-center font-mono tabular-nums text-xs">
                                {quantity}
                              </span>
                              <button
                                type="button"
                                aria-label="Increase item quantity"
                                onClick={() => updateCartQty(product.id, 1)}
                                className="p-1.5 text-[#63635E] hover:text-[#141413] dark:hover:text-white cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                            <span className="font-mono tabular-nums text-sm font-semibold">
                              {formatMoney(product.price * quantity)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {cart.length > 0 && checkoutStep !== 'confirmed' && (
              <div className="p-6 border-t border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] space-y-3">
                <div className="flex justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">{formatMoney(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between text-xs text-[#63635E] dark:text-[#A1A1AA]">
                  <span>Shipping</span>
                  <span className="font-mono tabular-nums">
                    {shippingFee === 0 ? 'Free' : formatMoney(shippingFee)}
                  </span>
                </div>
                <div className="flex justify-between text-base font-semibold pt-2 border-t border-[#E4E4E0] dark:border-[#27272A]">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{formatMoney(cartTotal)}</span>
                </div>

                {checkoutStep === 'cart' ? (
                  <button
                    type="button"
                    onClick={() => setCheckoutStep('checkout')}
                    className="w-full py-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium transition-colors cursor-pointer"
                  >
                    Proceed to Checkout
                  </button>
                ) : (
                  <button
                    type="submit"
                    form="checkout-form"
                    disabled={submittingOrder}
                    className="w-full py-3 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-sm font-medium transition-colors cursor-pointer"
                  >
                    {submittingOrder ? 'Placing Order...' : `Place Order · ${formatMoney(cartTotal)}`}
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* ORDER TRACKER MODAL */}
      {trackerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setTrackerOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#E4E4E0] dark:border-[#27272A] bg-white dark:bg-[#171719] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg font-semibold">Track Your Order</h2>
              <button
                type="button"
                onClick={() => setTrackerOpen(false)}
                aria-label="Close tracker"
                className="p-1.5 rounded-lg text-[#63635E] hover:text-[#141413] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleTrackOrder} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" htmlFor="track-num">
                  Order Number
                </label>
                <input
                  id="track-num"
                  required
                  value={trackNumber}
                  onChange={(e) => setTrackNumber(e.target.value)}
                  placeholder="STX-1042"
                  className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm font-mono uppercase focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" htmlFor="track-email">
                  Order Email
                </label>
                <input
                  id="track-email"
                  type="email"
                  required
                  value={trackEmail}
                  onChange={(e) => setTrackEmail(e.target.value)}
                  placeholder="clara.chen@example.com"
                  className="w-full px-3.5 py-2 rounded-lg border border-[#E4E4E0] dark:border-[#27272A] bg-[#F8F8F6] dark:bg-[#0E0E0F] text-sm focus:outline-none focus:border-[#2563EB]"
                />
              </div>
              <button
                type="submit"
                disabled={trackingLoading}
                className="w-full py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-medium cursor-pointer"
              >
                {trackingLoading ? 'Checking...' : 'Check Order Status'}
              </button>
            </form>

            {trackedOrder && (
              <div className="mt-5 pt-4 border-t border-[#E4E4E0] dark:border-[#27272A] space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-mono font-semibold">{trackedOrder.order_number}</span>
                  <span className="font-medium text-[#2563EB]">{trackedOrder.status}</span>
                </div>
                <p className="text-xs text-[#63635E] dark:text-[#A1A1AA]">
                  Ordered by {trackedOrder.customer_name} · {trackedOrder.created_at.slice(0, 10)}
                </p>
                <div className="space-y-1 pt-2">
                  {trackedOrder.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span>
                        {item.product_name} × {item.quantity}
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatMoney(item.unit_price * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between font-semibold pt-2 border-t border-[#E4E4E0] dark:border-[#27272A]">
                  <span>Total</span>
                  <span className="font-mono tabular-nums">{formatMoney(trackedOrder.total)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
