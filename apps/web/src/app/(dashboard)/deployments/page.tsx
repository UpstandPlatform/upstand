"use client";

import { redirect } from "next/navigation";
import { useEffect } from "react";

export default function DeploymentsRedirectPage() {
  useEffect(() => {
    redirect("/observation?tab=deployments");
  }, []);

  return null;
}
