#!/bin/bash
set -e

echo "========== ApplicationStart: Starting containers =========="

cd /home/ubuntu

# Start containers in detached mode
docker compose up -d

# Wait for container to be running
sleep 5

# Check container status
docker compose ps

echo "========== ApplicationStart: Complete =========="
