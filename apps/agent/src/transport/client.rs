use anyhow::{Context, Result};
use reqwest::{Client, Identity, Certificate};
use serde::{Deserialize, Serialize};
use tracing::{info, warn, error};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::security::certificate_manager::{CertificateManager, CertBundle};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignRequest {
    csr: String,
    bootstrap_token: String,
    node_name: String,
    region: String,
    ip_address: String,
    port: u16,
    cpu_cores: u32,
    memory_gb: u32,
    storage_gb: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignResponse {
    certificate: String,
    ca_certificate: String,
    node_id: String,
    expires_at: String,
}

pub struct MTlsClient {
    client: Arc<RwLock<Client>>,
    cert_manager: CertificateManager,
    base_url: String,
    bootstrap_token: Option<String>,
}

impl MTlsClient {
    pub async fn new(
        base_url: String,
        cert_manager: CertificateManager,
        bootstrap_token: Option<String>,
    ) -> Result<Self> {
        let slf = Self {
            client: Arc::new(RwLock::new(Client::new())),
            cert_manager,
            base_url,
            bootstrap_token,
        };
        
        slf.refresh_client().await?;
        Ok(slf)
    }

    /// Refreshes the internal reqwest client with current mTLS credentials
    pub async fn refresh_client(&self) -> Result<()> {
        let bundle = match self.cert_manager.load_bundle() {
            Ok(b) => Some(b),
            Err(_) => {
                info!("No certificate bundle found. Client will start in bootstrap mode.");
                None
            }
        };

        let mut builder = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .use_rustls_tls();

        if let Some(bundle) = bundle {
            // Check for rotation
            if self.cert_manager.needs_rotation(&bundle) {
                warn!("Certificate needs rotation. Attempting renewal...");
                // In a real implementation, we would call a renewal endpoint here
            }

            // Configure mTLS Identity
            let identity_pem = format!("{}\n{}", bundle.certificate, bundle.private_key);
            let identity = Identity::from_pem(identity_pem.as_bytes())
                .context("Failed to create mTLS identity from PEM")?;
            
            // Configure Root CA
            let ca_cert = Certificate::from_pem(bundle.ca_certificate.as_bytes())
                .context("Failed to parse CA certificate")?;

            builder = builder
                .identity(identity)
                .add_root_certificate(ca_cert);
            
            info!("mTLS client initialized with agent certificate");
        }

        let new_client = builder.build().context("Failed to build reqwest client")?;
        let mut client_lock = self.client.write().await;
        *client_lock = new_client;

        Ok(())
    }

    /// Performs the bootstrap process to obtain a certificate
    pub async fn bootstrap(&self, node_info: NodeRegistrationInfo) -> Result<String> {
        let token = self.bootstrap_token.as_ref()
            .context("Bootstrap token missing but required for certificate issuance")?;

        info!("Starting certificate bootstrap for agent...");

        let (csr, key_pair) = self.cert_manager.generate_csr()?;
        
        let request_body = SignRequest {
            csr,
            bootstrap_token: token.clone(),
            node_name: node_info.name,
            region: node_info.region,
            ip_address: node_info.ip_address,
            port: node_info.port,
            cpu_cores: node_info.cpu_cores,
            memory_gb: node_info.memory_gb,
            storage_gb: node_info.storage_gb,
        };

        let response = self.client.read().await
            .post(format!("{}/v2/agents/certificates/sign", self.base_url))
            .json(&request_body)
            .send()
            .await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            error!("Bootstrap failed: {}", err_body);
            return Err(anyhow::anyhow!("Bootstrap failed: {}", err_body));
        }

        let sign_res: SignResponse = response.json().await?;
        
        let bundle = CertBundle {
            certificate: sign_res.certificate,
            private_key: key_pair.serialize_pem(),
            ca_certificate: sign_res.ca_certificate,
            expires_at: chrono::DateTime::parse_from_rfc3339(&sign_res.expires_at)?.with_timezone(&chrono::Utc),
        };

        self.cert_manager.store_bundle(bundle)?;
        
        // Refresh client to use new credentials
        self.refresh_client().await?;

        info!("Bootstrap completed successfully. Node ID: {}", sign_res.node_id);
        Ok(sign_res.node_id)
    }

    pub async fn get_client(&self) -> Arc<RwLock<Client>> {
        self.client.clone()
    }

    pub async fn report_task_result(&self, result: &crate::types::ExecutionResult) -> Result<()> {
        let response = self.client.read().await
            .post(format!("{}/v2/agents/tasks/{}/result", self.base_url, result.task_id))
            .json(result)
            .send()
            .await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to report result: {}", err_body));
        }

        Ok(())
    }

    pub async fn send_heartbeat(&self, payload: &serde_json::Value) -> Result<()> {
        let response = self.client.read().await
            .post(format!("{}/v2/agents/heartbeat", self.base_url))
            .json(payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to send heartbeat: {}", err_body));
        }

        Ok(())
    }

    pub async fn get_pending_task(&self) -> Result<Option<crate::types::TaskSpec>> {
        let response = self.client.read().await
            .get(format!("{}/v2/agents/tasks/pending", self.base_url))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to get pending task: {}", err_body));
        }

        let task: crate::types::TaskSpec = response.json().await?;
        Ok(Some(task))
    }
}

pub struct NodeRegistrationInfo {
    pub name: String,
    pub region: String,
    pub ip_address: String,
    pub port: u16,
    pub cpu_cores: u32,
    pub memory_gb: u32,
    pub storage_gb: u32,
}
