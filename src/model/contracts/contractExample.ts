// Pulls a response example out of the pinned OpenAPI contracts in
// docs/contracts/, looked up by operationId.
//
// Parsed live from the YAML rather than copied into a JSON snapshot: a
// snapshot would have to be refreshed by hand, which is the copy-it-again
// habit this whole check exists to end.
//
// Test-time only. Nothing in the app reads these files.
import { readFileSync } from 'fs';
import { join } from 'path';

import { load } from 'js-yaml';

const CONTRACTS_DIRECTORY = join(__dirname, '..', '..', '..', 'docs', 'contracts');

/** Parsed contracts, kept because the two YAMLs are ~5,500 lines together. */
const parsedContracts = new Map<string, unknown>();

function readContract(fileName: string): Record<string, unknown> {
  const alreadyParsed = parsedContracts.get(fileName);
  if (alreadyParsed === undefined) {
    const text = readFileSync(join(CONTRACTS_DIRECTORY, fileName), 'utf8');
    const parsed = load(text);
    parsedContracts.set(fileName, parsed);
    return parsed as Record<string, unknown>;
  }
  return alreadyParsed as Record<string, unknown>;
}

type Operation = {
  operationId?: string;
  responses?: Record<string, { content?: Record<string, ExampleHolder> }>;
};

type ExampleHolder = {
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
};

function findOperation(fileName: string, operationId: string): Operation {
  const contract = readContract(fileName);
  const paths = contract.paths as Record<string, Record<string, Operation>>;

  for (const methods of Object.values(paths)) {
    for (const operation of Object.values(methods)) {
      if (operation && operation.operationId === operationId) {
        return operation;
      }
    }
  }

  throw new Error(`${fileName} has no operation with operationId "${operationId}"`);
}

/** The first 2xx response body, whatever media type the operation answers with. */
function findSuccessBody(operation: Operation, operationId: string): ExampleHolder {
  const responses = operation.responses ?? {};

  for (const [status, response] of Object.entries(responses)) {
    const isSuccess = status.startsWith('2');
    if (!isSuccess || !response.content) {
      continue;
    }
    const [body] = Object.values(response.content);
    if (body) {
      return body;
    }
  }

  throw new Error(`operation "${operationId}" has no success response body to take an example from`);
}

/**
 * Returns the response example a fixture should be shaped like.
 *
 * @param fileName  A file in docs/contracts/, e.g. 'wokay-api.yaml'.
 * @param operationId  The OpenAPI operationId, e.g. 'getRootFeed'.
 * @param exampleName  Required only where the operation carries named examples.
 */
export function loadContractExample(
  fileName: string,
  operationId: string,
  exampleName?: string,
): unknown {
  const operation = findOperation(fileName, operationId);
  const body = findSuccessBody(operation, operationId);

  if (exampleName !== undefined) {
    const named = body.examples?.[exampleName];
    if (named === undefined) {
      throw new Error(`operation "${operationId}" has no example named "${exampleName}"`);
    }
    return named.value;
  }

  if (body.example === undefined) {
    throw new Error(
      `operation "${operationId}" has no single example; pass an example name instead`,
    );
  }
  return body.example;
}
