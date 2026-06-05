import * as React from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Clock,
  Server,
  Activity,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  History,
  FileJson,
  RotateCcw,
  XCircle,
  Brain,
} from "lucide-react";
import { DrawerPanel } from "../shared/DrawerPanel";
import { JsonViewer } from "../shared/JsonViewer";
import { StatusBadge } from "../shared/StatusBadge";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { cn, formatCurrency, formatDuration } from "../../lib/utils";
import type { Task, LogEntry, EdgeNode } from "../../types";
import Link from "next/link";

interface TaskDetailDrawerProps {
  task: Task | null;
  isOpen: boolean;
  logs: LogEntry[] | undefined;
  node: EdgeNode | undefined;
  onRetry: ((task: Task) => void) | undefined;
  onCancel: ((task: Task) => void) | undefined;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailDrawer({
  task,
  isOpen,
  onOpenChange,
  logs = [],
  node,
  onRetry,
  onCancel,
}: TaskDetailDrawerProps) {
  if (!task) return null;

  const taskLogs = logs.filter((l) => l.taskId === task.id);

  return (
    <DrawerPanel
      isOpen={isOpen}
      onClose={() => onOpenChange(false)}
      title={task.name}
      description={`Task ID: ${task.id}`}
      width="lg"
    >
      <div className="space-y-8">
        {/* Task Lifecycle Visualization */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Saga Lifecycle
            </h3>
            <StatusBadge status={task.status} />
          </div>
          <TaskLifecycle status={task.status} />
        </section>

        <Separator className="bg-border/50" />

        {/* Execution Details */}
        <section className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" />
              Compute
            </h3>
            <div className="space-y-3">
              <DetailItem label="Type" value={task.type} />
              <DetailItem label="Runtime" value={task.runtime.toUpperCase()} />
              {task.affinity && (
                <DetailItem label="Affinity" value={task.affinity} />
              )}
              <DetailItem
                label="Priority"
                value={<StatusBadge status={task.priority} showDot={false} />}
              />
              <DetailItem label="Target" value={task.target.toUpperCase()} />
              <DetailItem
                label="Retries"
                value={`${task.retryCount} / ${task.maxRetries}`}
              />
            </div>
          </div>
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Performance
            </h3>
            <div className="space-y-3">
              <DetailItem
                label="Latency"
                value={`${Math.round(task.latencyMs)}ms`}
              />
              <DetailItem
                label="Duration"
                value={formatDuration(task.duration)}
              />
              <DetailItem label="Cost" value={formatCurrency(task.cost)} />
              <DetailItem
                label="Submitted"
                value={new Date(task.submittedAt).toLocaleTimeString()}
              />
            </div>
          </div>
        </section>

        <Separator className="bg-border/50" />

        {/* Allocated Node */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Server className="h-4 w-4" />
            Execution Node
          </h3>
          {task.nodeId ? (
            <div className="rounded-lg border border-border bg-secondary/30 p-4 flex items-center justify-between group hover:border-primary/50 transition-all">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Server className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {node?.name || "Edge Node"}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {task.nodeId}
                  </p>
                </div>
              </div>
              <Link
                href={`/nodes?node=${task.nodeId}`}
                className="p-2 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all opacity-0 group-hover:opacity-100"
              >
                <ExternalLink className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No node allocated yet
              </p>
            </div>
          )}
        </section>

        <Separator className="bg-border/50" />

        {/* Task Metadata / Spec */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            Task Specification
          </h3>
          <div className="rounded-lg border border-border bg-[#0a0a0f] overflow-hidden">
            <JsonViewer
              data={
                task.metadata || {
                  id: task.id,
                  name: task.name,
                  type: task.type,
                  target: task.target,
                  priority: task.priority,
                }
              }
            />
          </div>
        </section>

        {/* Logs */}
        <section className="space-y-4 pb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <History className="h-4 w-4" />
              Execution Logs
            </h3>
            <Badge variant="outline" className="font-mono text-[10px]">
              {taskLogs.length} Events
            </Badge>
          </div>
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin">
            {taskLogs.length > 0 ? (
              taskLogs.map((log) => (
                <div
                  key={log.id}
                  className="rounded border border-border/50 bg-secondary/20 p-2.5 font-mono text-[10px] space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "uppercase font-bold",
                        log.level === "error"
                          ? "text-destructive"
                          : log.level === "warn"
                            ? "text-yellow-500"
                            : "text-primary",
                      )}
                    >
                      {log.level}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-foreground leading-relaxed">
                    {log.message}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-center py-8 text-xs text-muted-foreground font-mono italic">
                No execution logs recorded for this task.
              </p>
            )}
          </div>
        </section>

        {(onRetry || onCancel) && (
          <div className="mt-auto border-t border-border p-6 bg-secondary/10 flex gap-3">
            {onRetry && task.status === "failed" && (
              <Button className="flex-1 gap-2" onClick={() => onRetry(task)}>
                <RotateCcw className="h-4 w-4" />
                Retry Task
              </Button>
            )}
            {onCancel &&
              (task.status === "pending" || task.status === "running") && (
                <Button
                  variant="destructive"
                  className="flex-1 gap-2"
                  onClick={() => onCancel(task)}
                >
                  <XCircle className="h-4 w-4" />
                  Cancel Task
                </Button>
              )}
          </div>
        )}
      </div>
    </DrawerPanel>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground font-mono">{label}</span>
      <div className="text-sm font-medium text-foreground text-right">
        {value}
      </div>
    </div>
  );
}

function TaskLifecycle({ status }: { status: Task["status"] }) {
  const steps = [
    { key: "pending", label: "Submitted", icon: CheckCircle2 },
    { key: "scheduled", label: "Scheduled", icon: Brain },
    { key: "running", label: "Running", icon: Activity },
    { key: "completed", label: "Finalized", icon: CheckCircle2 },
  ];

  const getStatusIndex = (s: Task["status"]) => {
    if (s === "pending") return 0;
    if (s === "scheduled") return 1;
    if (s === "running") return 2;
    if (s === "completed") return 3;
    if (s === "failed") return 2; // Show up to running then failed
    return -1;
  };

  const currentIndex = getStatusIndex(status);

  return (
    <div className="relative pt-2 pb-6">
      {/* Background Line */}
      <div className="absolute top-[21px] left-4 right-4 h-0.5 bg-border/50" />

      {/* Active Line */}
      <motion.div
        className="absolute top-[21px] left-4 h-0.5 bg-primary"
        initial={{ width: 0 }}
        animate={{ width: `${(currentIndex / (steps.length - 1)) * 100}%` }}
        transition={{ duration: 0.8, ease: "easeInOut" }}
      />

      <div className="relative flex justify-between">
        {steps.map((step, idx) => {
          const isActive = idx <= currentIndex;
          const isCurrent = idx === currentIndex;
          const isFailed = status === "failed" && idx === 2;
          const Icon = isFailed ? AlertCircle : step.icon;

          return (
            <div key={step.key} className="flex flex-col items-center gap-2">
              <motion.div
                className={cn(
                  "h-10 w-10 rounded-full border-2 flex items-center justify-center bg-card z-10",
                  isActive
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground",
                  isCurrent && "shadow-[0_0_15px_rgba(0,212,170,0.3)]",
                  isFailed &&
                    "border-destructive text-destructive shadow-[0_0_15px_rgba(239,68,68,0.3)]",
                )}
                initial={false}
                animate={{
                  scale: isCurrent ? 1.1 : 1,
                  backgroundColor: isActive
                    ? "rgba(0, 212, 170, 0.05)"
                    : "rgba(10, 10, 15, 1)",
                }}
              >
                <Icon className={cn("h-5 w-5", isCurrent && "animate-pulse")} />
              </motion.div>
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-tighter",
                  isActive ? "text-foreground" : "text-muted-foreground",
                  isFailed && "text-destructive",
                )}
              >
                {isFailed ? "Failed" : step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
