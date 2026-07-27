import { redirect } from "next/navigation";

export default function AuditLogsRedirectPage() {
  redirect("/observation?tab=audits");
}
