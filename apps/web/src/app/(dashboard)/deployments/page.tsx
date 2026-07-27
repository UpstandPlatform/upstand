import { redirect } from "next/navigation";

export default function DeploymentsRedirectPage() {
  redirect("/observation?tab=deployments");
}
