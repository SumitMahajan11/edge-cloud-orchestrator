"use client";

import { motion } from "framer-motion";
import { StatCards } from "@/components/dashboard/StatCards";
import { SchedulingFeed } from "@/components/dashboard/SchedulingFeed";
import { NodeMapSection } from "@/components/dashboard/NodeMapSection";
import { TaskDistributionAndNodeStatus } from "@/components/dashboard/TaskDistributionAndNodeStatus";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { SystemAlertsBanner } from "@/components/dashboard/SystemAlertsBanner";
import { CarbonSummaryWidget } from "@/components/dashboard/CarbonSummaryWidget";
import { useSystemMetrics } from "@/hooks/useMetrics";
import { useNodes } from "@/hooks/useNodes";

/**
 * Mission-control dashboard composed of six sections.
 * Ported from legacy Vite app and optimized for Next.js 14.
 */
export default function DashboardPage() {
  const { data: metrics, isLoading: metricsLoading } = useSystemMetrics();
  const { data: nodes, isLoading: nodesLoading } = useNodes();

  if (metricsLoading || nodesLoading) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!metrics || !nodes) {return null;}

  const cpuHistory = metrics.cpuHistory || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Section F — Alerts banner */}
      <SystemAlertsBanner />

      {/* Section A — Top stats */}
      <StatCards metrics={metrics} />

      {/* Section B + C — Feed and map */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SchedulingFeed cpuHistory={cpuHistory} />
        </div>
        <NodeMapSection nodes={nodes} />
      </div>

      {/* Section D — Task distribution + Node status */}
      <TaskDistributionAndNodeStatus metrics={metrics} nodes={nodes} />

      {/* Carbon Attribution & Compliance Reporting */}
      <CarbonSummaryWidget />

      {/* Section E — Recent activity */}
      <RecentActivity />
    </motion.div>
  );
}
