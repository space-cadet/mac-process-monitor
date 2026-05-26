#!/usr/bin/env node

/**
 * Import existing memory bank data into the new SQLite database
 * Reads from existing markdown files and populates the DB
 */

import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const dbPath = join(process.cwd(), 'memory-bank', 'database', 'memory_bank.db');
const db = new Database(dbPath);

const mbDir = join(process.cwd(), 'memory-bank');

console.log('\n🔄 Importing existing memory bank data...\n');

// Import tasks from tasks.md
const tasksMd = readFileSync(join(mbDir, 'tasks.md'), 'utf-8');

// Parse active tasks
const activeMatch = tasksMd.match(/## Active Tasks\n\n\| ID \| Title \| Status \|.*?\n\n## Completed Tasks/s);
if (activeMatch) {
  const lines = activeMatch[0].split('\n').filter(l => l.startsWith('| T'));
  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim()).filter(p => p);
    if (parts.length >= 6) {
      const [id, title, status, priority, started, deps, details] = parts;
      const normalizedStatus = status.includes('🔄') ? 'in_progress' : 
                              status.includes('✅') ? 'completed' : 
                              status.includes('⏸️') ? 'paused' : 'pending';
      
      db.prepare(`INSERT OR REPLACE INTO task_items (id, title, status, priority, started, details)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, title, normalizedStatus, priority, started, `Task ${id}: ${title}`);
      
      console.log(`  📋 Task ${id}: ${title} → ${normalizedStatus}`);
    }
  }
}

// Parse completed tasks
const completedMatch = tasksMd.match(/## Completed Tasks\n\n\| ID \| Title \| Status \|.*?\n\n## Status Summary/s);
if (completedMatch) {
  const lines = completedMatch[0].split('\n').filter(l => l.startsWith('| T'));
  for (const line of lines) {
    const parts = line.split('|').map(p => p.trim()).filter(p => p);
    if (parts.length >= 7) {
      const [id, title, status, priority, started, completed, deps, details] = parts;
      db.prepare(`INSERT OR REPLACE INTO task_items (id, title, status, priority, started, details)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, title, 'completed', priority, started, `Task ${id}: ${title} (completed ${completed})`);
      
      console.log(`  ✅ Task ${id}: ${title} → completed`);
    }
  }
}

// Import edit history from edit_history.md
const editHistoryMd = readFileSync(join(mbDir, 'edit_history.md'), 'utf-8');
const editMatches = [...editHistoryMd.matchAll(/#### (\d{2}:\d{2}:\d{2}) (\w+)? - (T\d+)?:?\s*(.+?)\n((?:- .+?\n)+)/g)];

for (const match of editMatches) {
  const [, time, tz, taskId, desc, modsBlock] = match;
  const dateMatch = editHistoryMd.slice(0, match.index).match(/## (\d{4}-\d{2}-\d{2})\s*$/m);
  const date = dateMatch ? dateMatch[1] : '2026-05-18';
  
  const result = db.prepare(`INSERT INTO edit_entries (date, time, timezone, timestamp, task_id, task_description)
                             VALUES (?, ?, ?, ?, ?, ?)`)
    .run(date, time, tz || 'IST', `${date}T${time}:00+05:30`, taskId || null, desc.trim());
  
  const entryId = result.lastInsertRowid;
  
  // Parse file modifications
  const modLines = modsBlock.split('\n').filter(l => l.trim().startsWith('- '));
  for (const modLine of modLines) {
    const modMatch = modLine.match(/- (\w+) `(.+?)` - (.+)/);
    if (modMatch) {
      const [, action, path, description] = modMatch;
      db.prepare(`INSERT INTO file_modifications (edit_entry_id, action, file_path, description)
                  VALUES (?, ?, ?, ?)`)
        .run(entryId, action, path, description);
    }
  }
  
  console.log(`  📝 Edit entry ${entryId}: ${taskId || 'INIT'} - ${desc.trim().slice(0, 50)}...`);
}

// Import session from session_cache.md
const sessionCacheMd = readFileSync(join(mbDir, 'session_cache.md'), 'utf-8');
const sessionDateMatch = sessionCacheMd.match(/\*Created: (\d{4}-\d{2}-\d{2})/);
const sessionDate = sessionDateMatch ? sessionDateMatch[1] : '2026-05-18';

const sessionId = `${sessionDate}-evening`;
db.prepare(`INSERT OR REPLACE INTO sessions (id, date, period, focus, status, content)
            VALUES (?, ?, ?, ?, ?, ?)`)
  .run(sessionId, sessionDate, 'evening', 'T1', 'completed', 
       'Initial TypeScript rewrite session. See session_cache.md for details.');

console.log(`  📅 Session: ${sessionId}`);

// Update session cache
db.prepare(`INSERT OR REPLACE INTO session_cache (session_id, status, focus_task, active_tasks_count, paused_tasks_count, completed_tasks_count)
            VALUES (?, ?, ?, ?, ?, ?)`)
  .run(sessionId, 'completed', 'T1', 0, 0, 1);

console.log(`  🗂️  Session cache updated`);

db.close();

console.log('\n✅ Import complete!');
console.log('\nYou can now use the DB workflow:');
console.log('  node -e "import(\'./lib/workflow.js\').then(m => m.recordSessionWork({...}))"');
