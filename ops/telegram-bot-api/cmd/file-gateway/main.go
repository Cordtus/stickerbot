package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"stickerbot/telegram-bot-api/internal/filegateway"
)

func main() {
	listenAddress := flag.String("listen", "0.0.0.0:8082", "gateway listen address")
	stateRoot := flag.String("state-root", "/var/lib/telegram-bot-api/state", "Telegram Bot API state root")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	handler, err := filegateway.NewHandler(filegateway.Config{
		StateRoot: *stateRoot,
		Logger:    logger,
	})
	if err != nil {
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              *listenAddress,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       2 * time.Minute,
		ErrorLog:          log.New(io.Discard, "", 0),
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	defer signal.Stop(stop)

	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case <-stop:
		shutdownContext, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			os.Exit(1)
		}
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			os.Exit(1)
		}
	}
}
