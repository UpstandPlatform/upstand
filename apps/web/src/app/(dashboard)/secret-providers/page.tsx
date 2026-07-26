import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import SecretProviders from "./secret-providers";

export const dynamic = "force-dynamic";

export default async function SecretProvidersPage() {
  let session = null;
  try {
    session = await getServerSession();
  } catch {}

  if (!session?.user) {
    redirect("/login");
  }

  return <SecretProviders session={session} />;
}
