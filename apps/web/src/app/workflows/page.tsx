"use client";

import { useState, useEffect } from "react";
import {
  Plus,
  Play,
  Info,
  MoreHorizontal,
  GitBranch,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { useWorkflows, useCreateWorkflow } from "@/hooks/useWorkflows";
import { isApiClientError } from "@edgecloud/api-client";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { CreateWorkflowModal } from "@/components/modals/CreateWorkflowModal";
import { useTenant } from "@/contexts/TenantContext";

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: "PENDING" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
  _count?: {
    executions: number;
  };
}

export default function WorkflowsPage() {
  const tenant = useTenant();
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { data, isLoading: loading, error } = useWorkflows();
  const createWorkflowMutation = useCreateWorkflow();
  const workflows = (data as any as Workflow[]) || [];


  useEffect(() => {
    if (error) {
      if (isApiClientError(error)) {
        if (error.isUnauthorized()) {
          router.push("/login");
          return;
        }
        toast.error(error.response.message);
      } else {
        toast.error("Failed to fetch workflows");
      }
    }
  }, [error, router]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return (
          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
            Active
          </Badge>
        );
      case "PENDING":
        return <Badge variant="secondary">Pending</Badge>;
      case "ARCHIVED":
        return <Badge variant="outline">Archived</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflows</h1>
          <p className="text-muted-foreground mt-1">
            Orchestrate complex DAG-based task sequences across edge nodes.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">
            <Info className="mr-2 h-4 w-4" />
            Documentation
          </Button>
          {tenant.isSuperAdmin && (
            <Button onClick={() => setIsModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Workflow
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <div className="flex items-center justify-between mb-6">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="all">All Workflows</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="all" className="mt-0">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-48 rounded-xl bg-card animate-pulse border border-border"
                />
              ))}
            </div>
          ) : workflows.length === 0 ? (
            <Card className="border-dashed border-2 bg-transparent">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <GitBranch className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">No workflows found</h3>
                <p className="text-muted-foreground text-center max-w-sm mt-2">
                  Create your first DAG-based workflow to start orchestrating
                  tasks efficiently across your edge infrastructure.
                </p>
                {tenant.isSuperAdmin && (
                  <Button className="mt-6" onClick={() => setIsModalOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Workflow
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {workflows.map((workflow) => (
                <Card
                  key={workflow.id}
                  className="group hover:border-primary/50 transition-colors"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <GitBranch className="h-5 w-5 text-primary" />
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem asChild>
                            <Link href={`/workflows/${workflow.id}`}>
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem>Duplicate</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive">
                            Archive
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="mt-4">
                      <CardTitle className="text-xl">{workflow.name}</CardTitle>
                      <CardDescription className="line-clamp-2 mt-1">
                        {workflow.description || "No description provided."}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>
                            Created{" "}
                            {formatDistanceToNow(new Date(workflow.createdAt))}{" "}
                            ago
                          </span>
                        </div>
                        {getStatusBadge(workflow.status)}
                      </div>
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground uppercase font-semibold">
                            Executions
                          </span>
                          <span className="text-lg font-bold">
                            {workflow._count?.executions || 0}
                          </span>
                        </div>
                        <div className="flex items-end justify-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full"
                            asChild
                          >
                            <Link href={`/workflows/${workflow.id}`}>
                              <Play className="mr-2 h-3.5 w-3.5" />
                              Execute
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      <CreateWorkflowModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async (data) => {
          try {
            await createWorkflowMutation.mutateAsync(data);
            toast.success("Workflow created successfully");
            setIsModalOpen(false);
          } catch (err: any) {
            toast.error(err.message || "Failed to create workflow");
          }
        }}
      />

    </div>
  );
}
