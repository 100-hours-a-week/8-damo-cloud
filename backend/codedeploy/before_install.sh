#!/bin/bash
set -e

echo "========== BeforeInstall: Cleaning up existing containers =========="

cd /home/ubuntu

# Stop and remove existing containers (ignore errors if not running)
if [ -f docker-compose.yml ]; then
    docker compose down --remove-orphans || true
fi

# Remove dangling images to free up space
docker image prune -f || true

echo "========== BeforeInstall: Complete =========="
