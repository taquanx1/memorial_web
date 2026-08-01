#!/usr/bin/env bash
# Start the memorial site and expose it with a Cloudflare Quick Tunnel
set -e
cd "$(dirname "$0")"
PORT="${PORT:-8090}"

echo "Starting memorial site on http://localhost:$PORT ..."
node server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

sleep 2
echo "Serving. Starting Cloudflare Quick Tunnel ..."
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate

echo "(stop both with Ctrl+C)"
