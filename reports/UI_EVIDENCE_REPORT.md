# UI Evidence Report

## Part 1: Application Routing & Component Readiness Audit
This section categorizes the state of all defined application paths within the Edge-Cloud Orchestrator UI based on a full browser-driven audit.

| Path | Observed State | Notes |
| :--- | :--- | :--- |
| `/` (Home) | **Blank Layout** | The root path renders an empty layout structure without a landing page or redirect. |
| `/login` | **Functional** | Login page renders correctly; authentication functionality is intact. |
| `/alerts` | **Functional** | The alerts dashboard is fully built and renders active alerts. |
| `/logs` | **Functional** | The system logs viewer is fully built and displays log entries. |
| `/ml-intelligence` | **Functional** | The ML Intelligence dashboard is fully built with functional UI elements. |
| `/monitoring` | **Functional** | The system monitoring dashboard is fully built. |
| `/nodes` | **Stub (Empty State)** | The layout and navigation load, but the primary content area is an empty placeholder or stub. |
| `/policies` | **Functional (Partial)** | The page renders correctly and displays current policies. The weights slider works, but Create/Edit/Delete actions are currently unresponsive in the frontend UI. |
| `/scheduler` | **Stub (Empty State)** | The layout is present, but the page content is an empty placeholder/stub. |
| `/tenants` | **Functional** | The tenant management dashboard is fully built. |
| `/webhooks` | **Functional** | The webhook configuration page is fully built. |
| `/workflows` | **Stub (Empty State)** | The layout is present, but the primary view is an empty placeholder/stub. |

## Part 2: Governance & Scheduling Policies Network Evidence

### Pre-Interaction DB State (Baseline)
The active database policies immediately prior to UI interaction, captured via direct PostgreSQL query:
```text
                  id                  |                               name                               |  type   | isActive |        createdAt        
--------------------------------------+------------------------------------------------------------------+---------+----------+-------------------------
 4d4d9a81-5575-4fa2-9a63-d4afbdcb3d49 | Cost Guardrail - 35540afc-0844-420f-b300-b92b83c9735f            | COST    | f        | 2026-07-16 06:23:13.196
 ed5323a1-3f35-454a-a9ce-517b15e888ee | Eco-First Optimization - 35540afc-0844-420f-b300-b92b83c9735f    | CARBON  | f        | 2026-07-16 06:23:13.188
 e27e17d8-4057-44b7-b7ee-99d0119897f5 | Latency SLA Guard - 35540afc-0844-420f-b300-b92b83c9735f         | LATENCY | f        | 2026-07-16 06:23:13.182
 6287869d-c05c-44f3-89eb-7d50381b9069 | Tunable Scheduling Policy - 35540afc-0844-420f-b300-b92b83c9735f | TUNABLE | t        | 2026-07-16 06:23:13.167
(4 rows)
```

### Policy Creation and Deletion
* **Finding**: The `+ Create Policy`, `Edit`, and `Delete` buttons on the UI are visually rendered but completely unresponsive. Clicking them does not trigger any DOM events, network requests, or errors in the console. As a result, the requested creation and deletion flows could not be executed via the browser UI.

### Captured Network Payloads (Intercepted via DevTools)

#### 1. Fetch Active Objective Weights (GET)
* **URL**: `http://localhost:3090/v2/scheduling/policy`
* **Response Body**:
  ```json
  {
    "id": "6287869d-c05c-44f3-89eb-7d50381b9069",
    "name": "Tunable Scheduling Policy - 35540afc-0844-420f-b300-b92b83c9735f",
    "type": "TUNABLE",
    "config": {
      "latencyWeight": 0.33,
      "costWeight": 0.33,
      "carbonWeight": 0.34
    },
    "isActive": true,
    "createdAt": "2026-07-16T06:23:13.167Z",
    "updatedAt": "2026-07-16T06:42:50.060Z",
    "tenantId": "35540afc-0844-420f-b300-b92b83c9735f"
  }
  ```

#### 2. Update Objective Weights (PUT)
* **URL**: `http://localhost:3090/v2/scheduling/policy`
* **Request Body**:
  ```json
  {
    "latencyWeight": 0.33,
    "costWeight": 0.33,
    "carbonWeight": 0.34
  }
  ```
* **Response Body**:
  ```json
  {
    "success": true,
    "policy": {
      "id": "6287869d-c05c-44f3-89eb-7d50381b9069",
      "name": "Tunable Scheduling Policy - 35540afc-0844-420f-b300-b92b83c9735f",
      "type": "TUNABLE",
      "config": {
        "latencyWeight": 0.33,
        "costWeight": 0.33,
        "carbonWeight": 0.34
      },
      "isActive": true,
      "createdAt": "2026-07-16T06:23:13.167Z",
      "updatedAt": "2026-07-16T06:42:49.000Z",
      "tenantId": "35540afc-0844-420f-b300-b92b83c9735f"
    }
  }
  ```

#### 3. Fetch Governance Metrics (GET)
* **URL**: `http://localhost:3090/v2/analytics/governance`
* **Response Body**:
  ```json
  {
    "activeConstraints": 14,
    "policyViolations": 11,
    "complianceScore": 0,
    "totalNodes": 11,
    "onlineNodes": 0
  }
  ```
