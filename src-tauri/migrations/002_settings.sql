-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Seed default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'system');
INSERT OR IGNORE INTO settings (key, value) VALUES ('check_updates_on_startup', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('openai_endpoint', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('openai_api_key', '');
