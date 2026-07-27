import { redirect } from "next/navigation";

export default function RequestsRedirectPage() {
  redirect("/observation?tab=requests");
}
