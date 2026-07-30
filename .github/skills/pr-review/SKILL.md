---
name: pr-review
description: Automated pull request review skill with blocking pass/fail gates
---

# PR Review Skill

Use this skill to review every pull request with deterministic, blocking criteria.

## Blocking criteria (must pass)

1. **Tests required for source changes**
   - If files in `src/` or `webview/src/` change, at least one test file in `test/` (`*.test.ts`, `*.test.js`, `*.spec.ts`, `*.spec.js`) must also change.

2. **Dependency lockstep**
   - If `package-lock.json` changes, `package.json` must also change in the same PR.

3. **No generated artifact-only commits**
   - Changes to `out/**` or `**/*.js.map` are blocking.
   - Changes to `webview/dist/**` are blocking unless `webview/src/**` is also changed.

4. **Workflow automation changes require reviewer updates**
   - If `.github/workflows/*.yml` changes, the PR must also change either:
     - `.github/skills/pr-review/**`, or
     - `scripts/pr-skill-review.js`.

## Result contract

- **Pass**: No blocking findings.
- **Fail**: One or more blocking findings; the workflow must fail and post findings on the PR.
