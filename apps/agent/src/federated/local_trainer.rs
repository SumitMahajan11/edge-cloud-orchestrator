use serde::{Deserialize, Serialize};
use chrono::prelude::*;
use tract_onnx::prelude::*;
use anyhow::Result;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalModel {
    pub w1: Vec<f32>, // 12 * 32 = 384
    pub b1: Vec<f32>, // 32
    pub w2: Vec<f32>, // 32 * 16 = 512
    pub b2: Vec<f32>, // 16
    pub w3: Vec<f32>, // 16 * 1 = 16
    pub b3: Vec<f32>, // 1
}

impl LocalModel {
    pub fn new_zeroed() -> Self {
        Self {
            w1: vec![0.0; 384],
            b1: vec![0.0; 32],
            w2: vec![0.0; 512],
            b2: vec![0.0; 16],
            w3: vec![0.0; 16],
            b3: vec![0.0; 1],
        }
    }

    pub fn to_flat_vec(&self) -> Vec<f32> {
        let mut flat = Vec::with_capacity(961);
        flat.extend_from_slice(&self.w1);
        flat.extend_from_slice(&self.b1);
        flat.extend_from_slice(&self.w2);
        flat.extend_from_slice(&self.b2);
        flat.extend_from_slice(&self.w3);
        flat.extend_from_slice(&self.b3);
        flat
    }

    pub fn from_flat_slice(flat: &[f32]) -> Self {
        let mut w1 = vec![0.0; 384];
        let mut b1 = vec![0.0; 32];
        let mut w2 = vec![0.0; 512];
        let mut b2 = vec![0.0; 16];
        let mut w3 = vec![0.0; 16];
        let mut b3 = vec![0.0; 1];

        let mut offset = 0;
        w1.copy_from_slice(&flat[offset..offset + 384]);
        offset += 384;
        b1.copy_from_slice(&flat[offset..offset + 32]);
        offset += 32;
        w2.copy_from_slice(&flat[offset..offset + 512]);
        offset += 512;
        b2.copy_from_slice(&flat[offset..offset + 16]);
        offset += 16;
        w3.copy_from_slice(&flat[offset..offset + 16]);
        offset += 16;
        b3.copy_from_slice(&flat[offset..offset + 1]);

        Self { w1, b1, w2, b2, w3, b3 }
    }
}

pub fn calculate_reward(
    duration_ms: u64,
    cpu_usage: f64,
    carbon_intensity: f64,
    status: &str,
) -> f64 {
    let is_failure = status == "FAILED" || status == "TIMEOUT" || status == "OOM";
    if is_failure {
        return -1.0;
    }

    let latency = duration_ms as f64;
    let mut latency_score = 1.0 - (latency / 5000.0);
    if latency_score < -1.0 {
        latency_score = -1.0;
    } else if latency_score > 1.0 {
        latency_score = 1.0;
    }

    let sla_penalty = if latency > 5000.0 { -0.5 } else { 0.0 };

    let mut carbon_score = 1.0 - (carbon_intensity / 1000.0);
    if carbon_score < -1.0 {
        carbon_score = -1.0;
    } else if carbon_score > 1.0 {
        carbon_score = 1.0;
    }

    let mut cpu_score = 1.0 - (cpu_usage / 100.0);
    if cpu_score < -1.0 {
        cpu_score = -1.0;
    } else if cpu_score > 1.0 {
        cpu_score = 1.0;
    }

    let load_penalty = if cpu_usage > 85.0 { -0.3 } else { 0.0 };

    let latency_weight = 0.4;
    let carbon_weight = 0.3;
    let cpu_weight = 0.3;

    let raw_reward = latency_weight * latency_score
        + carbon_weight * carbon_score
        + cpu_weight * cpu_score
        + sla_penalty
        + load_penalty;

    if raw_reward < -1.0 {
        -1.0
    } else if raw_reward > 1.0 {
        1.0
    } else {
        raw_reward
    }
}

pub fn extract_features(
    cpu_usage: f64,
    memory_usage: f64,
    tasks_running: u32,
    latency: f64,
    cost_per_hour: f64,
    priority: &str,
    estimated_duration_ms: f64,
    requires_gpu: bool,
    image_size_mb: f64,
) -> [f32; 12] {
    let prio_val = match priority {
        "LOW" => 0.0,
        "MEDIUM" => 1.0,
        "HIGH" => 2.0,
        "CRITICAL" => 3.0,
        _ => 1.0,
    };
    
    let now = chrono::Utc::now();
    let hour = now.time().hour() as f32;
    let weekday = now.weekday().num_days_from_monday() as f32;

    [
        (cpu_usage / 100.0) as f32,
        (memory_usage / 100.0) as f32,
        (tasks_running as f32 / 20.0).min(1.0),
        (latency / 1000.0).min(1.0) as f32,
        0.95, // historical success rate
        (cost_per_hour / 2.0) as f32,
        (prio_val / 3.0) as f32,
        (estimated_duration_ms / 30000.0).min(1.0) as f32,
        if requires_gpu { 1.0 } else { 0.0 },
        (image_size_mb / 500.0).min(1.0) as f32,
        hour / 24.0,
        weekday / 7.0,
    ]
}

pub fn train_local_step(
    model: &mut LocalModel,
    features: &[f32; 12],
    target_reward: f32,
    learning_rate: f32,
) -> (LocalModel, f32) {
    // Forward pass
    // Dense 1: 12 -> 32
    let mut z1 = vec![0.0; 32];
    let mut h1 = vec![0.0; 32];
    for i in 0..32 {
        let mut sum = model.b1[i];
        for j in 0..12 {
            sum += features[j] * model.w1[j * 32 + i];
        }
        z1[i] = sum;
        h1[i] = if sum > 0.0 { sum } else { 0.0 }; // ReLU
    }

    // Dense 2: 32 -> 16
    let mut z2 = vec![0.0; 16];
    let mut h2 = vec![0.0; 16];
    for i in 0..16 {
        let mut sum = model.b2[i];
        for j in 0..32 {
            sum += h1[j] * model.w2[j * 16 + i];
        }
        z2[i] = sum;
        h2[i] = if sum > 0.0 { sum } else { 0.0 }; // ReLU
    }

    // Dense 3: 16 -> 1
    let mut z3 = model.b3[0];
    for j in 0..16 {
        z3 += h2[j] * model.w3[j];
    }
    let prediction = 1.0 / (1.0 + (-z3).exp()); // Sigmoid

    // Backward pass
    let error = prediction - target_reward;
    let d_z3 = error * prediction * (1.0 - prediction);

    let mut delta = LocalModel::new_zeroed();

    // Dense 3 grads
    delta.b3[0] = d_z3;
    for j in 0..16 {
        delta.w3[j] = d_z3 * h2[j];
    }

    // Dense 2 grads
    let mut d_z2 = vec![0.0; 16];
    for j in 0..16 {
        let relu_deriv = if z2[j] > 0.0 { 1.0 } else { 0.0 };
        d_z2[j] = d_z3 * model.w3[j] * relu_deriv;
    }
    for i in 0..16 {
        delta.b2[i] = d_z2[i];
        for j in 0..32 {
            delta.w2[j * 16 + i] = d_z2[i] * h1[j];
        }
    }

    // Dense 1 grads
    let mut d_z1 = vec![0.0; 32];
    for j in 0..32 {
        let mut sum = 0.0;
        for k in 0..16 {
            sum += d_z2[k] * model.w2[j * 16 + k];
        }
        let relu_deriv = if z1[j] > 0.0 { 1.0 } else { 0.0 };
        d_z1[j] = sum * relu_deriv;
    }
    for i in 0..32 {
        delta.b1[i] = d_z1[i];
        for j in 0..12 {
            delta.w1[j * 32 + i] = d_z1[i] * features[j];
        }
    }

    // Update weights of the model
    for i in 0..model.w1.len() { model.w1[i] -= learning_rate * delta.w1[i]; }
    for i in 0..model.b1.len() { model.b1[i] -= learning_rate * delta.b1[i]; }
    for i in 0..model.w2.len() { model.w2[i] -= learning_rate * delta.w2[i]; }
    for i in 0..model.b2.len() { model.b2[i] -= learning_rate * delta.b2[i]; }
    for i in 0..model.w3.len() { model.w3[i] -= learning_rate * delta.w3[i]; }
    for i in 0..model.b3.len() { model.b3[i] -= learning_rate * delta.b3[i]; }

    (delta, prediction)
}

pub fn train_on_outcomes(
    initial_weights: &[f32],
    outcomes: &[(String, Vec<f32>, f64)],
    learning_rate: f32,
) -> (Vec<f32>, f64) {
    if outcomes.is_empty() {
        return (vec![0.0; 961], 0.0);
    }

    let mut model = if initial_weights.len() == 961 {
        LocalModel::from_flat_slice(initial_weights)
    } else {
        LocalModel::new_zeroed()
    };

    let mut total_reward = 0.0;
    let initial_model_weights = model.to_flat_vec();

    for (_id, features, reward) in outcomes {
        total_reward += *reward;
        let mut feat_arr = [0.0; 12];
        for i in 0..12 {
            if i < features.len() {
                feat_arr[i] = features[i];
            }
        }
        train_local_step(&mut model, &feat_arr, *reward as f32, learning_rate);
    }

    let final_weights = model.to_flat_vec();
    let mut deltas = vec![0.0; 961];
    for i in 0..961 {
        deltas[i] = final_weights[i] - initial_model_weights[i];
    }

    let avg_reward = total_reward / outcomes.len() as f64;
    
    // Scale weight delta by the average reward signal (* avg_reward * 0.01)
    let scale = avg_reward * 0.01;
    for i in 0..961 {
        deltas[i] *= scale as f32;
    }

    (deltas, avg_reward)
}

pub fn run_tract_inference(onnx_path: &str, features: &[f32; 12]) -> Result<f32> {
    let model = tract_onnx::onnx()
        .model_for_path(onnx_path)?
        .into_optimized()?
        .into_runnable()?;
    
    let array = tract_onnx::prelude::tract_ndarray::Array2::from_shape_vec((1, 12), features.to_vec())?;
    let input: Tensor = array.into();
    let result = model.run(tvec!(input.into()))?;
    let val: f32 = *result[0].to_scalar::<f32>()?;
    Ok(val)
}
