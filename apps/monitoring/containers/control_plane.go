package containers

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/UpstandPlatform/upstand/apps/monitoring/database"
)

const snapshotPath = "/api/monitoring/local-containers"
const snapshotBodyLimit = 1024 * 1024

var snapshotClient = &http.Client{
	Timeout:       30 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
}

type controlPlaneSnapshot struct {
	CollectedAt time.Time `json:"collectedAt"`
	Containers  []struct {
		ID            string  `json:"containerId"`
		Name          string  `json:"name"`
		CPU           float64 `json:"cpuPercent"`
		MemoryUsed    float64 `json:"memoryUsageBytes"`
		MemoryLimit   float64 `json:"memoryLimitBytes"`
		MemoryPercent float64 `json:"memoryPercent"`
		NetworkRx     float64 `json:"networkRxBytes"`
		NetworkTx     float64 `json:"networkTxBytes"`
		BlockRead     float64 `json:"blockReadBytes"`
		BlockWrite    float64 `json:"blockWriteBytes"`
	} `json:"containers"`
}

func fetchControlPlaneMetrics(ctx context.Context, callback, token string) ([]database.ContainerMetric, error) {
	endpoint, err := url.Parse(callback)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") || endpoint.User != nil || token == "" {
		return nil, errors.New("invalid control-plane metrics configuration")
	}
	endpoint.Path, endpoint.RawPath, endpoint.RawQuery, endpoint.Fragment = snapshotPath, "", "", ""
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, errors.New("invalid control-plane metrics request")
	}
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	mac := hmac.New(sha256.New, []byte(token))
	_, _ = mac.Write([]byte("GET|" + snapshotPath + "|" + timestamp))
	request.Header.Set("X-Upstand-Metrics-Timestamp", timestamp)
	request.Header.Set("X-Upstand-Metrics-Signature", hex.EncodeToString(mac.Sum(nil)))
	response, err := snapshotClient.Do(request)
	if err != nil {
		return nil, errors.New("control-plane metrics request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("control-plane metrics returned HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, snapshotBodyLimit+1))
	if err != nil || len(body) > snapshotBodyLimit {
		return nil, errors.New("invalid control-plane metrics response size")
	}
	var snapshot controlPlaneSnapshot
	if json.Unmarshal(body, &snapshot) != nil || snapshot.Containers == nil || len(snapshot.Containers) > 256 {
		return nil, errors.New("invalid control-plane metrics response")
	}
	age := time.Since(snapshot.CollectedAt)
	if snapshot.CollectedAt.IsZero() || age > time.Minute || age < -time.Minute {
		return nil, errors.New("stale control-plane metrics response")
	}
	metrics := make([]database.ContainerMetric, 0, len(snapshot.Containers))
	for _, sample := range snapshot.Containers {
		if sample.ID == "" || sample.Name == "" {
			return nil, errors.New("incomplete container metrics response")
		}
		for _, value := range []float64{sample.CPU, sample.MemoryUsed, sample.MemoryLimit, sample.MemoryPercent, sample.NetworkRx, sample.NetworkTx, sample.BlockRead, sample.BlockWrite} {
			if value < 0 {
				return nil, errors.New("invalid container metrics value")
			}
		}
		metrics = append(metrics, database.ContainerMetric{
			Timestamp: snapshot.CollectedAt.UTC().Format(time.RFC3339Nano), ID: sample.ID, Container: sample.ID, Name: sample.Name, CPU: sample.CPU,
			Memory:  database.MemoryMetric{Percentage: sample.MemoryPercent, Used: sample.MemoryUsed, Total: sample.MemoryLimit, UsedUnit: "B", TotalUnit: "B"},
			Network: database.NetworkMetric{Input: sample.NetworkRx, Output: sample.NetworkTx, InputUnit: "B", OutputUnit: "B"},
			BlockIO: database.BlockIOMetric{Read: sample.BlockRead, Write: sample.BlockWrite, ReadUnit: "B", WriteUnit: "B"},
		})
	}
	return metrics, nil
}
