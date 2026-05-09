import React, { useState, useEffect } from 'react';
import { Leaf, Zap, Globe, ShieldCheck, Info, TrendingDown, Settings } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../ui/card';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

// Mock data for regions - in a real app, this would come from an API
const REGION_CARBON_DATA = [
  { id: 'us-west', name: 'US West', intensity: 180, status: 'low' },
  { id: 'us-east', name: 'US East', intensity: 420, status: 'high' },
  { id: 'eu-de', name: 'EU (Germany)', intensity: 350, status: 'medium' },
  { id: 'eu-fr', name: 'EU (France)', intensity: 60, status: 'optimal' },
  { id: 'ap-sg', name: 'Asia Pacific (SG)', intensity: 500, status: 'high' },
];

export const CarbonDashboard: React.FC = () => {
  const [isCarbonAware, setIsCarbonAware] = useState(true);
  const [cumulativeSavings, setCumulativeSavings] = useState(12450.8); // gCO2
  const [realTimeIntensity] = useState(245); // avg gCO2/kWh

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      if (isCarbonAware) {
        setCumulativeSavings(prev => prev + Math.random() * 0.5);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isCarbonAware]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'optimal': return 'text-emerald-400 bg-emerald-400/10';
      case 'low': return 'text-green-400 bg-green-400/10';
      case 'medium': return 'text-yellow-400 bg-yellow-400/10';
      case 'high': return 'text-rose-400 bg-rose-400/10';
      default: return 'text-slate-400 bg-slate-400/10';
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Control Card */}
        <Card className="md:col-span-2 bg-slate-900/50 border-emerald-500/20 backdrop-blur-xl">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold flex items-center gap-2">
                <Leaf className="w-6 h-6 text-emerald-400" />
                Carbon-Aware Orchestration
              </CardTitle>
              <CardDescription>
                Optimize workload placement based on grid carbon intensity
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 bg-slate-800/50 p-2 rounded-lg border border-white/5">
              <span className="text-sm font-medium text-slate-300">
                {isCarbonAware ? 'Enabled' : 'Disabled'}
              </span>
              <Switch 
                checked={isCarbonAware} 
                onCheckedChange={setIsCarbonAware}
                className="data-[state=checked]:bg-emerald-500"
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400/70">Total Carbon Saved</span>
                </div>
                <div className="text-3xl font-mono font-bold text-white">
                  {cumulativeSavings.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} 
                  <span className="text-sm ml-2 text-slate-400 font-sans font-normal">gCO2eq</span>
                </div>
                <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  Equivalent to 12.4kg of coal offsets
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-800/30 border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Current Grid Avg</span>
                </div>
                <div className="text-3xl font-mono font-bold text-white">
                  {realTimeIntensity}
                  <span className="text-sm ml-2 text-slate-400 font-sans font-normal">gCO2/kWh</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px]">
                    24% Lower vs 24h
                  </Badge>
                </div>
              </div>
            </div>

            {/* Region Map Visualization Placeholder */}
            <div className="mt-8 relative h-48 rounded-xl bg-slate-950/50 border border-white/5 overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center opacity-20">
                <Globe className="w-32 h-32 text-emerald-400" />
              </div>
              <div className="absolute inset-0 p-4">
                <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Global Intensity Map</div>
                <div className="flex flex-wrap gap-3">
                  {REGION_CARBON_DATA.map(region => (
                    <div 
                      key={region.id}
                      className={`px-3 py-1.5 rounded-full border text-xs font-medium flex items-center gap-2 backdrop-blur-md transition-all hover:scale-105 ${getStatusColor(region.status)} border-current/20`}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                      {region.name}: {region.intensity}g
                    </div>
                  ))}
                </div>
              </div>
              <div className="absolute bottom-2 right-4 flex items-center gap-2">
                <Info className="w-3 h-3 text-slate-500" />
                <span className="text-[10px] text-slate-500">Live data provided by Electricity Maps</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sidebar/Info Card */}
        <Card className="bg-slate-900/50 border-white/5">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Policy Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Carbon Weight</label>
              <div className="flex items-center gap-4">
                <div className="h-2 flex-1 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 w-[40%]" />
                </div>
                <span className="text-sm font-mono font-bold text-white">0.40</span>
              </div>
              <p className="text-[10px] text-slate-500 italic">
                Workloads prioritized for low-carbon zones within 2x latency threshold.
              </p>
            </div>

            <div className="pt-4 border-t border-white/5 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">API Status</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <div className="w-1 h-1 rounded-full bg-emerald-400" />
                  Connected
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Cache TTL</span>
                <span className="text-slate-200 font-mono">248s</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Grid Zones Tracked</span>
                <span className="text-slate-200 font-mono">12</span>
              </div>
            </div>

            <Button variant="outline" className="w-full mt-4 border-white/10 hover:bg-white/5 text-slate-300 gap-2">
              <Settings className="w-4 h-4" />
              Advanced Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
