# Submission Checklist

Run this before sending the project to your teacher.

```bash
make check
make demo
make package
```

Expected results:

- Foundry format check passes.
- 23 smart-contract tests pass.
- 26 TypeScript tests pass.
- CLI TypeScript build passes.
- Vite browser build passes.
- `npm audit` reports 0 vulnerabilities.
- End-to-end Anvil demo finishes with `Demo completed successfully`.
- `20235625-VuQuangTien-blockchain-credential.zip` is created without `node_modules`, Foundry build outputs, local keys, or runtime data.

Files to read before the defense:

- `docs/PRESENTATION.md`
- `docs/GRADING.md`
- `docs/evaluation/00_INDEX.md`
- `docs/SECURITY.md`

Live dashboard:

```bash
make web
# open http://localhost:5173
```

Fallback if the dev server has watcher issues:

```bash
cd app
npm run web:build
npm run web:preview -- --port 4173
# open http://localhost:4173
```
