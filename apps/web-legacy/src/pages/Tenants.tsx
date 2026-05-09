import { useState } from 'react'
import { 
  Users, 
  Building2, 
  Plus, 
  Search, 
  MoreHorizontal, 
  ShieldCheck, 
  Lock,
  Database,
  Settings
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { useTenant } from '../contexts/TenantContext'
import { cn } from '../lib/utils'
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu"
import { DrawerPanel } from '../components/shared/DrawerPanel'

export function Tenants() {
  const { availableTenants, setActiveTenantId, tenantId: activeTenantId } = useTenant()
  const [search, setSearch] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)

  const filteredTenants = availableTenants.filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase()) || 
    t.id.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-card p-6 rounded-xl border border-border gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-xl">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Tenant Management</h2>
            <p className="text-muted-foreground text-sm">Control multi-tenant fleet isolation and global resource quotas</p>
          </div>
        </div>
        
        <Button onClick={() => setIsAddOpen(true)} className="gap-2 h-11 px-6 font-bold">
          <Plus className="h-4 w-4" />
          Provision Tenant
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {[
          { label: 'Total Tenants', value: availableTenants.length, icon: Building2, color: 'text-primary' },
          { label: 'Active Users', value: '1,242', icon: Users, color: 'text-blue-500' },
          { label: 'Resource Quota', value: '85%', icon: Database, color: 'text-amber-500' },
        ].map((stat) => (
          <div key={stat.label} className="bg-card p-6 rounded-xl border border-border flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">{stat.label}</p>
              <p className="text-2xl font-black font-mono text-foreground">{stat.value}</p>
            </div>
            <div className="p-2 bg-secondary/50 rounded-lg">
              <stat.icon className={cn("h-5 w-5", stat.color)} />
            </div>
          </div>
        ))}
      </div>

      {/* List Actions */}
      <div className="bg-card p-4 rounded-xl border border-border">
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by tenant name or identifier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-secondary/30 border-border/50 h-11"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/30 border-b border-border/50">
              <tr className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                <th className="text-left p-4">Organization / ID</th>
                <th className="text-left p-4">Nodes</th>
                <th className="text-left p-4">Tasks / Day</th>
                <th className="text-left p-4">SLA Status</th>
                <th className="text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredTenants.map((tenant) => (
                <tr 
                  key={tenant.id} 
                  className={cn(
                    "group hover:bg-white/5 transition-colors",
                    activeTenantId === tenant.id && "bg-primary/[0.03]"
                  )}
                >
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center border border-border">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold text-foreground flex items-center gap-2">
                          {tenant.name}
                          {activeTenantId === tenant.id && (
                            <Badge className="h-4 text-[8px] bg-primary/20 text-primary border-none font-black uppercase">ACTIVE</Badge>
                          )}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground uppercase">{tenant.id}</span>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5 font-mono text-xs">
                      <span className="font-bold text-foreground">12</span>
                      <span className="text-muted-foreground">/ 50</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="text-xs font-mono">1.4k</span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                      <span className="text-xs font-bold text-emerald-500 uppercase">Premium</span>
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                       <Button 
                         variant="ghost" 
                         size="sm" 
                         className={cn("text-[10px] font-bold uppercase", activeTenantId === tenant.id ? "text-primary" : "text-muted-foreground")}
                         onClick={() => setActiveTenantId(tenant.id)}
                         disabled={activeTenantId === tenant.id}
                       >
                         {activeTenantId === tenant.id ? "Current Context" : "Switch To"}
                       </Button>
                       <DropdownMenu>
                         <DropdownMenuTrigger asChild>
                           <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                             <MoreHorizontal className="h-4 w-4" />
                           </Button>
                         </DropdownMenuTrigger>
                         <DropdownMenuContent align="end" className="w-56">
                           <DropdownMenuLabel className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">Admin Actions</DropdownMenuLabel>
                           <DropdownMenuItem className="gap-2">
                             <Users className="h-4 w-4" />
                             Manage Users
                           </DropdownMenuItem>
                           <DropdownMenuItem className="gap-2">
                             <Settings className="h-4 w-4" />
                             Quota Settings
                           </DropdownMenuItem>
                           <DropdownMenuSeparator />
                           <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive">
                             <Lock className="h-4 w-4" />
                             Suspend Tenant
                           </DropdownMenuItem>
                         </DropdownMenuContent>
                       </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Provisioning Drawer */}
      <DrawerPanel
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Provision New Tenant"
        description="Initialize a secure, isolated compute namespace"
        width="sm"
      >
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Organization Name</label>
              <Input placeholder="Acme Global Inc." className="bg-secondary/30 border-border/50 h-10" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Plan Tier</label>
              <div className="grid grid-cols-2 gap-3">
                 <button className="p-3 rounded-lg border border-primary bg-primary/5 text-left transition-all">
                    <p className="text-xs font-bold text-foreground">Standard</p>
                    <p className="text-[10px] text-muted-foreground">10 Nodes · Shared</p>
                 </button>
                 <button className="p-3 rounded-lg border border-border bg-secondary/20 text-left hover:border-primary/50 transition-all">
                    <p className="text-xs font-bold text-foreground">Premium</p>
                    <p className="text-[10px] text-muted-foreground">50 Nodes · Dedicated</p>
                 </button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Region Locality</label>
              <div className="flex flex-wrap gap-2">
                 {['US_EAST', 'EU_WEST', 'APAC_SOUTH'].map(r => (
                   <Badge key={r} variant="outline" className="h-6 px-2 text-[9px] font-mono cursor-pointer hover:border-primary/50">{r}</Badge>
                 ))}
              </div>
            </div>
          </div>

          <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl space-y-3">
             <div className="flex items-center gap-2 text-primary">
                <ShieldCheck className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-widest">Security isolation</span>
             </div>
             <p className="text-[10px] text-muted-foreground leading-relaxed">
               Provisioning will generate a dedicated mTLS root CA and isolate all Redis stream namespaces for this tenant.
             </p>
          </div>

          <div className="flex gap-4 pt-4">
            <Button className="flex-1 h-11 font-bold" onClick={() => setIsAddOpen(false)}>Initialize Tenant</Button>
          </div>
        </div>
      </DrawerPanel>
    </div>
  )
}

