/**
 * Comprehensive coverage tests for ainative-ollama
 *
 * Targets uncovered lines: provision retry logic, _scanMcpConfig branches,
 * generate fallback, isConnectionError all variants, AINATIVE_API_URL env,
 * list() deduplication with local models, _cloudChat with missing choices/usage
 */

import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let AINativeOllama;

describe('ainative-ollama coverage', () => {
  before(async () => {
    const mod = await import('../index.js');
    AINativeOllama = mod.AINativeOllama;
  });

  // ── Additional model mappings ──────────────────────────────────

  describe('model mapping - all aliases', () => {
    let ollama;
    before(() => { ollama = new AINativeOllama(); });

    // Llama family
    it('should map llama3.1 to Llama-3.3-70B-Instruct', () => {
      assert.equal(ollama._mapModel('llama3.1'), 'meta-llama/Llama-3.3-70B-Instruct');
    });
    it('should map llama3.1:70b', () => {
      assert.equal(ollama._mapModel('llama3.1:70b'), 'meta-llama/Llama-3.3-70B-Instruct');
    });
    it('should map llama3.1:8b', () => {
      assert.equal(ollama._mapModel('llama3.1:8b'), 'meta-llama/Llama-3.3-70B-Instruct');
    });
    it('should map llama2', () => {
      assert.equal(ollama._mapModel('llama2'), 'meta-llama/Llama-3.3-70B-Instruct');
    });

    // Qwen family
    it('should map qwen2.5', () => {
      assert.equal(ollama._mapModel('qwen2.5'), 'qwen3-coder-flash');
    });
    it('should map qwen2.5-coder', () => {
      assert.equal(ollama._mapModel('qwen2.5-coder'), 'qwen3-coder-flash');
    });
    it('should map qwen3', () => {
      assert.equal(ollama._mapModel('qwen3'), 'qwen3-coder-flash');
    });

    // DeepSeek family
    it('should map deepseek-coder', () => {
      assert.equal(ollama._mapModel('deepseek-coder'), 'deepseek-4-flash');
    });
    it('should map deepseek-coder-v2', () => {
      assert.equal(ollama._mapModel('deepseek-coder-v2'), 'deepseek-4-flash');
    });
    it('should map deepseek-v2', () => {
      assert.equal(ollama._mapModel('deepseek-v2'), 'deepseek-4-flash');
    });

    // Coding models
    it('should map starcoder to qwen3-coder-flash', () => {
      assert.equal(ollama._mapModel('starcoder'), 'qwen3-coder-flash');
    });
    it('should map codegemma to qwen3-coder-flash', () => {
      assert.equal(ollama._mapModel('codegemma'), 'qwen3-coder-flash');
    });

    // General models
    it('should map mixtral', () => {
      assert.equal(ollama._mapModel('mixtral'), 'meta-llama/Llama-3.3-70B-Instruct');
    });
    it('should map gemma', () => {
      assert.equal(ollama._mapModel('gemma'), 'meta-llama/Llama-3.3-70B-Instruct');
    });
    it('should map gemma2', () => {
      assert.equal(ollama._mapModel('gemma2'), 'meta-llama/Llama-3.3-70B-Instruct');
    });
    it('should map phi3', () => {
      assert.equal(ollama._mapModel('phi3'), 'meta-llama/Llama-3.3-70B-Instruct');
    });
    it('should map phi', () => {
      assert.equal(ollama._mapModel('phi'), 'meta-llama/Llama-3.3-70B-Instruct');
    });

    // Edge: model with tag that matches full key
    it('should match full key with tag before falling back to base', () => {
      assert.equal(ollama._mapModel('llama3.3:70b'), 'meta-llama/Llama-3.3-70B-Instruct');
    });
  });

  // ── isConnectionError all variants ─────────────────────────────

  describe('isConnectionError coverage via chat fallback', () => {
    const connectionErrors = [
      { code: 'ECONNREFUSED', msg: 'connect ECONNREFUSED' },
      { code: 'ECONNRESET', msg: 'connection reset' },
      { code: 'ENOTFOUND', msg: 'getaddrinfo ENOTFOUND' },
      { code: '', msg: 'fetch failed' },
      { code: '', msg: 'connection refused by host' },
      { code: '', msg: 'econnrefused something' },
      { code: '', msg: 'network error occurred' },
      { code: '', msg: 'socket hang up' },
    ];

    for (const errDef of connectionErrors) {
      it(`should fall back on connection error: ${errDef.code || errDef.msg}`, async () => {
        const originalFetch = globalThis.fetch;
        let callNum = 0;
        globalThis.fetch = mock.fn(async (url) => {
          callNum++;
          if (callNum === 1) {
            // First call (local Ollama) fails
            const err = new Error(errDef.msg);
            if (errDef.code) err.code = errDef.code;
            throw err;
          }
          // Cloud call succeeds
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { role: 'assistant', content: 'cloud fallback' } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
          };
        });

        const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
        const result = await ollama.chat({
          model: 'llama3.3',
          messages: [{ role: 'user', content: 'test' }],
        });

        assert.equal(result.message.content, 'cloud fallback');
        globalThis.fetch = originalFetch;
      });
    }
  });

  // ── generate() with fallback ───────────────────────────────────

  describe('generate fallback', () => {
    it('should fall back to cloud on ECONNREFUSED', async () => {
      const originalFetch = globalThis.fetch;
      let callNum = 0;
      globalThis.fetch = mock.fn(async () => {
        callNum++;
        if (callNum === 1) {
          const err = new Error('fetch failed');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content: 'generated text' } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
        };
      });

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      const result = await ollama.generate({
        model: 'llama3.3',
        prompt: 'Write a poem',
      });

      assert.equal(result.response, 'generated text');
      assert.equal(result.done, true);
      assert.equal(result.model, 'llama3.3');
      globalThis.fetch = originalFetch;
    });

    it('should use cloud directly for generate when cloudOnly', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'cloud generated' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key', cloudOnly: true });
      const result = await ollama.generate({
        model: 'qwen',
        prompt: 'Hello',
      });

      assert.equal(result.response, 'cloud generated');
      assert.equal(globalThis.fetch.mock.calls.length, 1);
      globalThis.fetch = originalFetch;
    });

    it('should re-throw non-connection errors from generate', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => {
        throw new Error('Model not found');
      });

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      await assert.rejects(
        () => ollama.generate({ model: 'bad', prompt: 'test' }),
        /Model not found/
      );
      globalThis.fetch = originalFetch;
    });

    it('should generate without system message', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'no system' } }],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key', cloudOnly: true });
      const result = await ollama._cloudGenerate({
        model: 'llama3.3',
        prompt: 'Just a prompt, no system',
      });

      // Verify only user message, no system
      const fetchCall = globalThis.fetch.mock.calls[0];
      const body = JSON.parse(fetchCall.arguments[1].body);
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0].role, 'user');
      assert.equal(result.response, 'no system');
      globalThis.fetch = originalFetch;
    });
  });

  // ── _cloudChat edge cases ──────────────────────────────────────

  describe('_cloudChat edge cases', () => {
    it('should handle empty choices array', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 0 },
        }),
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      const result = await ollama._cloudChat({
        model: 'llama3.3',
        messages: [{ role: 'user', content: 'hi' }],
      });

      assert.equal(result.message.content, '');
      assert.equal(result.done, true);
      globalThis.fetch = originalFetch;
    });

    it('should handle missing usage in response', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: 'hello' } }],
        }),
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key' });
      const result = await ollama._cloudChat({
        model: 'llama3.3',
        messages: [{ role: 'user', content: 'hi' }],
      });

      assert.equal(result.prompt_eval_count, 0);
      assert.equal(result.eval_count, 0);
      globalThis.fetch = originalFetch;
    });

    it('should trigger provisioning when no API key', async () => {
      const prev = process.env.AINATIVE_API_KEY;
      delete process.env.AINATIVE_API_KEY;

      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      console.log = () => {};

      let fetchCalls = [];
      globalThis.fetch = mock.fn(async (url, opts) => {
        fetchCalls.push(url);
        if (url.includes('instant-db')) {
          return {
            ok: true,
            json: async () => ({
              api_key: 'provisioned-key-chat',
              project_id: 'proj-1',
              expires_at: '2026-12-31',
              claim_url: 'https://ainative.studio/claim/test',
            }),
          };
        }
        // Chat completions
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content: 'provisioned response' } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
        };
      });

      const ollama = new AINativeOllama();
      const result = await ollama._cloudChat({
        model: 'llama3.3',
        messages: [{ role: 'user', content: 'test' }],
      });

      assert.equal(result.message.content, 'provisioned response');
      assert.ok(fetchCalls.some(u => u.includes('instant-db')), 'Should have called instant-db');

      console.log = originalLog;
      globalThis.fetch = originalFetch;
      if (prev) process.env.AINATIVE_API_KEY = prev;
      else delete process.env.AINATIVE_API_KEY;
    });
  });

  // ── _provision - retry logic and env re-check ──────────────────

  describe('_provision retry and edge cases', () => {
    it('should retry on 502/503/504 errors', async () => {
      const prev = process.env.AINATIVE_API_KEY;
      delete process.env.AINATIVE_API_KEY;

      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      console.log = () => {};

      let attempt = 0;
      globalThis.fetch = mock.fn(async () => {
        attempt++;
        if (attempt <= 2) {
          return {
            ok: false,
            status: 502,
            text: async () => 'Bad Gateway',
          };
        }
        return {
          ok: true,
          json: async () => ({
            api_key: 'retry-success-key',
            project_id: 'proj-retry',
            expires_at: '2026-12-31',
            claim_url: 'https://ainative.studio/claim/retry',
          }),
        };
      });

      const ollama = new AINativeOllama();
      await ollama._provision();
      assert.equal(ollama._ainativeKey, 'retry-success-key');
      assert.ok(attempt >= 3, 'Should have retried at least twice');

      console.log = originalLog;
      globalThis.fetch = originalFetch;
      if (prev) process.env.AINATIVE_API_KEY = prev;
      else delete process.env.AINATIVE_API_KEY;
    }, { timeout: 15000 });

    it('should throw after 3 failed attempts', async () => {
      const prev = process.env.AINATIVE_API_KEY;
      delete process.env.AINATIVE_API_KEY;

      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      console.log = () => {};

      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => 'Server Error',
      }));

      const ollama = new AINativeOllama();
      await assert.rejects(
        () => ollama._provision(),
        /Failed to provision/
      );

      console.log = originalLog;
      globalThis.fetch = originalFetch;
      if (prev) process.env.AINATIVE_API_KEY = prev;
      else delete process.env.AINATIVE_API_KEY;
    });

    it('should use env AINATIVE_API_KEY if set during provision', async () => {
      const prev = process.env.AINATIVE_API_KEY;

      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      console.log = () => {};

      // Simulate: key gets set by another code path during provisioning
      process.env.AINATIVE_API_KEY = 'ak_set_externally';

      const ollama = new AINativeOllama();
      ollama._ainativeKey = null; // Force provision path
      await ollama._provision();
      assert.equal(ollama._ainativeKey, 'ak_set_externally');

      console.log = originalLog;
      globalThis.fetch = originalFetch;
      if (prev) process.env.AINATIVE_API_KEY = prev;
      else delete process.env.AINATIVE_API_KEY;
    });

    it('should reset _provisioning after completion', async () => {
      const prev = process.env.AINATIVE_API_KEY;
      process.env.AINATIVE_API_KEY = 'ak_reset_test';

      const ollama = new AINativeOllama();
      ollama._ainativeKey = null;
      await ollama._provision();
      assert.equal(ollama._provisioning, null, '_provisioning should be null after completion');

      if (prev) process.env.AINATIVE_API_KEY = prev;
      else delete process.env.AINATIVE_API_KEY;
    });

    it('should reset _provisioning even on failure', async () => {
      const prev = process.env.AINATIVE_API_KEY;
      delete process.env.AINATIVE_API_KEY;

      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      console.log = () => {};

      globalThis.fetch = mock.fn(async () => {
        throw new Error('Network down');
      });

      const ollama = new AINativeOllama();
      try {
        await ollama._provision();
      } catch (_) {}
      assert.equal(ollama._provisioning, null, '_provisioning should be null after failure');

      console.log = originalLog;
      globalThis.fetch = originalFetch;
      if (prev) process.env.AINATIVE_API_KEY = prev;
      else delete process.env.AINATIVE_API_KEY;
    });
  });

  // ── _scanMcpConfig ─────────────────────────────────────────────

  describe('_scanMcpConfig', () => {
    const testDir = join(tmpdir(), 'ainative-ollama-mcp-test-' + process.pid);
    let originalCwd;
    let originalHome;

    before(() => {
      originalCwd = process.cwd;
      originalHome = process.env.HOME;
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      process.cwd = originalCwd;
      process.env.HOME = originalHome;
      try { rmSync(join(testDir, '.mcp.json'), { force: true }); } catch (_) {}
    });

    after(() => {
      process.cwd = originalCwd;
      process.env.HOME = originalHome;
      try { rmSync(testDir, { recursive: true, force: true }); } catch (_) {}
    });

    it('should find AINATIVE_API_KEY in cwd .mcp.json', () => {
      const mcpConfig = {
        mcpServers: {
          'ainative-ollama': {
            command: 'npx',
            env: { AINATIVE_API_KEY: 'ak_from_cwd_mcp' }
          }
        }
      };
      writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(mcpConfig));
      process.cwd = () => testDir;

      const ollama = new AINativeOllama();
      const key = ollama._scanMcpConfig();
      assert.equal(key, 'ak_from_cwd_mcp');
    });

    it('should find ZERODB_API_KEY in .mcp.json', () => {
      const mcpConfig = {
        mcpServers: {
          'zerodb': {
            command: 'npx',
            env: { ZERODB_API_KEY: 'zk_from_mcp' }
          }
        }
      };
      writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(mcpConfig));
      process.cwd = () => testDir;

      const ollama = new AINativeOllama();
      const key = ollama._scanMcpConfig();
      assert.equal(key, 'zk_from_mcp');
    });

    it('should check HOME .mcp.json as fallback', () => {
      // No .mcp.json in cwd, but one in HOME
      process.cwd = () => tmpdir(); // No .mcp.json here
      const homeDir = join(testDir, 'fakehome');
      mkdirSync(homeDir, { recursive: true });
      process.env.HOME = homeDir;

      const mcpConfig = {
        mcpServers: {
          'some-server': {
            env: { AINATIVE_API_KEY: 'ak_from_home' }
          }
        }
      };
      writeFileSync(join(homeDir, '.mcp.json'), JSON.stringify(mcpConfig));

      const ollama = new AINativeOllama();
      const key = ollama._scanMcpConfig();
      assert.equal(key, 'ak_from_home');

      rmSync(homeDir, { recursive: true, force: true });
    });

    it('should handle "servers" key (alternative to mcpServers)', () => {
      const mcpConfig = {
        servers: {
          'alt-server': {
            env: { AINATIVE_API_KEY: 'ak_alt_key' }
          }
        }
      };
      writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(mcpConfig));
      process.cwd = () => testDir;

      const ollama = new AINativeOllama();
      const key = ollama._scanMcpConfig();
      assert.equal(key, 'ak_alt_key');
    });

    it('should return null when no .mcp.json files found', () => {
      process.cwd = () => tmpdir();
      process.env.HOME = join(tmpdir(), 'nonexistent-' + Date.now());

      const ollama = new AINativeOllama();
      const key = ollama._scanMcpConfig();
      assert.equal(key, null);
    });

    it('should handle malformed .mcp.json gracefully', () => {
      writeFileSync(join(testDir, '.mcp.json'), '{ not valid json }}}');
      process.cwd = () => testDir;

      const ollama = new AINativeOllama();
      const key = ollama._scanMcpConfig();
      // Should not throw, returns null
      assert.equal(key, null);
    });

    it('should return null when servers have no matching env vars', () => {
      const mcpConfig = {
        mcpServers: {
          'unrelated': {
            env: { OTHER_KEY: 'value' }
          }
        }
      };
      writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(mcpConfig));
      process.cwd = () => testDir;

      const ollama = new AINativeOllama();
      const key = ollama._scanMcpConfig();
      assert.equal(key, null);
    });

    it('should handle server config without env property', () => {
      const mcpConfig = {
        mcpServers: {
          'no-env-server': {
            command: 'npx'
          }
        }
      };
      writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(mcpConfig));
      process.cwd = () => testDir;

      const ollama = new AINativeOllama();
      const key = ollama._scanMcpConfig();
      assert.equal(key, null);
    });
  });

  // ── constructor with AINATIVE_API_URL env ──────────────────────

  describe('constructor AINATIVE_API_URL env', () => {
    it('should use AINATIVE_API_URL from env', () => {
      const prev = process.env.AINATIVE_API_URL;
      process.env.AINATIVE_API_URL = 'https://custom.api.example.com';
      const ollama = new AINativeOllama();
      assert.equal(ollama._ainativeUrl, 'https://custom.api.example.com');
      if (prev) process.env.AINATIVE_API_URL = prev;
      else delete process.env.AINATIVE_API_URL;
    });

    it('should prefer constructor ainativeApiUrl over env', () => {
      const prev = process.env.AINATIVE_API_URL;
      process.env.AINATIVE_API_URL = 'https://env-url.com';
      const ollama = new AINativeOllama({ ainativeApiUrl: 'https://constructor-url.com' });
      assert.equal(ollama._ainativeUrl, 'https://constructor-url.com');
      if (prev) process.env.AINATIVE_API_URL = prev;
      else delete process.env.AINATIVE_API_URL;
    });
  });

  // ── list() with local models + deduplication ───────────────────

  describe('list() deduplication', () => {
    it('should merge local and cloud models without duplicates', async () => {
      const originalFetch = globalThis.fetch;
      // Mock local Ollama returning some models
      globalThis.fetch = mock.fn(async (url) => {
        if (url.includes('11434') || url.includes('localhost')) {
          return {
            ok: true,
            json: async () => ({
              models: [
                { name: 'llama3.3:latest', model: 'llama3.3:latest', size: 42000000000, details: { family: 'llama' } },
                { name: 'custom-model:v1', model: 'custom-model:v1', size: 1000000, details: { family: 'custom' } },
              ]
            }),
          };
        }
        throw new Error('unexpected URL: ' + url);
      });

      const ollama = new AINativeOllama();
      const result = await ollama.list();

      // Should have local models + cloud models (minus llama3.3 which overlaps)
      assert.ok(result.models.some(m => m.name === 'llama3.3:latest'), 'local llama should be present');
      assert.ok(result.models.some(m => m.name === 'custom-model:v1'), 'local custom should be present');
      // llama3.3:70b cloud should be excluded (dedup: llama3.3 is in local)
      const cloudLlama = result.models.filter(m => m.name === 'llama3.3:70b');
      assert.equal(cloudLlama.length, 0, 'cloud llama3.3 should be deduped');
      // qwen and deepseek cloud should still be present
      assert.ok(result.models.some(m => m.name === 'qwen3-coder'), 'cloud qwen should be present');
      assert.ok(result.models.some(m => m.name === 'deepseek'), 'cloud deepseek should be present');

      globalThis.fetch = originalFetch;
    });

    it('should re-throw non-connection errors from list', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => {
        throw new Error('Permission denied');
      });

      const ollama = new AINativeOllama();
      await assert.rejects(
        () => ollama.list(),
        /Permission denied/
      );
      globalThis.fetch = originalFetch;
    });
  });

  // ── CJS entry point ────────────────────────────────────────────

  describe('CJS entry (index.cjs)', () => {
    it('should export load() and create() functions', async () => {
      const cjs = await import('../index.cjs');
      const mod = cjs.default || cjs;
      assert.equal(typeof mod.load, 'function');
      assert.equal(typeof mod.create, 'function');
    });

    it('should create an AINativeOllama instance via create()', async () => {
      const cjs = await import('../index.cjs');
      const mod = cjs.default || cjs;
      const instance = await mod.create({ ainativeApiKey: 'cjs-test-key' });
      assert.ok(instance);
      assert.equal(instance._ainativeKey, 'cjs-test-key');
    });

    it('should return all exports via load()', async () => {
      const cjs = await import('../index.cjs');
      const mod = cjs.default || cjs;
      const exports = await mod.load();
      assert.ok(exports.AINativeOllama);
      assert.ok(exports.Ollama);
      assert.ok(exports.default);
    });

    it('should cache module on repeated load() calls', async () => {
      const cjs = await import('../index.cjs');
      const mod = cjs.default || cjs;
      const first = await mod.load();
      const second = await mod.load();
      assert.equal(first, second, 'load() should return cached module');
    });
  });

  // ── httpPost error handling ────────────────────────────────────

  describe('httpPost error handling', () => {
    it('should include status code in error message', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 429,
        text: async () => 'Rate limited',
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key', cloudOnly: true });
      await assert.rejects(
        () => ollama.chat({ model: 'llama3.3', messages: [{ role: 'user', content: 'hi' }] }),
        /HTTP 429/
      );
      globalThis.fetch = originalFetch;
    });

    it('should handle text() failure gracefully', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => { throw new Error('body stream error'); },
      }));

      const ollama = new AINativeOllama({ ainativeApiKey: 'test-key', cloudOnly: true });
      await assert.rejects(
        () => ollama.chat({ model: 'llama3.3', messages: [{ role: 'user', content: 'hi' }] }),
        /HTTP 500/
      );
      globalThis.fetch = originalFetch;
    });
  });

  // ── CLOUD_MODELS structure ─────────────────────────────────────

  describe('CLOUD_MODELS', () => {
    it('should have correct structure for all cloud models', async () => {
      const ollama = new AINativeOllama();
      const result = await (async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock.fn(async () => {
          const err = new Error('fetch failed');
          err.code = 'ECONNREFUSED';
          throw err;
        });
        const res = await ollama.list();
        globalThis.fetch = originalFetch;
        return res;
      })();

      for (const model of result.models) {
        assert.ok(model.name, 'model should have name');
        assert.ok(model.model, 'model should have model field');
        assert.ok(model.modified_at, 'model should have modified_at');
        assert.equal(model.digest, 'ainative-cloud', 'digest should be ainative-cloud');
        assert.ok(model.details, 'model should have details');
        assert.equal(model.details.format, 'cloud');
        assert.equal(model.details._source, 'ainative-cloud');
      }
    });
  });
});
