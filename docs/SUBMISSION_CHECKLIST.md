# Submission Checklist

Run this before sending the project to your teacher.

```bash
make setup
make check
make smoke-check
make demo
```

Expected results:

- `make setup` completes successfully, initializing dependencies.
- `make check` succeeds deterministically without requiring network access.
- `make smoke-check` successfully packages, extracts, and runs setup/checks from the clean package.
- Foundry format check passes.
- 23 smart-contract tests pass.
- 26 TypeScript tests pass.
- CLI TypeScript build passes.
- Vite browser build passes.
- `make audit` (run independently) reports 0 vulnerabilities.
- End-to-end Anvil demo finishes with `Demo completed successfully`.
- `20235625-VuQuangTien-blockchain-credential.zip` is created, containing the project files and pinned/vendored Solidity dependencies under `contracts/lib/` (with no nested `.git` metadata). Restoring Node packages requires network access to the npm registry or a populated npm cache when running `npm ci`.

Files to read before the defense:

- `docs/PRESENTATION.md`
- `docs/GRADING.md`
- `docs/evaluation/00_INDEX.md`
- `docs/SECURITY.md`

Live dashboard:

```bash
make web
# open the printed local URL
```

Fallback if the dev server has watcher issues:

```bash
cd app
npm run web:build
npm run web:preview -- --port 4173
# open http://localhost:4173
```
