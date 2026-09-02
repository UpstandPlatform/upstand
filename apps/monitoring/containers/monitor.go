package containers

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/UpstandPlatform/upstand/apps/monitoring/config"
	"github.com/UpstandPlatform/upstand/apps/monitoring/database"
)

type ContainerMonitor struct {
	db        *database.DB
	isRunning bool
	mu        sync.Mutex
	stopChan  chan struct{}
}

func NewContainerMonitor(db *database.DB) (*ContainerMonitor, error) {
	if err := db.InitContainerMetricsTable(); err != nil {
		return nil, fmt.Errorf("failed to initialize container metrics table: %v", err)
	}

	return &ContainerMonitor{
		db:       db,
		stopChan: make(chan struct{}),
	}, nil
}

func (cm *ContainerMonitor) Start() error {
	if err := LoadConfig(); err != nil {
		return fmt.Errorf("error loading config: %v", err)
	}
	if !dockerTransportAvailable(os.Getenv("DOCKER_HOST"), fileExists) {
		log.Printf("Container metrics collection disabled: no usable Docker transport is configured")
		return nil
	}

	metricsConfig := config.GetMetricsConfig()
	refreshRate := metricsConfig.Containers.RefreshRate
	if refreshRate == 0 {
		refreshRate = 60 // default refresh rate
	}
	duration := time.Duration(refreshRate) * time.Second

	// An empty include list intentionally means all containers, subject to the
	// exclude list. This keeps the default installation useful without requiring
	// the control plane to know every generated Swarm service name.
	cm.collectMetrics()

	ticker := time.NewTicker(duration)
	go func() {
		for {
			select {
			case <-ticker.C:
				cm.collectMetrics()
			case <-cm.stopChan:
				ticker.Stop()
				return
			}
		}
	}()

	return nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// dockerTransportAvailable prevents an agent from retrying docker stats forever
// when it was intentionally deployed without a socket or broker credentials.
// Remote agents normally use the Unix socket; brokered local agents must have
// the complete client certificate set before an HTTPS endpoint is considered
// usable.
func dockerTransportAvailable(host string, exists func(string) bool) bool {
	host = strings.TrimSpace(host)
	if host == "" {
		return exists("/var/run/docker.sock")
	}

	parsed, err := url.Parse(host)
	if err != nil {
		return false
	}
	switch parsed.Scheme {
	case "unix":
		path := parsed.Path
		if path == "" {
			path = "/var/run/docker.sock"
		}
		return exists(path)
	case "npipe":
		return true
	case "tcp":
		return true
	case "https":
		certPath := strings.TrimSpace(os.Getenv("DOCKER_CERT_PATH"))
		if certPath == "" {
			return false
		}
		return exists(path.Join(certPath, "ca.pem")) &&
			exists(path.Join(certPath, "cert.pem")) &&
			exists(path.Join(certPath, "key.pem"))
	default:
		return false
	}
}

func (cm *ContainerMonitor) Stop() {
	close(cm.stopChan)
}

func (cm *ContainerMonitor) collectMetrics() {
	cm.mu.Lock()
	if cm.isRunning {
		cm.mu.Unlock()
		log.Println("Previous collection still running, skipping...")
		return
	}
	cm.isRunning = true
	cm.mu.Unlock()

	defer func() {
		cm.mu.Lock()
		cm.isRunning = false
		cm.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "docker", "stats", "--no-stream", "--format",
		`{"BlockIO":"{{.BlockIO}}","CPUPerc":"{{.CPUPerc}}","ID":"{{.ID}}","MemPerc":"{{.MemPerc}}","MemUsage":"{{.MemUsage}}","Name":"{{.Name}}","NetIO":"{{.NetIO}}"}`)

	output, err := cmd.CombinedOutput()

	// log.Printf("Output: %s", string(output))
	if err != nil {
		if ctx.Err() != nil {
			log.Printf("Docker stats collection timed out after 15s")
			return
		}
		log.Printf("Error getting docker stats: %v", err)
		return
	}

	lines := string(output)
	if lines == "" {
		return
	}

	seenServices := make(map[string]bool)
	for _, line := range strings.Split(lines, "\n") {
		if line == "" {
			continue
		}

		var container Container
		if err := json.Unmarshal([]byte(line), &container); err != nil {
			log.Printf("Error parsing container data: %v", err)
			continue
		}

		if !ShouldMonitorContainer(container.Name) {
			continue
		}

		serviceName := GetServiceName(container.Name)

		if seenServices[serviceName] {
			continue
		}

		seenServices[serviceName] = true

		// log.Printf("Container: %+v", container)

		// Process metrics
		metric := processContainerMetrics(container)

		// log.Printf("Saving metrics for %s: %+v", serviceName, metric)

		if err := cm.db.SaveContainerMetric(metric); err != nil {
			log.Printf("Error saving metrics for %s: %v", serviceName, err)
		}
	}
}

func processContainerMetrics(container Container) *database.ContainerMetric {

	// Process CPU
	cpu, _ := strconv.ParseFloat(strings.TrimSuffix(container.CPUPerc, "%"), 64)

	// Process Memory
	memPerc, _ := strconv.ParseFloat(strings.TrimSuffix(container.MemPerc, "%"), 64)
	memParts := strings.Split(container.MemUsage, " / ")

	var usedValue, totalValue float64
	var usedUnit, totalUnit string

	if len(memParts) == 2 {
		// Process used memory
		usedParts := strings.Fields(memParts[0])
		if len(usedParts) > 0 {
			usedValue, _ = strconv.ParseFloat(strings.TrimRight(usedParts[0], "MiBGiB"), 64)
			usedUnit = strings.TrimLeft(usedParts[0], "0123456789.")
			// Convert MiB to MB and GiB to GB
			if usedUnit == "MiB" {
				usedUnit = "MB"
			} else if usedUnit == "GiB" {
				usedUnit = "GB"
			}
		}

		// Process total memory
		totalParts := strings.Fields(memParts[1])
		if len(totalParts) > 0 {
			totalValue, _ = strconv.ParseFloat(strings.TrimRight(totalParts[0], "MiBGiB"), 64)
			totalUnit = strings.TrimLeft(totalParts[0], "0123456789.")
			// Convert MiB to MB and GiB to GB
			if totalUnit == "MiB" {
				totalUnit = "MB"
			} else if totalUnit == "GiB" {
				totalUnit = "GB"
			}
		}
	}

	// Process Network I/O
	netParts := strings.Split(container.NetIO, " / ")

	var netInValue, netOutValue float64
	var netInUnit, netOutUnit string

	if len(netParts) == 2 {
		// Process input
		inParts := strings.Fields(netParts[0])
		if len(inParts) > 0 {
			netInValue, _ = strconv.ParseFloat(strings.TrimRight(inParts[0], "kMGTB"), 64)
			netInUnit = strings.TrimLeft(inParts[0], "0123456789.")
		}

		// Process output
		outParts := strings.Fields(netParts[1])
		if len(outParts) > 0 {
			netOutValue, _ = strconv.ParseFloat(strings.TrimRight(outParts[0], "kMGTB"), 64)
			netOutUnit = strings.TrimLeft(outParts[0], "0123456789.")
		}
	}

	// Process Block I/O
	blockParts := strings.Split(container.BlockIO, " / ")

	var blockReadValue, blockWriteValue float64
	var blockReadUnit, blockWriteUnit string

	if len(blockParts) == 2 {
		// Process read
		readParts := strings.Fields(blockParts[0])
		if len(readParts) > 0 {
			blockReadValue, _ = strconv.ParseFloat(strings.TrimRight(readParts[0], "kMGTB"), 64)
			blockReadUnit = strings.TrimLeft(readParts[0], "0123456789.")
		}

		// Process write
		writeParts := strings.Fields(blockParts[1])
		if len(writeParts) > 0 {
			blockWriteValue, _ = strconv.ParseFloat(strings.TrimRight(writeParts[0], "kMGTB"), 64)
			blockWriteUnit = strings.TrimLeft(writeParts[0], "0123456789.")
		}
	}

	return &database.ContainerMetric{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		CPU:       cpu,
		Memory: database.MemoryMetric{
			Percentage: memPerc,
			Used:       usedValue,
			Total:      totalValue,
			UsedUnit:   usedUnit,
			TotalUnit:  totalUnit,
		},
		Network: database.NetworkMetric{
			Input:      netInValue,
			Output:     netOutValue,
			InputUnit:  netInUnit,
			OutputUnit: netOutUnit,
		},
		BlockIO: database.BlockIOMetric{
			Read:      blockReadValue,
			Write:     blockWriteValue,
			ReadUnit:  blockReadUnit,
			WriteUnit: blockWriteUnit,
		},
		Container: container.ID,
		ID:        container.ID,
		Name:      container.Name,
	}
}

func parseValue(value string) (float64, string) {
	parts := strings.Fields(value)
	if len(parts) < 1 {
		return 0, "B"
	}
	v, _ := strconv.ParseFloat(parts[0], 64)
	unit := strings.TrimLeft(value, "0123456789.")
	return v, unit
}
