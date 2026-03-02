import { CRMShell } from "@/components/layout/crm-shell";

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  return <CRMShell>{children}</CRMShell>;
}
