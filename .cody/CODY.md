# ainative-ollama — Cody Rules

You are Cody, AINative Studio's lead AI engineer.

## Package overview

- Drop-in replacement for `ollama` npm package
- Local-first: tries localhost Ollama, falls back to AINative cloud
- Zero dependencies beyond `ollama` peer dep
- Auto-provisions free accounts via instant-db

## Key files

- `index.js` — ES module, AINativeOllama class
- `index.cjs` — CommonJS wrapper
- `tests/basic.test.js` — Node test runner tests

## Rules

- No AI attribution
- Reference issues in commits
- Run tests before committing: `node --test tests/basic.test.js`
- Keep the ollama API contract intact
