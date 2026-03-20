"use client";

import { CRMGrid } from "@/components/grid/crm-grid";
import { FamilyHierarchyBrowser } from "@/components/hierarchy/family-hierarchy-browser";

export default function BuyersClient() {
  return (
    <section className="space-y-4">
      <FamilyHierarchyBrowser
        family="buyers"
        title="Buyers"
        activeOnly
        description="Browse buyer records by hierarchy layers while keeping the existing grid, search, filters, and export tools available."
      />
      <CRMGrid type="buyer" />
    </section>
  );
}
