import { redirect } from "next/navigation";

export default function MonitoringRedirectPage() {
  redirect("/observation?tab=monitoring");
}
