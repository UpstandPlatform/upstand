package database

import (
	"database/sql"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type ServerMetric struct {
	Timestamp        time.Time `json:"timestamp"`
	CPU              float64   `json:"cpu"`
	CPUModel         string    `json:"cpuModel"`
	CPUCores         int       `json:"cpuCores"`
	CPUPhysicalCores int       `json:"cpuPhysicalCores"`
	CPUSpeed         float64   `json:"cpuSpeed"`
	OS               string    `json:"os"`
	Distro           string    `json:"distro"`
	Kernel           string    `json:"kernel"`
	Arch             string    `json:"arch"`
	MemUsed          uint64    `json:"memUsed"`
	MemUsedGB        float64   `json:"memUsedGB"`
	MemTotal         uint64    `json:"memTotal"`
	Uptime           uint64    `json:"uptime"`
	DiskUsed         uint64    `json:"diskUsed"`
	TotalDisk        uint64    `json:"totalDisk"`
	NetworkIn        uint64    `json:"networkIn"`
	NetworkOut       uint64    `json:"networkOut"`
}

func scanServerMetrics(rows *sql.Rows) ([]ServerMetric, error) {
	var metrics []ServerMetric
	for rows.Next() {
		var m ServerMetric
		err := rows.Scan(
			&m.Timestamp, &m.CPU, &m.CPUModel, &m.CPUCores, &m.CPUPhysicalCores,
			&m.CPUSpeed, &m.OS, &m.Distro, &m.Kernel, &m.Arch,
			&m.MemUsed, &m.MemUsedGB, &m.MemTotal, &m.Uptime,
			&m.DiskUsed, &m.TotalDisk, &m.NetworkIn, &m.NetworkOut,
		)
		if err != nil {
			return nil, err
		}
		metrics = append(metrics, m)
	}
	return metrics, nil
}

func (db *DB) SaveServerMetric(m ServerMetric) error {
	_, err := db.Exec(`
		INSERT INTO server_metrics (
			timestamp, cpu, cpu_model, cpu_cores, cpu_physical_cores, cpu_speed, os, distro, kernel, arch, mem_used, mem_used_gb, mem_total, uptime, disk_used, total_disk, network_in, network_out
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, m.Timestamp, m.CPU, m.CPUModel, m.CPUCores, m.CPUPhysicalCores, m.CPUSpeed, m.OS, m.Distro, m.Kernel, m.Arch, m.MemUsed, m.MemUsedGB, m.MemTotal, m.Uptime, m.DiskUsed, m.TotalDisk, m.NetworkIn, m.NetworkOut)
	return err
}

func (db *DB) GetMetricsByTimeRange(start, end time.Time, limit int) ([]ServerMetric, error) {
	var orderClause string
	var limitClause string
	args := []interface{}{start, end}

	if limit > 0 {
		orderClause = "ORDER BY timestamp DESC"
		limitClause = " LIMIT ?"
		args = append(args, limit)
	}
	rows, err := db.Query(`
		SELECT timestamp, cpu, cpu_model, cpu_cores, cpu_physical_cores, cpu_speed, os, distro, kernel, arch, mem_used, mem_used_gb, mem_total, uptime, disk_used, total_disk, network_in, network_out
		FROM server_metrics
		WHERE timestamp BETWEEN ? AND ?
		`+orderClause+`
	`+limitClause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	metrics, err := scanServerMetrics(rows)
	if err != nil {
		return nil, err
	}

	if limit > 0 {
		for left, right := 0, len(metrics)-1; left < right; left, right = left+1, right-1 {
			metrics[left], metrics[right] = metrics[right], metrics[left]
		}
	}
	return metrics, nil
}

func (db *DB) GetLastNMetrics(n int) ([]ServerMetric, error) {
	rows, err := db.Query(`
		WITH recent_metrics AS (
			SELECT timestamp, cpu, cpu_model, cpu_cores, cpu_physical_cores, cpu_speed, os, distro, kernel, arch, mem_used, mem_used_gb, mem_total, uptime, disk_used, total_disk, network_in, network_out
			FROM server_metrics
			ORDER BY timestamp DESC
			LIMIT ?
		)
		SELECT * FROM recent_metrics
		ORDER BY timestamp ASC
	`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanServerMetrics(rows)
}

func (db *DB) GetAllMetrics() ([]ServerMetric, error) {
	rows, err := db.Query(`
		SELECT timestamp, cpu, cpu_model, cpu_cores, cpu_physical_cores, cpu_speed, os, distro, kernel, arch, mem_used, mem_used_gb, mem_total, uptime, disk_used, total_disk, network_in, network_out
		FROM server_metrics
		ORDER BY timestamp ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanServerMetrics(rows)
}
