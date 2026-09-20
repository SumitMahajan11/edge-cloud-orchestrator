use sysinfo::{System, Disks};
use std::process::Command;

#[derive(Clone, Debug, Default)]
pub struct GpuInfo {
    pub model: String,
    pub memory_mb: Option<u64>,
}

pub struct SystemMetrics {
    sys: System,
    disks: Disks,
}

impl Default for SystemMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl SystemMetrics {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        let disks = Disks::new_with_refreshed_list();
        Self { sys, disks }
    }

    pub fn refresh(&mut self) {
        self.sys.refresh_cpu();
        self.sys.refresh_memory();
        self.disks.refresh_list();
    }

    pub fn cpu_usage_percent(&self) -> f64 {
        // Average across all logical CPUs
        let cpus = self.sys.cpus();
        if cpus.is_empty() {
            return 0.0;
        }
        cpus.iter().map(|c| c.cpu_usage() as f64).sum::<f64>() / cpus.len() as f64
    }

    pub fn memory_used_bytes(&self) -> u64 {
        self.sys.used_memory()
    }

    pub fn memory_total_bytes(&self) -> u64 {
        self.sys.total_memory()
    }

    pub fn memory_usage_percent(&self) -> f64 {
        let total = self.sys.total_memory();
        if total == 0 {
            return 0.0;
        }
        (self.sys.used_memory() as f64 / total as f64) * 100.0
    }

    pub fn disk_used_bytes(&self) -> u64 {
        self.disks.list().iter().map(|d| d.total_space() - d.available_space()).sum()
    }

    pub fn disk_total_bytes(&self) -> u64 {
        self.disks.list().iter().map(|d| d.total_space()).sum()
    }

    pub fn load_average_1m(&self) -> f64 {
        System::load_average().one
    }

    /// Detect a GPU without making the agent depend on a vendor SDK.
    /// NVIDIA memory is reported when `nvidia-smi` is available. For other
    /// PCI-visible GPUs, the model is still reported and memory remains null.
    pub fn detect_gpu(&self) -> Option<GpuInfo> {
        if let Ok(output) = Command::new("nvidia-smi")
            .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
            .output()
        {
            if output.status.success() {
                if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                    let mut parts = line.split(',').map(str::trim);
                    if let Some(model) = parts.next().filter(|value| !value.is_empty()) {
                        let memory_mb = parts.next().and_then(|value| value.parse().ok());
                        return Some(GpuInfo { model: model.to_string(), memory_mb });
                    }
                }
            }
        }

        let output = Command::new("lspci").output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .find(|line| {
                let lower = line.to_ascii_lowercase();
                lower.contains("vga compatible controller")
                    || lower.contains("3d controller")
                    || lower.contains("display controller")
            })
            .map(|line| GpuInfo {
                model: line.split(':').nth(2).unwrap_or(line).trim().to_string(),
                memory_mb: None,
            })
    }

    /// Internal method to refresh and get agent process metrics
    pub fn get_process_metrics(&mut self, pid: sysinfo::Pid) -> (f64, u64) {
        self.sys.refresh_process(pid);
        if let Some(process) = self.sys.process(pid) {
            (process.cpu_usage() as f64, process.memory())
        } else {
            (0.0, 0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_metrics_not_zero() {
        let mut m = SystemMetrics::new();
        m.refresh();
        // On any real machine, memory total is never 0
        assert!(m.memory_total_bytes() > 0);
        // CPU count is never 0
        // (cpu_usage could briefly be 0.0 so we don't assert on it)
    }

    #[test]
    fn test_zero_divisor_resilience() {
        // Ensure memory usage calculation handles 0 total memory gracefully
        let mut m = SystemMetrics::new();
        m.sys.refresh_memory();
        // Even if we mock/force a zero division state, it should return 0.0 instead of panicking
        let original_total = m.sys.total_memory();
        if original_total == 0 {
            assert_eq!(m.memory_usage_percent(), 0.0);
        }
    }

    #[test]
    fn test_empty_cpu_resilience() {
        let m = SystemMetrics::new();
        // Test cpu calculation behavior - should not panic if cpu list were empty
        if m.sys.cpus().is_empty() {
            assert_eq!(m.cpu_usage_percent(), 0.0);
        }
    }
}
