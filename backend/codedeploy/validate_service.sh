#!/bin/bash
set -e

echo "========== ValidateService: Health check =========="

# Health check configuration
HEALTH_URL="http://localhost:8080/api/healthy"
MAX_RETRIES=30
RETRY_INTERVAL=2

for i in $(seq 1 $MAX_RETRIES); do
    echo "Health check attempt $i/$MAX_RETRIES..."

    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL || echo "000")

    if [ "$HTTP_STATUS" = "200" ]; then
        echo "Health check passed! (HTTP $HTTP_STATUS)"
        echo "========== ValidateService: Complete =========="
        exit 0
    fi

    echo "Health check failed (HTTP $HTTP_STATUS). Retrying in ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

echo "Health check failed after $MAX_RETRIES attempts"
echo "Container logs:"
cd /home/ubuntu && docker compose logs --tail=50
exit 1
