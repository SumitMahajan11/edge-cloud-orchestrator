#!/usr/bin/env python3
"""
Image Classification Task Simulator
Simulates processing an image and returning classification results
"""

import os
import time
import random
import json
from datetime import datetime

def classify_image():
    """Simulate image classification"""
    # Simulate processing time
    processing_time = random.uniform(0.5, 3.0)
    time.sleep(processing_time)
    
    # Simulated classes
    classes = [
        "cat", "dog", "bird", "car", "person", 
        "tree", "building", "mountain", "beach", "food"
    ]
    
    # Generate random predictions
    predictions = []
    for i in range(random.randint(3, 5)):
        predictions.append({
            "class": random.choice(classes),
            "confidence": round(random.uniform(0.6, 0.99), 4)
        })
    
    # Sort by confidence
    predictions.sort(key=lambda x: x["confidence"], reverse=True)
    
    return {
        "status": "success",
        "task_type": "image-classification",
        "processing_time_ms": round(processing_time * 1000, 2),
        "predictions": predictions,
        "model": "resnet50-simulated",
        "timestamp": datetime.now().isoformat(),
        "node": os.environ.get("HOSTNAME", "unknown")
    }

def main():
    print("=" * 50)
    print("Image Classification Task Started")
    print("=" * 50)
    
    start_time = time.time()
    
    try:
        result = classify_image()
        
        print(f"\nProcessing completed in {result['processing_time_ms']}ms")
        print(f"\nTop Predictions:")
        for i, pred in enumerate(result['predictions'][:3], 1):
            print(f"  {i}. {pred['class']}: {pred['confidence']*100:.2f}%")
        
        print("\n" + "=" * 50)
        print(json.dumps(result, indent=2))
        print("=" * 50)
        
        return 0
        
    except Exception as e:
        print(f"ERROR: {str(e)}")
        return 1

if __name__ == "__main__":
    exit(main())
