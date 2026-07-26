package monitoring

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"

	"github.com/UpstandPlatform/upstand/apps/monitoring/config"
	"github.com/UpstandPlatform/upstand/apps/monitoring/database"
)

var healthState = struct {
	sync.RWMutex
	lastCollectedAt string
	collectionError string
}{}

func RecordCollection(result error) {
	healthState.Lock()
	defer healthState.Unlock()
	healthState.lastCollectedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if result != nil {
		healthState.collectionError = result.Error()
	} else {
		healthState.collectionError = ""
	}
}

func Health() (string, string, string) {
	healthState.RLock()
	defer healthState.RUnlock()
	status := "ok"
	if healthState.collectionError != "" {
		status = "degraded"
	}
	return status, healthState.lastCollectedAt, healthState.collectionError
}

type SystemMetrics struct {
	CPU              string  `json:"cpu"`
	CPUModel         string  `json:"cpuModel"`
	CPUCores         int32   `json:"cpuCores"`
	CPUPhysicalCores int32   `json:"cpuPhysicalCores"`
	CPUSpeed         float64 `json:"cpuSpeed"`
	OS               string  `json:"os"`
	Distro           string  `json:"distro"`
	Kernel           string  `json:"kernel"`
	Arch             string  `json:"arch"`
	MemUsed          string  `json:"memUsed"`
	MemUsedGB        string  `json:"memUsedGB"`
	MemTotal         string  `json:"memTotal"`
	Uptime           uint64  `json:"uptime"`
	DiskUsed         string  `json:"diskUsed"`
	TotalDisk        string  `json:"totalDisk"`
	NetworkIn        string  `json:"networkIn"`
	NetworkOut       string  `json:"networkOut"`
	Timestamp        string  `json:"timestamp"`
}

type AlertPayload struct {
	ServerID   string  `json:"serverId"`
	ServerType string  `json:"serverType"`
	Type       string  `json:"type"`
	Value      float64 `json:"value"`
	Threshold  float64 `json:"threshold"`
	Message    string  `json:"message"`
	Timestamp  string  `json:"timestamp"`
	Nonce      string  `json:"nonce"`
	Signature  string  `json:"signature"`
}

func getRealOS() string {
	if content, err := os.ReadFile("/etc/os-release"); err == nil {
		lines := strings.Split(string(content), "\n")
		var id, name, version string
		for _, line := range lines {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"")
			} else if strings.HasPrefix(line, "NAME=") {
				name = strings.Trim(strings.TrimPrefix(line, "NAME="), "\"")
			} else if strings.HasPrefix(line, "VERSION=") {
				version = strings.Trim(strings.TrimPrefix(line, "VERSION="), "\"")
			} else if strings.HasPrefix(line, "ID=") {
				id = strings.Trim(strings.TrimPrefix(line, "ID="), "\"")
			}
		}
		if name != "" && version != "" {
			return fmt.Sprintf("%s %s", name, version)
		}
		if name != "" {
			return name
		}
		if id != "" {
			return id
		}
	}

	if content, err := os.ReadFile("/etc/system-release"); err == nil {
		text := strings.ToLower(string(content))
		switch {
		case strings.Contains(text, "red hat"):
			return "rhel"
		case strings.Contains(text, "centos"):
			return "centos"
		case strings.Contains(text, "fedora"):
			return "fedora"
		}
	}

	cmd := exec.Command("uname", "-a")
	if output, err := cmd.Output(); err == nil {
		osInfo := strings.ToLower(string(output))
		switch {
		case strings.Contains(osInfo, "debian"):
			return "debian"
		case strings.Contains(osInfo, "ubuntu"):
			return "ubuntu"
		case strings.Contains(osInfo, "centos"):
			return "centos"
		case strings.Contains(osInfo, "fedora"):
			return "fedora"
		case strings.Contains(osInfo, "red hat"):
			return "rhel"
		case strings.Contains(osInfo, "arch"):
			return "arch"
		case strings.Contains(osInfo, "darwin"):
			return "darwin"
		}
	}

	return runtime.GOOS
}

func GetServerMetrics() database.ServerMetric {
	v, _ := mem.VirtualMemory()
	c, _ := cpu.Percent(time.Second, false)
	cpuInfo, _ := cpu.Info()
	diskInfo, _ := disk.Usage("/")
	netInfo, _ := net.IOCounters(false)
	hostInfo, _ := host.Info()
	distro := getRealOS()

	cpuModel := ""
	var cpuSpeed float64
	var physicalCores int32
	if len(cpuInfo) > 0 {
		cpuModel = fmt.Sprintf("%s %s", cpuInfo[0].VendorID, cpuInfo[0].ModelName)
		cpuSpeed = float64(cpuInfo[0].Mhz)
		physicalCores = int32(len(cpuInfo))
	}

	var memTotalGB, memAvailableGB float64
	if v != nil {
		memTotalGB = float64(v.Total) / 1024 / 1024 / 1024
		memAvailableGB = float64(v.Available) / 1024 / 1024 / 1024
	}
	memUsedGB := memTotalGB - memAvailableGB
	memUsedPercent := 0.0
	if memTotalGB > 0 {
		memUsedPercent = (memUsedGB / memTotalGB) * 100
	}

	var networkIn, networkOut float64
	if len(netInfo) > 0 {
		networkIn = float64(netInfo[0].BytesRecv) / 1024 / 1024
		networkOut = float64(netInfo[0].BytesSent) / 1024 / 1024
	}
	cpuPercent := 0.0
	if len(c) > 0 {
		cpuPercent = c[0]
	}

	diskUsed, totalDisk := 0.0, 0.0
	if diskInfo != nil {
		diskUsed = diskInfo.UsedPercent
		totalDisk = float64(diskInfo.Total) / 1024 / 1024 / 1024
	}

	kernel, uptime, arch := "", uint64(0), runtime.GOARCH
	if hostInfo != nil {
		kernel = hostInfo.KernelVersion
		uptime = hostInfo.Uptime
		arch = hostInfo.KernelArch
	}

	return database.ServerMetric{
		Timestamp:        time.Now().UTC(),
		CPU:              cpuPercent,
		CPUModel:         cpuModel,
		CPUCores:         runtime.NumCPU(),
		CPUPhysicalCores: int(physicalCores),
		CPUSpeed:         cpuSpeed,
		OS:               getRealOS(),
		Distro:           distro,
		Kernel:           kernel,
		Arch:             arch,
		MemUsed:          uint64(memUsedPercent),
		MemUsedGB:        memUsedGB,
		MemTotal:         uint64(memTotalGB),
		Uptime:           uptime,
		DiskUsed:         uint64(diskUsed),
		TotalDisk:        uint64(totalDisk),
		NetworkIn:        uint64(networkIn),
		NetworkOut:       uint64(networkOut),
	}
}

func ConvertToSystemMetrics(metric database.ServerMetric) SystemMetrics {
	return SystemMetrics{
		CPU:              fmt.Sprintf("%.2f", metric.CPU),
		CPUModel:         metric.CPUModel,
		CPUCores:         int32(metric.CPUCores),
		CPUPhysicalCores: int32(metric.CPUPhysicalCores),
		CPUSpeed:         metric.CPUSpeed,
		OS:               metric.OS,
		Distro:           metric.Distro,
		Kernel:           metric.Kernel,
		Arch:             metric.Arch,
		MemUsed:          fmt.Sprintf("%d", metric.MemUsed),
		MemUsedGB:        fmt.Sprintf("%.2f", metric.MemUsedGB),
		MemTotal:         fmt.Sprintf("%d", metric.MemTotal),
		Uptime:           metric.Uptime,
		DiskUsed:         fmt.Sprintf("%d", metric.DiskUsed),
		TotalDisk:        fmt.Sprintf("%d", metric.TotalDisk),
		NetworkIn:        fmt.Sprintf("%d", metric.NetworkIn),
		NetworkOut:       fmt.Sprintf("%d", metric.NetworkOut),
		Timestamp:        metric.Timestamp.Format(time.RFC3339Nano),
	}
}

func CheckThresholds(metrics database.ServerMetric) error {
	cfg := config.GetMetricsConfig()
	cpuThresholdValue, memoryThresholdValue := config.GetThresholds()
	cpuThreshold := float64(cpuThresholdValue)
	memThreshold := float64(memoryThresholdValue)
	callbackURL := cfg.Server.UrlCallback
	metricsToken := cfg.Server.Token

	// log.Printf("CPU threshold: %.2f%%", cpuThreshold)
	// log.Printf("Current CPU usage: %.2f%%", metrics.CPU)
	// log.Printf("Memory threshold: %.2f%%", memThreshold)
	// log.Printf("Callback URL: %s", callbackURL)
	// log.Printf("Metrics token: %s", metricsToken)

	if cpuThreshold == 0 && memThreshold == 0 {
		return nil
	}

	if cpuThreshold > 0 && metrics.CPU > cpuThreshold {
		alert := AlertPayload{
			ServerID:   cfg.Server.ServerID,
			ServerType: cfg.Server.ServerType,
			Type:       "CPU",
			Value:      metrics.CPU,
			Threshold:  cpuThreshold,
			Message:    fmt.Sprintf("CPU usage (%.2f%%) exceeded threshold (%.2f%%)", metrics.CPU, cpuThreshold),
			Timestamp:  metrics.Timestamp.Format(time.RFC3339Nano),
			Nonce:      newAlertNonce(),
		}
		alert.Signature = signAlert(alert, metricsToken)
		if err := sendAlert(callbackURL, alert); err != nil {
			return fmt.Errorf("failed to send CPU alert: %v", err)
		}
	}

	if memThreshold > 0 && float64(metrics.MemUsed) > memThreshold {
		alert := AlertPayload{
			ServerID:   cfg.Server.ServerID,
			ServerType: cfg.Server.ServerType,
			Type:       "Memory",
			Value:      float64(metrics.MemUsed),
			Threshold:  memThreshold,
			Message:    fmt.Sprintf("Memory usage (%.2f%%) exceeded threshold (%.2f%%)", float64(metrics.MemUsed), memThreshold),
			Timestamp:  metrics.Timestamp.Format(time.RFC3339Nano),
			Nonce:      newAlertNonce(),
		}
		alert.Signature = signAlert(alert, metricsToken)
		if err := sendAlert(callbackURL, alert); err != nil {
			return fmt.Errorf("failed to send memory alert: %v", err)
		}
	}

	return nil
}

func newAlertNonce() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(value)
}

func signAlert(payload AlertPayload, secret string) string {
	canonical := fmt.Sprintf(
		"%s|%s|%s|%s|%s|%s|%s|%s",
		payload.ServerID,
		payload.ServerType,
		payload.Type,
		strconv.FormatFloat(payload.Value, 'f', -1, 64),
		strconv.FormatFloat(payload.Threshold, 'f', -1, 64),
		payload.Message,
		payload.Timestamp,
		payload.Nonce,
	)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}

func sendAlert(callbackURL string, payload AlertPayload) error {
	if callbackURL == "" {
		return fmt.Errorf("callback URL is not set")
	}
	wrappedPayload := map[string]interface{}{
		"json": payload,
	}

	jsonData, err := json.Marshal(wrappedPayload)
	if err != nil {
		return fmt.Errorf("failed to marshal alert payload: %v", err)
	}

	resp, err := http.Post(callbackURL, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to send POST request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("received non-OK response status: %s, body: %s", resp.Status, string(bodyBytes))
	}

	return nil
}
