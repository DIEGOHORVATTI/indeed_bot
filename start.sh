#!/usr/bin/env bash
set -e

trap 'kill 0; exit' SIGINT SIGTERM EXIT

for port in 8004 8005; do
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "Matando processo anterior na porta $port (PID $pid)..."
    kill -9 $pid 2>/dev/null || true
  fi
done

echo "Iniciando API na porta :8004..."
bun run dev:api &

echo "Iniciando Dashboard na porta :8005..."
bun run dev:dashboard &

echo ""
echo "API:       http://localhost:8004"
echo "OpenAPI:   http://localhost:8004/openapi"
echo "Dashboard: http://localhost:8005"
echo ""
echo "Pressione Ctrl+C para parar todos os servicos"

wait
