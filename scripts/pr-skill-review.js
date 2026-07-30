#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const prNumber = Number(process.env.PR_NUMBER);
const resultPath = process.env.RESULT_PATH || '/tmp/pr-skill-review-result.json';
const skillPath = process.env.SKILL_PATH || '.github/skills/pr-review/SKILL.md';

if (!repo || !token || !prNumber) {
  console.error('Missing required environment variables: GITHUB_REPOSITORY, GITHUB_TOKEN, PR_NUMBER');
  process.exit(2);
}

const [owner, repoName] = repo.split('/');
if (!owner || !repoName) {
  console.error(`Invalid GITHUB_REPOSITORY value: ${repo}`);
  process.exit(2);
}

const apiBase = 'https://api.github.com';

async function githubRequest(url) {
  const response = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pr-skill-review-bot'
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function fetchAllPrFiles() {
  const files = [];
  let page = 1;

  while (true) {
    const pageFiles = await githubRequest(
      `${apiBase}/repos/${owner}/${repoName}/pulls/${prNumber}/files?per_page=100&page=${page}`
    );
    files.push(...pageFiles);
    if (pageFiles.length < 100) break;
    page += 1;
  }

  return files;
}

function byPattern(files, predicate) {
  return files.filter((f) => predicate(f.filename));
}

function formatPathList(paths) {
  if (!paths.length) return '_none_';
  return paths.map((p) => `- \`${p}\``).join('\n');
}

function evaluateRules(files) {
  const paths = files.map((f) => f.filename);
  const failures = [];

  const srcChanged = paths.some((p) => p.startsWith('src/') || p.startsWith('webview/src/'));
  const testChanged = paths.some(
    (p) => p.startsWith('test/') && /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)
  );
  if (srcChanged && !testChanged) {
    failures.push({
      id: 'PRR-001',
      title: 'Missing test updates for source changes',
      details: 'Source files changed in `src/` or `webview/src/`, but no test files changed in `test/`.'
    });
  }

  const lockChanged = paths.includes('package-lock.json');
  const packageJsonChanged = paths.includes('package.json');
  if (lockChanged && !packageJsonChanged) {
    failures.push({
      id: 'PRR-002',
      title: 'Lockfile changed without package manifest',
      details: '`package-lock.json` changed without a matching change to `package.json`.'
    });
  }

  const generatedChanged = byPattern(
    files,
    (p) => p.startsWith('out/') || p.endsWith('.js.map')
  ).map((f) => f.filename);
  if (generatedChanged.length > 0) {
    failures.push({
      id: 'PRR-003A',
      title: 'Generated build artifacts were modified',
      details: `Do not commit generated artifacts:\n${formatPathList(generatedChanged)}`
    });
  }

  const distChanged = byPattern(files, (p) => p.startsWith('webview/dist/')).map((f) => f.filename);
  const webviewSourceChanged = paths.some((p) => p.startsWith('webview/src/'));
  if (distChanged.length > 0 && !webviewSourceChanged) {
    failures.push({
      id: 'PRR-003B',
      title: 'Webview dist changed without webview source changes',
      details: `Changed dist files:\n${formatPathList(distChanged)}\n\nExpected matching changes in \`webview/src/\`.`
    });
  }

  const workflowYmlChanged = paths.some(
    (p) => p.startsWith('.github/workflows/') && p.endsWith('.yml')
  );
  const skillChanged = paths.some((p) => p.startsWith('.github/skills/pr-review/'));
  const runnerChanged = paths.includes('scripts/pr-skill-review.js');
  if (workflowYmlChanged && !skillChanged && !runnerChanged) {
    failures.push({
      id: 'PRR-004',
      title: 'Workflow changed without reviewer updates',
      details:
        'Changes to `.github/workflows/*.yml` must include updates to `.github/skills/pr-review/**` or `scripts/pr-skill-review.js`.'
    });
  }

  return {
    passed: failures.length === 0,
    failures,
    changedPaths: paths
  };
}

function renderSummary(skillDisplayName, result) {
  const status = result.passed ? '✅ PASS' : '❌ FAIL';
  let body = `## ${status} — ${skillDisplayName}\n\n`;
  body += `Checked files: **${result.changedPaths.length}**\n\n`;

  if (result.passed) {
    body += 'No blocking findings.\n';
    return body;
  }

  body += '### Blocking findings\n';
  for (const failure of result.failures) {
    body += `\n- **${failure.id} — ${failure.title}**\n  - ${failure.details.replace(/\n/g, '\n  ')}\n`;
  }

  return body;
}

function readSkillTitle(skillFilePath) {
  try {
    const abs = path.resolve(skillFilePath);
    const content = fs.readFileSync(abs, 'utf8');
    const headerMatch = content.match(/^#\s+(.+)$/m);
    return headerMatch ? headerMatch[1].trim() : 'PR Review Skill';
  } catch {
    return 'PR Review Skill';
  }
}

async function main() {
  const files = await fetchAllPrFiles();
  const result = evaluateRules(files);
  const skillDisplayName = readSkillTitle(skillPath);
  const summary = renderSummary(skillDisplayName, result);

  const output = {
    marker: '<!-- pr-skill-review -->',
    skill: skillDisplayName,
    passed: result.passed,
    failures: result.failures,
    changedPaths: result.changedPaths,
    summary
  };

  fs.writeFileSync(resultPath, JSON.stringify(output, null, 2));
  console.log(summary);
}

main().catch((error) => {
  const fallback = {
    marker: '<!-- pr-skill-review -->',
    skill: 'PR Review Skill',
    passed: false,
    failures: [
      {
        id: 'PRR-000',
        title: 'Reviewer execution failure',
        details: error instanceof Error ? error.message : String(error)
      }
    ],
    changedPaths: [],
    summary: `## ❌ FAIL — PR Review Skill\n\nReviewer execution failed.\n`
  };
  fs.writeFileSync(resultPath, JSON.stringify(fallback, null, 2));
  console.error(error);
  process.exit(1);
});
