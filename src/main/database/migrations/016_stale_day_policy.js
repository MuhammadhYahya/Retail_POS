export const version = '016_stale_day_policy';

export function up(db) {
  db.exec(`
    ALTER TABLE settings
    ADD COLUMN stale_day_policy TEXT NOT NULL DEFAULT 'block';
  `);
}
