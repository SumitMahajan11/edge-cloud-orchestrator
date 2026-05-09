use anyhow::Result;
use edge_agent::security::certificate_manager::CertificateManager;
use edge_agent::transport::client::{MTlsClient, NodeRegistrationInfo};
use edge_agent::persistence::DatabaseManager;
use edge_agent::agent::Agent;
use std::path::PathBuf;
use std::env;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<()> {
    edge_agent::telemetry::init_telemetry("edge-agent");
    
    let agent_id = env::var("AGENT_ID").unwrap_or_else(|_| "edge-agent-01".to_string());
    let control_plane_url = env::var("CONTROL_PLANE_URL").unwrap_or_else(|_| "https://api.edge-cloud.local".to_string());
    let bootstrap_token = env::var("BOOTSTRAP_TOKEN").ok();
    let cert_path = PathBuf::from("data/certs/bundle.json");
    let db_path = PathBuf::from("data/agent.db");

    // Ensure data directory exists
    std::fs::create_dir_all("data/certs")?;

    let cert_manager = CertificateManager::new(&agent_id, cert_path);
    let mtls_client = MTlsClient::new(control_plane_url, cert_manager, bootstrap_token).await?;

    // Initialize persistence
    let db_manager = Arc::new(DatabaseManager::new(&db_path).await?);
    let shared_mtls = Arc::new(mtls_client);

    // Bootstrap if needed
    if let Err(_) = shared_mtls.refresh_client().await {
        println!("No valid certificate found. Attempting bootstrap...");
        let node_info = NodeRegistrationInfo {
            name: agent_id.clone(),
            region: env::var("AGENT_REGION").unwrap_or_else(|_| "us-east-1".to_string()),
            ip_address: "127.0.0.1".to_string(),
            port: 4000,
            cpu_cores: 4,
            memory_gb: 8,
            storage_gb: 100,
        };
        shared_mtls.bootstrap(node_info).await?;
    }

    let agent = Agent::new(db_manager, shared_mtls)?;
    println!("Rust Edge Agent started with persistence and mTLS security.");
    
    agent.run().await?;
    
    Ok(())
}
