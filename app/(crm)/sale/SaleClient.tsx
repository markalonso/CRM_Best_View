"use client";

import { CRMGrid } from "@/components/grid/crm-grid";

export default function SaleClient() {
  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Sale</h2>
        <p className="mt-1 text-sm text-slate-600">Advanced grid with search, filters, views, export, and quick intake action.</p>
      </section>
      <CRMGrid type="sale" />
    </section>
  );
}
