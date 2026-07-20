# Edge-Cloud Orchestrator: UI Interactive Control & Stub Audit Table

This table catalogs all user-facing interactive elements across the dashboard, providing code trace paths, expected backend behaviors, step-by-step verification recipes, and integration status.

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
| **7** | **Governance & Policies** (`/policies`) | **Edit Policy** Icon Button | Launches policy editing modal and updates record in PostgreSQL. | `SELECT name FROM "scheduling_policies" WHERE id = '<id>';` | Hover over policy row, click `Edit` icon, update fields, save. | `SELECT name FROM "scheduling_policies" WHERE id = '<id>';` | Policy properties updated in database. | **REMEDIATED** |
| **8** | **Governance & Policies** (`/policies`) | **Delete Policy** Icon Button | Removes scheduling policy from PostgreSQL after confirmation. | `SELECT COUNT(*) FROM "scheduling_policies" WHERE id = '<id>';` | Hover over policy row, click `Delete` icon, confirm deletion. | `SELECT COUNT(*) FROM "scheduling_policies" WHERE id = '<id>';` | Policy record count becomes 0. | **REMEDIATED** |
| **9** | **Outbound Webhooks** (`/webhooks`) | **Register Webhook** Button (launches `RegisterWebhookModal`) | Creates `Webhook` subscription in PostgreSQL database. | `SELECT COUNT(*) FROM "Webhook";` | Click "Register Webhook", fill name/URL, click register. | `SELECT COUNT(*) FROM "Webhook";` | Webhook count increases by 1. | **PENDING USER VERIFICATION** |
| **10** | **Outbound Webhooks** (`/webhooks`) | **Test Webhook** Icon Button (Play icon in row) | Triggers diagnostic test event dispatch. | `SELECT COUNT(*) FROM "webhook_deliveries" WHERE "webhookId" = '<id>';` | Hover over webhook row, click `Play` icon. | `SELECT COUNT(*) FROM "webhook_deliveries" WHERE "webhookId" = '<id>';` | Webhook delivery record count increases by 1. | **REMEDIATED** |
| **11** | **Outbound Webhooks** (`/webhooks`) | **Edit Webhook** Icon Button (Edit2 icon in row) | Launches webhook configuration modal and updates record in PostgreSQL. | `SELECT name, url FROM "webhooks" WHERE id = '<id>';` | Hover over webhook row, click `Edit` icon, update fields, submit. | `SELECT name, url FROM "webhooks" WHERE id = '<id>';` | Webhook properties updated in database. | **REMEDIATED** |
| **12** | **Outbound Webhooks** (`/webhooks`) | **Delete Webhook** Icon Button (Trash2 icon in row) | Removes webhook subscription from PostgreSQL after confirmation. | `SELECT COUNT(*) FROM "webhooks" WHERE id = '<id>';` | Hover over webhook row, click `Trash` icon, confirm deletion. | `SELECT COUNT(*) FROM "webhooks" WHERE id = '<id>';` | Webhook record count becomes 0. | **REMEDIATED** |
| **13** | **System Alerts** (`/alerts`) | **Acknowledge** Check Button | Sets `acknowledgedAt` timestamp on the active alert. | `SELECT id, "acknowledgedAt" FROM "Alert" WHERE id = '<alert-id>';` | Click checkmark button next to `<alert-id>`. | `SELECT id, "acknowledgedAt" FROM "Alert" WHERE id = '<alert-id>';` | `acknowledgedAt` reflects current timestamp. | **PENDING USER VERIFICATION** |
| **14** | **ML Intelligence** (`/ml-intelligence`) | **Trigger Retrain** / **Global Retrain** Button | Dispatches retraining request to backend ML workers. | `SELECT status FROM "MLJob" ORDER BY "createdAt" DESC LIMIT 1;` | Click "Trigger Retrain" or "Global Retrain" button. | `SELECT status FROM "MLJob" ORDER BY "createdAt" DESC LIMIT 1;` | Stored job status changes to `RUNNING` or `QUEUED`. | **PENDING USER VERIFICATION** |
| **15** | **ML Intelligence** (`/ml-intelligence`) | **Start Session** Button (Federated Learning) | Creates a new active FL training epoch session. | `SELECT COUNT(*) FROM "FLSession";` | Click "Start Session" button under Federated Learning card. | `SELECT COUNT(*) FROM "FLSession";` | Session count increases by 1. | **PENDING USER VERIFICATION** |
| **16** | **ML Intelligence** (`/ml-intelligence`) | **Stop Session** Button (Federated Learning) | Aborts or completes the selected FL session. | `SELECT status FROM "FLSession" WHERE id = '<session-id>';` | Click "Stop Session" button next to `<session-id>`. | `SELECT status FROM "FLSession" WHERE id = '<session-id>';` | Session status transitions to `COMPLETED` or `CANCELLED`. | **PENDING USER VERIFICATION** |
| **17** | **Workflows** (`/workflows`) | **Create Workflow** Button (launches editor modal) | Persists new DAG definition to database. | `SELECT COUNT(*) FROM "workflows" WHERE "tenantId" = '<tenant-id>';` | Click "Create Workflow", input name/tasks, click submit. | `SELECT COUNT(*) FROM "workflows" WHERE "tenantId" = '<tenant-id>';` | Workflow record created in database. | **REMEDIATED** |
| **18** | **Workflows** (`/workflows`) | **Run Workflow (Preview)** Button (on Detail route) | Executes workflow execution sequence via Fastify engine. | `SELECT COUNT(*) FROM "WorkflowExecution";` | Navigate to workflow detail, click "Run Workflow (Preview)". | `SELECT COUNT(*) FROM "WorkflowExecution";` | Record count increases by 1. | **PENDING USER VERIFICATION** |
| **19** | **Workflows** (`/workflows`) | **Edit** Button (on Detail route) | Enables inline workflow renaming / structure editing. | `SELECT name, version FROM "workflows" WHERE id = '<id>';` | Click "Edit" button, modify workflow metadata, save changes. | `SELECT name, version FROM "workflows" WHERE id = '<id>';` | Workflow record updated in database. | **REMEDIATED** |
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
- **Policy Inventory CRUD**: The table row renders `Edit2` and `Trash2` buttons. These elements are visual-only, lacking any `onClick` logic or backing mutations.

### C. Outbound Webhooks
- **Registration**: Wired `RegisterWebhookModal` `onSubmit` to `createWebhookMutation` (`POST /v2/webhooks`) in `webhooks/page.tsx`.
- **Controls**: Row action buttons (`Play`, `Edit2`, `Trash2`) lack `onClick` triggers, meaning they fail to call `useTestWebhook`, `useUpdateWebhook`, or `useDeleteWebhook`.

### D. System Alerts
- **Acknowledge Alert**: Handled by `handleAcknowledge` in `alerts/page.tsx` (line 47), which triggers `acknowledgeMutation.mutateAsync(id)` mapping to `postV2AlertsByIdAcknowledge`.

### E. Workflows
- **Workflow Creation**: `CreateWorkflowModal` accepts DAG inputs but calls a stubbed submit function that only triggers client-side toast feedback.
- **Workflow Run**: Mapped in `workflows/[id]/page.tsx` (line 78) to `handleExecute`, executing a real POST request to `/api/v2/workflows/${id}/execute` to trigger the backend workflow engine.
