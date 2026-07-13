import ts from 'typescript';
import { readText } from './repo.mts';

export function parseTypeScript(root: string, path: string): ts.SourceFile {
  return ts.createSourceFile(path, readText(root, path), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

export function findVariable(sourceFile: ts.SourceFile, name: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function stringArrayFromVariable(sourceFile: ts.SourceFile, name: string): string[] {
  const declaration = findVariable(sourceFile, name);
  if (!declaration?.initializer) throw new Error(`${sourceFile.fileName}: missing initialized variable ${name}`);
  const initializer = unwrapExpression(declaration.initializer);
  const array = ts.isArrayLiteralExpression(initializer)
    ? initializer
    : ts.isNewExpression(initializer) && initializer.arguments?.[0] && ts.isArrayLiteralExpression(initializer.arguments[0])
      ? initializer.arguments[0]
      : undefined;
  if (!array) throw new Error(`${sourceFile.fileName}: ${name} must be an array literal or Set constructed from one`);
  return array.elements.map((element) => {
    const value = unwrapExpression(element as ts.Expression);
    if (!ts.isStringLiteralLike(value)) throw new Error(`${sourceFile.fileName}: ${name} contains a non-string element`);
    return value.text;
  });
}

export function literalStringsFromType(type: ts.TypeNode, sourceFile: ts.SourceFile, seen = new Set<string>()): string[] {
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteralLike(type.literal)) return [type.literal.text];
  if (ts.isUnionTypeNode(type)) return type.types.flatMap((child) => literalStringsFromType(child, sourceFile, seen));
  if (ts.isParenthesizedTypeNode(type)) return literalStringsFromType(type.type, sourceFile, seen);
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
    const name = type.typeName.text;
    if (seen.has(name)) return [];
    seen.add(name);
    const alias = sourceFile.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
    if (alias) return literalStringsFromType(alias.type, sourceFile, seen);
    const variable = findVariable(sourceFile, name);
    if (variable?.initializer) {
      const initializer = unwrapExpression(variable.initializer);
      if (ts.isArrayLiteralExpression(initializer)) return initializer.elements.filter(ts.isStringLiteralLike).map((entry) => entry.text);
    }
  }
  if (ts.isIndexedAccessTypeNode(type)) {
    const objectType = ts.isParenthesizedTypeNode(type.objectType) ? type.objectType.type : type.objectType;
    if (!ts.isTypeQueryNode(objectType)) return [];
    const expression = objectType.exprName;
    if (ts.isIdentifier(expression)) {
      const variable = findVariable(sourceFile, expression.text);
      if (variable?.initializer) {
        const initializer = unwrapExpression(variable.initializer);
        if (ts.isArrayLiteralExpression(initializer)) return initializer.elements.filter(ts.isStringLiteralLike).map((entry) => entry.text);
      }
    }
  }
  return [];
}

export function stringsFromTypeAlias(sourceFile: ts.SourceFile, name: string): string[] {
  const alias = sourceFile.statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name);
  if (!alias) throw new Error(`${sourceFile.fileName}: missing type alias ${name}`);
  return literalStringsFromType(alias.type, sourceFile);
}

export function stringsFromInterfaceProperty(sourceFile: ts.SourceFile, interfaceName: string, propertyName: string): string[] {
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
  );
  if (!declaration) throw new Error(`${sourceFile.fileName}: missing interface ${interfaceName}`);
  let members: ts.NodeArray<ts.TypeElement> = declaration.members;
  let property: ts.PropertySignature | undefined;
  const segments = propertyName.split('.');
  for (const [index, segment] of segments.entries()) {
    property = members.find(
      (member): member is ts.PropertySignature => ts.isPropertySignature(member) && member.name && ((ts.isIdentifier(member.name) && member.name.text === segment) || (ts.isStringLiteralLike(member.name) && member.name.text === segment))
    );
    if (!property?.type) throw new Error(`${sourceFile.fileName}: missing property ${interfaceName}.${segments.slice(0, index + 1).join('.')}`);
    if (index < segments.length - 1) {
      if (!ts.isTypeLiteralNode(property.type)) throw new Error(`${sourceFile.fileName}: ${interfaceName}.${segments.slice(0, index + 1).join('.')} is not an inline object type`);
      members = property.type.members;
    }
  }
  return literalStringsFromType(property!.type!, sourceFile);
}
