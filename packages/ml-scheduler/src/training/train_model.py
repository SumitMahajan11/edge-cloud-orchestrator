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
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error

def get_next_version(output_dir):
    latest_path = os.path.join(output_dir, "latest.json")
    if not os.path.exists(latest_path):
        return "1.0.0"
    try:
        with open(latest_path, 'r') as f:
            data = json.load(f)
            v = data.get("version", "1.0.0")
            major, minor, patch = map(int, v.split('.'))
            return f"{major}.{minor}.{patch + 1}"
    except:
        return "1.0.0"

def train_model(data_path, output_dir):
    print(f"Loading data from {data_path}...")
    try:
        df = pd.read_json(data_path)
    except Exception as e:
        print(f"Error loading JSON: {e}")
        try:
            df = pd.read_json(data_path, lines=True)
        except:
            sys.exit(1)
    
    if df.empty:
        print("Error: Empty dataset")
        sys.exit(1)
        
    target_col = 'scheduling_score'
    if target_col not in df.columns:
        print(f"Error: Target column {target_col} not found")
        sys.exit(1)
        
    X = df.drop(columns=[target_col])
    y = df[target_col]
    X = X.select_dtypes(include=[np.number])
    
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    print(f"Training on {len(X_train)} samples with {X.shape[1]} features...")
    
    model = XGBRegressor(
        n_estimators=100,
        learning_rate=0.1,
        max_depth=5,
        random_state=42
    )
    
    model.fit(X_train, y_train)
    
    predictions = model.predict(X_test)
    mae = mean_absolute_error(y_test, predictions)
    
    # Model Validation Gate
    errors = np.abs(y_test - predictions)
    p99_error = np.percentile(errors, 99)
    print(f"Validation Result - MAE: {mae:.4f}, P99 Error: {p99_error:.4f}ms")
    
    if p99_error >= 10.0:
        print(f"CRITICAL: P99 error {p99_error:.4f}ms exceeds threshold of 10ms. Validation failed.")
        sys.exit(1)
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Versioning
    version = get_next_version(output_dir)
    model_filename = f"model_{version}.xgb.json"
    model_path = os.path.join(output_dir, model_filename)
    meta_path = os.path.join(output_dir, "model_metadata.json")
    
    # Save model
    if hasattr(model, 'save_model'):
        model.save_model(model_path)
    else:
        import joblib
        model_path = os.path.join(output_dir, f"model_{version}.joblib")
        joblib.dump(model, model_path)
    
    # Save metadata
    metadata = {
        "version": version,
        "algorithm": "XGBoost" if hasattr(model, 'save_model') else "GradientBoostingRegressor",
        "accuracy": 1.0 - (mae / (y_test.mean() if y_test.mean() != 0 else 1)), # Proxy for accuracy
        "mae": float(mae),
        "p99_error": float(p99_error),
        "features": X.columns.tolist(),
        "trainedAt": datetime.now().isoformat(),
        "artifact_path": model_path
    }
    
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)
        
    # Also save versioned metadata
    versioned_meta_path = os.path.join(output_dir, f"model_{version}.json")
    with open(versioned_meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)
        
    print(f"Model saved: {model_path}")
    print(f"Metadata updated: {meta_path}")
    
    # Update latest.json for backward compatibility if needed
    latest_meta_path = os.path.join(output_dir, "latest.json")
    with open(latest_meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)
        
    return version, mae

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python train_model.py <data_json_path> <output_dir>")
        sys.exit(1)
        
    data_json_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    train_model(data_json_path, output_dir)
