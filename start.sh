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

redis_ping() {
  if command -v redis-cli &>/dev/null; then
    redis-cli ping 2>/dev/null | grep -q PONG
  else
    docker compose exec -T redis redis-cli ping 2>/dev/null | grep -q PONG
  fi
}

if redis_ping; then
  echo "Redis já está rodando."
else
  if docker info &>/dev/null; then
    echo "Iniciando Redis..."
    docker compose up -d redis
    until redis_ping; do
      sleep 0.3
    done
    echo "Redis pronto."
  else
    echo "⚠ Docker não está rodando — worker precisa de Redis em localhost:6379"
    echo "  Inicie o Docker Desktop ou execute: brew services start redis"
    echo ""
  fi
fi

echo "Iniciando API na porta :8004..."
bun run dev:api &

echo "Iniciando Dashboard na porta :8005..."
bun run dev:dashboard &

echo "Iniciando Worker (aguardando Redis)..."
bun run dev:worker &

echo ""
echo "API:       http://localhost:8004"
echo "OpenAPI:   http://localhost:8004/openapi"
echo "Dashboard: http://localhost:8005"
echo ""
echo "Pressione Ctrl+C para parar todos os serviços"

wait
