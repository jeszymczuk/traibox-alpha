import { z } from 'zod';
import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { auditComponentTokens, verifyComponentDebt } from './component-token-audit.mts';
import { pathExists, readText, readYaml } from './shared/repo.mts';

const registrySchema = z
  .object({
    schema_version: z.literal(1),
    registry_id: z.string().min(1),
    status: z.literal('REVIEW'),
    canonical_files: z.object({ tokens: z.string().min(1), themes: z.string().min(1), tailwind: z.string().min(1) }).strict(),
    required_families: z.record(z.array(z.string().regex(/^--[a-z0-9-]+$/)).min(1))
  })
  .strict();

type CssBlock = { selector: string; variables: Map<string, string>; duplicates: string[] };

export function parseCssVariableBlocks(css: string): CssBlock[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: CssBlock[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!.trim();
    const variables = new Map<string, string>();
    const duplicates: string[] = [];
    for (const variable of match[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const name = variable[1]!;
      if (variables.has(name)) duplicates.push(name);
      variables.set(name, variable[2]!.trim());
    }
    if (variables.size > 0) blocks.push({ selector, variables, duplicates });
  }
  return blocks;
}

function add(findings: ConformanceFinding[], rule: string, message: string, source: string, severity: ConformanceFinding['severity'] = 'high'): void {
  findings.push({ check: 'design-tokens', rule, message, source, severity });
}

export function undefinedTailwindVariables(defined: Iterable<string>, tailwindSource: string): string[] {
  const available = new Set(defined);
  return [...new Set([...tailwindSource.matchAll(/var\((--[a-z0-9-]+)\)/gi)].map((match) => match[1]!).filter((variable) => !available.has(variable)))].sort();
}

export function checkDesignTokenStructure(context: CheckContext): { findings: ConformanceFinding[]; baselined: ConformanceFinding[] } {
  const findings: ConformanceFinding[] = [];
  const registry = registrySchema.parse(readYaml(context.root, 'scripts/conformance/registries/design-token-contract.yaml'));
  for (const path of Object.values(registry.canonical_files)) {
    if (!pathExists(context.root, path)) add(findings, 'DS_CANONICAL_FILE_MISSING', `canonical token file is missing or relocated without registry update: ${path}`, path, 'critical');
  }
  if (findings.length > 0) return { findings, baselined: [] };

  const tokenBlocks = parseCssVariableBlocks(readText(context.root, registry.canonical_files.tokens));
  const themeBlocks = parseCssVariableBlocks(readText(context.root, registry.canonical_files.themes));
  const dark = tokenBlocks.find((block) => block.selector.includes("data-theme='dark'"));
  const base = tokenBlocks.find((block) => block.selector === ':root');
  const light = themeBlocks.find((block) => block.selector.includes("data-theme='light'"));
  if (!dark) add(findings, 'DS_DARK_THEME_MISSING', 'tokens.css must define :root[data-theme=dark]', registry.canonical_files.tokens, 'critical');
  if (!base) add(findings, 'DS_BASE_TOKENS_MISSING', 'tokens.css must define structural :root tokens', registry.canonical_files.tokens, 'critical');
  if (!light) add(findings, 'DS_LIGHT_THEME_MISSING', 'themes.css must define :root[data-theme=light]', registry.canonical_files.themes, 'critical');
  if (!dark || !base || !light) return { findings, baselined: [] };

  for (const block of [...tokenBlocks, ...themeBlocks]) {
    for (const duplicate of block.duplicates) add(findings, 'DS_DUPLICATE_TOKEN_DEFINITION', `${duplicate} is defined more than once in ${block.selector}`, block.selector.includes('light') ? registry.canonical_files.themes : registry.canonical_files.tokens);
  }
  for (const variable of dark.variables.keys()) if (!light.variables.has(variable)) add(findings, 'DS_LIGHT_THEME_VARIABLE_MISSING', `${variable} exists in the canonical dark theme but not the light theme`, registry.canonical_files.themes);
  for (const variable of light.variables.keys()) if (!dark.variables.has(variable)) add(findings, 'DS_DARK_THEME_VARIABLE_MISSING', `${variable} exists in the light theme but not the canonical dark theme`, registry.canonical_files.tokens);

  const allVariables = new Set([...dark.variables.keys(), ...base.variables.keys(), ...light.variables.keys()]);
  for (const [family, variables] of Object.entries(registry.required_families)) {
    for (const variable of variables) if (!allVariables.has(variable)) add(findings, 'DS_REQUIRED_TOKEN_MISSING', `${family} token family is missing ${variable}`, registry.canonical_files.tokens);
  }
  const tailwind = readText(context.root, registry.canonical_files.tailwind);
  for (const variable of undefinedTailwindVariables(allVariables, tailwind)) add(findings, 'DS_TAILWIND_UNDEFINED_VARIABLE', `Tailwind maps to undefined ${variable}`, registry.canonical_files.tailwind);
  const debt = verifyComponentDebt(context.root, auditComponentTokens(context.root));
  return { findings: [...findings, ...debt.findings], baselined: debt.baselined };
}

export async function runDesignTokensCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  const result = checkDesignTokenStructure(context);
  return { check: 'design-tokens', ...result };
}
