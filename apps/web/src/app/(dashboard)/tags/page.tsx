import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import TagsPage from "./tags-page";

export const dynamic = "force-dynamic";

export default async function TagsRoute() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");
  return <TagsPage />;
}
