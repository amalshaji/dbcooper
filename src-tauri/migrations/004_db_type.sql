-- Add db_type and file_path columns for multi-database support
ALTER TABLE connections ADD COLUMN db_type TEXT NOT NULL DEFAULT 'postgres';
ALTER TABLE connections ADD COLUMN file_path TEXT;
