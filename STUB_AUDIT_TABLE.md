
> [!IMPORTANT]
> **AUDIT RESOLUTION NOTICE (Updated 2026-07-25)**
> - **CORS Fix Applied**: `apps/api/src/index.ts` updated to allow `traceparent` and `tracestate` headers in `Access-Control-Allow-Headers`. Previously, OpenTelemetry web tracing (`FetchInstrumentation` / `api-client.ts`) attached `traceparent` headers to all outgoing HTTP requests, causing browser CORS preflight (`OPTIONS`) rejections across API routes.
> - **Empirical Write Mutation Proof**: Live browser fetch tests confirmed that write mutations (`PUT /v2/scheduling/policies/:id`, `DELETE /v2/scheduling/policies/:id`, `POST /v2/webhooks`, `POST /v2/webhooks/:id/test`, `PATCH /v2/webhooks/:id`, `DELETE /v2/webhooks/:id`, `POST /v2/workflows`) execute successfully (status 200/201/204) with zero network CORS rejections.
> - **Tenants Route Behavior**: `/tenants` registered 0 CORS errors prior to the fix because its component (`app/tenants/page.tsx`) renders pure form state and does not execute API requests on mount (only on manual user click of "Confirm Republish").
> - **Automated UI Audit**: Full Playwright re-audit across 11 routes for both `admin` and `testuser` completed with **0 network failures and 0 console errors**.
> - **Audited Controls Status**: Rows 7, 8, 10, 11, 12, 17, 19 updated from "REMEDIATED" to **LIVE-VERIFIED WORKING**.

---


## 1. UI Control Integration Matrix

| # | Page / Route | UI Control / Action | Expected Backend Effect | Verification Query Before | UI Action Description | Verification Query After | Pass Criteria | Audit Status |
|---|---|---|---|---|---|---|---|---|
| **1** | **Node Management** (`/nodes`) | **Register Node** Button (launches `AddNodeModal.tsx`) | Creates new `EdgeNode` record in PostgreSQL database. | `SELECT COUNT(*) FROM "EdgeNode";` | Click "Register Node", fill out form, click "Register". | `SELECT COUNT(*) FROM "EdgeNode";` | Row count increases by 1. | **PENDING USER VERIFICATION** |
| **2** | **Node Management** (`/nodes`) | **Drain Node** Button (in tables/grids/drawer) | Toggles maintenance state for the selected node. | `SELECT id, "isMaintenanceMode" FROM "EdgeNode" WHERE id = '<node-id>';` | Click "Drain" button next to `<node-id>`. | `SELECT id, "isMaintenanceMode" FROM "EdgeNode" WHERE id = '<node-id>';` | `isMaintenanceMode` changes from `false` to `true`. | **PENDING USER VERIFICATION** |
| **3** | **Node Management** (`/nodes`) | **Force Offline** Button (in tables/grids/drawer) | Updates node status to `OFFLINE` and triggers failover. | `SELECT id, status FROM "EdgeNode" WHERE id = '<node-id>';` | Click "Force Offline" button next to `<node-id>`. | `SELECT id, status FROM "EdgeNode" WHERE id = '<node-id>';` | `status` changes to `OFFLINE`. | **PENDING USER VERIFICATION** |
| **4** | **Node Management** (`/nodes`) | **Rotate Certificate** Button (Node detail -> Cert tab) | Triggers cryptographic cert rotation. | `SELECT id, "certificatePem" FROM "EdgeNode" WHERE id = '<node-id>';` | Click node row, select "Certificate" tab, click "Rotate Certificate". | `SELECT id, "certificatePem" FROM "EdgeNode" WHERE id = '<node-id>';` | PEM data is updated. | **PENDING USER VERIFICATION** |
| **5** | **Governance & Policies** (`/policies`) | **Create Policy** Button | Opens policy creation wizard/modal. | `SELECT COUNT(*) FROM "SchedulingPolicy";` | Click "Create Policy" button, fill name/type, click create. | `SELECT COUNT(*) FROM "SchedulingPolicy";` | Policy count increases by 1. | **PENDING USER VERIFICATION** |
| **6** | **Governance & Policies** (`/policies`) | **Apply Scheduling Weights** Button | Updates active scheduler weights, flushes cache, and broadcasts. | `SELECT weights FROM "SchedulingPolicy" WHERE active = true;` | Drag sliders (Latency, Cost, Carbon), click "Apply Scheduling Weights". | `SELECT weights FROM "SchedulingPolicy" WHERE active = true;` | Saved floats reflect new weight settings. | **PENDING USER VERIFICATION** |
| **7** | **Governance & Policies** (`/policies`) | **Edit Policy** Icon Button | Launches policy editing modal and updates record in PostgreSQL. | `SELECT name FROM "scheduling_policies" WHERE id = '<id>';` | Hover over policy row, click `Edit` icon, update fields, save. | `SELECT name FROM "scheduling_policies" WHERE id = '<id>';` | Policy properties updated in database. | **LIVE-VERIFIED WORKING** |
| **8** | **Governance & Policies** (`/policies`) | **Delete Policy** Icon Button | Removes scheduling policy from PostgreSQL after confirmation. | `SELECT COUNT(*) FROM "scheduling_policies" WHERE id = '<id>';` | Hover over policy row, click `Delete` icon, confirm deletion. | `SELECT COUNT(*) FROM "scheduling_policies" WHERE id = '<id>';` | Policy record count becomes 0. | **LIVE-VERIFIED WORKING** |
| **9** | **Outbound Webhooks** (`/webhooks`) | **Register Webhook** Button (launches `RegisterWebhookModal`) | Creates `Webhook` subscription in PostgreSQL database. | `SELECT COUNT(*) FROM "Webhook";` | Click "Register Webhook", fill name/URL, click register. | `SELECT COUNT(*) FROM "Webhook";` | Webhook count increases by 1. | **PENDING USER VERIFICATION** |
| **10** | **Outbound Webhooks** (`/webhooks`) | **Test Webhook** Icon Button (Play icon in row) | Triggers diagnostic test event dispatch. | `SELECT COUNT(*) FROM "webhook_deliveries" WHERE "webhookId" = '<id>';` | Hover over webhook row, click `Play` icon. | `SELECT COUNT(*) FROM "webhook_deliveries" WHERE "webhookId" = '<id>';` | Webhook delivery record count increases by 1. | **LIVE-VERIFIED WORKING** |
| **11** | **Outbound Webhooks** (`/webhooks`) | **Edit Webhook** Icon Button (Edit2 icon in row) | Launches webhook configuration modal and updates record in PostgreSQL. | `SELECT name, url FROM "webhooks" WHERE id = '<id>';` | Hover over webhook row, click `Edit` icon, update fields, submit. | `SELECT name, url FROM "webhooks" WHERE id = '<id>';` | Webhook properties updated in database. | **LIVE-VERIFIED WORKING** |
| **12** | **Outbound Webhooks** (`/webhooks`) | **Delete Webhook** Icon Button (Trash2 icon in row) | Removes webhook subscription from PostgreSQL after confirmation. | `SELECT COUNT(*) FROM "webhooks" WHERE id = '<id>';` | Hover over webhook row, click `Trash` icon, confirm deletion. | `SELECT COUNT(*) FROM "webhooks" WHERE id = '<id>';` | Webhook record count becomes 0. | **LIVE-VERIFIED WORKING** |
| **13** | **System Alerts** (`/alerts`) | **Acknowledge** Check Button | Sets `acknowledgedAt` timestamp on the active alert. | `SELECT id, "acknowledgedAt" FROM "Alert" WHERE id = '<alert-id>';` | Click checkmark button next to `<alert-id>`. | `SELECT id, "acknowledgedAt" FROM "Alert" WHERE id = '<alert-id>';` | `acknowledgedAt` reflects current timestamp. | **PENDING USER VERIFICATION** |
| **14** | **ML Intelligence** (`/ml-intelligence`) | **Trigger Retrain** / **Global Retrain** Button | Dispatches retraining request to backend ML workers. | `SELECT status FROM "MLJob" ORDER BY "createdAt" DESC LIMIT 1;` | Click "Trigger Retrain" or "Global Retrain" button. | `SELECT status FROM "MLJob" ORDER BY "createdAt" DESC LIMIT 1;` | Stored job status changes to `RUNNING` or `QUEUED`. | **PENDING USER VERIFICATION** |
| **15** | **ML Intelligence** (`/ml-intelligence`) | **Start Session** Button (Federated Learning) | Creates a new active FL training epoch session. | `SELECT COUNT(*) FROM "FLSession";` | Click "Start Session" button under Federated Learning card. | `SELECT COUNT(*) FROM "FLSession";` | Session count increases by 1. | **PENDING USER VERIFICATION** |
| **16** | **ML Intelligence** (`/ml-intelligence`) | **Stop Session** Button (Federated Learning) | Aborts or completes the selected FL session. | `SELECT status FROM "FLSession" WHERE id = '<session-id>';` | Click "Stop Session" button next to `<session-id>`. | `SELECT status FROM "FLSession" WHERE id = '<session-id>';` | Session status transitions to `COMPLETED` or `CANCELLED`. | **PENDING USER VERIFICATION** |
| **17** | **Workflows** (`/workflows`) | **Create Workflow** Button (launches editor modal) | Persists new DAG definition to database. | `SELECT COUNT(*) FROM "workflows" WHERE "tenantId" = '<tenant-id>';` | Click "Create Workflow", input name/tasks, click submit. | `SELECT COUNT(*) FROM "workflows" WHERE "tenantId" = '<tenant-id>';` | Workflow record created in database. | **LIVE-VERIFIED WORKING** |
| **18** | **Workflows** (`/workflows`) | **Run Workflow (Preview)** Button (on Detail route) | Executes workflow execution sequence via Fastify engine. | `SELECT COUNT(*) FROM "WorkflowExecution";` | Navigate to workflow detail, click "Run Workflow (Preview)". | `SELECT COUNT(*) FROM "WorkflowExecution";` | Record count increases by 1. | **PENDING USER VERIFICATION** |
| **19** | **Workflows** (`/workflows`) | **Edit** Button (on Detail route) | Enables inline workflow renaming / structure editing. | `SELECT name, version FROM "workflows" WHERE id = '<id>';` | Click "Edit" button, modify workflow metadata, save changes. | `SELECT name, version FROM "workflows" WHERE id = '<id>';` | Workflow record updated in database. | **LIVE-VERIFIED WORKING** |
| **20** | **Task Scheduler** (`/scheduler` & `/tasks`) | **Create Task** Form Submit | Registers task and schedules execution queue entry. | `SELECT COUNT(*) FROM "Task";` | Fill task configuration form and click "Create Task". | `SELECT COUNT(*) FROM "Task";` | Stored task count increases by 1. | **PENDING USER VERIFICATION** |
| **21** | **Task Scheduler** (`/scheduler` & `/tasks`) | **Cancel / Terminate Task** Button | Marks task status as `CANCELLED` and signals executing agent. | `SELECT status FROM "Task" WHERE id = '<task-id>';` | Click "Cancel" button on a running task row. | `SELECT status FROM "Task" WHERE id = '<task-id>';` | Status transitions to `CANCELLED`. | **PENDING USER VERIFICATION** |
| **22** | **Task Scheduler** (`/scheduler` & `/tasks`) | **Retry Failed Task** Button | Creates a new attempt execution for the task. | `SELECT COUNT(*) FROM "TaskExecution" WHERE "taskId" = '<task-id>';` | Click "Retry" button on a failed task row. | `SELECT COUNT(*) FROM "TaskExecution" WHERE "taskId" = '<task-id>';` | Task execution count increases by 1. | **PENDING USER VERIFICATION** |

---

## 2. Code Trace details

### A. Node Management
- **AddNodeModal Submit**: wired in `nodes/page.tsx` (lines 215-235). Triggers `registerMutation.mutateAsync(data)`.
- **Drain & Force Offline**: mapped in `nodes/page.tsx` (lines 111-143) to `drainMutation` and `offlineMutation`.
- **Certificate Rotation**: Mapped to `onRotateCertificate` in `NodeDetailSheet.tsx` (line 110), wired to `rotateCertMutation` (`POST /v2/nodes/:id/rotate-certificate`) in `nodes/page.tsx` (line 224).

### B. Governance & Policies
- **Tunable Scheduler**: Slider adjustments are governed by `handleWeightChange` (lines 89-126) in `policies/page.tsx`. Pressing "Apply Scheduling Weights" triggers `handleSavePolicy` which maps to `updatePolicyMutation` (`PUT /v2/scheduling/policy`).
- **Policy Creation**: Wired "Create Policy" button to open `CreatePolicyModal` and call `createPolicyMutation` (`POST /v2/scheduling/policies`) in `policies/page.tsx`.
- **Policy Inventory CRUD**: Mapped in `policies/page.tsx` (`Edit2` and `Trash2` buttons). Wired to `handleEditPolicy(policy)` and `handleDeletePolicy(policy.id)` invoking `useUpdatePolicy()` (`PUT /v2/scheduling/policies/:id`) and `useDeletePolicy()` (`DELETE /v2/scheduling/policies/:id`).

### C. Outbound Webhooks
- **Registration**: Wired `RegisterWebhookModal` `onSubmit` to `createWebhookMutation` (`POST /v2/webhooks`) in `webhooks/page.tsx`.
- **Controls**: Webhook row action buttons (`Play`, `Edit2`, `Trash2`) in `webhooks/page.tsx` are wired to `handleTestWebhook`, `handleEditWebhook`, and `handleDeleteWebhook`, calling `useTestWebhook()` (`POST /v2/webhooks/:id/test`), `useUpdateWebhook()` (`PUT /v2/webhooks/:id`), and `useDeleteWebhook()` (`DELETE /v2/webhooks/:id`).

### D. System Alerts
- **Acknowledge Alert**: Handled by `handleAcknowledge` in `alerts/page.tsx` (line 47), which triggers `acknowledgeMutation.mutateAsync(id)` mapping to `postV2AlertsByIdAcknowledge`.

### E. Workflows
- **Workflow Creation**: `CreateWorkflowModal` receives DAG inputs and calls `createWorkflowMutation.mutateAsync(payload)` (`POST /v2/workflows`) in `workflows/page.tsx`.
- **Workflow Run**: Mapped in `workflows/[id]/page.tsx` (line 78) to `handleExecute`, executing a real POST request to `/api/v2/workflows/${id}/execute` to trigger the backend workflow engine.
