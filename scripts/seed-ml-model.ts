import fs from 'fs';
import path from 'path';

import { SchedulingPredictor, type TrainingExample } from '../packages/ml-scheduler/src/predictor';

async function seed() {
  const predictor = new SchedulingPredictor();
  
  if ((predictor as any).useMock) {
    console.error('CRITICAL: Cannot seed real model because @tensorflow/tfjs-node failed to load.');
    process.exit(1);
  }

  // Create dummy training data
  const data: TrainingExample[] = [];
  for (let i = 0; i < 100; i++) {
    data.push({
      cpu_usage_pct: Math.random() * 100,
      ram_usage_pct: Math.random() * 100,
      current_task_count: Math.floor(Math.random() * 20),
      avg_latency_ms: Math.random() * 1000,
      historical_success_rate_7d: 0.9 + Math.random() * 0.1,
      region_cost_rate: Math.random() * 2.0,
      priority: Math.floor(Math.random() * 4),
      estimated_duration_ms: Math.random() * 30000,
      requires_gpu: Math.random() > 0.8 ? 1 : 0,
      image_size_mb: Math.random() * 500,
      hour_of_day: Math.floor(Math.random() * 24),
      day_of_week: Math.floor(Math.random() * 7),
      outcome_score: Math.random()
    });
  }

  console.log('Training initial seed model...');
  const { version, mae } = await predictor.train(data);
  console.log(`Training complete. Version: ${version}, MAE: ${mae}`);
  
  const modelDir = path.join(process.cwd(), 'models');
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  await predictor.saveModel(modelDir);
  
  // Set as active in registry if we had access to redis here, 
  // but for cold start, simply having it in /models is enough if the loader is updated.
  // Actually, TaskScheduler calls checkHotSwap which checks the registry.
  
  console.log('Seed model created successfully.');
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
