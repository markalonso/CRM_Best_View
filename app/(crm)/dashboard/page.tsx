"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type DashboardResponse = {
  kpis: {
    sale_total: number;
    rent_total: number;
    buyer_total: number;
    client_total: number;
    intake_today: number;
    overdue_tasks: number;
    needs_review_total: number;
  };
  trends: Array<{ date: string; sale: number; rent: number; buyer: number; client: number; intake: number; confirmed: number; needs_review: number }>;
  market: {
    sale_avg_by_area: Array<{ label: string; avg: number }>;
    rent_avg_by_area: Array<{ label: string; avg: number }>;
    buyer_avg_budget_by_area: Array<{ label: string; avg: number }>;
  };
  data_quality: {
    sale_missing_price: number;
    sale_missing_location: number;
    buyer_missing_budget: number;
    client_missing_phone: number;
  };
  activity: Array<{ id: string; action: string; record_type: string; record_code: string; created_at: string }>;
};

function relTime(v: string) {
  const d = Math.floor((Date.now() - new Date(v).getTime()) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function Card({ title, value, href, onNavigate }: { title: string; value: number; href: string; onNavigate: (href: string) => void }) {
  return (
    <button onClick={() => onNavigate(href)} className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value.toLocaleString()}</p>
    </button>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/dashboard/summary", { cache: "no-store" });
      const json = await res.json();
      setData(json);
      setLoading(false);
    };
    load();
  }, []);

  const trendData = useMemo(() => (data?.trends || []).map((row) => ({ ...row, date: row.date.slice(5) })), [data]);

  if (loading || !data) {
    return <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading dashboard...</section>;
  }

  return (
    <section className="grid grid-cols-[1fr_340px] gap-4">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Card title="Total Sale listings" value={data.kpis.sale_total} href="/sale" onNavigate={(href) => window.location.assign(href)} />
          <Card title="Total Rent listings" value={data.kpis.rent_total} href="/rent" onNavigate={(href) => window.location.assign(href)} />
          <Card title="Total Buyers" value={data.kpis.buyer_total} href="/buyers" onNavigate={(href) => window.location.assign(href)} />
          <Card title="Total Clients" value={data.kpis.client_total} href="/clients" onNavigate={(href) => window.location.assign(href)} />
          <Card title="New intakes today" value={data.kpis.intake_today} href={`/inbox?startDate=${new Date().toISOString().slice(0, 10)}`} onNavigate={(href) => window.location.assign(href)} />
          <Card title="Overdue Tasks" value={data.kpis.overdue_tasks} href="/tasks?view=overdue" onNavigate={(href) => window.location.assign(href)} />
          <Card title="Needs Review (all)" value={data.kpis.needs_review_total} href="/sale?status=needs_review" onNavigate={(href) => window.location.assign(href)} />
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">New records per day (last 14 days)</h3>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="sale" stackId="a" fill="#0f172a" />
                <Bar dataKey="rent" stackId="a" fill="#334155" />
                <Bar dataKey="buyer" stackId="a" fill="#64748b" />
                <Bar dataKey="client" stackId="a" fill="#94a3b8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Intake sessions per day</h3>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="intake" stroke="#0f172a" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-800">Confirmed vs Needs Review</h3>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="confirmed" stroke="#16a34a" strokeWidth={2} />
                  <Line type="monotone" dataKey="needs_review" stroke="#f97316" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[
            { title: "Sale avg price by area", rows: data.market.sale_avg_by_area },
            { title: "Rent avg price by area", rows: data.market.rent_avg_by_area },
            { title: "Buyer avg budget by area", rows: data.market.buyer_avg_budget_by_area }
          ].map((group) => (
            <div key={group.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-800">{group.title}</h3>
              <div className="mt-3 space-y-2 text-sm">
                {group.rows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1.5">
                    <span className="truncate pr-2 text-slate-600">{row.label}</span>
                    <span className="font-semibold text-slate-900">{row.avg.toLocaleString()}</span>
                  </div>
                ))}
                {group.rows.length === 0 && <p className="text-xs text-slate-500">No data yet.</p>}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Data quality</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
            <button onClick={() => window.location.assign("/sale?preset=missing_price")} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-left hover:bg-slate-50">
              <span>Sale missing price</span>
              <span className="font-semibold">{data.data_quality.sale_missing_price.toLocaleString()}</span>
            </button>
            <button onClick={() => window.location.assign("/sale?preset=missing_location")} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-left hover:bg-slate-50">
              <span>Sale missing location</span>
              <span className="font-semibold">{data.data_quality.sale_missing_location.toLocaleString()}</span>
            </button>
            <button onClick={() => window.location.assign("/buyers?requirements_missing=yes")} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-left hover:bg-slate-50">
              <span>Buyer missing budget</span>
              <span className="font-semibold">{data.data_quality.buyer_missing_budget.toLocaleString()}</span>
            </button>
            <button onClick={() => window.location.assign("/clients?phone_exists=no")} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2 text-left hover:bg-slate-50">
              <span>Client missing phone</span>
              <span className="font-semibold">{data.data_quality.client_missing_phone.toLocaleString()}</span>
            </button>
          </div>
        </div>
      </div>

      <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">Activity feed</h3>
        <div className="mt-3 space-y-2">
          {data.activity.map((row) => (
            <div key={row.id} className="rounded border border-slate-200 p-2">
              <p className="text-xs font-medium text-slate-800">{row.record_code} • {row.action}</p>
              <p className="text-xs text-slate-500">{row.record_type} • {relTime(row.created_at)}</p>
            </div>
          ))}
          {data.activity.length === 0 && <p className="text-xs text-slate-500">No activity yet.</p>}
        </div>
      </aside>
    </section>
  );
}
