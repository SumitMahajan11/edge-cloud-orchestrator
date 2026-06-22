"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  Clock,
  Cpu,
  Globe,
  Plus,
  Search,
  Filter,
  BarChart3,
  Play,
  Pause,
  RotateCcw,
  Settings,
  MoreVertical,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTasks } from "@/hooks/useTasks";
import { useNodes } from "@/hooks/useNodes";
import { format } from "date-fns";
import { useEffect } from "react";
import { isApiClientError } from "@edgecloud/api-client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { SubmitTaskModal } from "@/components/modals/SubmitTaskModal";


export default function TaskSchedulerPage() {
  const router = useRouter();
  const {
    data: tasks = [],
    isLoading: tasksLoading,
    error: tasksError,
  } = useTasks();
  const { data: nodes = [], error: nodesError } = useNodes();
  const [search, setSearch] = useState("");
  const [isSubmitTaskModalOpen, setIsSubmitTaskModalOpen] = useState(false);


  useEffect(() => {
    const error = tasksError || nodesError;
    if (error) {
      if (isApiClientError(error)) {
        if (error.isUnauthorized()) {
          router.push("/login");
          return;
        }
        toast.error(error.response.message);
      } else {
        toast.error("Failed to load scheduler data");
      }
    }
  }, [tasksError, nodesError, router]);

  const stats = {
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => t.status === "running").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Task Scheduler
          </h1>
          <p className="text-muted-foreground">
            Orchestrate compute workloads across the edge
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <Settings className="h-4 w-4" /> Global Config
          </Button>
          <Button className="gap-2" onClick={() => setIsSubmitTaskModalOpen(true)}>
            <Plus className="h-4 w-4" /> New Task
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          title="Pending"
          value={stats.pending}
          color="text-amber-400"
          bg="bg-amber-500/10"
        />
        <StatusCard
          title="Running"
          value={stats.running}
          color="text-teal-400"
          bg="bg-teal-500/10"
        />
        <StatusCard
          title="Completed"
          value={stats.completed}
          color="text-emerald-400"
          bg="bg-emerald-500/10"
        />
        <StatusCard
          title="Failed"
          value={stats.failed}
          color="text-rose-400"
          bg="bg-rose-500/10"
        />
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Fleet Queue</CardTitle>
              <CardDescription>
                Real-time task scheduling and execution status
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter tasks..."
                  className="pl-8 h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button variant="outline" size="sm">
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead>Task ID / Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Target Node</TableHead>
                <TableHead>Resource Reqs</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasksLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10">
                    <div className="flex justify-center">
                      <RotateCcw className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : tasks.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-10 text-muted-foreground italic"
                  >
                    No active tasks in the queue.
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => (
                  <TableRow key={task.id} className="border-border/50 group">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-mono text-xs text-teal-400">
                          {task.id.slice(0, 8)}
                        </span>
                        <span className="font-medium">
                          {task.name || "Anonymous Task"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`gap-1.5 uppercase ${
                          task.status === "running"
                            ? "bg-teal-500/10 text-teal-400 border-teal-500/20"
                            : task.status === "completed"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : task.status === "failed"
                                ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }`}
                      >
                        {task.status === "running" && (
                          <div className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
                        )}
                        {task.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Globe className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm">
                          {task.nodeId
                            ? nodes.find((n) => n.id === task.nodeId)?.name ||
                              "Unknown"
                            : "Unassigned"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 w-24">
                        <div className="flex justify-between text-[10px] text-muted-foreground uppercase">
                          <span>CPU</span>
                          <span>{task.specs?.cpuCores || 0} Core</span>
                        </div>
                        <Progress
                          value={(task.specs?.cpuCores || 0) * 10}
                          className="h-1"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(task.submittedAt), "MMM dd, HH:mm")}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="gap-2">
                            <BarChart3 className="h-4 w-4" /> View Metrics
                          </DropdownMenuItem>
                          {task.status === "running" && (
                            <DropdownMenuItem className="gap-2 text-rose-400">
                              <Pause className="h-4 w-4" /> Terminate
                            </DropdownMenuItem>
                          )}
                          {task.status === "pending" && (
                            <DropdownMenuItem className="gap-2">
                              <Play className="h-4 w-4" /> Force Execute
                            </DropdownMenuItem>
                          )}
                          {(task.status === "failed" ||
                            task.status === "completed") && (
                            <DropdownMenuItem className="gap-2">
                              <RotateCcw className="h-4 w-4" /> Retry
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SubmitTaskModal
        isOpen={isSubmitTaskModalOpen}
        onClose={() => setIsSubmitTaskModalOpen(false)}
      />
    </div>
  );
}

function StatusCard({
  title,
  value,
  color,
  bg,
}: {
  title: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-tight">
            {title}
          </div>
          <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
        </div>
        <div className={`p-3 rounded-xl ${bg}`}>
          {title === "Pending" && <Clock className={`h-5 w-5 ${color}`} />}
          {title === "Running" && <Activity className={`h-5 w-5 ${color}`} />}
          {title === "Completed" && (
            <CheckCircle2 className={`h-5 w-5 ${color}`} />
          )}
          {title === "Failed" && <AlertCircle className={`h-5 w-5 ${color}`} />}
        </div>
      </CardContent>
    </Card>
  );
}

function Activity({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
