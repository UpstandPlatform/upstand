import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import S3Destinations from "./s3-destinations";

export const dynamic = "force-dynamic";

export default async function S3DestinationsPage() {
  const session = await getServerSession();

  if (!session?.user) {
    redirect("/login");
  }

  return <S3Destinations session={session} />;
}
