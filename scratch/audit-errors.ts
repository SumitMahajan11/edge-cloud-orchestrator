import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

const API_SRC_DIR = path.resolve(__dirname, "../apps/api/src");

interface AuditResult {
  file: string;
  line: number;
  type:
    | "swallowed_error"
    | "generic_error"
    | "unprotected_async_handler"
    | "non_standard_response"
    | "uncontextualized_log";
  message: string;
  codeSnippet: string;
}

const results: AuditResult[] = [];

function getLineAndCharacter(sourceFile: ts.SourceFile, pos: number) {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, pos);
  return { line: line + 1, character: character + 1 };
}

function getSnippet(sourceFile: ts.SourceFile, node: ts.Node): string {
  return node.getText(sourceFile).slice(0, 100);
}

function scanFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  );

  function checkCatchClause(node: ts.CatchClause) {
    const block = node.block;
    const statements = block.statements;
    const { line } = getLineAndCharacter(sourceFile, node.getStart());

    // 1. Swallowed errors (empty catches)
    if (statements.length === 0) {
      results.push({
        file: filePath,
        line,
        type: "swallowed_error",
        message: "Empty catch block found.",
        codeSnippet: getSnippet(sourceFile, node),
      });
      return;
    }

    // 2. Catch blocks that only log and do not return/throw/re-throw
    let hasRethrowOrReturn = false;
    let onlyLogs = true;

    function checkStatement(s: ts.Node) {
      if (
        s.kind === ts.SyntaxKind.ThrowStatement ||
        s.kind === ts.SyntaxKind.ReturnStatement
      ) {
        hasRethrowOrReturn = true;
        onlyLogs = false;
      }
      if (ts.isCallExpression(s)) {
        const exprText = s.getText(sourceFile);
        if (
          exprText.includes("reply.send") ||
          exprText.includes("reply.status") ||
          exprText.includes("reply.code") ||
          exprText.includes("reject") ||
          exprText.includes("next(")
        ) {
          hasRethrowOrReturn = true;
          onlyLogs = false;
        }
      }
      if (ts.isExpressionStatement(s)) {
        const expr = s.expression;
        if (ts.isCallExpression(expr)) {
          const exprText = expr.getText(sourceFile);
          if (!exprText.match(/logger|console/)) {
            onlyLogs = false;
          }
        } else {
          onlyLogs = false;
        }
      } else if (
        !ts.isBlock(s) &&
        s.kind !== ts.SyntaxKind.ThrowStatement &&
        s.kind !== ts.SyntaxKind.ReturnStatement
      ) {
        // any other statement means not only logs
        // (unless it's variables, etc. but let's keep it simple)
      }
      ts.forEachChild(s, checkStatement);
    }

    statements.forEach(checkStatement);

    if (onlyLogs && !hasRethrowOrReturn) {
      results.push({
        file: filePath,
        line,
        type: "swallowed_error",
        message:
          "Catch block only logs and does not re-throw, return, or reply.",
        codeSnippet: getSnippet(sourceFile, node),
      });
    }
  }

  function checkThrowStatement(node: ts.ThrowStatement) {
    const expr = node.expression;
    if (ts.isNewExpression(expr)) {
      const typeText = expr.expression.getText(sourceFile);
      if (typeText === "Error") {
        const args = expr.arguments;
        if (args && args.length > 0) {
          const argText = args[0].getText(sourceFile);
          const genericStrings = [
            "'error'",
            '"error"',
            "'failed'",
            '"failed"',
            "'failed.'",
            '"failed."',
          ];
          if (genericStrings.includes(argText)) {
            const { line } = getLineAndCharacter(sourceFile, node.getStart());
            results.push({
              file: filePath,
              line,
              type: "generic_error",
              message: `Generic error thrown: ${argText}`,
              codeSnippet: getSnippet(sourceFile, node),
            });
          }
        }
      }
    }
  }

  function checkRouteHandler(node: ts.CallExpression) {
    // Check if it's fastify.get/post/put/patch/delete
    const expression = node.expression;
    if (ts.isPropertyAccessExpression(expression)) {
      const propName = expression.name.text;
      const objName = expression.expression.getText(sourceFile);
      if (
        (objName === "fastify" || objName === "router" || objName === "app") &&
        ["get", "post", "put", "patch", "delete"].includes(propName)
      ) {
        // The handler is typically the last argument, or within option object
        const args = node.arguments;
        if (args.length > 0) {
          const lastArg = args[args.length - 1];
          let handler: ts.Node | null = null;
          if (ts.isArrowFunction(lastArg) || ts.isFunctionExpression(lastArg)) {
            handler = lastArg;
          }

          if (handler) {
            // Check if handler is async
            const isAsync = handler.modifiers?.some(
              (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
            );
            if (isAsync) {
              // Check if body is wrapped in try-catch
              const handlerFunc = handler as ts.FunctionLikeDeclaration;
              const body = handlerFunc.body;
              if (body && ts.isBlock(body)) {
                let hasTryCatch = false;
                for (const stmt of body.statements) {
                  if (ts.isTryStatement(stmt)) {
                    hasTryCatch = true;
                    break;
                  }
                }
                if (!hasTryCatch) {
                  const { line } = getLineAndCharacter(
                    sourceFile,
                    handler.getStart(),
                  );
                  results.push({
                    file: filePath,
                    line,
                    type: "unprotected_async_handler",
                    message: `Async route handler lacks an outer try/catch block.`,
                    codeSnippet: getSnippet(sourceFile, handler),
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  function checkReplyStatus(node: ts.CallExpression) {
    const text = node.getText(sourceFile);
    // e.g. reply.status(403).send(...)
    if (text.includes("reply.status(") || text.includes("reply.code(")) {
      if (text.includes(".send(")) {
        // Parse the argument to send
        const sendMatch = text.match(/\.send\(([\s\S]*)\)$/);
        if (sendMatch) {
          const argText = sendMatch[1].trim();
          // Check if it follows standard error shape:
          // it must have "error: {" or match standard error responses
          // unless it returns a valid response body or is status 200/201/204/202 (which are success codes)
          const statusMatch = text.match(/status\((\d+)\)|code\((\d+)\)/);
          const statusCode = statusMatch
            ? parseInt(statusMatch[1] || statusMatch[2])
            : 200;
          if (statusCode >= 400) {
            // It is an error response!
            // Let's check if the argument contains 'error:' or is structured properly.
            // E.g. { error: { ... } } or throws
            const isStandard =
              argText.startsWith("{") &&
              argText.includes("error:") &&
              argText.includes("code:") &&
              argText.includes("message:");
            if (!isStandard) {
              const { line } = getLineAndCharacter(sourceFile, node.getStart());
              results.push({
                file: filePath,
                line,
                type: "non_standard_response",
                message: `Non-standard error response for status ${statusCode}: expected { error: { code, message, requestId } }, got: ${argText}`,
                codeSnippet: getSnippet(sourceFile, node),
              });
            }
          }
        }
      }
    }
  }

  function checkLoggerError(node: ts.CallExpression) {
    const expression = node.expression;
    if (ts.isPropertyAccessExpression(expression)) {
      const propName = expression.name.text;
      const objText = expression.expression.getText(sourceFile);
      if (
        propName === "error" &&
        (objText.includes("logger") || objText.includes("log"))
      ) {
        // Check first argument
        const args = node.arguments;
        if (args.length > 0) {
          const firstArg = args[0];
          // If first arg is a string literal (not an object), it lacks a context object!
          if (
            ts.isStringLiteral(firstArg) ||
            ts.isNoSubstitutionTemplateLiteral(firstArg) ||
            ts.isTemplateExpression(firstArg)
          ) {
            const { line } = getLineAndCharacter(sourceFile, node.getStart());
            results.push({
              file: filePath,
              line,
              type: "uncontextualized_log",
              message: `logger.error call missing a context object (first argument should be an object containing 'err' or context data).`,
              codeSnippet: getSnippet(sourceFile, node),
            });
          }
        }
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isCatchClause(node)) {
      checkCatchClause(node);
    } else if (ts.isThrowStatement(node)) {
      checkThrowStatement(node);
    } else if (ts.isCallExpression(node)) {
      checkRouteHandler(node);
      checkReplyStatus(node);
      checkLoggerError(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function walkDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (file.endsWith(".ts")) {
      scanFile(fullPath);
    }
  }
}

// Start auditing
console.log(
  "Auditing edge-cloud-orchestrator apps/api/src for error handling consistency...",
);
walkDir(API_SRC_DIR);

// Write to JSON file
fs.writeFileSync(
  path.resolve(__dirname, "audit-results.json"),
  JSON.stringify(results, null, 2),
  "utf-8",
);

console.log("\n--- AUDIT RESULTS ---");
console.log(`Total Violations Found: ${results.length}\n`);

// Group by type
const grouped = results.reduce(
  (acc, curr) => {
    acc[curr.type] = acc[curr.type] || [];
    acc[curr.type].push(curr);
    return acc;
  },
  {} as Record<string, AuditResult[]>,
);

for (const type of Object.keys(grouped)) {
  console.log(`[${type.toUpperCase()}] (${grouped[type].length} occurrences):`);
  grouped[type].slice(0, 5).forEach((r) => {
    const relPath = path.relative(path.resolve(__dirname, ".."), r.file);
    console.log(`  - ${relPath}:${r.line} : ${r.message}`);
    console.log(`    Code: ${r.codeSnippet.replace(/\r?\n/g, " ")}\n`);
  });
  if (grouped[type].length > 5) {
    console.log(`  ... and ${grouped[type].length - 5} more occurrences.`);
  }
}
