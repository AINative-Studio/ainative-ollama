/**
 * ainative-ollama — Drop-in replacement for the `ollama` npm package.
 *
 * When local Ollama is running, all calls pass through with zero overhead.
 * When local Ollama is unavailable, seamlessly falls back to AINative cloud
 * with free Llama 3.3 70B, Qwen, and DeepSeek models.
 *
 * @module ainative-ollama
 */

import { Ollama } from 'ollama';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const AINATIVE_API_URL = 'https://api.ainative.studio/api/v1';
const INSTANT_DB_URL = `${AINATIVE_API_URL}/public/instant-db`;
const CHAT_URL = `${AINATIVE_API_URL}/chat/completions`;

/**
 * Model name mapping from Ollama names to AINative model identifiers.
 */
const MODEL_MAP = {
  // Llama family
  'llama3.3': 'meta-llama/Llama-3.3-70B-Instruct',
  'llama3.3:70b': 'meta-llama/Llama-3.3-70B-Instruct',
  'llama3.1': 'meta-llama/Llama-3.3-70B-Instruct',
  'llama3.1:70b': 'meta-llama/Llama-3.3-70B-Instruct',
  'llama3.1:8b': 'meta-llama/Llama-3.3-70B-Instruct',
  'llama3': 'meta-llama/Llama-3.3-70B-Instruct',
  'llama2': 'meta-llama/Llama-3.3-70B-Instruct',

  // Qwen family
  'qwen': 'qwen3-coder-flash',
  'qwen2.5': 'qwen3-coder-flash',
  'qwen2.5-coder': 'qwen3-coder-flash',
  'qwen3': 'qwen3-coder-flash',
  'qwen3-coder': 'qwen3-coder-flash',

  // DeepSeek family
  'deepseek': 'deepseek-4-flash',
  'deepseek-coder': 'deepseek-4-flash',
  'deepseek-coder-v2': 'deepseek-4-flash',
  'deepseek-v2': 'deepseek-4-flash',
  'deepseek-r1': 'deepseek-4-flash',

  // Coding models → qwen3-coder-flash
  'codellama': 'qwen3-coder-flash',
  'starcoder': 'qwen3-coder-flash',
  'codegemma': 'qwen3-coder-flash',

  // General models → llama 3.3
  'mistral': 'meta-llama/Llama-3.3-70B-Instruct',
  'mixtral': 'meta-llama/Llama-3.3-70B-Instruct',
  'gemma': 'meta-llama/Llama-3.3-70B-Instruct',
  'gemma2': 'meta-llama/Llama-3.3-70B-Instruct',
  'phi3': 'meta-llama/Llama-3.3-70B-Instruct',
  'phi': 'meta-llama/Llama-3.3-70B-Instruct',
};

/**
 * Cloud models available on AINative (returned by list() when local is unavailable).
 */
const CLOUD_MODELS = [
  {
    name: 'llama3.3:70b',
    model: 'llama3.3:70b',
    modified_at: new Date().toISOString(),
    size: 0,
    digest: 'ainative-cloud',
    details: {
      parent_model: '',
      format: 'cloud',
      family: 'llama',
      families: ['llama'],
      parameter_size: '70B',
      quantization_level: 'none (cloud)',
    },
  },
  {
    name: 'qwen3-coder',
    model: 'qwen3-coder',
    modified_at: new Date().toISOString(),
    size: 0,
    digest: 'ainative-cloud',
    details: {
      parent_model: '',
      format: 'cloud',
      family: 'qwen',
      families: ['qwen'],
      parameter_size: 'unknown',
      quantization_level: 'none (cloud)',
    },
  },
  {
    name: 'deepseek',
    model: 'deepseek',
    modified_at: new Date().toISOString(),
    size: 0,
    digest: 'ainative-cloud',
    details: {
      parent_model: '',
      format: 'cloud',
      family: 'deepseek',
      families: ['deepseek'],
      parameter_size: 'unknown',
      quantization_level: 'none (cloud)',
    },
  },
];

/**
 * Check if an error indicates local Ollama is not running.
 */
function isConnectionError(err) {
  if (!err) return false;
  const code = err.code || '';
  const msg = (err.message || '').toLowerCase();
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ENOTFOUND' ||
    msg.includes('fetch failed') ||
    msg.includes('connection refused') ||
    msg.includes('econnrefused') ||
    msg.includes('network error') ||
    msg.includes('socket hang up')
  );
}

/**
 * Minimal HTTP POST using native fetch (Node 18+).
 */
async function httpPost(url, body, headers = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

/**
 * AINativeOllama — extends the official Ollama class with cloud fallback.
 *
 * Usage:
 *   import { AINativeOllama } from 'ainative-ollama';
 *   const ollama = new AINativeOllama();
 *   const response = await ollama.chat({ model: 'llama3.3', messages: [...] });
 */
export class AINativeOllama extends Ollama {
  /**
   * @param {Object} opts - Options passed to the Ollama constructor
   * @param {string} [opts.ainativeApiKey] - AINative API key (or set AINATIVE_API_KEY env var)
   * @param {string} [opts.ainativeApiUrl] - Override AINative API base URL
   * @param {boolean} [opts.cloudOnly] - Skip local Ollama entirely, always use cloud
   */
  constructor(opts = {}) {
    super(opts);
    this._ainativeKey = opts.ainativeApiKey || process.env.AINATIVE_API_KEY || null;
    this._ainativeUrl = opts.ainativeApiUrl || process.env.AINATIVE_API_URL || AINATIVE_API_URL;
    this._cloudOnly = opts.cloudOnly || false;
    this._provisioning = null; // dedup concurrent provision calls
  }

  /**
   * Chat with a model. Tries local Ollama first, falls back to AINative cloud.
   */
  async chat(request) {
    if (this._cloudOnly) {
      return this._cloudChat(request);
    }

    try {
      return await super.chat(request);
    } catch (err) {
      if (isConnectionError(err)) {
        return this._cloudChat(request);
      }
      throw err;
    }
  }

  /**
   * List available models. Merges local models with AINative cloud models.
   */
  async list() {
    let localModels = [];
    try {
      const result = await super.list();
      localModels = result.models || [];
    } catch (err) {
      if (!isConnectionError(err)) throw err;
    }

    // Tag cloud models so callers can distinguish
    const cloudTagged = CLOUD_MODELS.map((m) => ({
      ...m,
      details: { ...m.details, _source: 'ainative-cloud' },
    }));

    // Deduplicate — local models take priority
    const localNames = new Set(localModels.map((m) => m.name.split(':')[0]));
    const uniqueCloud = cloudTagged.filter(
      (m) => !localNames.has(m.name.split(':')[0])
    );

    return { models: [...localModels, ...uniqueCloud] };
  }

  /**
   * Generate a completion (non-chat). Falls back to cloud chat API.
   */
  async generate(request) {
    if (this._cloudOnly) {
      return this._cloudGenerate(request);
    }

    try {
      return await super.generate(request);
    } catch (err) {
      if (isConnectionError(err)) {
        return this._cloudGenerate(request);
      }
      throw err;
    }
  }

  /**
   * Map an Ollama model name to the AINative model identifier.
   */
  _mapModel(ollamaModel) {
    if (!ollamaModel) return 'meta-llama/Llama-3.3-70B-Instruct';
    const base = ollamaModel.split(':')[0].toLowerCase();
    return MODEL_MAP[ollamaModel.toLowerCase()] || MODEL_MAP[base] || ollamaModel;
  }

  /**
   * Send chat request to AINative cloud.
   */
  async _cloudChat(request) {
    if (!this._ainativeKey) await this._provision();

    const model = this._mapModel(request.model);
    const messages = (request.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const chatUrl = `${this._ainativeUrl}/chat/completions`;
    const resp = await httpPost(chatUrl, { model, messages, stream: false }, {
      'x-api-key': this._ainativeKey,
    });

    const choice = resp.choices?.[0];
    return {
      model: request.model,
      created_at: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: choice?.message?.content || '',
      },
      done: true,
      done_reason: 'stop',
      total_duration: 0,
      load_duration: 0,
      prompt_eval_count: resp.usage?.prompt_tokens || 0,
      eval_count: resp.usage?.completion_tokens || 0,
      eval_duration: 0,
    };
  }

  /**
   * Send generate request to AINative cloud (uses chat completions under the hood).
   */
  async _cloudGenerate(request) {
    const messages = [{ role: 'user', content: request.prompt || '' }];
    if (request.system) {
      messages.unshift({ role: 'system', content: request.system });
    }
    const chatResult = await this._cloudChat({
      model: request.model,
      messages,
    });
    return {
      model: request.model,
      created_at: chatResult.created_at,
      response: chatResult.message.content,
      done: true,
      done_reason: 'stop',
      total_duration: 0,
      load_duration: 0,
      prompt_eval_count: chatResult.prompt_eval_count,
      eval_count: chatResult.eval_count,
      eval_duration: 0,
    };
  }

  /**
   * Auto-provision a free AINative account on first cloud fallback.
   * Uses the instant-db endpoint — same pattern as zerodb-cli.
   */
  async _provision() {
    // Deduplicate concurrent provision calls
    if (this._provisioning) return this._provisioning;

    this._provisioning = (async () => {
      // Check env again (may have been set by another path)
      if (process.env.AINATIVE_API_KEY) {
        this._ainativeKey = process.env.AINATIVE_API_KEY;
        return;
      }

      // Check .mcp.json for existing credentials
      const key = this._scanMcpConfig();
      if (key) {
        this._ainativeKey = key;
        return;
      }

      // Provision via instant-db
      console.log('[ainative-ollama] Local Ollama not available. Provisioning free AINative cloud account...');

      let result;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const instantDbUrl = `${this._ainativeUrl}/public/instant-db`;
          result = await httpPost(instantDbUrl, { agree_terms: true });
          break;
        } catch (err) {
          if (attempt < 3 && /50[234]/.test(err.message)) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          } else {
            throw new Error(`[ainative-ollama] Failed to provision: ${err.message}`);
          }
        }
      }

      this._ainativeKey = result.api_key;
      process.env.AINATIVE_API_KEY = result.api_key;

      console.log('[ainative-ollama] Free cloud account provisioned!');
      console.log(`[ainative-ollama]   API Key:  ${result.api_key.slice(0, 16)}...`);
      console.log(`[ainative-ollama]   Expires:  ${result.expires_at}`);
      console.log(`[ainative-ollama]   Claim:    ${result.claim_url}`);
      console.log('[ainative-ollama] Set AINATIVE_API_KEY env var to skip auto-provisioning next time.');
    })();

    try {
      await this._provisioning;
    } finally {
      this._provisioning = null;
    }
  }

  /**
   * Scan .mcp.json files for existing AINative/ZeroDB API keys.
   */
  _scanMcpConfig() {
    try {
      const candidates = [
        join(process.cwd(), '.mcp.json'),
        join(process.env.HOME || '', '.mcp.json'),
      ];

      for (const file of candidates) {
        try {
          if (!existsSync(file)) continue;
          const raw = JSON.parse(readFileSync(file, 'utf-8'));
          const servers = raw.mcpServers || raw.servers || {};
          for (const [, cfg] of Object.entries(servers)) {
            const env = cfg.env || {};
            if (env.AINATIVE_API_KEY) return env.AINATIVE_API_KEY;
            if (env.ZERODB_API_KEY) return env.ZERODB_API_KEY;
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Filesystem not available
    }
    return null;
  }
}

// Re-export everything from ollama for full compatibility
export { Ollama } from 'ollama';

// Convenience: default export is AINativeOllama
export default AINativeOllama;
