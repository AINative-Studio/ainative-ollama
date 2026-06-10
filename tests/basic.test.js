import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock the ollama module before importing our code
// We need to create a mock Ollama class that simulates connection failures
const mockOllamaChat = mock.fn();
const mockOllamaList = mock.fn();
const mockOllamaGenerate = mock.fn();

// We'll test the AINativeOllama class by importing it after mocking
let AINativeOllama;

describe('ainative-ollama', () => {
  before(async () => {
    const mod = await import('../index.js');
    AINativeOllama = mod.AINativeOllama;
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const ollama = new AINativeOllama();
      assert.ok(ollama);
      assert.equal(ollama._cloudOnly, false);
    });

    it('should accept ainativeApiKey option', () => {
      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key-123' });
      assert.equal(ollama._ainativeKey, 'test-key-123');
    });

    it('should accept ainativeApiUrl option', () => {
      const ollama = new AINativeOllama({ ainativeApiUrl: 'https://custom.api.com' });
      assert.equal(ollama._ainativeUrl, 'https://custom.api.com');
    });

    it('should accept cloudOnly option', () => {
      const ollama = new AINativeOllama({ cloudOnly: true });
      assert.equal(ollama._cloudOnly, true);
    });

    it('should read AINATIVE_API_KEY from env', () => {
      const prev = process.env.AINATIVE_API_KEY;
      process.env.AINATIVE_API_KEY = 'env-key-456';
      const ollama = new AINativeOllama();
      assert.equal(ollama._ainativeKey, 'env-key-456');
      if (prev) {
        process.env.AINATIVE_API_KEY = prev;
      } else {
        delete process.env.AINATIVE_API_KEY;
      }
    });

    it('should prefer constructor option over env var', () => {
      const prev = process.env.AINATIVE_API_KEY;
      process.env.AINATIVE_API_KEY = 'env-key';
      const ollama = new AINativeOllama({ ainativeApiKey: 'opt-key' });
      assert.equal(ollama._ainativeKey, 'opt-key');
      if (prev) {
        process.env.AINATIVE_API_KEY = prev;
      } else {
        delete process.env.AINATIVE_API_KEY;
      }
    });
  });

  describe('_mapModel', () => {
    let ollama;

    before(() => {
      ollama = new AINativeOllama();
    });

    it('should map llama3.3 to Llama-3.3-70B-Instruct', () => {
      assert.equal(
        ollama._mapModel('llama3.3'),
        'meta-llama/Llama-3.3-70B-Instruct'
      );
    });

    it('should map llama3.3:70b to Llama-3.3-70B-Instruct', () => {
      assert.equal(
        ollama._mapModel('llama3.3:70b'),
        'meta-llama/Llama-3.3-70B-Instruct'
      );
    });

    it('should map qwen to qwen3-coder-flash', () => {
      assert.equal(ollama._mapModel('qwen'), 'qwen3-coder-flash');
    });

    it('should map qwen3-coder to qwen3-coder-flash', () => {
      assert.equal(ollama._mapModel('qwen3-coder'), 'qwen3-coder-flash');
    });

    it('should map deepseek to deepseek-4-flash', () => {
      assert.equal(ollama._mapModel('deepseek'), 'deepseek-4-flash');
    });

    it('should map deepseek-r1 to deepseek-4-flash', () => {
      assert.equal(ollama._mapModel('deepseek-r1'), 'deepseek-4-flash');
    });

    it('should map codellama to qwen3-coder-flash', () => {
      assert.equal(ollama._mapModel('codellama'), 'qwen3-coder-flash');
    });

    it('should map mistral to Llama-3.3-70B-Instruct', () => {
      assert.equal(
        ollama._mapModel('mistral'),
        'meta-llama/Llama-3.3-70B-Instruct'
      );
    });

    it('should pass through unknown model names', () => {
      assert.equal(
        ollama._mapModel('custom-model-v1'),
        'custom-model-v1'
      );
    });

    it('should default to Llama-3.3-70B-Instruct for null/undefined', () => {
      assert.equal(
        ollama._mapModel(null),
        'meta-llama/Llama-3.3-70B-Instruct'
      );
      assert.equal(
        ollama._mapModel(undefined),
        'meta-llama/Llama-3.3-70B-Instruct'
      );
    });

    it('should be case-insensitive', () => {
      assert.equal(
        ollama._mapModel('LLAMA3.3'),
        'meta-llama/Llama-3.3-70B-Instruct'
      );
      assert.equal(ollama._mapModel('QWEN'), 'qwen3-coder-flash');
      assert.equal(ollama._mapModel('DeepSeek'), 'deepseek-4-flash');
    });

    it('should strip tag when matching base name', () => {
      assert.equal(
        ollama._mapModel('llama3:latest'),
        'meta-llama/Llama-3.3-70B-Instruct'
      );
    });
  });

  describe('_cloudChat', () => {
    it('should convert OpenAI response to Ollama format', async () => {
      // Mock fetch globally
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Hello world!' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      const result = await ollama._cloudChat({
        model: 'llama3.3',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      assert.equal(result.model, 'llama3.3');
      assert.equal(result.message.role, 'assistant');
      assert.equal(result.message.content, 'Hello world!');
      assert.equal(result.done, true);
      assert.equal(result.prompt_eval_count, 10);
      assert.equal(result.eval_count, 5);

      globalThis.fetch = originalFetch;
    });

    it('should throw on HTTP errors from cloud', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      await assert.rejects(
        () => ollama._cloudChat({ model: 'llama3.3', messages: [] }),
        /HTTP 500/
      );

      globalThis.fetch = originalFetch;
    });
  });

  describe('_cloudGenerate', () => {
    it('should convert generate request to chat and back', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Generated text' } }],
          usage: { prompt_tokens: 8, completion_tokens: 3 },
        }),
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      const result = await ollama._cloudGenerate({
        model: 'llama3.3',
        prompt: 'Once upon a time',
        system: 'You are a storyteller.',
      });

      assert.equal(result.model, 'llama3.3');
      assert.equal(result.response, 'Generated text');
      assert.equal(result.done, true);

      // Verify the fetch was called with system + user messages
      const fetchCall = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(fetchCall.arguments[1].body);
      assert.equal(body.messages.length, 2);
      assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[1].role, 'user');

      globalThis.fetch = originalFetch;
    });
  });

  describe('chat fallback', () => {
    it('should fall back to cloud on ECONNREFUSED', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async (url) => {
        // Cloud API call
        if (url.includes('ainative.studio') || url.includes('chat/completions')) {
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { role: 'assistant', content: 'Cloud response' } }],
              usage: { prompt_tokens: 5, completion_tokens: 3 },
            }),
          };
        }
        // Local Ollama call — simulate connection refused
        const err = new Error('fetch failed');
        err.code = 'ECONNREFUSED';
        throw err;
      });

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      const result = await ollama.chat({
        model: 'llama3.3',
        messages: [{ role: 'user', content: 'Test' }],
      });

      assert.equal(result.message.content, 'Cloud response');
      assert.equal(result.done, true);

      globalThis.fetch = originalFetch;
    });

    it('should use cloud directly when cloudOnly is true', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'Cloud only' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2 },
        }),
      }));

      const ollama = new AINativeOllama({
        ainativeApiKey: 'test-key',
        cloudOnly: true,
      });
      const result = await ollama.chat({
        model: 'qwen',
        messages: [{ role: 'user', content: 'Test' }],
      });

      assert.equal(result.message.content, 'Cloud only');

      // Should have called fetch exactly once (cloud only, no local attempt)
      assert.equal(globalThis.fetch.mock.calls.length, 1);

      globalThis.fetch = originalFetch;
    });

    it('should re-throw non-connection errors', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => {
        throw new Error('Model not found: nonexistent');
      });

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      await assert.rejects(
        () => ollama.chat({ model: 'nonexistent', messages: [] }),
        /Model not found/
      );

      globalThis.fetch = originalFetch;
    });
  });

  describe('list', () => {
    it('should return cloud models when local is unavailable', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => {
        const err = new Error('fetch failed');
        err.code = 'ECONNREFUSED';
        throw err;
      });

      const ollama = new AINativeOllama();
      const result = await ollama.list();

      assert.ok(Array.isArray(result.models));
      assert.ok(result.models.length >= 3); // At least 3 cloud models
      assert.ok(result.models.some((m) => m.name === 'llama3.3:70b'));
      assert.ok(result.models.some((m) => m.name === 'qwen3-coder'));
      assert.ok(result.models.some((m) => m.name === 'deepseek'));

      // Cloud models should be tagged
      for (const m of result.models) {
        assert.equal(m.details._source, 'ainative-cloud');
      }

      globalThis.fetch = originalFetch;
    });
  });

  describe('_provision', () => {
    it('should call instant-db and store the API key', async () => {
      const prev = process.env.AINATIVE_API_KEY;
      delete process.env.AINATIVE_API_KEY;

      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          api_key: 'provisioned-key-abc123',
          project_id: 'proj-xyz',
          expires_at: '2026-07-08T00:00:00Z',
          claim_url: 'https://ainative.studio/claim/abc',
        }),
      }));

      const ollama = new AINativeOllama();
      await ollama._provision();

      assert.equal(ollama._ainativeKey, 'provisioned-key-abc123');
      assert.equal(process.env.AINATIVE_API_KEY, 'provisioned-key-abc123');
      assert.ok(logs.some((l) => l.includes('provisioned')), `Expected 'provisioned' in logs: ${JSON.stringify(logs)}`);

      console.log = originalLog;
      globalThis.fetch = originalFetch;
      if (prev) {
        process.env.AINATIVE_API_KEY = prev;
      } else {
        delete process.env.AINATIVE_API_KEY;
      }
    });

    it('should deduplicate concurrent provision calls', async () => {
      const prev = process.env.AINATIVE_API_KEY;
      delete process.env.AINATIVE_API_KEY;

      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      console.log = () => {};

      let callCount = 0;
      globalThis.fetch = mock.fn(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return {
          ok: true,
          json: async () => ({
            api_key: 'dedup-key',
            project_id: 'proj-1',
            expires_at: '2026-07-08T00:00:00Z',
            claim_url: 'https://ainative.studio/claim/dedup',
          }),
        };
      });

      const ollama = new AINativeOllama();
      await Promise.all([ollama._provision(), ollama._provision(), ollama._provision()]);

      // Should have called fetch only once despite 3 concurrent calls
      assert.equal(callCount, 1);

      console.log = originalLog;
      globalThis.fetch = originalFetch;
      if (prev) {
        process.env.AINATIVE_API_KEY = prev;
      } else {
        delete process.env.AINATIVE_API_KEY;
      }
    });
  });

  describe('exports', () => {
    it('should export AINativeOllama', async () => {
      const mod = await import('../index.js');
      assert.ok(mod.AINativeOllama);
      assert.equal(typeof mod.AINativeOllama, 'function');
    });

    it('should re-export Ollama from ollama package', async () => {
      const mod = await import('../index.js');
      assert.ok(mod.Ollama);
      assert.equal(typeof mod.Ollama, 'function');
    });

    it('should have AINativeOllama as default export', async () => {
      const mod = await import('../index.js');
      assert.equal(mod.default, mod.AINativeOllama);
    });
  });
});
