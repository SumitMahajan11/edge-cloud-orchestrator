# Edge Agent

The Edge Agent is responsible for executing tasks on the edge node. It communicates with the Orchestrator to receive tasks and reports metrics.

## Security

The agent uses mTLS for secure communication.

### Certificate Generation

For local development, you can generate self-signed certificates using the provided script:

```bash
# From the project root
./edge-cloud-orchestrator/infra/scripts/generate-certs-local-dev.sh
```

**⚠️ WARNING: The local development script is NOT for production use.**

In production, certificates are issued by HashiCorp Vault. See `infra/vault/` for Vault certificate issuance configuration.

## Configuration

Configuration is managed via environment variables or a `.env` file.

- `PORT`: Port the agent listens on (default: 4001)
- `NODE_ID`: Unique identifier for this node
- `ORCHESTRATOR_URL`: URL of the orchestrator service
- `ENABLE_MTLS`: Whether to enable mTLS (true/false)
