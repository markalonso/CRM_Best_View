"use client";

import { CRMGrid } from "@/components/grid/crm-grid";
import { FamilyHierarchyBrowser } from "@/components/hierarchy/family-hierarchy-browser";

export default function ClientsClient() {
  return (
    <section className="space-y-4">
      <FamilyHierarchyBrowser
        family="clients"
        title="Clients"
        activeOnly
        description="Browse client records by hierarchy layers while keeping the existing grid, search, filters, and export tools available."
      />
      <CRMGrid type="client" />
    </section>
  );
}
