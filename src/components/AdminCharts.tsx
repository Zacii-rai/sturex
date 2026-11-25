import { useEffect, useRef } from 'react';
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  ArcElement,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  ArcElement,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
  Filler
);

interface DailyPoint {
  date: string;
  revenue: number;
  expenses: number;
}

interface ProductInsightPoint {
  name: string;
  revenue: number;
  profit: number;
}

interface StatusCount {
  status: string;
  count: number;
}

export function RevenueExpensesChart({
  data,
  darkMode,
}: {
  data: DailyPoint[];
  darkMode: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const textColor = darkMode ? '#A1A1AA' : '#63635E';
    const gridColor = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(20,20,19,0.07)';

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map((d) => d.date.slice(5)),
        datasets: [
          {
            label: 'Revenue (In)',
            data: data.map((d) => d.revenue),
            backgroundColor: darkMode ? '#3B82F6' : '#2563EB',
            borderRadius: 6,
            maxBarThickness: 28,
          },
          {
            label: 'Expenses (Out)',
            data: data.map((d) => d.expenses),
            backgroundColor: darkMode ? 'rgba(220,38,38,0.75)' : 'rgba(220,38,38,0.8)',
            borderRadius: 6,
            maxBarThickness: 28,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: textColor,
              boxWidth: 10,
              usePointStyle: true,
              pointStyle: 'rectRounded',
              font: { family: 'DM Sans, sans-serif', size: 12 },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { family: 'JetBrains Mono, monospace', size: 11 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'JetBrains Mono, monospace', size: 11 },
              callback: (v) => `$${v}`,
            },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [data, darkMode]);

  return (
    <div className="h-64 w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}

export function SalesByProductChart({
  products,
  darkMode,
}: {
  products: ProductInsightPoint[];
  darkMode: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const top = products.filter((p) => p.revenue > 0).slice(0, 6);
    const textColor = darkMode ? '#A1A1AA' : '#63635E';
    const gridColor = darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(20,20,19,0.07)';

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: top.map((p) => (p.name.length > 18 ? `${p.name.slice(0, 17)}…` : p.name)),
        datasets: [
          {
            label: 'Revenue',
            data: top.map((p) => p.revenue),
            backgroundColor: darkMode ? '#3B82F6' : '#2563EB',
            borderRadius: 6,
            barThickness: 16,
          },
          {
            label: 'Profit',
            data: top.map((p) => p.profit),
            backgroundColor: '#16A34A',
            borderRadius: 6,
            barThickness: 16,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: textColor,
              boxWidth: 10,
              usePointStyle: true,
              pointStyle: 'rectRounded',
              font: { family: 'DM Sans, sans-serif', size: 12 },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: 'JetBrains Mono, monospace', size: 11 },
              callback: (v) => `$${v}`,
            },
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor, font: { family: 'DM Sans, sans-serif', size: 12 } },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [products, darkMode]);

  return (
    <div className="h-64 w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}

export function OrdersStatusChart({
  statuses,
  darkMode,
}: {
  statuses: StatusCount[];
  darkMode: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const palette: Record<string, string> = {
      Pending: '#D97706',
      Paid: '#2563EB',
      Processing: '#0284C7',
      Shipped: '#6366F1',
      Delivered: '#16A34A',
      Cancelled: '#DC2626',
    };

    const textColor = darkMode ? '#D4D4D8' : '#3F3F46';

    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: statuses.map((s) => s.status),
        datasets: [
          {
            data: statuses.map((s) => s.count),
            backgroundColor: statuses.map((s) => palette[s.status] || '#71717A'),
            borderWidth: 2,
            borderColor: darkMode ? '#171719' : '#FFFFFF',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: textColor,
              padding: 14,
              boxWidth: 10,
              usePointStyle: true,
              pointStyle: 'circle',
              font: { family: 'DM Sans, sans-serif', size: 12 },
            },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [statuses, darkMode]);

  return (
    <div className="h-64 w-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
