import { randomUUID as nodeRandomUUID } from 'node:crypto';

export function randomUUID() {
  return nodeRandomUUID();
}
