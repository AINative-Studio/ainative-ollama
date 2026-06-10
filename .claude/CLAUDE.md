# ainative-ollama

Drop-in replacement for the `ollama` npm package with AINative cloud fallback.

## Rules

- No AI attribution in commits or code
- All changes must reference an issue
- Run `node --test tests/basic.test.js` before committing
- Keep zero dependencies beyond the `ollama` peer dep (use native `fetch`)
- Maintain backward compatibility with the `ollama` package API
