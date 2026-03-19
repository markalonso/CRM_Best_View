"use client";

import { CRMGrid } from "@/components/grid/crm-grid";
import { FamilyHierarchyBrowser } from "@/components/hierarchy/family-hierarchy-browser";

export default function RentClient() {
  return (
    <section className="space-y-4">
      <FamilyHierarchyBrowser
        family="rent"
        title="Rent"
        activeOnly
        recordContainerOnly
        description="Browse rent records by hierarchy layers while keeping the existing grid, search, filters, and export tools available."
      />
      <CRMGrid type="rent" />
    </section>
  );
}
