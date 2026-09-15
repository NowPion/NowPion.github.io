---
title: Nginx与Caddy
date: 2025-10-25 16:56:18
tags: [Nginx, Caddy, Docker, 反向代理]
categories: [技术分享]
---

# Nginx 与 Caddy：特点、区别与 Docker 部署

本文面向常见的反向代理与静态站点场景，对比 **Nginx** 与 **Caddy** 的核心特点与差异，并给出在 Windows 环境下使用 **Docker** 的快速部署示例，帮助你按需选择与落地。

---

## 为什么关注

- 统一入口：反向代理整合多服务与路由。
- HTTPS 与安全：证书与重定向策略标准化管理。
- 性能与稳定：高并发、低资源占用，适合生产环境。
- 易用性：配置、热更新与可观测性影响运维效率。

---

## 特点速览

### Nginx
- 高性能与低资源占用，成熟生态与广泛应用。
- 配置文件（`nginx.conf`）语法稳定，适合复杂路由与负载均衡。
- 反向代理与负载均衡（`upstream`），静态资源与缓存支持好。
- 模块生态丰富（开源/商业），社区资料多，排障成本低。
- 热重载通过 `nginx -s reload`，支持零停机更新。

### Caddy
- 开箱即用的自动 HTTPS（ACME），证书自动申请与续期。
- 简洁的 `Caddyfile` 配置，支持 JSON 与 Admin API 动态管理。
- 反向代理简单（`reverse_proxy`），内置 HTTP/2、HTTP/3（QUIC）。
- 结构化日志与良好默认安全策略，易于现代化运维。
- 插件生态活跃（相对更小），功能覆盖常用站点与网关需求。

---

## 核心区别一览

- 配置与管理：
  - Nginx 使用 `nginx.conf`，灵活但语法偏繁；热重载靠信号。
  - Caddy 使用 `Caddyfile`（或 JSON），更简洁；Admin API 支持在线更新、重载与查询。
- HTTPS 与证书：
  - Nginx 需手动申请与配置证书（或脚本自动化）。
  - Caddy 自动申请与续期，默认将 HTTP 重定向到 HTTPS（需公网域名与 80/443 开放）。
- 负载均衡：
  - Nginx 提供 `upstream` 多策略（轮询、最少连接、IP hash）。
  - Caddy 在 `reverse_proxy` 中内置多后端与健康检查，配置更直观。
- 性能与资源：
  - 两者都非常高效；Nginx 更“工业化”、内存占用更小。
  - Caddy 默认启用现代协议与安全特性，整体开销略高但配置更省心。
- 可观测性：
  - Nginx 日志与 `stub_status`（或第三方模块）常用。
  - Caddy 日志结构化，Admin API/JSON 状态便于集成。

选择建议：
- 追求“稳、广、细控”用 Nginx；追求“快搭建、自动 HTTPS、简配置”用 Caddy。

---

## 使用 Docker 部署 Nginx

以下示例基于 **Docker Desktop for Windows**。

### 1）运行容器（挂载配置与静态目录）

```bash
docker run -d \
  --name nginx \
  -p 80:80 -p 443:443 \
  -v "h:/data/nginx/conf:/etc/nginx" \
  -v "h:/data/nginx/html:/usr/share/nginx/html" \
  -v "h:/data/nginx/certs:/etc/nginx/certs" \
  nginx:stable
```

- `conf`：放置 `nginx.conf` 与 `conf.d/*.conf`。
- `html`：站点静态文件目录。
- `certs`：证书与私钥（用于 HTTPS）。

### 2）最小配置示例（反向代理 + 静态）

`h:/data/nginx/conf/nginx.conf`

```nginx
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;

    # 静态站点
    server {
        listen 80;
        server_name example.local;

        location / {
            root  /usr/share/nginx/html;
            index index.html;
        }

        # 反向代理到后端服务
        location /api/ {
            proxy_pass http://host.docker.internal:8080/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
}
```

HTTPS 提示：
- 生产环境需在 `server` 中配置 `listen 443 ssl;`、证书路径与安全套件。
- 可配合 `Let’s Encrypt`/`acme.sh` 自动化证书申请。

### 3）Docker Compose（推荐）

`docker-compose.yml`

```yaml
version: "3.8"
services:
  nginx:
    image: nginx:stable
    container_name: nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./data/nginx/conf:/etc/nginx
      - ./data/nginx/html:/usr/share/nginx/html
      - ./data/nginx/certs:/etc/nginx/certs
    restart: unless-stopped
```

运维常用：
- 重载配置：`docker exec nginx nginx -s reload`
- 查看日志：`docker logs -f nginx`

---

## 使用 Docker 部署 Caddy

### 1）运行容器（挂载 Caddyfile 与数据目录）

```bash
docker run -d \
  --name caddy \
  -p 80:80 -p 443:443 -p 2019:2019 \
  -v "h:/data/caddy/Caddyfile:/etc/caddy/Caddyfile" \
  -v "h:/data/caddy/site:/srv" \
  -v "h:/data/caddy/data:/data" \
  -v "h:/data/caddy/config:/config" \
  caddy:2
```

- `Caddyfile`：核心配置文件。
- `site`：静态文件目录（配合 `file_server`）。
- `2019`：Admin API（可用于热更新与状态查询）。
- `data/config`：证书与运行时配置持久化（自动 HTTPS 需要）。

### 2）最小配置示例

`h:/data/caddy/Caddyfile`

```caddy
# 站点 + 自动 HTTPS（需公网 DNS 指向本机）
example.com {
    # 静态站点
    root * /srv
    file_server

    # 反向代理
    reverse_proxy host.docker.internal:8080
}

# 本地开发（不申请证书）
:80 {
    root * /srv
    file_server
    reverse_proxy host.docker.internal:8080
}
```

热重载：
- 通过 Admin API：`curl -X POST localhost:2019/load -H "Content-Type: text/caddyfile" --data-binary @/etc/caddy/Caddyfile`
- 或直接：`docker exec caddy caddy reload --config /etc/caddy/Caddyfile`

### 3）Docker Compose（推荐）

`docker-compose.yml`

```yaml
version: "3.8"
services:
  caddy:
    image: caddy:2
    container_name: caddy
    ports:
      - "80:80"
      - "443:443"
      - "2019:2019"
    volumes:
      - ./data/caddy/Caddyfile:/etc/caddy/Caddyfile
      - ./data/caddy/site:/srv
      - ./data/caddy/data:/data
      - ./data/caddy/config:/config
    restart: unless-stopped
```

注意事项：
- 自动 HTTPS 需要可解析的域名与 80/443 外网连通；内网或本地开发可使用 `:80` 监听或 `tls internal`。
- Windows 挂载路径需在 Docker Desktop 中共享并允许访问对应磁盘。

---

## 总结

- Nginx 更适合在需要精细化控制、资源占用更小、生态更成熟的场景中使用。
- Caddy 更适合快速交付、自动 HTTPS、现代协议与简单配置的场景。
- 两者都可通过 Docker 在 Windows 环境快速部署；建议使用 Compose 管理配置与数据持久化，并结合反向代理与静态站点需求选择合适的方案。

—— *NowPion*
