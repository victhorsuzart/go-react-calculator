// Command server runs the calculator API (SPEC §3, §4.3).
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/victhorsuzart/go-react-calculator/backend/internal/httpapi"
)

func main() {
	os.Exit(run())
}

func run() int {
	healthcheck := flag.Bool("healthcheck", false, "check GET /healthz on the local server and exit")
	flag.Parse()

	port := envOr("PORT", "8080")
	if *healthcheck {
		return checkHealth(port)
	}

	var level slog.Level
	if err := level.UnmarshalText([]byte(envOr("LOG_LEVEL", "info"))); err != nil {
		slog.New(slog.NewJSONHandler(os.Stdout, nil)).Error("invalid LOG_LEVEL", "error", err.Error())
		return 1
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           httpapi.NewHandler(logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelError),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		logger.Error("listen failed", "addr", srv.Addr, "error", err.Error())
		return 1
	}
	logger.Info("server listening", "addr", ln.Addr().String())

	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	select {
	case err := <-errc:
		logger.Error("server failed", "error", err.Error())
		return 1
	case <-ctx.Done():
		stop() // a second signal now terminates the process immediately
	}

	logger.Info("server shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown failed", "error", err.Error())
		return 1
	}
	if err := <-errc; err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server failed", "error", err.Error())
		return 1
	}
	logger.Info("server stopped")
	return 0
}

// checkHealth implements -healthcheck: exit 0 on 200, 1 otherwise.
func checkHealth(port string) int {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/healthz")
	if err != nil {
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
