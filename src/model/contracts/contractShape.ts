// Compares the SHAPE of a mock fixture against a contract example: which
// fields exist, nested where, holding which type of value. Titles, ids and
// counts are ignored on purpose — our fixtures deliberately carry different
// data from wokay's examples (see the OPDS-samples README), so comparing
// values would fail on day one.
//
// The two directions mean different things, which is why they are reported
// separately: a path only the example has means the contract moved and we are
// behind it, while a path only the fixture has is usually us being richer than
// one tenant's example.

/** One difference set. Both lists are sorted so failure output is stable. */
export type ShapeComparison = {
  /** In the contract example, absent from the fixture. Treat as a failure. */
  missingFromFixture: string[];
  /** In the fixture, absent from the example. Allowed case by case. */
  extraInFixture: string[];
};

function describeLeaf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    // Only reachable for an empty array; a filled one recurses instead.
    return 'empty-array';
  }
  return typeof value;
}

function walk(value: unknown, path: string, found: Set<string>): void {
  if (Array.isArray(value) && value.length > 0) {
    // Every element folds onto the same path, so ten links read as one shape.
    for (const element of value) {
      walk(element, `${path}[]`, found);
    }
    return;
  }

  const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (isPlainObject) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) {
      for (const [key, child] of entries) {
        const childPath = path === '' ? key : `${path}.${key}`;
        walk(child, childPath, found);
      }
      return;
    }
  }

  found.add(`${path} :${describeLeaf(value)}`);
}

/**
 * Flattens a document into `path :type` strings, with array indices collapsed
 * to `[]` so element count never registers as a shape difference.
 */
export function collectShapePaths(document: unknown): Set<string> {
  const found = new Set<string>();
  walk(document, '', found);
  return found;
}

export type ShapeAllowances = {
  /** Fixture-only paths that are known to be legitimate. */
  allowedExtraPaths?: string[];
  /**
   * Whole optional blocks this fixture deliberately does not carry, named by
   * their path prefix — a new institution with no `groups`, an audiobook with
   * no `encrypted`. Naming the branch beats listing every leaf beneath it.
   */
  omittedBranches?: string[];
};

// True when `path` is the branch itself or something nested inside it. The
// boundary check stops `copies` from also swallowing `copiesAvailable`.
function isInsideBranch(path: string, branch: string): boolean {
  if (!path.startsWith(branch)) {
    return false;
  }
  const nextCharacter = path.charAt(branch.length);
  return nextCharacter === '.' || nextCharacter === '[' || nextCharacter === ' ';
}

/**
 * Compares a fixture against the contract example it was built from.
 *
 * @param fixture  The mock document as the app loads it.
 * @param example  The `example:` block from the pinned contract.
 * @param allowances  The differences already known to be legitimate.
 */
export function compareShape(
  fixture: unknown,
  example: unknown,
  allowances: ShapeAllowances = {},
): ShapeComparison {
  const fixturePaths = collectShapePaths(fixture);
  const examplePaths = collectShapePaths(example);
  const allowed = new Set(allowances.allowedExtraPaths ?? []);
  const omittedBranches = allowances.omittedBranches ?? [];

  const missingFromFixture: string[] = [];
  for (const path of examplePaths) {
    if (fixturePaths.has(path)) {
      continue;
    }
    const isOmittedOnPurpose = omittedBranches.some((branch) => isInsideBranch(path, branch));
    if (!isOmittedOnPurpose) {
      missingFromFixture.push(path);
    }
  }

  const extraInFixture: string[] = [];
  for (const path of fixturePaths) {
    if (!examplePaths.has(path) && !allowed.has(path)) {
      extraInFixture.push(path);
    }
  }

  missingFromFixture.sort();
  extraInFixture.sort();
  return { missingFromFixture, extraInFixture };
}
