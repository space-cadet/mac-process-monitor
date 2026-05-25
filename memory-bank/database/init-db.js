#!/usr/bin/env node

/**
 * Initialize memory bank database for mac-process-monitor
 * Creates memory_bank.db with Phase A schema
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'memory_bank.db');
const schemaPath = join(__dirname, 'schema.sql');

console.log('\n🔄 Initializing Memory Bank Database...\n');
console.log('   DB path:', dbPath);

const db = new Database(dbPath);
const schema = readFileSync(schemaPath, 'utf-8');

// Execute the entire schema as one block — better-sqlite3 handles multiple statements
try {
  db.exec(schema);
  console.log('✅ Schema executed successfully');
} catch (err) {
  console.error('❌ Schema error:', err.message);
  process.exit(1);
}

// Count tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name").all();

console.log(`\n📋 Tables created (${tables.length}):`);
for (const t of tables) {
  console.log(`   • ${t.name}`);
}

console.log(`\n🔑 Indexes created (${indexes.length}):`);
for (const i of indexes) {
  console.log(`   • ${i.name}`);
}

db.close();

console.log(`\n✅ Database initialized: ${dbPath}`);
console.log('\nNext steps:');
console.log('  1. Import existing tasks: node import-existing-data.js');
console.log('  2. Run DB workflow: node -e "import(\'./lib/workflow.js\').then(m => m.recordSessionWork({...}))"');
