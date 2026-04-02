"use client";

import { CRMGrid } from "@/components/grid/crm-grid";
import { FamilyHierarchyBrowser } from "@/components/hierarchy/family-hierarchy-browser";
import { useAuth } from "@/hooks/use-auth";

export default function SaleClient() {
  const { user } = useAuth();
  const isAgent = (user?.role || "viewer") === "agent";

  return (
    <section className="space-y-4">
      {!isAgent && (
        <FamilyHierarchyBrowser
          family="sale"
          title="Sale"
          activeOnly
          recordContainerOnly
          description="Browse sale records by hierarchy layers while keeping the existing grid, search, filters, and export tools available."
        />
      )}
      <CRMGrid type="sale" />
    </section>
  );
}
