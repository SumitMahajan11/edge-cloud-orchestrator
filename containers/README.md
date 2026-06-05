# Sample Edge Workload Containers

These containers demonstrate typical edge computing workloads that can be scheduled via the orchestrator.

| Container        | Purpose                                 | Resource Requirements |
| ---------------- | --------------------------------------- | --------------------- |
| data-aggregator  | Aggregates sensor data from IoT devices | 256MB RAM, 0.5 CPU    |
| image-classifier | Runs ML inference on image data         | 512MB RAM, 1 CPU      |
| log-analyzer     | Parses and forwards structured logs     | 128MB RAM, 0.25 CPU   |

## Deployment

Submit a task via the orchestrator API with the corresponding image name:
`edgecloud/[container-name]:latest`
