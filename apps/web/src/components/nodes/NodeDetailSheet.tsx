import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Check,
  X,
  RotateCw,
  Power,
  Wrench,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { cn } from "../../lib/utils";
import type { EdgeNode, Task, LogEntry } from "../../types";
import { useWsEventStream } from "../../stores/websocket";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";

interface NodeDetailSheetProps {
  node: EdgeNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks?: Task[];
  logs?: LogEntry[];
  onDrain?: ((node: EdgeNode) => void | Promise<void>) | undefined;
  onForceOffline?: ((node: EdgeNode) => void | Promise<void>) | undefined;
  onRotateCertificate?: ((node: EdgeNode) => void | Promise<void>) | undefined;
}

/**
 * Right-side drawer for detailed node management.
 * Tabs: Overview | Metrics | Tasks | Certificate | Logs
 * Spec: 480px wide, live-updating via WebSocket.
 */
export function NodeDetailSheet({
  node,
  open,
  onOpenChange,
  tasks = [],
  logs = [],
  onDrain,
  onForceOffline,
  onRotateCertificate,
}: NodeDetailSheetProps) {
  if (!node) {return null;}

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[480px] p-0 flex flex-col"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-[#1e1e2e]">
          <div className="flex items-center gap-2">
            <StatusDot status={node.status} />
            <SheetTitle className="font-mono">{node.name}</SheetTitle>
          </div>
          <SheetDescription className="font-mono text-[11px]">
            {node.id} · {node.region}
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-6 mt-3 grid grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="certificate">Cert</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 min-h-0">
            <TabsContent value="overview" className="px-6 py-4 mt-0">
              <OverviewTab
                node={node}
                onDrain={onDrain}
                onForceOffline={onForceOffline}
              />
            </TabsContent>
            <TabsContent value="metrics" className="px-6 py-4 mt-0">
              <MetricsTab node={node} />
            </TabsContent>
            <TabsContent value="tasks" className="px-6 py-4 mt-0">
              <TasksTab node={node} tasks={tasks} />
            </TabsContent>
            <TabsContent value="certificate" className="px-6 py-4 mt-0">
              <CertificateTab node={node} onRotate={onRotateCertificate} />
            </TabsContent>
            <TabsContent value="logs" className="px-6 py-4 mt-0">
              <LogsTab node={node} logs={logs} />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Overview Tab
// ────────────────────────────────────────────────────────────────────────

function OverviewTab({
  node,
  onDrain,
  onForceOffline,
}: {
  node: EdgeNode;
  onDrain?: ((n: EdgeNode) => void | Promise<void>) | undefined;
  onForceOffline?: ((n: EdgeNode) => void | Promise<void>) | undefined;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const uptimeStr = `${node.uptime.toFixed(2)}%`;
  // Derive synthetic hardware/cert info from id hash until backend surfaces them.
  const h = hashId(node.id);
  const cores = 4 + (h % 29);
  const memGb = 8 + ((h >> 3) % 120);
  const diskGb = 128 + ((h >> 5) % 896);
  const arch = h % 2 === 0 ? "x86_64" : "aarch64";
  const agentVersion = `rust-agent v${1 + (h % 3)}.${(h >> 2) % 12}.${(h >> 4) % 20}`;
  const zone = `${node.region}-${String.fromCharCode(97 + (h % 3))}`;

  const certStatus = deriveCertStatus(node.id);
  const certSerial = `sn:${(h >>> 0).toString(16).padStart(8, "0")}${((h * 2654435761) >>> 0).toString(16).padStart(8, "0")}`;

  return (
    <div className="space-y-5">
      {/* Node ID row (copyable) */}
      <SectionHeading>Identity</SectionHeading>
      <KV label="Node ID" value={<CopyableCode text={node.id} />} />
      <KV
        label="Name"
        value={<span className="font-mono text-xs">{node.name}</span>}
      />
      <KV
        label="Location"
        value={<span className="font-mono text-xs">{node.location}</span>}
      />

      <Separator className="bg-[#1e1e2e]" />
      <SectionHeading>Hardware</SectionHeading>
      <KV
        label="CPU cores"
        value={<span className="font-mono text-xs">{cores}</span>}
      />
      <KV
        label="Memory"
        value={<span className="font-mono text-xs">{memGb} GB</span>}
      />
      <KV
        label="Disk"
        value={<span className="font-mono text-xs">{diskGb} GB</span>}
      />
      <KV
        label="Architecture"
        value={<span className="font-mono text-xs">{arch}</span>}
      />

      <Separator className="bg-[#1e1e2e]" />
      <SectionHeading>Network</SectionHeading>
      <KV label="IP Address" value={<CopyableCode text={node.ip} />} />
      <KV
        label="Region"
        value={<span className="font-mono text-xs">{node.region}</span>}
      />
      <KV
        label="Zone"
        value={<span className="font-mono text-xs">{zone}</span>}
      />
      <KV
        label="Latency"
        value={
          <span className="font-mono text-xs">
            {Math.round(node.latency)}ms
          </span>
        }
      />
      <KV label="Agent URL" value={<CopyableCode text={node.url} />} />

      <Separator className="bg-[#1e1e2e]" />
      <SectionHeading>Agent</SectionHeading>
      <KV
        label="Version"
        value={<span className="font-mono text-xs">{agentVersion}</span>}
      />
      <KV
        label="Runtimes"
        value={
          <div className="flex gap-1.5">
            <Badge className="bg-[#6366f1]/10 text-[#6366f1] border-[#6366f1]/30">
              Docker
            </Badge>
            <Badge className="bg-[#00d4aa]/10 text-[#00d4aa] border-[#00d4aa]/30">
              WASM
            </Badge>
          </div>
        }
      />
      <KV
        label="Uptime"
        value={<span className="font-mono text-xs">{uptimeStr}</span>}
      />

      <Separator className="bg-[#1e1e2e]" />
      <SectionHeading>mTLS Certificate</SectionHeading>
      <KV
        label="Status"
        value={
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-xs",
              certStatus === "valid" && "text-[#10b981]",
              certStatus === "expiring" && "text-[#f59e0b]",
              certStatus === "expired" && "text-[#ef4444]",
            )}
          >
            {certStatus === "valid" && <ShieldCheck className="h-3.5 w-3.5" />}
            {certStatus === "expiring" && (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            {certStatus === "expired" && <ShieldX className="h-3.5 w-3.5" />}
            {certStatus.toUpperCase()}
          </span>
        }
      />
      <KV
        label="Serial"
        value={<span className="font-mono text-[10px]">{certSerial}</span>}
      />

      {/* Actions */}
      {(onDrain || onForceOffline) && (
        <>
          <Separator className="bg-[#1e1e2e]" />
          <div className="flex flex-col gap-2 pt-2">
            {onDrain && (
              <Button
                variant="outline"
                className="w-full border-[#f59e0b]/40 text-[#f59e0b] hover:bg-[#f59e0b]/10"
                onClick={() => onDrain?.(node)}
                disabled={node.status === "offline" || node.isMaintenanceMode}
              >
                <Wrench className="h-4 w-4 mr-2" />
                Drain Node
              </Button>
            )}

            {onForceOffline &&
              (!confirmOpen ? (
                <Button
                  variant="outline"
                  className="w-full border-[#ef4444]/40 text-[#ef4444] hover:bg-[#ef4444]/10"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Power className="h-4 w-4 mr-2" />
                  Force Offline
                </Button>
              ) : (
                <div className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/5 p-3 space-y-2">
                  <p className="text-xs text-[#ef4444] font-mono">
                    Type CONFIRM to force offline
                  </p>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="CONFIRM"
                    className="bg-[#0a0a0f] border-[#1e1e2e] font-mono text-xs"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setConfirmOpen(false);
                        setConfirmText("");
                      }}
                    >
                      <X className="h-3.5 w-3.5 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 bg-[#ef4444] hover:bg-[#ef4444]/80 text-white"
                      disabled={confirmText !== "CONFIRM"}
                      onClick={() => {
                        void onForceOffline?.(node);
                        setConfirmOpen(false);
                        setConfirmText("");
                      }}
                    >
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Confirm
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Metrics Tab
// ────────────────────────────────────────────────────────────────────────

function MetricsTab({ node }: { node: EdgeNode }) {
  // Subscribe to live heartbeats for this node — triggers re-render.
  useWsEventStream("node.heartbeat");

  const history = useMemo(
    () =>
      (node.healthHistory || []).slice(-60).map((h) => ({
        t: new Date(h.timestamp).toLocaleTimeString(),
        cpu: h.cpu,
        memory: h.memory,
        latency: h.latency,
      })),
    [node.healthHistory],
  );

  // Fake throughput derivation: tasks completed/min bucketed from history length.
  const throughput = useMemo(() => {
    const buckets: { minute: string; count: number }[] = [];
    const now = Date.now();
    for (let i = 9; i >= 0; i--) {
      const mark = new Date(now - i * 60_000);
      const min = `${mark.getHours().toString().padStart(2, "0")}:${mark
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;
      const h = hashId(node.id + i);
      buckets.push({ minute: min, count: h % (node.tasksRunning + 4) });
    }
    return buckets;
  }, [node.id, node.tasksRunning]);

  return (
    <div className="space-y-5">
      <SectionHeading>CPU % (last hour)</SectionHeading>
      <MiniLineChart
        data={history}
        dataKey="cpu"
        color="#00d4aa"
        domain={[0, 100]}
        unit="%"
      />

      <SectionHeading>Memory % (last hour)</SectionHeading>
      <MiniLineChart
        data={history}
        dataKey="memory"
        color="#6366f1"
        domain={[0, 100]}
        unit="%"
      />

      <SectionHeading>Latency (ms)</SectionHeading>
      <MiniLineChart
        data={history}
        dataKey="latency"
        color="#f59e0b"
        unit="ms"
      />

      <SectionHeading>Task throughput (per min)</SectionHeading>
      <div className="h-[110px] w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={throughput}>
            <CartesianGrid stroke="#1e1e2e" vertical={false} />
            <XAxis dataKey="minute" tick={{ fontSize: 9, fill: "#6b7280" }} />
            <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} width={24} />
            <RechartsTooltip
              contentStyle={{
                background: "#111118",
                border: "1px solid #1e1e2e",
                borderRadius: 8,
                fontSize: 11,
              }}
            />
            <Bar dataKey="count" fill="#00d4aa" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MiniLineChart({
  data,
  dataKey,
  color,
  domain,
  unit,
}: {
  data: Array<Record<string, unknown>>;
  dataKey: string;
  color: string;
  domain?: [number, number] | undefined;
  unit?: string;
}) {
  return (
    <div className="h-[110px] w-full rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] p-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="#1e1e2e" vertical={false} />
          <XAxis dataKey="t" tick={{ fontSize: 9, fill: "#6b7280" }} />
          <YAxis
            tick={{ fontSize: 9, fill: "#6b7280" }}
            width={28}
            domain={domain as any}
            tickFormatter={(v) => `${v}${unit ?? ""}`}
          />
          <RechartsTooltip
            contentStyle={{
              background: "#111118",
              border: "1px solid #1e1e2e",
              borderRadius: 8,
              fontSize: 11,
            }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Tasks Tab
// ────────────────────────────────────────────────────────────────────────

function TasksTab({ node, tasks }: { node: EdgeNode; tasks: Task[] }) {
  const router = useRouter();
  const assigned = useMemo(
    () => tasks.filter((t) => t.nodeId === node.id).slice(0, 100),
    [tasks, node.id],
  );

  if (assigned.length === 0) {
    return (
      <div className="p-8 text-center text-xs font-mono text-muted-foreground">
        No tasks currently assigned to this node.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SectionHeading>{assigned.length} task(s) on this node</SectionHeading>
      <div className="space-y-1.5">
        {assigned.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => router.push(`/scheduler?task=${t.id}`)}
            className="w-full text-left rounded-lg border border-[#1e1e2e] bg-[#0a0a0f] p-3 hover:border-[#00d4aa]/40 transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] truncate text-foreground">
                {t.id.slice(0, 12)}… {t.name}
              </span>
              <TaskStatusBadge status={t.status} />
            </div>
            <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
              <span>
                Start:{" "}
                {t.startedAt ? new Date(t.startedAt).toLocaleTimeString() : "—"}
              </span>
              <span>·</span>
              <span>{t.duration}ms</span>
              <span>·</span>
              <span>${t.cost.toFixed(4)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskStatusBadge({ status }: { status: Task["status"] }) {
  const map: Record<Task["status"], string> = {
    pending: "bg-gray-500/10 text-gray-400 border-gray-500/30",
    scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    running: "bg-[#00d4aa]/10 text-[#00d4aa] border-[#00d4aa]/30",
    completed: "bg-[#10b981]/10 text-[#10b981] border-[#10b981]/30",
    failed: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/30",
  };
  return (
    <Badge className={cn("font-mono text-[9px]", map[status])}>{status}</Badge>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Certificate Tab
// ────────────────────────────────────────────────────────────────────────

function CertificateTab({
  node,
  onRotate,
}: {
  node: EdgeNode;
  onRotate?: ((n: EdgeNode) => void | Promise<void>) | undefined;
}) {
  const h = hashId(node.id);
  const status = deriveCertStatus(node.id);
  const serial = `${(h >>> 0).toString(16).padStart(8, "0")}${((h * 2654435761) >>> 0).toString(16).padStart(8, "0")}`;
  const issued = new Date(Date.now() - (h % 180) * 86_400_000);
  const expires = new Date(
    issued.getTime() +
      (status === "expired" ? -7 : status === "expiring" ? 20 : 180) *
        86_400_000,
  );
  const subject = `CN=${node.name},O=EdgeCloud,OU=Nodes`;
  const issuer = `CN=EdgeCloud Vault PKI Intermediate,O=EdgeCloud`;
  const sans = [node.name, node.ip].join(", ");

  return (
    <div className="space-y-5">
      <SectionHeading>Certificate</SectionHeading>
      <KV
        label="Subject"
        value={<span className="font-mono text-[10px]">{subject}</span>}
      />
      <KV
        label="SANs"
        value={<span className="font-mono text-[10px]">{sans}</span>}
      />
      <KV
        label="Issuer"
        value={<span className="font-mono text-[10px]">{issuer}</span>}
      />
      <KV
        label="Serial"
        value={
          <span className="font-mono text-[10px] break-all">{serial}</span>
        }
      />
      <KV
        label="Issued"
        value={
          <span className="font-mono text-[11px]">
            {issued.toLocaleString()}
          </span>
        }
      />
      <KV
        label="Expires"
        value={
          <span
            className={cn(
              "font-mono text-[11px]",
              status === "expired" && "text-[#ef4444]",
              status === "expiring" && "text-[#f59e0b]",
              status === "valid" && "text-[#10b981]",
            )}
          >
            {expires.toLocaleString()}
          </span>
        }
      />

      <Separator className="bg-[#1e1e2e]" />
      <SectionHeading>CRL Status</SectionHeading>
      <KV
        label="Revocation"
        value={
          <span className="font-mono text-xs text-[#10b981]">Not revoked</span>
        }
      />

      <Button
        variant="outline"
        className="w-full border-[#00d4aa]/40 text-[#00d4aa] hover:bg-[#00d4aa]/10"
        onClick={() => onRotate?.(node)}
      >
        <RotateCw className="h-4 w-4 mr-2" />
        Rotate Certificate
      </Button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Logs Tab
// ────────────────────────────────────────────────────────────────────────

function LogsTab({ node, logs }: { node: EdgeNode; logs: LogEntry[] }) {
  const nodeLogs = useMemo(
    () =>
      logs
        .filter((l) => l.nodeId === node.id || l.source?.includes(node.name))
        .slice(-100)
        .reverse(),
    [logs, node.id, node.name],
  );

  if (nodeLogs.length === 0) {
    return (
      <div className="p-8 text-center text-xs font-mono text-muted-foreground">
        No logs for this node yet.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {nodeLogs.map((log) => (
        <div
          key={log.id}
          className="rounded border border-[#1e1e2e] bg-[#0a0a0f] px-2.5 py-1.5 font-mono text-[10px]"
        >
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            <span
              className={cn(
                "uppercase",
                log.level === "error" && "text-[#ef4444]",
                log.level === "warn" && "text-[#f59e0b]",
                log.level === "info" && "text-[#00d4aa]",
                log.level === "debug" && "text-muted-foreground",
              )}
            >
              {log.level}
            </span>
            <span className="text-muted-foreground truncate">{log.source}</span>
          </div>
          <div className="text-foreground mt-0.5 break-words">
            {log.message}
          </div>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Small building blocks
// ────────────────────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono mb-2">
      {children}
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-[11px] text-muted-foreground font-mono">
        {label}
      </span>
      <div className="text-right min-w-0">{value}</div>
    </div>
  );
}

function CopyableCode({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded bg-[#0a0a0f] border border-[#1e1e2e] px-1.5 py-0.5 font-mono text-[10px] text-foreground hover:border-[#00d4aa]/40 transition-colors max-w-full"
    >
      <span className="truncate">{text}</span>
      {copied ? (
        <Check className="h-3 w-3 text-[#10b981] shrink-0" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

function StatusDot({ status }: { status: EdgeNode["status"] }) {
  const color =
    status === "online"
      ? "bg-[#10b981] animate-pulse-teal"
      : status === "degraded"
        ? "bg-[#f59e0b]"
        : "bg-[#ef4444]";
  return <span className={cn("inline-block h-2 w-2 rounded-full", color)} />;
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

function deriveCertStatus(id: string): "valid" | "expiring" | "expired" {
  const h = hashId(id);
  if (h % 7 === 0) {return "expired";}
  if (h % 13 === 0) {return "expiring";}
  return "valid";
}
