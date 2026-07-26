package config

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
)

type Config struct {
	Server struct {
		ServerID      string `json:"serverId"`
		ServerType    string `json:"serverType"`
		RefreshRate   int    `json:"refreshRate"`
		Port          int    `json:"port"`
		Token         string `json:"token"`
		UrlCallback   string `json:"urlCallback"`
		CronJob       string `json:"cronJob"`
		RetentionDays int    `json:"retentionDays"`
		Thresholds    struct {
			CPU    int `json:"cpu"`
			Memory int `json:"memory"`
		} `json:"thresholds"`
	} `json:"server"`
	Containers struct {
		RefreshRate int `json:"refreshRate"`
		Services    struct {
			Include []string `json:"include"`
			Exclude []string `json:"exclude"`
		} `json:"services"`
	} `json:"containers"`
}

var (
	config     *Config
	configOnce sync.Once
	configMu   sync.RWMutex
)

func GetMetricsConfig() *Config {
	configOnce.Do(func() {
		configJSON := os.Getenv("METRICS_CONFIG")
		if configJSON == "" {
			log.Fatal("METRICS_CONFIG environment variable is required")
		}

		config = &Config{}
		if err := json.Unmarshal([]byte(configJSON), config); err != nil {
			log.Fatalf("Error parsing METRICS_CONFIG: %v", err)
		}

		// Validate required fields
		if config.Server.Token == "" || config.Server.UrlCallback == "" {
			log.Fatal("token and urlCallback are required in the configuration")
		}
		if config.Server.RefreshRate <= 0 {
			config.Server.RefreshRate = 25
		}
		if config.Server.Port <= 0 {
			config.Server.Port = 3001
		}
		if config.Server.RetentionDays <= 0 {
			config.Server.RetentionDays = 7
		}
		if config.Server.CronJob == "" {
			config.Server.CronJob = "0 0 * * *"
		}
		if config.Containers.RefreshRate <= 0 {
			config.Containers.RefreshRate = config.Server.RefreshRate
		}
	})

	return config
}

// GetThresholds returns the current runtime alert thresholds. A value of zero
// disables the corresponding alert.
func GetThresholds() (cpu int, memory int) {
	configMu.RLock()
	defer configMu.RUnlock()

	cfg := GetMetricsConfig()
	return cfg.Server.Thresholds.CPU, cfg.Server.Thresholds.Memory
}

// UpdateThresholds changes alert thresholds without requiring an agent restart.
func UpdateThresholds(cpu int, memory int) error {
	if cpu < 0 || cpu > 100 || memory < 0 || memory > 100 {
		return fmt.Errorf("thresholds must be between 0 and 100")
	}

	configMu.Lock()
	defer configMu.Unlock()

	cfg := GetMetricsConfig()
	cfg.Server.Thresholds.CPU = cpu
	cfg.Server.Thresholds.Memory = memory
	return nil
}
