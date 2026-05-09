You are working on the Edge-Cloud Orchestrator monorepo.

CONFIRMED FROM AUDIT:
154/154 tests pass. But the audit noted: "we lack tests that would have
caught the admin.ts dynamic import crash." The new features added in
the last sprint — workflow engine, admin republish, ML endpoints, carbon
endpoints, circuit breaker endpoints — have no dedicated tests.

TASK:
1. Check current test coverage:
   pnpm test --coverage 2>&1 | tail -30
   Note which files have < 80% coverage.

2. Write tests for each new feature:

FILE: apps/api/src/__tests__/workflows.test.ts
   Test 1 — Create workflow with valid DAG
     POST /api/v2/workflows with a 3-node DAG
     Assert: 201 response, workflow ID returned, models in DB
   
   Test 2 — Reject workflow with cycle
     POST /api/v2/workflows with a DAG containing a cycle (A→B→C→A)
     Assert: 400 response, error message mentions "cycle"
   
   Test 3 — Execute workflow runs steps in order
     Create a 2-step workflow (step2 depends on step1)
     Execute it
     Assert: step1 task created first, step2 only created after step1 completes
   
   Test 4 — Workflow tenant isolation
     Create workflow as tenant A
     Try to execute as tenant B
     Assert: 404 response

FILE: apps/api/src/__tests__/admin-republish.test.ts
   Test 1 — Republish valid task event
     Create a task in DB
     POST /api/v2/admin/events/republish with taskId
     Assert: 200, Kafka publish was called, AuditLog entry created
   
   Test 2 — Republish nonexistent entity returns 404
     POST with entityId that doesn't exist
     Assert: 404 response
   
   Test 3 — Non-admin cannot republish
     Use USER role token
     Assert: 403 response
   
   Test 4 — Dynamic import path works (regression test for the bug)
     Call the endpoint and confirm it does NOT throw "Cannot find module"
     This test would have caught the bug before shipping.

FILE: apps/api/src/__tests__/ml-endpoints.test.ts
   Test 1 — GET /api/v2/ml/drift/current returns valid schema
     Assert: response has driftScore (number 0-1), isDrifting (boolean)
   
   Test 2 — GET /api/v2/ml/drift/history returns array
     Assert: array of objects with timestamp and driftScore
   
   Test 3 — POST /api/v2/ml/retrain requires ML_RETRAIN permission
     USER token → 403
     TENANT_ADMIN token → 200

FILE: apps/api/src/__tests__/carbon-endpoints.test.ts
   Test 1 — GET /api/v2/carbon/intensity returns regions array
   Test 2 — PATCH /api/v2/carbon/policy validates carbonWeight range (0-1)
     Assert: carbonWeight: 1.5 → 400 validation error
     Assert: carbonWeight: 0.4 → 200 success
   Test 3 — Carbon policy requires CARBON_POLICY_WRITE permission

3. For the broken import regression, add a smoke test to CI:
   In .github/workflows/ci.yml, add a step after unit tests:
   
   - name: API smoke test (catch broken imports)
     run: |
       # Start the API
       NODE_ENV=test node apps/api/dist/index.js &
       sleep 5
       # Hit every registered route to catch module-not-found errors
       curl -f http://localhost:3090/health/live
       curl -f http://localhost:3090/health/ready
       # The admin route that was broken:
       curl -o /dev/null -w "%{http_code}" \
         http://localhost:3090/api/v2/admin/events/republish \
         -X POST -H "Content-Type: application/json" \
         -d '{"eventType":"test","entityId":"test"}' \
         | grep -v "^0$"  # any response (even 401/403) means no crash
       kill %1
   
   This catches import path bugs before they reach production.

4. Run all new tests:
   pnpm test 2>&1 | tail -20
   Target: all new tests pass, total test count increases from 154
   to at least 180.

5. Commit:
   git commit -m "test: add coverage for workflow engine, admin republish, ML and carbon endpoints""use client"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import { useTenant } from '../../contexts/TenantContext'
import { apiClient } from '../../lib/api-client'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Terminal } from 'lucide-react'
import { isApiClientError } from '@edgecloud/api-client'

export default function TenantsPage() {
  const tenant = useTenant()

  const [eventType, setEventType] = useState('task.created')
  const [mode, setMode] = useState<'single' | 'range'>('single')
  const [entityId, setEntityId] = useState('')
  const [fromTime, setFromTime] = useState('')
  const [toTime, setToTime] = useState('')
  const [dryRun, setDryRun] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  if (!tenant.isSuperAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p>You must be a SUPER_ADMIN to view this page.</p>
      </div>
    )
  }

  const handleRepublish = async () => {
    setShowConfirm(false)
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      if (mode === 'single') {
        const res = await apiClient.post('/api/v2/admin/events/republish', {
          eventType,
          entityId
        })
        setResult(`Successfully republished event to topic ${res.data.topic}`)
      } else {
        const res = await apiClient.post('/api/v2/admin/events/republish-range', {
          eventType,
          fromTimestamp: new Date(fromTime).toISOString(),
          toTimestamp: new Date(toTime).toISOString(),
          dryRun
        })
        if (dryRun) {
          setResult(`Dry run found ${res.data.count} events to republish. Preview: ${JSON.stringify(res.data.events, null, 2)}`)
        } else {
          setResult(`${res.data.published} events republished successfully. ${res.data.failed} failed. Errors: ${JSON.stringify(res.data.errors)}`)
        }
      }
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        // We do not have router in this component, so we just set error state
        setError(error.response.message || 'An error occurred');
      } else {
        setError(error instanceof Error ? error.message : 'An unexpected error occurred');
        console.error('Unexpected error in tenants page:', error);
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Tenants & Administration</h1>
        <p className="text-muted-foreground mt-2">Manage tenants and perform system recovery operations.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event Replay</CardTitle>
          <CardDescription>
            Republish lost events to Kafka for testing or recovery purposes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Event Type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger>
                <SelectValue placeholder="Select event type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="task.created">Task Created</SelectItem>
                <SelectItem value="node.registered">Node Registered</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Replay Mode</Label>
            <Select value={mode} onValueChange={(val: any) => setMode(val)}>
              <SelectTrigger>
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single Entity</SelectItem>
                <SelectItem value="range">Time Range (Bulk)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'single' ? (
            <div className="space-y-2">
              <Label>Entity ID</Label>
              <Input 
                placeholder="Enter task ID or node ID..." 
                value={entityId} 
                onChange={e => setEntityId(e.target.value)} 
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Time (Local)</Label>
                <Input 
                  type="datetime-local" 
                  value={fromTime} 
                  onChange={e => setFromTime(e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>To Time (Local)</Label>
                <Input 
                  type="datetime-local" 
                  value={toTime} 
                  onChange={e => setToTime(e.target.value)} 
                />
              </div>
              <div className="flex items-center space-x-2 col-span-2 pt-2">
                <Switch 
                  id="dry-run" 
                  checked={dryRun} 
                  onCheckedChange={setDryRun} 
                />
                <Label htmlFor="dry-run">Dry Run (Show count only)</Label>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-border">
            {!showConfirm ? (
              <Button 
                onClick={() => setShowConfirm(true)} 
                disabled={loading || (mode === 'single' && !entityId) || (mode === 'range' && (!fromTime || !toTime))}
              >
                Prepare Republish
              </Button>
            ) : (
              <div className="space-y-4">
                <Alert className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                  <Terminal className="h-4 w-4" />
                  <AlertTitle>Warning</AlertTitle>
                  <AlertDescription>
                    Are you sure you want to republish these events? This will trigger downstream systems.
                  </AlertDescription>
                </Alert>
                <div className="flex space-x-4">
                  <Button variant="destructive" onClick={handleRepublish} disabled={loading}>
                    {loading ? 'Republishing...' : 'Confirm Republish'}
                  </Button>
                  <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={loading}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {result && (
            <Alert className="bg-green-500/10 text-green-600 border-green-500/20">
              <AlertTitle>Result</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">{result}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
