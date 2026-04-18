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

def train_model(data_path, output_dir):
    print(f"Loading data from {data_path}...")
    try:
        df = pd.read_json(data_path)
    except Exception as e:
        print(f"Error loading JSON: {e}")
        # Try reading as lines if it's JSONL
        try:
            df = pd.read_json(data_path, lines=True)
        except:
            sys.exit(1)
    
    if df.empty:
        print("Error: Empty dataset")
        sys.exit(1)
        
    # Feature engineering
    target_col = 'scheduling_score'
    if target_col not in df.columns:
        print(f"Error: Target column {target_col} not found")
        sys.exit(1)
        
    X = df.drop(columns=[target_col])
    y = df[target_col]
    
    # Ensure all columns are numeric
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
    print(f"Training complete. MAE: {mae:.4f}")
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Versioning
    version = datetime.now().strftime("%Y%m%d%H%M%S")
    model_filename = f"model_{version}.json"
    model_path = os.path.join(output_dir, model_filename)
    meta_path = os.path.join(output_dir, f"model_{version}.json") # Meta is also JSON
    
    # Save model
    if hasattr(model, 'save_model'):
        model.save_model(model_path)
    else:
        # Fallback for sklearn
        import joblib
        model_path = os.path.join(output_dir, f"model_{version}.joblib")
        joblib.dump(model, model_path)
    
    # Save metadata for registry
    metadata = {
        "version": version,
        "algorithm": "XGBoost" if hasattr(model, 'save_model') else "GradientBoostingRegressor",
        "mae": float(mae),
        "features": X.columns.tolist(),
        "created_at": datetime.now().isoformat(),
        "artifact_path": model_path
    }
    
    # Write metadata (this will overwrite model_path if using XGBoost and meta_path is same, 
    # so let's use a different name for meta if they collide, but they shouldn't as versioned)
    # Actually ModelRegistry expects model_{version}.json to be the metadata.
    # Let's save model artifact as model_{version}.bin or .json and metadata as model_{version}.json
    # If XGBoost saves to JSON, let's call it model_{version}.xgb.json
    
    xgb_model_path = os.path.join(output_dir, f"model_{version}.xgb.json")
    if hasattr(model, 'save_model'):
        model.save_model(xgb_model_path)
        metadata["artifact_path"] = xgb_model_path
    
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2)
        
    print(f"Model saved: {metadata['artifact_path']}")
    print(f"Metadata saved: {meta_path}")
    
    # Also update latest.json
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
