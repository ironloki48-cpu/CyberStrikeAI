package plugins

import (
	"database/sql"
	"fmt"

	"go.uber.org/zap"
)

// DB wraps the database handle for plugin persistence.
type DB struct {
	db     *sql.DB
	logger *zap.Logger
}

// NewDB creates a new plugin DB wrapper. It creates the required tables if they
// do not exist.
func NewDB(sqlDB *sql.DB, logger *zap.Logger) (*DB, error) {
	d := &DB{db: sqlDB, logger: logger}
	if err := d.initTables(); err != nil {
		return nil, fmt.Errorf("plugin db init: %w", err)
	}
	return d, nil
}

func (d *DB) initTables() error {
	createPluginStates := `
	CREATE TABLE IF NOT EXISTS plugin_states (
		plugin_name TEXT PRIMARY KEY,
		enabled     INTEGER NOT NULL DEFAULT 0,
		installed   INTEGER NOT NULL DEFAULT 0
	);`

	createPluginConfig := `
	CREATE TABLE IF NOT EXISTS plugin_config (
		plugin_name TEXT NOT NULL,
		config_key  TEXT NOT NULL,
		config_value TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (plugin_name, config_key)
	);`

	if _, err := d.db.Exec(createPluginStates); err != nil {
		return fmt.Errorf("create plugin_states table: %w", err)
	}
	if _, err := d.db.Exec(createPluginConfig); err != nil {
		return fmt.Errorf("create plugin_config table: %w", err)
	}
	return nil
}

// PluginStateRow represents a row in plugin_states.
type PluginStateRow struct {
	Name      string
	Enabled   bool
	Installed bool
}

// GetPluginState returns the persisted state for a plugin. Returns nil if not found.
func (d *DB) GetPluginState(name string) (*PluginStateRow, error) {
	row := d.db.QueryRow("SELECT plugin_name, enabled, installed FROM plugin_states WHERE plugin_name = ?", name)
	var ps PluginStateRow
	var enabled, installed int
	if err := row.Scan(&ps.Name, &enabled, &installed); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	ps.Enabled = enabled != 0
	ps.Installed = installed != 0
	return &ps, nil
}

// UpsertPluginState upserts plugin enabled/installed state.
func (d *DB) UpsertPluginState(name string, enabled, installed bool) error {
	_, err := d.db.Exec(`
		INSERT INTO plugin_states (plugin_name, enabled, installed)
		VALUES (?, ?, ?)
		ON CONFLICT(plugin_name) DO UPDATE SET enabled = excluded.enabled, installed = excluded.installed`,
		name, boolToInt(enabled), boolToInt(installed))
	return err
}

// SetPluginEnabled sets only the enabled flag.
func (d *DB) SetPluginEnabled(name string, enabled bool) error {
	_, err := d.db.Exec(`
		INSERT INTO plugin_states (plugin_name, enabled, installed)
		VALUES (?, ?, 0)
		ON CONFLICT(plugin_name) DO UPDATE SET enabled = excluded.enabled`,
		name, boolToInt(enabled))
	return err
}

// SetPluginInstalled sets only the installed flag.
func (d *DB) SetPluginInstalled(name string, installed bool) error {
	_, err := d.db.Exec(`
		INSERT INTO plugin_states (plugin_name, enabled, installed)
		VALUES (?, 0, ?)
		ON CONFLICT(plugin_name) DO UPDATE SET installed = excluded.installed`,
		name, boolToInt(installed))
	return err
}

// GetPluginConfig returns all config key-value pairs for a plugin.
func (d *DB) GetPluginConfig(name string) (map[string]string, error) {
	rows, err := d.db.Query("SELECT config_key, config_value FROM plugin_config WHERE plugin_name = ?", name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		result[k] = v
	}
	return result, rows.Err()
}

// SetPluginConfigValue sets a single config key-value for a plugin.
func (d *DB) SetPluginConfigValue(pluginName, key, value string) error {
	_, err := d.db.Exec(`
		INSERT INTO plugin_config (plugin_name, config_key, config_value)
		VALUES (?, ?, ?)
		ON CONFLICT(plugin_name, config_key) DO UPDATE SET config_value = excluded.config_value`,
		pluginName, key, value)
	return err
}

// DeletePluginState removes all persisted state and config for a plugin.
func (d *DB) DeletePluginState(name string) error {
	if _, err := d.db.Exec("DELETE FROM plugin_config WHERE plugin_name = ?", name); err != nil {
		return err
	}
	_, err := d.db.Exec("DELETE FROM plugin_states WHERE plugin_name = ?", name)
	return err
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
