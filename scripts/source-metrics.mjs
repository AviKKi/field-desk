import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = process.cwd();
const rows = [];
function scan(directory) {
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.tsx?$/.test(entry.name)) {
      const text = readFileSync(join(root, path), 'utf8');
      const source = ts.createSourceFile(
        path,
        text,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      let decisionNodes = 0;
      const visit = (node) => {
        if (
          ts.isIfStatement(node) ||
          ts.isCaseClause(node) ||
          ts.isConditionalExpression(node) ||
          ts.isCatchClause(node) ||
          ts.isForStatement(node) ||
          ts.isForInStatement(node) ||
          ts.isForOfStatement(node) ||
          ts.isWhileStatement(node) ||
          ts.isDoStatement(node) ||
          (ts.isBinaryExpression(node) &&
            [
              ts.SyntaxKind.AmpersandAmpersandToken,
              ts.SyntaxKind.BarBarToken,
              ts.SyntaxKind.QuestionQuestionToken,
            ].includes(node.operatorToken.kind))
        )
          decisionNodes++;
        ts.forEachChild(node, visit);
      };
      visit(source);
      rows.push({
        path: relative(root, join(root, path)),
        nonblankLines: text.split('\n').filter((line) => line.trim()).length,
        decisionNodes,
        sha256: createHash('sha256').update(text).digest('hex'),
      });
    }
  }
}
for (const directory of [
  'server/src',
  'client/src',
  'shared/src',
  'server/test',
])
  scan(directory);
rows.sort((a, b) => a.path.localeCompare(b.path));
const report = {
  generatedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  definitions: {
    nonblankLines:
      'Nonempty TypeScript source lines, including comments; excludes generated code, migrations, dependencies, and Markdown.',
    decisionNodes:
      'AST counts of if, case, ternary, catch, loops, &&, ||, and ??. This is a branch proxy, not cyclomatic complexity or a quality score.',
  },
  totals: {
    files: rows.length,
    nonblankLines: rows.reduce((sum, row) => sum + row.nonblankLines, 0),
    decisionNodes: rows.reduce((sum, row) => sum + row.decisionNodes, 0),
  },
  files: rows,
};
mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(
  join(root, 'reports/source-metrics.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(
  JSON.stringify({ path: 'reports/source-metrics.json', ...report.totals }),
);
