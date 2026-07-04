import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path'; // Using standard naming format consistent with your index.js
import fs from 'fs';
import { runMigrations } from './migrations/index.js';

let db;

export function getDb() {
  if (db) return db;

  const dataDir = app.getPath('userData');

  // Ensure the directory exists before creating the SQLite file
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'posly.db');

  db = new Database(dbPath);

  // Optimizations and Constraints
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Automatically spin up your tables and settings
  try {
    runMigrations(db);
    console.log('✔ Database successfully initialized at:', dbPath);
  } catch (error) {
    console.error('❌ Failed to run database migrations:', error);
  }

  return db;
}