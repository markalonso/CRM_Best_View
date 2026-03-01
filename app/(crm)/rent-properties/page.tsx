import { CRMGrid } from "@/components/grid/crm-grid";

export default function RentPropertiesPage() {
  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Rent Properties</h2>
        <p className="mt-1 text-sm text-slate-600">Unified CRM Grid with inline edit, sort, selection and detail drawer.</p>
      </section>
      <CRMGrid type="rent" />
    </section>
  );
}
