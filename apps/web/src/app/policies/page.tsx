"use client";

import { useState } from "react";
import {
  Shield,
  Plus,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit2,
  Search,
  Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PoliciesPage() {
  const [search, setSearch] = useState("");

  const policies = [
    {
      id: "pol-001",
      name: "Global Latency SLA",
      type: "LATENCY",
      target: "< 50ms",
      status: "active",
      nodes: 42,
      lastEvaluated: "2m ago",
    },
    {
      id: "pol-002",
      name: "Eco-First Optimization",
      type: "CARBON",
      target: "Min Intensity",
      status: "active",
      nodes: 128,
      lastEvaluated: "5m ago",
    },
    {
      id: "pol-003",
      name: "Critical Workload Affinity",
      type: "AFFINITY",
      target: "Region: US-East",
      status: "warning",
      nodes: 12,
      lastEvaluated: "1m ago",
    },
    {
      id: "pol-004",
      name: "Cost Guardrail",
      type: "COST",
      target: "< $0.05/hr",
      status: "inactive",
      nodes: 0,
      lastEvaluated: "N/A",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Governance Policies
          </h1>
          <p className="text-muted-foreground">
            Manage fleet-wide constraints and scheduling logic
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" /> Create Policy
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Active
              Constraints
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">14</div>
            <p className="text-xs text-muted-foreground mt-1">
              Applying to 182 edge nodes
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400" /> Policy
              Violations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3</div>
            <p className="text-xs text-muted-foreground mt-1">
              Drift detected in AP-South region
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-teal-400" /> Compliance Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-teal-400">98.2%</div>
            <p className="text-xs text-muted-foreground mt-1">
              +0.5% from last month
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Policy Inventory</CardTitle>
            <div className="flex gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter policies..."
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
                <TableHead>Policy Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Impact</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.map((policy) => (
                <TableRow key={policy.id} className="border-border/50 group">
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {policy.id}
                      </span>
                      <span className="font-medium">{policy.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {policy.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-teal-400">
                    {policy.target}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          policy.status === "active"
                            ? "bg-emerald-400"
                            : policy.status === "warning"
                              ? "bg-amber-400"
                              : "bg-muted-foreground/30"
                        }`}
                      />
                      <span className="capitalize text-sm">
                        {policy.status}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {policy.nodes} nodes
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
