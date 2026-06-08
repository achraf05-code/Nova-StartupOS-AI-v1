// =====================================================================
// Nova StartupOS AI — Project context loader (shared)
// ---------------------------------------------------------------------
// Reads `supabase_schema.sql`, `supabase_schema_v2.sql`, and
// `TECHNICAL_SPECIFICATION.md` from the function bundle so the LLM can
// reason about Nova's actual architecture instead of guessing.
//
// Vercel ships these files into the function via `includeFiles` in
// vercel.json. Local Node runs read straight from process.cwd().
//
// All loads are cached on the warm function instance so we pay the
// disk I/O exactly once per cold start.
// =====================================================================

'use strict';

const fs = require('fs');
const path = require('path');

let _cache = null;

function readSafe(name, maxBytes) {
  const candidates = [
    process.cwd(),
    path.join(process.cwd(), 'api', '..'),
    path.resolve(__dirname, '..', '..'),
  ];
  for (const root of candidates) {
    const full = path.join(root, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      const raw = fs.readFileSync(full, 'utf8');
      return raw.length > maxBytes ? raw.slice(0, maxBytes) + '\n…[truncated]' : raw;
    } catch (_) { /* try next root */ }
  }
  return '';
}

function load() {
  if (_cache) return _cache;
  _cache = {
    schema:   readSafe('supabase_schema.sql',     14000),
    schemaV2: readSafe('supabase_schema_v2.sql',   6000),
    spec:     readSafe('TECHNICAL_SPECIFICATION.md', 14000),
    loadedAt: new Date().toISOString(),
  };
  _cache.have = {
    schema:   !!_cache.schema,
    schemaV2: !!_cache.schemaV2,
    spec:     !!_cache.spec,
  };
  return _cache;
}

/**
 * Compose a "Project context (read-only)" block to append to a system
 * prompt. Returns an empty string if no files were found, so callers
 * can safely concatenate without checking.
 *
 * @param {Object}  [opts]
 * @param {boolean} [opts.includeSpec=true]    include TECHNICAL_SPECIFICATION.md
 * @param {boolean} [opts.includeSchema=true]  include supabase_schema(_v2?).sql
 * @returns {string}
 */
function buildContextBlock(opts) {
  opts = opts || {};
  const ctx = load();
  let out = '';
  if (opts.includeSchema !== false) {
    if (ctx.schema)   out += '\n\n[supabase_schema.sql]\n' + ctx.schema;
    if (ctx.schemaV2) out += '\n\n[supabase_schema_v2.sql]\n' + ctx.schemaV2;
  }
  if (opts.includeSpec !== false && ctx.spec) {
    out += '\n\n[TECHNICAL_SPECIFICATION.md]\n' + ctx.spec;
  }
  return out ? '\n\nProject context (read-only):' + out : '';
}

module.exports = { load, buildContextBlock };
