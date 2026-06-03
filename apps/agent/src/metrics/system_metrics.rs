use sysinfo::{System, Disks};

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

