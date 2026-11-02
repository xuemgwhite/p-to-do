ALTER TABLE tasks ADD COLUMN excluded_weekdays TEXT NOT NULL DEFAULT '';

UPDATE schema_meta
SET version = 2,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = 1;
