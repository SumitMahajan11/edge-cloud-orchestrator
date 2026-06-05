---
phase: 6
plan: 1
wave: 1
depends_on: []
files_modified:
  [
    "apps/api/prisma/schema.prisma",
    "apps/api/src/services/task-scheduler.ts",
    "apps/web/src/stores/websocket.ts",
    "apps/web/src/lib/websocketClient.ts",
  ]
autonomous: true
---

# Plan 6.1: Backend Infrastructure & Telemetry Bridges

<objective>
Harden the backend infrastructure by adding geographic coordinates to edge nodes, implementing real-time scheduling decision broadcasts, and updating the frontend WebSocket client for the unified gateway.
</objective>

<context>
- apps/api/prisma/schema.prisma
- apps/api/src/services/task-scheduler.ts
- apps/web/src/stores/websocket.ts
- apps/web/src/lib/websocketClient.ts
</context>

<tasks>

<task type="auto">
  <name>Add Geographic Coordinates to EdgeNode</name>
  <files>apps/api/prisma/schema.prisma</files>
  <action>
    Add `latitude` and `longitude` fields to the `EdgeNode` model in `schema.prisma`.
    Latitude  Float?
    Longitude Float?
    Then run `pnpm prisma migrate dev --name add_node_coordinates` in `apps/api`.
  </action>
  <verify>npx prisma studio (check fields) or check migrations folder</verify>
  <done>Fields added to schema and migration generated.</done>
</task>

<task type="auto">
  <name>Implement Scheduling Decision Broadcast</name>
  <files>apps/api/src/services/task-scheduler.ts</files>
  <action>
    1. Capture `schedulingStartTime` in `scoreAndAssignWithLock`.
    2. Broadcast `scheduler:decision` in `assignTask` after successful dispatch.
    Include taskId, selectedNodeId, mlScore, usedML, latencyMs, carbonIntensity, and costUsd.
  </action>
  <verify>grep -n "scheduler:decision" apps/api/src/services/task-scheduler.ts</verify>
  <done>Broadcast added with correct payload.</done>
</task>

<task type="auto">
  <name>Harden WebSocket Client & Store</name>
  <files>apps/web/src/stores/websocket.ts, apps/web/src/lib/websocketClient.ts</files>
  <action>
    1. In `websocketClient.ts`, ensure `4001` close code (Unauthorized) triggers a specific log or state change if needed.
    2. In `websocketClient.ts`, verify `ws://localhost:3090/ws` is the default.
    3. In `websocketClient.ts`, ensure `reconnectAttempts` are reset correctly.
    4. In `useWsStore.ts`, handle the `scheduler:decision` event for query invalidation.
  </action>
  <verify>Check websocketClient.ts and useWsStore.ts for the changes.</verify>
  <done>WS client hardened and store updated for new events.</done>
</task>

</tasks>

<verification>
- [ ] EdgeNode has latitude/longitude fields.
- [ ] scheduler:decision event is broadcasted.
- [ ] WS client connects to port 3090 with token.
</verification>

<success_criteria>

- [ ] Backend supports geographic telemetry.
- [ ] Real-time scheduling decisions are visible to the system.
- [ ] Frontend WebSocket communication is stable and port-aligned.
      </success_criteria>
