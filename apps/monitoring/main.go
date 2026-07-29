package main

import (
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/UpstandPlatform/upstand/apps/monitoring/config"
	"github.com/UpstandPlatform/upstand/apps/monitoring/containers"
	"github.com/UpstandPlatform/upstand/apps/monitoring/database"
	"github.com/UpstandPlatform/upstand/apps/monitoring/middleware"
	"github.com/UpstandPlatform/upstand/apps/monitoring/monitoring"
	"github.com/gofiber/fiber/v2"
	"github.com/joho/godotenv"
)

func main() {
	godotenv.Load()

	// Get configuration
	cfg := config.GetMetricsConfig()
	token := cfg.Server.Token
	METRICS_URL_CALLBACK := cfg.Server.UrlCallback
	log.Printf("Environment variables:")
	log.Printf("Monitoring configuration loaded")

	if token == "" || METRICS_URL_CALLBACK == "" {
		log.Fatal("token and urlCallback are required in the configuration")
	}

	db, err := database.InitDB()
	if err != nil {
		log.Fatal(err)
	}

	// Iniciar el sistema de limpieza de métricas
	cleanupCron, err := database.StartMetricsCleanup(db.DB, cfg.Server.RetentionDays, cfg.Server.CronJob)
	if err != nil {
		log.Fatalf("Error starting metrics cleanup system: %v", err)
	}
	defer cleanupCron.Stop()

	app := fiber.New()

	app.Get("/health", func(c *fiber.Ctx) error {
		status, lastCollectedAt, collectionError := monitoring.Health()
		return c.JSON(fiber.Map{
			"status":          status,
			"lastCollectedAt": lastCollectedAt,
			"collectionError": collectionError,
		})
	})

	app.Use(func(c *fiber.Ctx) error {
		if c.Path() == "/health" {
			return c.Next()
		}
		return middleware.AuthMiddleware()(c)
	})

	app.Post("/config/thresholds", func(c *fiber.Ctx) error {
		var payload struct {
			CPU    int `json:"cpu"`
			Memory int `json:"memory"`
		}
		if err := c.BodyParser(&payload); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid threshold payload",
			})
		}
		if err := config.UpdateThresholds(payload.CPU, payload.Memory); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}

		cpu, memory := config.GetThresholds()
		return c.JSON(fiber.Map{"cpu": cpu, "memory": memory})
	})

	app.Get("/metrics", func(c *fiber.Ctx) error {
		limit := c.Query("limit", "50")
		start, end, hasRange, err := parseMetricRange(c)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		var metrics []monitoring.SystemMetrics
		if hasRange {
			limitNum := parseLimit(limit)
			dbMetrics, rangeErr := db.GetMetricsByTimeRange(start, end, limitNum)
			if rangeErr != nil {
				return c.Status(500).JSON(fiber.Map{"error": "Failed to fetch metrics"})
			}
			for _, m := range dbMetrics {
				metrics = append(metrics, monitoring.ConvertToSystemMetrics(m))
			}
		} else {
			n := parseLimit(limit)
			dbMetrics, err := db.GetLastNMetrics(n)
			if err != nil {
				return c.Status(500).JSON(fiber.Map{
					"error": "Failed to fetch metrics",
				})
			}
			for _, m := range dbMetrics {
				metrics = append(metrics, monitoring.ConvertToSystemMetrics(m))
			}
		}

		return c.JSON(metrics)
	})

	containerMonitor, err := containers.NewContainerMonitor(db)
	if err != nil {
		log.Fatalf("Failed to create container monitor: %v", err)
	}
	if err := containerMonitor.Start(); err != nil {
		log.Fatalf("Failed to start container monitor: %v", err)
	}
	defer containerMonitor.Stop()

	app.Get("/metrics/containers", func(c *fiber.Ctx) error {
		limit := c.Query("limit", "50")
		appName := c.Query("appName", "")
		start, end, hasRange, err := parseMetricRange(c)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		var metrics []database.ContainerMetric
		if hasRange {
			metrics, err = db.GetContainerMetricsInRange(appName, start, end, parseLimit(limit))
		} else {
			metrics, err = db.GetLastNContainerMetrics(appName, parseLimit(limit))
		}

		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"error": "Error getting container metrics: " + err.Error(),
			})
		}

		return c.JSON(metrics)
	})

	collectServerMetrics := func() {
		metrics := monitoring.GetServerMetrics()
		if err := db.SaveServerMetric(metrics); err != nil {
			monitoring.RecordCollection(err)
			log.Printf("Error saving metrics: %v", err)
			return
		}
		monitoring.RecordCollection(nil)

		if err := monitoring.CheckThresholds(metrics); err != nil {
			log.Printf("Error checking thresholds: %v", err)
		}
	}
	collectServerMetrics()

	go func() {
		refreshRate := cfg.Server.RefreshRate
		duration := time.Duration(refreshRate) * time.Second

		log.Printf("Refreshing server metrics every %v", duration)
		ticker := time.NewTicker(duration)
		defer ticker.Stop()

		for range ticker.C {
			collectServerMetrics()
		}
	}()

	port := cfg.Server.Port
	if port == 0 {
		port = 3001
	}

	log.Printf("Server starting on port %d", port)
	log.Fatal(app.Listen(":" + strconv.Itoa(port)))
}

func parseLimit(value string) int {
	if value == "all" {
		return 5000
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 {
		return 50
	}
	if limit > 5000 {
		return 5000
	}
	return limit
}

func parseMetricRange(c *fiber.Ctx) (time.Time, time.Time, bool, error) {
	fromValue := c.Query("from")
	toValue := c.Query("to")
	if fromValue == "" && toValue == "" {
		return time.Time{}, time.Time{}, false, nil
	}

	now := time.Now().UTC()
	start := now.AddDate(0, 0, -7)
	end := now
	var err error
	if fromValue != "" {
		start, err = time.Parse(time.RFC3339, fromValue)
		if err != nil {
			return time.Time{}, time.Time{}, true, fmt.Errorf("invalid from timestamp")
		}
	}
	if toValue != "" {
		end, err = time.Parse(time.RFC3339, toValue)
		if err != nil {
			return time.Time{}, time.Time{}, true, fmt.Errorf("invalid to timestamp")
		}
	}
	if end.Before(start) {
		return time.Time{}, time.Time{}, true, fmt.Errorf("to timestamp must be after from timestamp")
	}
	return start.UTC(), end.UTC(), true, nil
}
