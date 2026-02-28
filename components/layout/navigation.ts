import type { Route } from "next";

export type NavItem = {
  label: string;
  href: Route;
};

export const SIDEBAR_ITEMS: NavItem[] = [
  { label: "Inbox", href: "/inbox" },
  { label: "Sale", href: "/sale" },
  { label: "Rent", href: "/rent" },
  { label: "Buyers", href: "/buyers" },
  { label: "Clients", href: "/clients" },
  { label: "Tasks", href: "/tasks" },
  { label: "Media", href: "/media" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Reports", href: "/reports" },
  { label: "Integrations", href: "/integrations/sheets" }
];

export const VIEW_MODES = ["Grid", "Kanban", "Dashboard", "Map"] as const;
