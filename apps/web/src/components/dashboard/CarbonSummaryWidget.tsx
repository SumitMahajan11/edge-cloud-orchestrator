"use client";

import React, { useState } from "react";
import { useCarbonReport } from "@/hooks/useCarbonMetrics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import {
  Download,
  Leaf,
  AlertCircle,
  TrendingDown,
  Clock,
  Briefcase,
  Globe,
} from "lucide-react";

export function CarbonSummaryWidget() {
  const [days, setDays] = useState(30);

  const roundedNow = Math.floor(Date.now() / 30000) * 30000;
  const fromDate = new Date(roundedNow - days * 24 * 60 * 60 * 1000).toISOString();
  const toDate = new Date(roundedNow).toISOString();

  const { data, isLoading, error, downloadCsv } = useCarbonReport(fromDate, toDate);

  const handleDownload = async () => {
    try {
      await downloadCsv();
    } catch (err) {
      console.error("Failed to download CSV carbon report", err);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-slate-900/50 border-white/5 backdrop-blur-xl animate-pulse">
        <CardHeader>
          <div className="h-6 w-48 bg-slate-800 rounded mb-2" />
          <div className="h-4 w-64 bg-slate-800 rounded" />
        </CardHeader>
        <CardContent className="h-48 bg-slate-800/20 rounded-xl m-6" />
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-slate-900/50 border-destructive/20 backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="text-rose-400 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Failed to Load Carbon Report
          </CardTitle>
          <CardDescription>
            Could not retrieve compliance reporting data.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const summary = {
    totalGco2eq: data?.summary?.totalGco2eq ?? 0,
    totalBaselineGco2eq: data?.summary?.totalBaselineGco2eq ?? 0,
    totalSavedGco2eq: data?.summary?.totalSavedGco2eq ?? 0,
    totalDurationMs: data?.summary?.totalDurationMs ?? 0,
    totalTasks: data?.summary?.totalTasks ?? 0,
    deferredTasks: data?.summary?.deferredTasks ?? 0,
  };

  const workloads = Object.entries(data?.breakdown || {}).map(([type, stats]: [string, any]) => ({
    type,
    taskCount: stats?.taskCount ?? 0,
    totalDurationMs: stats?.totalDurationMs ?? 0,
    totalGco2eq: stats?.totalGco2eq ?? 0,
    totalSavedGco2eq: stats?.totalSavedGco2eq ?? 0,
  }));

  const savingsPct = summary.totalBaselineGco2eq > 0
    ? (summary.totalSavedGco2eq / summary.totalBaselineGco2eq) * 100
    : 0;

  return (
    <Card className="bg-slate-900/50 border-emerald-500/20 backdrop-blur-xl relative overflow-hidden group">
      {/* Background radial glow */}
      <div className="absolute -right-24 -top-24 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/15 transition-all duration-500 pointer-events-none" />

      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-6 border-b border-white/5">
        <div>
          <CardTitle className="text-xl font-bold flex items-center gap-2 text-white">
            <Leaf className="w-5 h-5 text-emerald-400 animate-pulse" />
            Carbon Attribution & Compliance
          </CardTitle>
          <CardDescription className="text-slate-400">
            Auditable per-tenant carbon footprint telemetry
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range buttons */}
          <div className="flex bg-slate-950/40 p-0.5 rounded-lg border border-white/5">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  days === d
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "text-slate-400 hover:text-slate-200 border border-transparent"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="border-emerald-500/20 hover:bg-emerald-500/10 text-emerald-400 gap-1.5 h-8 font-semibold transition-all hover:scale-[1.02]"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {/* Core numbers grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-950/30 border border-white/5">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
              <span>Carbon Saved</span>
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {summary.totalSavedGco2eq.toFixed(1)}
              <span className="text-xs ml-1 text-slate-400 font-sans font-normal">gCO2eq</span>
            </div>
            <span className="text-[10px] text-emerald-400/80 font-medium">
              -{savingsPct.toFixed(1)}% vs Baseline
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/30 border border-white/5">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Leaf className="w-3.5 h-3.5 text-slate-400" />
              <span>Actual Footprint</span>
            </div>
            <div className="text-2xl font-bold font-mono text-white">
              {summary.totalGco2eq.toFixed(1)}
              <span className="text-xs ml-1 text-slate-400 font-sans font-normal">gCO2eq</span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium">
              Based on live grid metrics
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/30 border border-white/5">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              <span>Baseline Footprint</span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-300">
              {summary.totalBaselineGco2eq.toFixed(1)}
              <span className="text-xs ml-1 text-slate-400 font-sans font-normal">gCO2eq</span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium">
              Naive scheduling baseline
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/30 border border-white/5">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>Deferred Execution</span>
            </div>
            <div className="text-2xl font-bold font-mono text-teal-400">
              {summary.deferredTasks}
              <span className="text-xs ml-1 text-slate-400 font-sans font-normal">/ {summary.totalTasks}</span>
            </div>
            <span className="text-[10px] text-slate-500 font-medium">
              Eco-deferred tasks shifted
            </span>
          </div>
        </div>

        {/* Workload Breakdown Section */}
        <div>
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-1.5">
            <Briefcase className="w-4 h-4 text-emerald-400" />
            Workload Attribution Breakdown
          </h3>

          <div className="rounded-xl border border-white/5 overflow-hidden bg-slate-950/20">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/40 border-b border-white/5 text-slate-400 font-medium uppercase tracking-wider">
                  <th className="p-3">Workload Type</th>
                  <th className="p-3 text-right">Tasks</th>
                  <th className="p-3 text-right">Total Duration</th>
                  <th className="p-3 text-right">Carbon Emitted</th>
                  <th className="p-3 text-right">Carbon Saved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {workloads.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-slate-500">
                      No workloads completed in this window.
                    </td>
                  </tr>
                ) : (
                  workloads.map((wl) => (
                    <tr key={wl.type} className="hover:bg-slate-800/10 transition-colors">
                      <td className="p-3 font-semibold text-slate-200">
                        {wl.type.replace(/_/g, " ")}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-300">
                        {wl.taskCount}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-300">
                        {wl.totalDurationMs >= 3600000
                          ? `${(wl.totalDurationMs / 3600000).toFixed(1)}h`
                          : wl.totalDurationMs >= 60000
                            ? `${(wl.totalDurationMs / 60000).toFixed(1)}m`
                            : `${(wl.totalDurationMs / 1000).toFixed(0)}s`}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-300">
                        {wl.totalGco2eq.toFixed(1)} <span className="text-[10px] text-slate-500">g</span>
                      </td>
                      <td className="p-3 text-right font-mono text-emerald-400">
                        {wl.totalSavedGco2eq > 0 ? `-${wl.totalSavedGco2eq.toFixed(1)}g` : "0.0g"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
