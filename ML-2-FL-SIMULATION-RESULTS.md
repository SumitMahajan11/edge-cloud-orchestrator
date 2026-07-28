# Empirical Federated Learning Simulation Results

**Executed at**: 2026-07-28T11:46:39.001Z
**Configuration**: 5 Edge Nodes, 5 FedAvg Aggregation Rounds

## Global Convergence Summary

| Round | Global MAE | Global Accuracy | Avg Node Local MAE | Avg Node Local Accuracy | Avg Reward |
|---|---|---|---|---|---|
| 1 | 0.0128 | 100.0% | 0.0147 | 100.0% | 0.9853 |
| 2 | 0.0127 | 100.0% | 0.0147 | 100.0% | 0.9853 |
| 3 | 0.0128 | 100.0% | 0.0148 | 100.0% | 0.9852 |
| 4 | 0.0128 | 100.0% | 0.0148 | 100.0% | 0.9852 |
| 5 | 0.0128 | 100.0% | 0.0148 | 100.0% | 0.9852 |

## Per-Node Performance Breakdown (Final Round 5)

| Node ID | Samples | Local MAE | Local Accuracy | Local Reward |
|---|---|---|---|---|
| 2e71adcd-3314-47ba-8aa9-6b19ad19ba25 | 150 | 0.0147 | 100.0% | 0.9853 |
| 605332d8-89a2-49f9-98cf-43efad1c21c3 | 150 | 0.0157 | 100.0% | 0.9843 |
| 77206f8b-4682-4454-bdcb-d2571ca19587 | 150 | 0.0150 | 100.0% | 0.9850 |
| a1b2c3d4-e5f6-7890-abcd-ef1234567890 | 150 | 0.0152 | 100.0% | 0.9848 |
| f9e8d7c6-b5a4-3210-fedc-ba9876543210 | 150 | 0.0131 | 100.0% | 0.9869 |

## Reproducibility

To reproduce these empirical results, execute:
```bash
npx tsx scripts/fl-simulator.ts 5
```
