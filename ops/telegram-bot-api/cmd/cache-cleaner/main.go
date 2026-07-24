package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"stickerbot/telegram-bot-api/internal/cachecleaner"
)

const (
	gibibyte      = int64(1024 * 1024 * 1024)
	defaultHigh   = 100 * gibibyte
	defaultLow    = 80 * gibibyte
	defaultState  = "/var/lib/telegram-bot-api/state"
	defaultTemp   = "/var/lib/telegram-bot-api/tmp"
	defaultAge    = 24 * time.Hour
	defaultTmpAge = 6 * time.Hour
	defaultMinAge = 2 * time.Hour
)

func main() {
	var stateRoot string
	var tempRoot string
	flag.StringVar(&stateRoot, "state", defaultState, "Telegram Bot API state root")
	flag.StringVar(&stateRoot, "state-root", defaultState, "Telegram Bot API state root")
	flag.StringVar(&tempRoot, "temp", defaultTemp, "Telegram Bot API temporary-file root")
	flag.StringVar(&tempRoot, "temp-root", defaultTemp, "Telegram Bot API temporary-file root")
	mediaMaxAge := flag.Duration("media-max-age", defaultAge, "maximum media age")
	tempMaxAge := flag.Duration("temp-max-age", defaultTmpAge, "maximum temporary-file age")
	minimumMediaAge := flag.Duration("minimum-media-age", defaultMinAge, "minimum media age eligible for capacity pruning")
	highWaterBytes := flag.Int64("high-water-bytes", defaultHigh, "capacity-prune trigger in bytes")
	lowWaterBytes := flag.Int64("low-water-bytes", defaultLow, "capacity-prune target in bytes")
	dryRun := flag.Bool("dry-run", false, "report cleanup candidates without deleting files")
	flag.Parse()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	report, err := cachecleaner.Clean(ctx, cachecleaner.Policy{
		StateRoot:       stateRoot,
		TempRoot:        tempRoot,
		MediaMaxAge:     *mediaMaxAge,
		TempMaxAge:      *tempMaxAge,
		MinimumMediaAge: *minimumMediaAge,
		HighWaterBytes:  *highWaterBytes,
		LowWaterBytes:   *lowWaterBytes,
		DryRun:          *dryRun,
	}, time.Now())
	if err != nil {
		slog.Error("Telegram Bot API cache cleanup failed", "error", err)
		os.Exit(1)
	}

	slog.Info("Telegram Bot API cache cleanup complete",
		"dry_run", *dryRun,
		"before_bytes", report.BeforeBytes,
		"after_bytes", report.AfterBytes,
		"removed", report.Removed,
		"reclaimed_bytes", report.Reclaimed,
		"by_bot_id", report.ByBotID,
	)
}
