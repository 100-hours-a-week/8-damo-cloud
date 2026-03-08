#!/bin/bash
set -e

echo "========== AfterInstall: ECR Login & Pull Images =========="

AWS_REGION="ap-northeast-2"
ECR_REGISTRY="080598576517.dkr.ecr.ap-northeast-2.amazonaws.com"

cd /home/ubuntu

# Reset docker config to avoid credential helper issues
mkdir -p /root/.docker
echo '{}' > /root/.docker/config.json

# Login to ECR
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

# Pull latest images
docker compose pull

echo "========== AfterInstall: Complete =========="
