# Edge Cloud Orchestrator - Testing Guide

## Quick Start

### 1. Setup Environment
```powershell
# Run setup script
.\setup-test-env.ps1
```

### 2. Start Edge Agents
```powershell
# Option A: Run all 3 agents
.\start-test-env.bat

# Option B: Run individually
cd edge-agent
npm run agent-1  # Port 4001
npm run agent-2  # Port 4002
npm run agent-3  # Port 4003
```

### 3. Start Orchestrator Dashboard
```powershell
npm run dev
```

### 4. Access Dashboard
Open http://localhost:5173

Login: `admin@edgecloud.io` / `password`

---

## Testing Scenarios

### Scenario 1: Register Edge Nodes

1. Go to **Edge Nodes** page
2. Click **Register Node**
3. Add these nodes:
   - Name: `Local Edge 1`, URL: `http://localhost:4001`
   - Name: `Local Edge 2`, URL: `http://localhost:4002`
   - Name: `Local Edge 3`, URL: `http://localhost:4003`

### Scenario 2: Execute Real Tasks

1. Go to **Task Scheduler**
2. Submit tasks with these images:
   - `edgecloud-image-classifier` (Image Classification)
   - `edgecloud-data-aggregator` (Data Aggregation)
   - `edgecloud-log-analyzer` (Log Analysis)
3. Watch tasks execute in real containers
4. Check results in task list

### Scenario 3: Monitor Node Health

1. Go to **Monitoring** page
2. View real CPU/memory metrics from agents
3. Check node heartbeat status
4. Test node failure by stopping an agent

### Scenario 4: Webhook Integration

1. Go to **Webhooks** page
2. Create webhook: `https://httpbin.org/post`
3. Subscribe to `task.completed` events
4. Submit tasks and verify webhook delivery

---

## Load Testing

### Install k6
```powershell
# Windows (Chocolatey)
choco install k6

# Or download from https://k6.io/docs/get-started/installation/
```

### Run Load Test
```powershell
cd test
k6 run load-test.js
```

This simulates 100 concurrent users submitting tasks.

---

## Container Images

### Build Images
```powershell
# Image Classifier
docker build -t edgecloud-image-classifier ./containers/image-classifier

# Data Aggregator
docker build -t edgecloud-data-aggregator ./containers/data-aggregator

# Log Analyzer
docker build -t edgecloud-log-analyzer ./containers/log-analyzer
```

### Test Containers Manually
```powershell
# Test image classifier
docker run --rm edgecloud-image-classifier

# Test data aggregator
docker run --rm edgecloud-data-aggregator

# Test log analyzer
docker run --rm edgecloud-log-analyzer
```

---

## API Endpoints

### Edge Agent Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/metrics` | GET | CPU, memory, tasks |
| `/heartbeat` | GET | Node status |
| `/run-task` | POST | Execute container |
| `/tasks` | GET | List running tasks |
| `/ping` | GET | Latency test |

### Example API Calls

```bash
# Health check
curl http://localhost:4001/health

# Get metrics
curl http://localhost:4001/metrics

# Run task
curl -X POST http://localhost:4001/run-task \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "test-001",
    "taskName": "Test Classification",
    "image": "edgecloud-image-classifier"
  }'
```

---

## Troubleshooting

### Docker Not Available
If Docker is not running, the system falls back to simulation mode.

### Port Already in Use
Change ports in `edge-agent/package.json` scripts.

### CORS Errors
Ensure orchestrator and agents are on same origin or CORS is enabled.

---

## Production Deployment

### Cloud VMs
1. Create 3+ VMs in different regions
2. Install Docker on each
3. Deploy edge agent: `npm start`
4. Open firewall ports 4001-4003
5. Register in orchestrator dashboard

### Kubernetes
```yaml
# Deploy edge agents as DaemonSet
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: edge-agent
spec:
  selector:
    matchLabels:
      app: edge-agent
  template:
    spec:
      containers:
      - name: agent
        image: edgecloud/agent:latest
        ports:
        - containerPort: 4001
```

---

## Metrics & Observability

### Prometheus Integration
Add Prometheus scraping config:
```yaml
scrape_configs:
  - job_name: 'edge-agents'
    static_configs:
      - targets: ['localhost:4001', 'localhost:4002', 'localhost:4003']
```

### Grafana Dashboard
Import dashboard JSON from `monitoring/grafana-dashboard.json`

---

## Support

For issues or questions, check:
1. Agent logs in terminal windows
2. Browser console for frontend errors
3. Docker logs: `docker logs <container-id>`
