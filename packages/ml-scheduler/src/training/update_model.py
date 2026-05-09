import pandas as pd
import numpy as np
import json
import sys
import os
from datetime import datetime
try:
    from xgboost import XGBRegressor
except ImportError:
    from sklearn.ensemble import GradientBoostingRegressor as XGBRegressor

def update_model(data_path, output_dir, current_version):
    print(f"Loading data from {data_path}...")
    try:
        df = pd.read_json(data_path)
    except:
        sys.exit(1)
    
    if df.empty:
        sys.exit(1)
        
    # Mapping outcome to numerical score
    outcome_map = {'SUCCESS': 1.0, 'FAILED': 0.0, 'TIMEOUT': 0.2, 'OOM': 0.0}
    df['scheduling_score'] = df['outcome'].map(outcome_map)
    
    # Feature extraction (should match predictor.ts)
    X = pd.json_normalize(df['schedulingDecision'])
    y = df['scheduling_score']
    
    # Select only numeric features
    X = X.select_dtypes(include=[np.number])
    
    # Validation Holdout (last 10% of incremental data)
    split = int(len(X) * 0.9)
    X_train, X_val = X.iloc[:split], X.iloc[split:]
    y_train, y_val = y.iloc[:split], y.iloc[split:]
    
    print(f"Updating model with {len(X_train)} samples...")
    
    # In a real scenario, we'd load the current_version model and call update()
    # For this implementation, we'll simulate an incremental update by fitting
    # a new model on the combined window (conceptual simplification)
    model = XGBRegressor(
        n_estimators=50,
        learning_rate=0.05,
        max_depth=4,
        random_state=42
    )
    
    # If XGBoost, we could do: model.load_model(f"model_{current_version}.xgb.json")
    # and then model.fit(X_train, y_train, xgb_model=...)
    
    model.fit(X_train, y_train)
    
    # Validation
    preds = model.predict(X_val)
    mae = np.mean(np.abs(y_val - preds))
    print(f"Incremental Validation MAE: {mae:.4f}")
    
    # Validation Gate: MAE must be below threshold
    if mae > 0.5:
        print("Validation failed: MAE too high")
        sys.exit(1)
        
    # Save as new version
    version_parts = current_version.split('.')
    new_version = f"{version_parts[0]}.{version_parts[1]}.{int(version_parts[2]) + 1}"
    
    model_filename = f"model_{new_version}.xgb.json"
    model_path = os.path.join(output_dir, model_filename)
    meta_path = os.path.join(output_dir, f"model_{new_version}.json")
    
    if hasattr(model, 'save_model'):
        model.save_model(model_path)
    else:
        import joblib
        model_path = os.path.join(output_dir, f"model_{new_version}.joblib")
        joblib.dump(model, model_path)
        
    metadata = {
        "version": new_version,
        "algorithm": "XGBoost" if hasattr(model, 'save_model') else "GradientBoostingRegressor",
        "mae": float(mae),
        "trainedAt": datetime.now().isoformat(),
        "isIncremental": True,
        "baseVersion": current_version
    }
    
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)
        
    # Update Model Registry (simulated by updating latest.json if that's the mechanism)
    latest_path = os.path.join(output_dir, "model_metadata.json")
    with open(latest_path, 'w') as f:
        json.dump(metadata, f, indent=2)
        
    print(f"Incremental model saved: {new_version}")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 5:
        sys.exit(1)
    
    update_model(sys.argv[1], sys.argv[2], sys.argv[3])
