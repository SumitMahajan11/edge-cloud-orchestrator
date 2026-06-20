/**
 * Secure Transport Client (mTLS) for the Edge Agent.
 *
 * What it does: Manages mTLS authentication, certificate bootstrapping,
 * and encrypted telemetry/outbox communication with the control plane (API).
 *
 * Key features:
 * - Bootstraps node credentials by generating a local Certificate Signing Request (CSR)
 *   and exchanging it with a one-time bootstrap token for an signed client cert.
 * - Auto-refreshes the internal HTTP client with TLS credentials and the CA bundle.
 * - Implements telemetry transport methods: `send_heartbeat`, `get_pending_task`,
 *   `report_task_result`, and federated learning upload/download APIs.
 */
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
    #[serde(rename = "memoryGB")]
    memory_gb: u32,
    #[serde(rename = "storageGB")]
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

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FederatedRoundInfo {
    pub round_id: String,
    pub round_number: i32,
    pub model_id: String,
    pub status: String,
    pub min_participants: i32,
    pub submissions_count: i32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FederatedSubmission {
    pub round_id: String,
    pub node_id: String,
    pub weights_url: String,
    pub sample_count: i32,
    pub avg_reward: f64,
}

pub struct MTlsClient {
    client: Arc<RwLock<Client>>,
    cert_manager: CertificateManager,
    base_url: String,
    bootstrap_token: Option<String>,
    node_id: Arc<RwLock<Option<String>>>,
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
            node_id: Arc::new(RwLock::new(None)),
        };
        
        slf.refresh_client().await?;
        Ok(slf)
    }

    pub async fn node_id(&self) -> Option<String> {
        let nid = self.node_id.read().await;
        nid.clone()
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
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

            // Store node_id if present
            if let Some(ref nid) = bundle.node_id {
                let mut nid_lock = self.node_id.write().await;
                *nid_lock = Some(nid.clone());
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
            node_id: Some(sign_res.node_id.clone()),
        };

        self.cert_manager.store_bundle(bundle)?;
        
        {
            let mut nid_lock = self.node_id.write().await;
            *nid_lock = Some(sign_res.node_id.clone());
        }

        // Refresh client to use new credentials
        self.refresh_client().await?;

        info!("Bootstrap completed successfully. Node ID: {}", sign_res.node_id);
        Ok(sign_res.node_id)
    }

    pub async fn get_client(&self) -> Arc<RwLock<Client>> {
        self.client.clone()
    }

    pub async fn report_task_result(&self, result: &crate::types::ExecutionResult) -> Result<()> {
        let req = self.client.read().await
            .post(format!("{}/v2/agents/tasks/{}/result", self.base_url, result.task_id))
            .json(result);
        let req = if let Some(ref nid) = *self.node_id.read().await {
            req.header("x-node-id", nid)
        } else {
            req
        };
        let response = req.send().await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to report result: {}", err_body));
        }

        Ok(())
    }

    pub async fn send_heartbeat(&self, payload: &serde_json::Value) -> Result<()> {
        let req = self.client.read().await
            .post(format!("{}/v2/agents/heartbeat", self.base_url))
            .json(payload);
        let req = if let Some(ref nid) = *self.node_id.read().await {
            req.header("x-node-id", nid)
        } else {
            req
        };
        let response = req.send().await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to send heartbeat: {}", err_body));
        }

        Ok(())
    }

    pub async fn get_pending_task(&self) -> Result<Option<crate::types::TaskSpec>> {
        let req = self.client.read().await
            .get(format!("{}/v2/agents/tasks/pending", self.base_url));
        let req = if let Some(ref nid) = *self.node_id.read().await {
            req.header("x-node-id", nid)
        } else {
            req
        };
        let response = req.send().await?;

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

    pub async fn get_federated_round(&self) -> Result<FederatedRoundInfo> {
        let req = self.client.read().await
            .get(format!("{}/v2/ml/federated/round", self.base_url));
        let req = if let Some(ref nid) = *self.node_id.read().await {
            req.header("x-node-id", nid)
        } else {
            req
        };
        let response = req.send().await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to get federated round: {}", err_body));
        }

        let round_info: FederatedRoundInfo = response.json().await?;
        Ok(round_info)
    }

    pub async fn submit_federated_weights(&self, submission: &FederatedSubmission) -> Result<bool> {
        let req = self.client.read().await
            .post(format!("{}/v2/ml/federated/weights", self.base_url))
            .json(submission);
        let req = if let Some(ref nid) = *self.node_id.read().await {
            req.header("x-node-id", nid)
        } else {
            req
        };
        let response = req.send().await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to submit federated weights: {}", err_body));
        }

        #[derive(Deserialize)]
        struct SuccessResponse {
            success: bool,
        }
        let res: SuccessResponse = response.json().await?;
        Ok(res.success)
    }

    pub async fn download_federated_weights(&self, model_id: &str) -> Result<Vec<f32>> {
        let req = self.client.read().await
            .get(format!("{}/v2/ml/federated/model/{}/weights", self.base_url, model_id));
        let req = if let Some(ref nid) = *self.node_id.read().await {
            req.header("x-node-id", nid)
        } else {
            req
        };
        let response = req.send().await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to download model weights: {}", err_body));
        }

        let bytes = response.bytes().await?;
        if bytes.len() % 4 != 0 {
            return Err(anyhow::anyhow!("Invalid weights buffer size: {}", bytes.len()));
        }

        let count = bytes.len() / 4;
        let mut weights = vec![0.0f32; count];
        for i in 0..count {
            let start = i * 4;
            let mut arr = [0u8; 4];
            arr.copy_from_slice(&bytes[start..start + 4]);
            weights[i] = f32::from_ne_bytes(arr);
        }
        Ok(weights)
    }

    pub async fn submit_federated_weights_multipart(
        &self,
        round_id: &str,
        node_id: &str,
        sample_count: i32,
        avg_reward: f64,
        weights: &[f32],
    ) -> Result<String> {
        let mut bytes = Vec::with_capacity(weights.len() * 4);
        for w in weights {
            bytes.extend_from_slice(&w.to_ne_bytes());
        }

        use reqwest::multipart;
        let form = multipart::Form::new()
            .text("roundId", round_id.to_string())
            .text("nodeId", node_id.to_string())
            .text("sampleCount", sample_count.to_string())
            .text("avgReward", avg_reward.to_string())
            .part("file", multipart::Part::bytes(bytes).file_name("weights.bin").mime_str("application/octet-stream")?);

        let req = self.client.read().await
            .post(format!("{}/v2/ml/federated/weights/upload", self.base_url))
            .multipart(form);
            
        let req = if let Some(ref nid) = *self.node_id.read().await {
            req.header("x-node-id", nid)
        } else {
            req
        };
        let response = req.send().await?;

        if !response.status().is_success() {
            let err_body = response.text().await?;
            return Err(anyhow::anyhow!("Failed to upload weights: {}", err_body));
        }

        #[derive(Deserialize)]
        struct UploadResponse {
            success: bool,
            #[serde(rename = "weightsUrl")]
            weights_url: String,
        }
        let res: UploadResponse = response.json().await?;
        if !res.success {
            return Err(anyhow::anyhow!("Weights upload reported failure from api"));
        }
        Ok(res.weights_url)
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
