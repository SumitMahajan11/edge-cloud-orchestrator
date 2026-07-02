import { 
  EnvSecretManager, 
  K8sSecretManager, 
  type SecretManager, 
  VaultSecretManager} from './SecretManager';

export class SecretManagerFactory {
  static create(): SecretManager {
    const backend = process.env.SECRET_BACKEND || (process.env.NODE_ENV === 'production' ? 'vault' : 'env');
    const isProd = process.env.NODE_ENV === 'production';

    if (backend === 'vault') {
      const address = process.env.VAULT_ADDR || 'https://vault:8200';
      const token = process.env.VAULT_TOKEN;
      const mountPath = process.env.VAULT_MOUNT_PATH || 'secret';
      
      if (!token && isProd) {
        console.warn('[SecretManager] VAULT_TOKEN is missing in production. Falling back to K8s.');
      } else if (token) {
        return new VaultSecretManager({ address, token, mountPath });
      }
    }

    if (backend === 'k8s' || (backend === 'vault' && !process.env.VAULT_TOKEN)) {
      const dir = process.env.K8S_SECRETS_DIR || '/var/run/secrets/edgecloud';
      return new K8sSecretManager(dir);
    }

    if (!isProd && backend !== 'env') {
       // Optional: Log warning if explicitly set to something else but falling back
    } else if (isProd) {
      console.warn('[SecretManager] Using EnvSecretManager in production! This is not recommended.');
    }

    return new EnvSecretManager();
  }
}
