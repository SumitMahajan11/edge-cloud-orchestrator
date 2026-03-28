export { VaultClient, type VaultConfig, type DatabaseCredentials, type CertificateResponse } from './vault-client';

export {
  ABACEngine,
  PolicyBuilder,
  TimeBasedAttributeResolver,
  RoleHierarchyResolver,
  DEFAULT_POLICIES,
  type Subject,
  type Resource,
  type Action,
  type Environment,
  type AccessRequest,
  type Policy,
  type PolicyCondition,
  type AccessDecision,
  type Obligation,
} from './abac';

export {
  MTLSManager,
  type CertificateAuthority,
  type CertificateRequest,
  type IssuedCertificate,
  type MTLSConfig,
} from './mtls';
