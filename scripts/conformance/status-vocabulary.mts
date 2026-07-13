import ts from 'typescript';
import { z } from 'zod';
import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { applyDebtBaseline, loadDebtBaseline } from './shared/baseline.mts';
import { getAtPath, fingerprint, pathExists, readText, readYaml, sortedUnique } from './shared/repo.mts';
import { parseTypeScript, stringArrayFromVariable, stringsFromInterfaceProperty, stringsFromTypeAlias, unwrapExpression } from './shared/typescript.mts';
import { loadGovernanceDocuments } from './governance-schema.mts';

const sourceSchema = z
  .object({
    id: z.string().min(1),
    domain: z.string().min(1),
    state_machine: z.string().min(1),
    manifest_path: z.string().min(1),
    owner: z.string().startsWith('@'),
    source: z.string().min(1),
    extractor: z.enum(['yaml_path', 'ts_type_alias', 'ts_const_array', 'ts_interface_property', 'ts_function_status_literals', 'ts_function_variable_literals', 'ts_sql_status_literals', 'sql_table_status']),
    symbol: z.string().min(1).optional(),
    property: z.string().min(1).optional(),
    table: z.string().min(1).optional(),
    shared: z.boolean().optional()
  })
  .strict();

const registrySchema = z
  .object({
    schema_version: z.literal(1),
    registry_id: z.string().min(1),
    status: z.literal('REVIEW'),
    sources: z.array(sourceSchema),
    aliases: z.array(z.object({ domain: z.string().min(1), alias: z.string().min(1), canonical: z.string().min(1) }).strict())
  })
  .strict();

type RegisteredSource = z.infer<typeof sourceSchema>;

function findFunction(sourceFile: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
  return sourceFile.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
}

function collectStringLiterals(node: ts.Node): string[] {
  const values: string[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isStringLiteralLike(child)) values.push(child.text);
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return values;
}

function functionStatusLiterals(sourceFile: ts.SourceFile, symbols: string): string[] {
  const values: string[] = [];
  for (const symbol of symbols.split(',')) {
    const fn = findFunction(sourceFile, symbol.trim());
    if (!fn) throw new Error(`${sourceFile.fileName}: missing function ${symbol.trim()}`);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node) && ((ts.isIdentifier(node.name) && node.name.text === 'status') || (ts.isStringLiteralLike(node.name) && node.name.text === 'status'))) {
        values.push(...collectStringLiterals(node.initializer));
      }
      ts.forEachChild(node, visit);
    };
    visit(fn);
  }
  return sortedUnique(values.filter((value) => /^[a-z][a-z0-9_]*$/.test(value)));
}

function functionVariableLiterals(sourceFile: ts.SourceFile, selector: string): string[] {
  const [functionName, variableName] = selector.split('#');
  if (!functionName || !variableName) throw new Error(`${sourceFile.fileName}: function-variable selector must be function#variable`);
  const fn = findFunction(sourceFile, functionName);
  if (!fn) throw new Error(`${sourceFile.fileName}: missing function ${functionName}`);
  let declaration: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variableName) declaration = node;
    if (!declaration) ts.forEachChild(node, visit);
  };
  visit(fn);
  if (!declaration?.initializer) throw new Error(`${sourceFile.fileName}: missing initialized variable ${selector}`);
  return sortedUnique(collectStringLiterals(declaration.initializer).filter((value) => /^[a-z][a-z0-9_]*$/.test(value)));
}

function staticString(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;
  const value = unwrapExpression(expression);
  if (ts.isStringLiteralLike(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  return undefined;
}

function queryParameterArray(expression: ts.Expression | undefined): ts.ArrayLiteralExpression | undefined {
  if (!expression) return undefined;
  const value = unwrapExpression(expression);
  return ts.isArrayLiteralExpression(value) ? value : undefined;
}

function sqlStatusLiterals(sourceFile: ts.SourceFile, functionName: string, table: string): string[] {
  const fn = findFunction(sourceFile, functionName);
  if (!fn) throw new Error(`${sourceFile.fileName}: missing function ${functionName}`);
  const values: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'query') {
      const sql = staticString(node.arguments[0]);
      const parameters = queryParameterArray(node.arguments[1]);
      if (sql && parameters && new RegExp(`\\b${table}\\b`, 'i').test(sql)) {
        for (const match of sql.matchAll(/\bstatus\s*=\s*'([^']+)'/gi)) values.push(match[1]!);
        for (const match of sql.matchAll(/\bstatus\s*=\s*\$(\d+)/gi)) {
          const parameter = parameters.elements[Number(match[1]) - 1];
          if (parameter && ts.isStringLiteralLike(parameter)) values.push(parameter.text);
        }
        const insert = sql.match(new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([^)]+)\\)\\s*VALUES\\s*\\(([^)]+)\\)`, 'i'));
        if (insert) {
          const columns = insert[1]!.split(',').map((column) => column.trim().toLowerCase());
          const placeholders = insert[2]!.split(',').map((placeholder) => placeholder.trim());
          const statusIndex = columns.indexOf('status');
          const placeholder = statusIndex >= 0 ? placeholders[statusIndex]?.match(/^\$(\d+)$/)?.[1] : undefined;
          const parameter = placeholder ? parameters.elements[Number(placeholder) - 1] : undefined;
          if (parameter && ts.isStringLiteralLike(parameter)) values.push(parameter.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return sortedUnique(values);
}

function sqlTableStatus(text: string, table: string): string[] {
  const tableMatch = text.match(new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  if (!tableMatch) throw new Error(`missing CREATE TABLE ${table}`);
  const statusLine = tableMatch[1]!.split('\n').find((line) => /^\s*status\s+/i.test(line));
  if (!statusLine) throw new Error(`missing ${table}.status`);
  const values = [...statusLine.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
  return sortedUnique(values);
}

function extractValues(root: string, source: RegisteredSource): string[] {
  if (source.extractor === 'yaml_path') {
    const value = getAtPath(readYaml(root, source.source), source.symbol!);
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) throw new Error(`${source.source}: ${source.symbol} is not a string array`);
    return sortedUnique(value);
  }
  if (source.extractor === 'sql_table_status') return sqlTableStatus(readText(root, source.source), source.table!);
  const sourceFile = parseTypeScript(root, source.source);
  if (source.extractor === 'ts_type_alias') return sortedUnique(stringsFromTypeAlias(sourceFile, source.symbol!));
  if (source.extractor === 'ts_const_array') return sortedUnique(source.symbol!.split(',').flatMap((symbol) => stringArrayFromVariable(sourceFile, symbol.trim())));
  if (source.extractor === 'ts_interface_property') return sortedUnique(stringsFromInterfaceProperty(sourceFile, source.symbol!, source.property!));
  if (source.extractor === 'ts_function_status_literals') return functionStatusLiterals(sourceFile, source.symbol!);
  if (source.extractor === 'ts_function_variable_literals') return functionVariableLiterals(sourceFile, source.symbol!);
  if (source.extractor === 'ts_sql_status_literals') return sqlStatusLiterals(sourceFile, source.symbol!, source.table!);
  return [];
}

function manifestValues(statusManifest: unknown, path: string): string[] {
  const entry = getAtPath(statusManifest, path);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`status manifest path ${path} is not an object`);
  const values = (entry as Record<string, unknown>).values ?? (entry as Record<string, unknown>).observed_values;
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) throw new Error(`status manifest path ${path} does not expose enumerable values`);
  return sortedUnique(values);
}

function add(findings: ConformanceFinding[], rule: string, source: RegisteredSource, value: string, message: string): void {
  findings.push({
    check: 'status-vocabulary',
    rule,
    message,
    source: source.source,
    severity: 'medium',
    baselineKey: fingerprint(rule, source.id, source.manifest_path, value)
  });
}

export function compareStatusValueSets(input: { id: string; domain: string; stateMachine: string; manifestPath: string; source: string; implementation: string[]; declared: string[] }): ConformanceFinding[] {
  const source = {
    id: input.id,
    domain: input.domain,
    state_machine: input.stateMachine,
    manifest_path: input.manifestPath,
    owner: '@fixture',
    source: input.source,
    extractor: 'ts_type_alias' as const
  };
  const findings: ConformanceFinding[] = [];
  for (const value of sortedUnique(input.implementation)) if (!input.declared.includes(value)) add(findings, 'STATUS_IMPLEMENTATION_VALUE_UNDECLARED', source, value, `${input.domain}/${input.stateMachine} implementation value ${value} is absent from the manifest`);
  for (const value of sortedUnique(input.declared)) if (!input.implementation.includes(value)) add(findings, 'STATUS_MANIFEST_VALUE_UNIMPLEMENTED', source, value, `${input.domain}/${input.stateMachine} manifest value ${value} is absent from the registered implementation source`);
  return findings;
}

export function findStatusVocabularyDiscrepancies(context: CheckContext): ConformanceFinding[] {
  const registry = registrySchema.parse(readYaml(context.root, 'scripts/conformance/registries/status-sources.yaml'));
  const { statuses } = loadGovernanceDocuments(context.root);
  const findings: ConformanceFinding[] = [];
  const ids = new Set<string>();
  const selectorOwners = new Map<string, RegisteredSource[]>();
  const grouped = new Map<string, { source: RegisteredSource; implementation: Set<string> }>();
  for (const source of registry.sources) {
    if (ids.has(source.id)) add(findings, 'STATUS_REGISTRY_DUPLICATE_ID', source, source.id, `duplicate source id ${source.id}`);
    ids.add(source.id);
    if (!pathExists(context.root, source.source)) add(findings, 'STATUS_REGISTRY_SOURCE_MISSING', source, source.source, `registered source does not exist: ${source.source}`);
    const selector = `${source.source}#${source.extractor}:${source.symbol ?? source.table ?? ''}:${source.property ?? ''}`;
    selectorOwners.set(selector, [...(selectorOwners.get(selector) ?? []), source]);
    try {
      const key = `${source.domain}\u0000${source.state_machine}\u0000${source.manifest_path}`;
      const current = grouped.get(key) ?? { source, implementation: new Set<string>() };
      for (const value of extractValues(context.root, source)) current.implementation.add(value);
      grouped.set(key, current);
      const manifestEntry = getAtPath(statuses, source.manifest_path) as Record<string, unknown> | undefined;
      const declaredSources = manifestEntry ? [manifestEntry.source, ...(Array.isArray(manifestEntry.sources) ? manifestEntry.sources : [])].filter((value): value is string => typeof value === 'string') : [];
      if (source.manifest_path !== 'governance_document_statuses' && !declaredSources.map((declared) => declared.split('#', 1)[0]).includes(source.source)) {
        add(findings, 'STATUS_REGISTRY_SOURCE_CONFLICT', source, source.source, `${source.id} scans ${source.source}, which is not declared at ${source.manifest_path}`);
      }
    } catch (error) {
      add(findings, 'STATUS_EXTRACTION_FAILED', source, source.id, error instanceof Error ? error.message : String(error));
    }
  }
  for (const owners of selectorOwners.values()) {
    if (owners.length > 1 && owners.some((source) => !source.shared)) {
      add(findings, 'STATUS_STATE_MACHINE_COLLAPSE', owners[0]!, owners[0]!.id, `one source selector is assigned to independent machines: ${owners.map((source) => `${source.domain}/${source.state_machine}`).join(', ')}`);
    }
  }
  for (const { source, implementation } of grouped.values()) {
    let declared: string[];
    try {
      declared = source.manifest_path === 'governance_document_statuses'
        ? sortedUnique((getAtPath(statuses, `${source.manifest_path}.values`) as string[]) ?? [])
        : manifestValues(statuses, source.manifest_path);
    } catch (error) {
      add(findings, 'STATUS_MANIFEST_VALUES_INVALID', source, source.manifest_path, error instanceof Error ? error.message : String(error));
      continue;
    }
    findings.push(
      ...compareStatusValueSets({
        id: source.id,
        domain: source.domain,
        stateMachine: source.state_machine,
        manifestPath: source.manifest_path,
        source: source.source,
        implementation: [...implementation],
        declared
      })
    );
  }
  const aliasTargets = new Map<string, string>();
  for (const alias of registry.aliases) {
    const key = `${alias.domain}\u0000${alias.alias}`;
    const prior = aliasTargets.get(key);
    if (prior === alias.canonical) {
      findings.push({ check: 'status-vocabulary', rule: 'STATUS_ALIAS_DUPLICATE', message: `duplicate alias ${alias.domain}/${alias.alias}`, source: 'scripts/conformance/registries/status-sources.yaml', severity: 'high' });
    } else if (prior && prior !== alias.canonical) {
      findings.push({ check: 'status-vocabulary', rule: 'STATUS_ALIAS_CONFLICT', message: `${alias.domain}/${alias.alias} maps to both ${prior} and ${alias.canonical}`, source: 'scripts/conformance/registries/status-sources.yaml', severity: 'high' });
    }
    aliasTargets.set(key, alias.canonical);
  }
  return findings;
}

export async function runStatusVocabularyCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  const raw = findStatusVocabularyDiscrepancies(context);
  const baseline = loadDebtBaseline(context.root, 'scripts/conformance/baselines/status-vocabulary-debt.json');
  const applied = applyDebtBaseline(raw, baseline.entries);
  for (const stale of applied.stale) {
    applied.unbaselined.push({ check: 'status-vocabulary', rule: 'STATUS_BASELINE_STALE', message: `remove remediated baseline entry ${stale.fingerprint}`, source: 'scripts/conformance/baselines/status-vocabulary-debt.json', severity: 'medium' });
  }
  return { check: 'status-vocabulary', findings: applied.unbaselined, baselined: applied.baselined };
}
