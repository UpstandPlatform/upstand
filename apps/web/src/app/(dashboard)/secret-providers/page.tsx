import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import SecretProviders from "./secret-providers";

export const dynamic = "force-dynamic";

export default async function SecretProvidersPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  return <SecretProviders session={session} />;
}
