export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  product_count?: number;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  slug: string;
  description: string;
  category_id: number;
  category_name: string;
  category_slug: string;
  price: number;
  cost_price?: number;
  stock: number;
  image_url: string;
  featured: number;
  created_at: string;
  units_sold?: number;
  total_revenue?: number;
  total_profit?: number;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  id?: number;
  product_id: number;
  product_name: string;
  unit_price: number;
  unit_cost?: number;
  quantity: number;
}

export type OrderStatus =
  | 'Pending'
  | 'Paid'
  | 'Processing'
  | 'Shipped'
  | 'Delivered'
  | 'Cancelled';

export interface Order {
  id: number;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  shipping_address: string;
  payment_method: 'pay_on_delivery' | 'bank_transfer';
  payment_reference: string;
  status: OrderStatus;
  subtotal: number;
  shipping_fee: number;
  total: number;
  paid_recorded: number;
  created_at: string;
  items: OrderItem[];
  payment?: {
    gateway: string;
    reference: string;
    instructions: string;
    authorizationUrl: string | null;
  };
}

export interface LedgerTransaction {
  id: number;
  type: 'in' | 'out';
  amount: number;
  category: string;
  note: string;
  date: string;
  order_id: number | null;
  created_at: string;
}

export interface SavingsEntry {
  id: number;
  type: 'deposit' | 'withdrawal' | 'auto';
  amount: number;
  note: string;
  order_id: number | null;
  date: string;
  created_at: string;
}

export interface AdminOverviewData {
  kpis: {
    totalRevenue: number;
    totalExpenses: number;
    netProfit: number;
    savingsBalance: number;
    savingsGoal: number;
    savingsPercentage: number;
    ordersToday: number;
    lowStockCount: number;
    lowStockThreshold: number;
  };
  lowStockProducts: Array<{
    id: number;
    sku: string;
    name: string;
    stock: number;
    price: number;
    category_name: string;
  }>;
  dailySeries: Array<{
    date: string;
    revenue: number;
    expenses: number;
  }>;
  productInsights: Array<{
    id: number;
    sku: string;
    name: string;
    price: number;
    cost_price: number;
    stock: number;
    image_url: string;
    category_name: string;
    units_sold: number;
    revenue: number;
    profit: number;
  }>;
  ordersByStatus: Array<{
    status: string;
    count: number;
  }>;
  settings: {
    savings_goal: string;
    savings_percentage: string;
    low_stock_threshold: string;
    bank_account_info: string;
    payment_gateway: string;
  };
}

export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  user: { email: string; name: string } | null;
  csrfToken: string | null;
}
