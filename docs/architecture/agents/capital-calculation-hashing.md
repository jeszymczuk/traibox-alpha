# Capital Calculation Canonical Hashing Specification

Status: APPROVED (Part B closure — calculation persistence and audit chain).
Consumers: Python Workbench (`apps/trade-brain/app/workbench/hashing.py`),
TypeScript persistence adapter
(`apps/api/src/domains/capital/calculations/calculation-run-hashing.ts`),
cross-language fixtures
(`packages/contracts/fixtures/financial-calculation-hash-fixtures.v1.json`).

Every persisted financial calculation run carries two deterministic hashes.
A run whose hashes cannot be independently reproduced from its stored
manifests is rejected at persistence time. This document is the
language-neutral definition both implementations must satisfy; the versioned
fixtures are the executable conformance test.

## 1. Hashed payloads

**Input hash** is computed over the *input manifest*:

| Field | Meaning |
| --- | --- |
| `inputs` | Normalized calculator inputs (declared semantically-unordered lists canonically sorted; ordered lists as supplied) |
| `currency_policy` | The effective explicit currency policy |
| `rounding_policy` | The effective validated rounding policy |
| `scenario_id` | Scenario identity (`null` for the base case) |
| `provenance` | Map of input path → provenance kind (behavior-affecting: `unresolved` forces `insufficient_information`) |

**Result hash** is computed over the *result envelope*:

| Field | Meaning |
| --- | --- |
| `status` | `completed \| insufficient_information \| invalid_input \| failed` |
| `eligibility` | `eligible \| ineligible \| insufficient_information \| not_applicable` |
| `outputs` | Normalized outputs (strict output model, `exclude_none`) |
| `warnings` | Structured warnings (code/message/severity/related paths) |
| `validations` | Validation findings |
| `assumptions_used` | Canonically sorted |
| `missing_fields` | Canonically sorted |
| `contradictions` | Canonically sorted |

Calculator identity binds *inside* the hash wrapper (§4) — it is not part of
the manifest body.

## 2. Canonical value forms (tagged)

The persisted manifests store values in **canonized, JSON-safe, tagged**
form. Canonization is idempotent — hashing the stored form reproduces the
original hash.

| Source value | Canonical form |
| --- | --- |
| Decimal / arbitrary-precision number | `{"$dec": "<normalized string>"}` (the Workbench decimal policy string; no locale formatting) |
| Calendar date | `{"$date": "YYYY-MM-DD"}` (ISO 8601) |
| Timestamp | `{"$dt": "<ISO 8601 with offset>"}` — naive timestamps are not produced; timezone-aware values keep their offset text |
| Binary float (rejected-input audit only) | `{"$float": "<repr>"}` — valid financial values never reach hashing as floats |
| Currency code | Uppercase ISO 4217 text (normalized before the manifest is built) |
| `null` | `null` — **null and missing are distinct**; absent keys are omitted before hashing by the engine's normalization |
| int / bool / string | Native JSON forms |

Raw (untagged) non-integer numbers, `NaN`, `Infinity`, and `undefined` are
not representable in a canonical manifest; both implementations reject them.

## 3. Canonical JSON serialization

Identical to Python `json.dumps(value, sort_keys=True, separators=(",", ":"),
ensure_ascii=True)`:

1. Object keys sorted by **Unicode code point** (not UTF-16 code units).
2. Separators `,` and `:` with no whitespace.
3. All non-ASCII characters escaped as `\uXXXX`; supplementary-plane
   characters as surrogate pairs (`🚢` → `🚢`).
4. Standard short escapes for `"` `\` and control characters
   (`\b \f \n \r \t`), `\uXXXX` for other control characters.
5. UTF-8 encoding of the resulting ASCII string (byte-identical by
   construction).
6. **List order is meaningful** except for lists declared
   `unordered_list_paths` by the calculator definition, which are sorted by
   the canonical JSON of each element *before* the manifest is built.

## 4. Hash rule

```
payload = canonical_json({
  "calc":      <calculator_id>,
  "calc_v":    <calculator_version>,
  "formula_v": <formula_version>,
  "data":      <manifest>,
})
hash = "sha256:" + lowercase_hex(sha256(utf8(payload)))
```

The wrapper keys serialize in sorted order (`calc`, `calc_v`, `data`,
`formula_v`). Changing the calculator version or formula version changes
both hashes even for identical data — versions are audit-relevant identity.

## 5. Persistence contract

`financial_calculation_runs` stores `input_manifest_json` and
`result_envelope_json` exactly as hashed (V018). The TypeScript adapter
recomputes both hashes from those columns' values on every insert and rejects
mismatches; the query-oriented columns (`result_json`, `warnings_json`,
`validation_results_json`, `status`, `eligibility`, `missing_fields_json`,
`assumptions_used_json`, `contradictions_json`) are projections and must
agree with the envelope. Projections use untagged JSON (decimal strings, ISO
dates) for queryability; they are never hashed.

## 6. Conformance

`packages/contracts/fixtures/financial-calculation-hash-fixtures.v1.json` is
generated from real Workbench executions and covers: tagged decimals,
tagged dates, unordered-list sorting, `insufficient_information` from
unresolved provenance, `invalid_input` float rejection with `$float` tags,
scenario identity, and non-ASCII text. The Python suite
(`tests/test_workbench.py::CrossLanguageFixtureTest`) and the TypeScript
suite (`calculation-run-hashing.test.ts`) run the identical file; every hash
must match exactly. A fixture change requires a new fixture version, never an
in-place edit.
