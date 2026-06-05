# Runbook: ML Model Degraded

## ALERT CONDITION

- **Metric**: `edgecloud_ml_fallback_total` (rate) / `edgecloud_scheduling_decisions_total` (rate)
- **Threshold**: `> 0.10` (10%) for 15 minutes.
- **Grafana Panel**: "ML Ops -> Fallback Rate"

## IMPACT

Scheduling decisions are less optimal, potentially leading to higher latency and costs. The system is operating in a "degraded" but safe mode using rule-based heuristics.

## DIAGNOSIS STEPS

1. **Verify Model Path**:
   Check if the API container can access the model file.
   - **Command**: `kubectl exec -it api-<pod-id> -- ls -l /models/active/`

2. **Check Model Version**:
   Verify the loaded version matches the expected version from the `ModelRegistry`.
   - **Query**: `SELECT version, status FROM "ModelRegistry" WHERE status = 'ACTIVE';`
   - **Environment**: Compare with `MIN_MODEL_VERSION` env var.

3. **Check DriftDetector Metrics**:
   Identify if the fallback is due to data drift or a crashed predictor.
   - **Query**: `edgecloud_ml_drift_mae`
   - **Logs**: `kubectl logs -l app=api | grep "DriftDetector"`

4. **Verify Resource Constraints**:
   Check if the `MLPredictor` is timing out due to CPU throttling.
   - **Command**: `kubectl top pods -l app=api`

## RESOLUTION

1. **Manually Trigger Retraining**:
   If drift is high, trigger a GitHub Action to retrain the model.
   - **Action**: Go to GitHub -> Actions -> "ML Retrain" -> "Run workflow".
   - **CLI**: `gh workflow run ml-retrain.yml`

2. **Roll Back to Previous Version**:
   If the current model is corrupted, revert to the known-good version.
   - **Step**: Update the `ModelRegistry` status.
   - **Query**: `UPDATE "ModelRegistry" SET status = 'INACTIVE' WHERE version = 'vCurrent'; UPDATE "ModelRegistry" SET status = 'ACTIVE' WHERE version = 'vPrevious';`

3. **Restart API Instances**:
   Force the hot-swap logic to reload the model from storage.
   - **Command**: `kubectl rollout restart deployment api`

## ESCALATION

- **Level 2**: Contact Data Science team if Mean Absolute Error (MAE) remains above 0.5 after retraining.
- **Level 3**: Contact ML Platform team if model weight downloads from S3/GCS are failing.

## POST-INCIDENT

- Review the `SchedulingPredictor` performance for the first 10 minutes after rollback.
- Audit the training data pipeline for missing features or stale data.
- Check `ModelStorageService` logs for authentication errors.
