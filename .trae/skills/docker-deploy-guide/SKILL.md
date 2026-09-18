---
name: docker-deploy-guide
description: 绿角犀 Office Docker 部署手册
---

# Docker 部署手册

## 基础镜像
node:20-alpine

## Dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
EXPOSE 3000
CMD [\"node\", \"server/index.js\"]

## docker-compose.yml
services:
  office-server:
    build: ./server
    ports: [\"3000:3000\"]
    environment:
      NODE_ENV: production
    volumes:
      - office-data:/app/data
    restart: unless-stopped
volumes:
  office-data:

## 生产部署
1. docker compose build
2. docker compose up -d
3. Nginx 反向代理 + HTTPS (certbot)
4. 健康检查: curl http://localhost:3000/health
