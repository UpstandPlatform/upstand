"use client";

import { Button } from "@upstand/ui/components/button";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import {
  Activity,
  AnalyticsUpIcon,
  Bell,
  Clock,
  FileClock,
  RefreshCw,
  Rocket01Icon,
} from "@/components/huge-icons";
import { AuditsSubpage } from "@/features/observation/components/audits-subpage";
import { CronJobsSubpage } from "@/features/observation/components/cron-jobs-subpage";
import { DeploymentsSubpage } from "@/features/observation/components/deployments-subpage";
import { MonitoringSubpage } from "@/features/observation/components/monitoring-subpage";
import { NotificationDeliveriesSubpage } from "@/features/observation/components/notification-deliveries-subpage";
import { RequestsSubpage } from "@/features/observation/components/requests-subpage";

const TABS = [
  {
    id: "audits",
    label: "Audit Logs",
    description: "Organization-scoped history of dashboard and API activity.",
    icon: FileClock,
  },
  {
    id: "cron-jobs",
    label: "Cron Jobs",
    description:
      "30-day retention observability, P75 duration, and execution history.",
    icon: Clock,
  },
  {
    id: "requests",
    label: "Requests",
    description: "HTTP traffic analytics and Caddy access log distribution.",
    icon: Rocket01Icon,
  },
  {
    id: "monitoring",
    label: "Monitoring",
    description:
      "Live host CPU, memory, disk, network, and container telemetry.",
    icon: AnalyticsUpIcon,
  },
  {
    id: "notification-deliveries",
    label: "Notification Deliveries",
    description: "30-day notification delivery history, payloads, and retries.",
    icon: Bell,
  },
  {
    id: "deployments",
    label: "Deployments",
    description:
      "Observe build histories, monitor live queues, and manage server-level concurrency.",
    icon: Activity,
  },
] as const;

type TabId = (typeof TABS)[number]["id"];

function ObservationContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as TabId | null;

  const activeTab = TABS.some((t) => t.id === tabParam)
    ? (tabParam as TabId)
    : "audits";

  const currentTab = TABS.find((t) => t.id === activeTab) || TABS[0];
  const IconComponent = currentTab.icon;

  const handleRefreshDeployments = () => {
    window.dispatchEvent(new CustomEvent("refresh-deployments"));
  };

  return (
    <DashboardPage className="flex-1">
      <DashboardPageHeader
        title={currentTab.label}
        icon={<IconComponent className="size-6 text-primary" />}
        description={currentTab.description}
        actions={
          activeTab === "deployments" ? (
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefreshDeployments}
              aria-label="Refresh deployments"
            >
              <RefreshCw className="size-4" />
            </Button>
          ) : undefined
        }
      />

      <div className="min-w-0">
        {activeTab === "deployments" ? (
          <DeploymentsSubpage />
        ) : (
          <div>
            {activeTab === "audits" && <AuditsSubpage />}
            {activeTab === "cron-jobs" && <CronJobsSubpage />}
            {activeTab === "requests" && <RequestsSubpage />}
            {activeTab === "monitoring" && <MonitoringSubpage />}
            {activeTab === "notification-deliveries" && (
              <NotificationDeliveriesSubpage />
            )}
          </div>
        )}
      </div>
    </DashboardPage>
  );
}

export default function ObservationPage() {
  return (
    <Suspense>
      <ObservationContent />
    </Suspense>
  );
}
