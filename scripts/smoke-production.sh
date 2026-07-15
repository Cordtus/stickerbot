#!/usr/bin/env bash
# Exercise the CPU VP9 path used for Telegram video stickers without Telegram.

set -euo pipefail

FFMPEG_BIN="${FFMPEG_BIN:-/usr/bin/ffmpeg}"
FFPROBE_BIN="${FFPROBE_BIN:-/usr/bin/ffprobe}"
TIMEOUT_BIN="${TIMEOUT_BIN:-/usr/bin/timeout}"
SMOKE_TIMEOUT_SECONDS="${SMOKE_TIMEOUT_SECONDS:-30}"
SMOKE_WORK_ROOT="${SMOKE_WORK_ROOT:-/var/tmp}"

for binary in "$FFMPEG_BIN" "$FFPROBE_BIN" "$TIMEOUT_BIN"; do
	if [[ ! -x "$binary" ]]; then
		echo "Required media smoke executable is missing: $binary" >&2
		exit 1
	fi
done

work_dir="$(mktemp -d "$SMOKE_WORK_ROOT/stickerbot-media-smoke.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
output_file="$work_dir/vp9-smoke.webm"

encoder_list="$("$TIMEOUT_BIN" "$SMOKE_TIMEOUT_SECONDS" "$FFMPEG_BIN" -hide_banner -encoders 2>&1)"
if ! grep -Eq '(^|[[:space:]])libvpx-vp9([[:space:]]|$)' <<< "$encoder_list"; then
	echo 'FFmpeg does not expose the required libvpx-vp9 encoder' >&2
	exit 1
fi

LC_ALL=C "$TIMEOUT_BIN" "$SMOKE_TIMEOUT_SECONDS" "$FFMPEG_BIN" \
	-hide_banner -loglevel error \
	-f lavfi -i 'color=c=blue:s=64x64:r=10:d=0.2' \
	-an -c:v libvpx-vp9 -pix_fmt yuv420p -y "$output_file"

if [[ ! -s "$output_file" ]]; then
	echo 'FFmpeg VP9 smoke output is empty' >&2
	exit 1
fi

probe="$("$TIMEOUT_BIN" "$SMOKE_TIMEOUT_SECONDS" "$FFPROBE_BIN" \
	-v error -select_streams v:0 \
	-show_entries stream=codec_name,width,height \
	-of default=noprint_wrappers=1 "$output_file")"
for expected in codec_name=vp9 width=64 height=64; do
	if ! grep -qx "$expected" <<< "$probe"; then
		echo "FFprobe media smoke mismatch: expected $expected" >&2
		exit 1
	fi
done

echo 'StickerBot media smoke passed: codec=vp9 width=64 height=64'
