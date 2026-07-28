import json
import numpy as np
import os

def generate_dataset(num_samples=1000, seed=42):
    np.random.seed(seed)
    data = []

    for i in range(num_samples):
        cpu = np.clip(np.random.normal(50, 25), 5, 98)
        ram = np.clip(np.random.normal(55, 20), 10, 95)
        tasks = np.random.randint(0, 18)
        latency = np.clip(np.random.exponential(45), 2, 600)
        success_rate = np.clip(np.random.beta(9, 1), 0.70, 1.00)
        cost_rate = round(float(np.random.uniform(0.02, 1.50)), 3)
        priority = np.random.choice([0, 1, 2, 3], p=[0.3, 0.4, 0.2, 0.1])
        estimated_duration = round(float(np.random.uniform(500, 25000)), 1)
        requires_gpu = int(np.random.choice([0, 1], p=[0.8, 0.2]))
        image_size = round(float(np.random.uniform(10, 450)), 1)
        hour = np.random.randint(0, 24)
        day = np.random.randint(0, 7)

        # Domain physics / realistic outcome score formula with noise
        base_score = 1.0
        # Load impact
        load_factor = (cpu / 100.0) * 0.35 + (ram / 100.0) * 0.25 + (tasks / 20.0) * 0.15
        # Latency impact
        latency_penalty = min(0.25, (latency / 500.0) * 0.25)
        # GPU penalty if high load
        gpu_penalty = 0.15 if (requires_gpu and cpu > 70) else 0.0

        # Success history influence
        hist_factor = (success_rate - 0.7) / 0.3 * 0.1

        score = base_score - load_factor - latency_penalty - gpu_penalty + hist_factor
        # Add realistic observation noise
        noise = np.random.normal(0, 0.05)
        scheduling_score = float(np.clip(score + noise, 0.0, 1.0))

        data.append({
            "cpu_usage_pct": round(float(cpu), 2),
            "ram_usage_pct": round(float(ram), 2),
            "current_task_count": int(tasks),
            "avg_latency_ms": round(float(latency), 2),
            "historical_success_rate_7d": round(float(success_rate), 4),
            "region_cost_rate": cost_rate,
            "priority": int(priority),
            "estimated_duration_ms": estimated_duration,
            "requires_gpu": requires_gpu,
            "image_size_mb": image_size,
            "hour_of_day": int(hour),
            "day_of_week": int(day),
            "scheduling_score": round(scheduling_score, 4)
        })

    os.makedirs("data", exist_ok=True)
    out_path = os.path.join("data", "ml_training_dataset.json")
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Generated {num_samples} realistic training samples at {out_path}")

if __name__ == "__main__":
    generate_dataset()
