#!/usr/bin/env bash
set -eo pipefail

PORT=9222
APP_URL="http://127.0.0.1:5173"
PROFILE_DIR="/tmp/edge-debug-profile-$(date +%s)"
OUTPUT_DIR="/home/nguyen/.gemini/antigravity/brain/e672099d-2635-46ca-9ae1-f128ac6ddbaf/screenshots"

cleanup() {
  echo "[Launcher] Cleaning up background browser process (PID: $EDGE_PID)..."
  if [ -n "$EDGE_PID" ]; then
    kill "$EDGE_PID" 2>/dev/null || true
  fi
  rm -rf "$PROFILE_DIR"
}
trap cleanup EXIT

echo "[Launcher] Spawning Microsoft Edge with CDP on port $PORT..."
DISPLAY=:0 microsoft-edge-stable \
  --remote-debugging-port=$PORT \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1920,1080 \
  "$APP_URL" > /dev/null 2>&1 &
EDGE_PID=$!

echo "[Launcher] Waiting for CDP endpoint readiness..."
for i in {1..15}; do
  if curl -s "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then
    echo "[Launcher] CDP is ready!"
    break
  fi
  sleep 0.5
done

echo "[Launcher] Executing CDP test scenario engine..."
python3 scripts/capture_screenshots.py --port "$PORT" --url "$APP_URL" --output-dir "$OUTPUT_DIR"

echo "[Launcher] UI Verification completed successfully."
