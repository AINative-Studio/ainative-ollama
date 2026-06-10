/**
 * ainative-ollama — CommonJS entry point.
 *
 * Re-exports the ES module via dynamic import for CommonJS consumers.
 *
 * Usage:
 *   const { AINativeOllama } = require('ainative-ollama');
 *   const ollama = new AINativeOllama();
 */

'use strict';

let _cached;

async function load() {
  if (!_cached) {
    _cached = await import('./index.js');
  }
  return _cached;
}

// Export a promise-based loader and convenience wrappers
module.exports = {
  /**
   * Load the ES module. Call once, then use the returned exports.
   * @returns {Promise<{ AINativeOllama, Ollama, default: AINativeOllama }>}
   */
  load,

  /**
   * Create an AINativeOllama instance (async due to ESM import).
   * @param {Object} [opts] - Options passed to AINativeOllama constructor
   * @returns {Promise<AINativeOllama>}
   */
  async create(opts) {
    const mod = await load();
    return new mod.AINativeOllama(opts);
  },
};
