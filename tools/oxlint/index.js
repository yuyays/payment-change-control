function memberName(node) {
  return node.computed ? node.property.value : node.property.name;
}

const packages = new Set(["effect", "@effect/platform-node", "@effect/platform-bun"]);
const modules = new Map([
  ["effect/Effect", "Effect"],
  ["effect/ManagedRuntime", "ManagedRuntime"],
  ["@effect/platform-node/NodeRuntime", "NodeRuntime"],
  ["@effect/platform-bun/BunRuntime", "BunRuntime"],
]);

function importedModule(context, node) {
  if (node.type === "MemberExpression" && node.object.type === "Identifier") {
    if (packages.has(importedModule(context, node.object))) return memberName(node);
    return undefined;
  }
  if (node.type !== "Identifier") return undefined;
  let scope = context.sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) {
      for (const definition of variable.defs) {
        if (definition.type !== "ImportBinding") continue;
        const source = definition.parent.source.value;
        if (definition.node.type === "ImportNamespaceSpecifier") {
          return packages.has(source) ? source : modules.get(source);
        }
        if (packages.has(source) && definition.node.type === "ImportSpecifier") {
          return definition.node.imported.name ?? definition.node.imported.value;
        }
      }
      return undefined;
    }
    scope = scope.upper;
  }
  return undefined;
}

function isRuntime(module, name) {
  return (
    (["Effect", "NodeRuntime", "BunRuntime"].includes(module) &&
      typeof name === "string" &&
      name.startsWith("run")) ||
    (module === "ManagedRuntime" && name === "make")
  );
}

const runtimeBoundary = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const report = (node) =>
      context.report({
        node,
        message:
          "Execute Effects only in an entrypoint, framework adapter, or test. Compose Effects and yield services here.",
      });
    return {
      MemberExpression(node) {
        if (isRuntime(importedModule(context, node.object), memberName(node))) report(node);
      },
      ImportDeclaration(node) {
        const module = modules.get(node.source.value);
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            isRuntime(module, specifier.imported.name ?? specifier.imported.value)
          )
            report(specifier);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "ObjectPattern" || !node.init) return;
        const module = importedModule(context, node.init);
        for (const property of node.id.properties) {
          if (
            property.type === "Property" &&
            isRuntime(module, property.key.name ?? property.key.value)
          )
            report(property);
        }
      },
    };
  },
};

const suppressionReason = {
  meta: { type: "problem", schema: [] },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const directive =
            /^\s*(?:(?:eslint|oxlint)-disable(?:-next-line|-line)?\b|@ts-(?:ignore|expect-error|nocheck)\b|@effect-diagnostics(?:-next-line)?\b)/;
          if (directive.test(comment.value) && !/--\s*\S/.test(comment.value)) {
            context.report({
              loc: comment.loc,
              message: "Explain this suppression with a '-- reason' suffix.",
            });
          }
        }
      },
    };
  },
};

export default {
  meta: { name: "starter" },
  rules: { "runtime-boundary": runtimeBoundary, "suppression-reason": suppressionReason },
};
