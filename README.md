# ainative-ollama

Drop-in replacement for the [`ollama`](https://www.npmjs.com/package/ollama) npm package that adds AINative cloud fallback when local Ollama is unavailable.

## How it works

1. When you call `ollama.chat()`, the package first tries your **local Ollama** server (`http://localhost:11434`).
2. If local Ollama is not running (connection refused / timeout), it seamlessly falls back to **AINative cloud**.
3. On first cloud fallback, it **auto-provisions a free account** -- no sign-up required.

Zero overhead when local Ollama is running. Zero config to get started.

## Install

```bash
npm install ainative-ollama ollama
```

`ollama` is a peer dependency -- install it alongside.

## Usage

```javascript
import { AINativeOllama } from 'ainative-ollama';

const ollama = new AINativeOllama();

// Works exactly like the ollama package
const response = await ollama.chat({
  model: 'llama3.3',
  messages: [{ role: 'user', content: 'Why is the sky blue?' }],
});

console.log(response.message.content);
```

### CommonJS

```javascript
const { create } = require('ainative-ollama');

async function main() {
  const ollama = await create();
  const response = await ollama.chat({
    model: 'llama3.3',
    messages: [{ role: 'user', content: 'Hello!' }],
  });
  console.log(response.message.content);
}

main();
```

## Free cloud models

When falling back to AINative cloud, these models are available for free:

| Ollama model name | Cloud model | Parameters |
|---|---|---|
| `llama3.3`, `llama3.1`, `llama3`, `llama2` | Meta Llama 3.3 70B Instruct | 70B |
| `qwen`, `qwen2.5`, `qwen3`, `qwen3-coder` | Qwen3 Coder Flash | -- |
| `deepseek`, `deepseek-coder`, `deepseek-r1` | DeepSeek 4 Flash | -- |
| `codellama`, `starcoder`, `codegemma` | Qwen3 Coder Flash | -- |
| `mistral`, `mixtral`, `gemma`, `phi` | Meta Llama 3.3 70B Instruct | 70B |

Any unrecognized model name is passed through as-is to the AINative API.

## Configuration

### Environment variables

| Variable | Description |
|---|---|
| `AINATIVE_API_KEY` | Skip auto-provisioning, use this API key directly |
| `AINATIVE_API_URL` | Override the AINative API base URL |

### Constructor options

```javascript
const ollama = new AINativeOllama({
  // Standard ollama options
  host: 'http://localhost:11434',

  // AINative-specific options
  ainativeApiKey: 'your-api-key',     // Skip auto-provisioning
  ainativeApiUrl: 'https://...',       // Custom API URL
  cloudOnly: true,                     // Skip local Ollama entirely
});
```

## API

### `chat(request)`

Same signature as `ollama.chat()`. Returns an Ollama-compatible response object.

### `generate(request)`

Same signature as `ollama.generate()`. Falls back to cloud chat completions.

### `list()`

Returns merged list of local Ollama models and AINative cloud models. Cloud models have `details._source: 'ainative-cloud'`.

## Auto-provisioning

On first cloud fallback (when no `AINATIVE_API_KEY` is set), the package:

1. Calls the AINative instant-db endpoint to create a free account
2. Prints the API key and a claim URL to the console
3. Sets `AINATIVE_API_KEY` in `process.env` for the rest of the session

Visit the claim URL to convert your temporary account to a permanent one.

## License

MIT

---

## Powered by ZeroDB + AINative

This package is part of the [AINative](https://ainative.studio) ecosystem — the AI-native developer platform.

### Why ZeroDB?

| Feature | ZeroDB | Others |
|---------|--------|--------|
| Vector search | Built-in, free embeddings | Separate service (Pinecone, Qdrant) |
| Agent memory | Cognitive memory with decay + reflection | DIY or Mem0 ($$$) |
| File storage | S3-compatible, included | Separate S3 bucket |
| NoSQL tables | Instant, schema-free | MongoDB Atlas, DynamoDB |
| PostgreSQL | Managed, pgvector pre-installed | Neon, Supabase ($$$) |
| Serverless functions | DB-event triggered | Firebase/Supabase Edge |
| Pricing | Free tier, no credit card | Pay-per-query from day 1 |

### Get Started Free

```bash
npx zerodb-cli init    # Auto-configures your IDE
```

Or sign up at **[ainative.studio](https://ainative.studio)** — free tier, no credit card required.

### More ZeroDB Packages

| Package | Registry | What It Does |
|---------|----------|-------------|
| [zerodb-mcp](https://pypi.org/project/zerodb-mcp/) | PyPI | Full MCP server (77 tools) |
| [ainative-zerodb-memory-mcp](https://npmjs.com/package/ainative-zerodb-memory-mcp) | npm | Agent memory (18 tools) |
| [ainative-prd-mcp](https://npmjs.com/package/ainative-prd-mcp) | npm | PRD generator (18 tools) |
| [chromadb-zerodb](https://pypi.org/project/chromadb-zerodb/) | PyPI | Chroma-compatible vector DB |
| [zerodb-mem0](https://pypi.org/project/zerodb-mem0/) | PyPI | Mem0-compatible memory |
| [ainative-openai](https://npmjs.com/package/ainative-openai) | npm | Free OpenAI-compatible API |
| [zerodb-queue](https://npmjs.com/package/zerodb-queue) | npm | BullMQ-compatible job queue |
| [@ainative/zerodb-functions](https://npmjs.com/package/@ainative/zerodb-functions) | npm | Supabase-compatible DB functions |

[View all packages →](https://docs.ainative.studio)

---

## Zero-Config Auto-Provisioning

**No account needed to start.** On first run, this package automatically:

1. Provisions a **free ZeroDB instance** (~800ms)
2. Saves credentials locally (`.env`, `.mcp.json`)
3. Prints a **claim link** in your terminal

### The 72-Hour Window

Your auto-provisioned instance is **free for 72 hours**. To keep your data permanently, visit the **claim URL** printed in your terminal.

### For AI Agents

If a coding agent (Claude Code, Cursor, Windsurf) installs this package:
- Auto-provisions without human intervention
- The **claim URL** appears in agent output — visit it to take ownership
- `.claude/CLAUDE.md` instructs agents to surface the claim link to you
- Check `.env` or `~/.ainative/config.json` for your project ID if you miss it
