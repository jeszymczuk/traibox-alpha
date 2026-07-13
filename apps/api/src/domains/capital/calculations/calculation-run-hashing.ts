import { createHash } from 'node:crypto';

/**
 * Cross-language canonical calculation hashing (Part B §B5).
 *
 * This module is the TypeScript half of the language-neutral canonical
 * calculation-hash specification (docs/architecture/agents/
 * capital-calculation-hashing.md). It MUST stay byte-for-byte compatible with
 * the Python Workbench implementation in
 * apps/trade-brain/app/workbench/hashing.py:
 *
 *   payload = canonical_json({calc, calc_v, formula_v, data})
 *   hash    = "sha256:" + sha256(utf8(payload))
 *
 * canonical_json is Python `json.dumps(value, sort_keys=True,
 * separators=(",", ":"), ensure_ascii=True)` over the CANONIZED form:
 * Decimals/dates/datetimes/floats arrive pre-tagged ({"$dec": ...},
 * {"$date": ...}, {"$dt": ...}, {"$float": ...}) because the persisted
 * manifests are stored in canonized form. This module therefore only has to
 * reproduce Python's JSON serialization exactly:
 *   - object keys sorted by Unicode code point;
 *   - separators "," and ":" with no whitespace;
 *   - all non-ASCII characters escaped as \uXXXX (surrogate pairs for
 *     supplementary planes, matching ensure_ascii=True);
 *   - null preserved; undefined is a contract violation (null !== missing).
 *
 * Cross-language parity is proven by the versioned fixtures in
 * packages/contracts/fixtures/financial-calculation-hash-fixtures.v1.json,
 * which run through both the Python and TypeScript test suites.
 */

/** Compare strings by Unicode code point, matching Python's str ordering
 * (JS default string comparison uses UTF-16 code units, which diverges for
 * supplementary-plane characters). */
export function compareCodePoints(a: string, b: string): number {
  const aPoints = Array.from(a);
  const bPoints = Array.from(b);
  const length = Math.min(aPoints.length, bPoints.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (aPoints[i]?.codePointAt(0) ?? 0) - (bPoints[i]?.codePointAt(0) ?? 0);
    if (diff !== 0) return diff;
  }
  return aPoints.length - bPoints.length;
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t'
};

function encodeString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value.charAt(i);
    const code = value.charCodeAt(i);
    if (ESCAPES[ch]) {
      out += ESCAPES[ch];
    } else if (code < 0x20 || code > 0x7e) {
      // ensure_ascii=True: every non-ASCII UTF-16 code unit becomes \uXXXX;
      // supplementary characters serialize as their surrogate pair, exactly
      // like CPython.
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

function encodeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError('canonical.non_finite_number', 'NaN/Infinity cannot appear in a canonical manifest');
  }
  if (!Number.isInteger(value)) {
    // Raw floats never appear in canonized manifests — Python tags them as
    // {"$float": ...} and financial values are tagged decimals.
    throw new CanonicalizationError('canonical.raw_float', `raw non-integer number ${value} is not canonical; decimals must be tagged`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalizationError('canonical.unsafe_integer', `integer ${value} exceeds the safe range for cross-language parity`);
  }
  return String(value);
}

export class CanonicalizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Serialize a canonized manifest exactly as Python's
 * json.dumps(..., sort_keys=True, separators=(",", ":"), ensure_ascii=True). */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) {
    throw new CanonicalizationError('canonical.undefined', 'undefined is not representable; null and missing are distinct');
  }
  switch (typeof value) {
    case 'string':
      return encodeString(value);
    case 'number':
      return encodeNumber(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort(compareCodePoints);
      const parts = keys.map((key) => `${encodeString(key)}:${canonicalJson(record[key])}`);
      return `{${parts.join(',')}}`;
    }
    default:
      throw new CanonicalizationError('canonical.unsupported_type', `type '${typeof value}' is not representable in a canonical manifest`);
  }
}

export interface HashVersionBinding {
  calculator_id: string;
  calculator_version: string;
  formula_version: string;
}

/** Mirror of Python deterministic_hash(): the calculator identity and both
 * versions are bound INSIDE the hashed payload. */
export function deterministicCalculationHash(manifest: unknown, binding: HashVersionBinding): string {
  const payload = canonicalJson({
    calc: binding.calculator_id,
    calc_v: binding.calculator_version,
    formula_v: binding.formula_version,
    data: manifest
  });
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}
