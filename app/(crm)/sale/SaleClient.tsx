"use client";

import { CRMGrid } from "@/components/grid/crm-grid";
import { FamilyHierarchyBrowser } from "@/components/hierarchy/family-hierarchy-browser";

export default function SaleClient() {
  return (
    <section className="space-y-4">
      <FamilyHierarchyBrowser
        family="sale"
        title="Sale"
        activeOnly
        recordContainerOnly
        description="Browse sale records by hierarchy layers while keeping the existing grid, search, filters, and export tools available."
      />
      <CRMGrid type="sale" />
    </section>
  );
}
