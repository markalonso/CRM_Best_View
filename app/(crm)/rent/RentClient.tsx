"use client";

import { CRMGrid } from "@/components/grid/crm-grid";
import { FamilyHierarchyBrowser } from "@/components/hierarchy/family-hierarchy-browser";
import { useAuth } from "@/hooks/use-auth";

export default function RentClient() {
  const { user } = useAuth();
  const isAgent = (user?.role || "viewer") === "agent";

  return (
    <section className="space-y-4">
      {!isAgent && (
        <FamilyHierarchyBrowser
          family="rent"
          title="Rent"
          activeOnly
          recordContainerOnly
          description="Browse rent records by hierarchy layers while keeping the existing grid, search, filters, and export tools available."
        />
      )}
      <CRMGrid type="rent" />
    </section>
  );
}
