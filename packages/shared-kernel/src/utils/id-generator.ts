import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function generateShortId(): string {
  return uuidv4().split('-')[0];
}

export function generateEventId(): string {
  return `evt_${uuidv4()}`;
}

export function generateCorrelationId(): string {
  return `corr_${uuidv4()}`;
}
