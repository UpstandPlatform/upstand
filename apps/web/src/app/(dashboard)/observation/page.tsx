"use client";

import { Button } from "@upstand/ui/components/button";
import dynamic from "next/dynamic";
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

function ObservationTabLoading() {
  return (
    <div className="flex min-h-48 items-center justify-center text-muted-foreground text-sm">
      Loading observation data…
    </div>
  );
}

const AuditsSubpage = dynamic(
  () =>
    import("@/features/observation/components/audits-subpage").then(
      (module) => module.AuditsSubpage,
    ),
  { loading: ObservationTabLoading, ssr: false },
);
const CronJobsSubpage = dynamic(
  () =>
    import("@/features/observation/components/cron-jobs-subpage").then(
      (module) => module.CronJobsSubpage,
    ),
  { loading: ObservationTabLoading, ssr: false },
);
const DeploymentsSubpage = dynamic(
  () =>
    import("@/features/observation/components/deployments-subpage").then(
      (module) => module.DeploymentsSubpage,
    ),
  { loading: ObservationTabLoading, ssr: false },
);
const MonitoringSubpage = dynamic(
  () =>
    import("@/features/observation/components/monitoring-subpage").then(
      (module) => module.MonitoringSubpage,
    ),
  { loading: ObservationTabLoading, ssr: false },
);
const NotificationDeliveriesSubpage = dynamic(
  () =>
    import(
      "@/features/observation/components/notification-deliveries-subpage"
    ).then((module) => module.NotificationDeliveriesSubpage),
  { loading: ObservationTabLoading, ssr: false },
);
const RequestsSubpage = dynamic(
  () =>
    import("@/features/observation/components/requests-subpage").then(
      (module) => module.RequestsSubpage,
    ),
  { loading: ObservationTabLoading, ssr: false },
);

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
