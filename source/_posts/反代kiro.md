---
title: 反代 Kiro：使用 Kiro-Go 暴露 OpenAI / Anthropic 兼容接口
date: 2026-05-22 10:14:34
tags: [Kiro, Kiro-Go, Claude Code, CC Switch, Docker]
categories: [技术分享]
---

Kiro 的这个ui是真几把难用，而且还很卡，就想着把Kiro的模型反代出来

这里使用的是 **Kiro-Go**：

GitHub 地址：<https://github.com/Quorinex/Kiro-Go>

Kiro-Go 的核心能力：

- 支持 OpenAI `/v1/chat/completions` 接口
- 支持 Anthropic `/v1/messages` 接口
- 支持多账号池与轮询负载均衡
- 支持 SSE 流式响应
- 支持自动刷新 Token
- 提供 Web 管理后台
- 支持配置 HTTP / SOCKS5 出站代理

## 使用 Docker 启动 Kiro-Go

先准备一个本地数据目录，用来持久化配置和账号数据：

```bash
mkdir -p /opt/kiro-go/data
```

然后启动容器：

```bash
docker run -d \
  --name kiro-go \
  -p 8080:8080 \
  -e ADMIN_PASSWORD=your_secure_password \
  -v /opt/kiro-go/data:/app/data \
  --restart unless-stopped \
  ghcr.io/quorinex/kiro-go:latest
```

参数说明：

- `-p 8080:8080`：将管理后台和 API 服务暴露到本机 `8080` 端口
- `ADMIN_PASSWORD`：管理后台登录密码，建议改成复杂密码
- `/opt/kiro-go/data:/app/data`：持久化配置文件和账号数据
- `--restart unless-stopped`：服务异常退出或机器重启后自动拉起

如果你想映射到其他端口，比如宿主机 `8912`，可以这样写：

```bash
-p 8912:8080
```

此时管理后台地址就是：

```text
http://localhost:8912/admin
```

## 访问管理后台

如果使用上面的默认端口映射，启动成功后访问：

```text
http://localhost:8080/admin
```

使用 `ADMIN_PASSWORD` 配置的密码登录后台。

![控制台](https://pub-7843c36ae8c74acbb64998494a352f61.r2.dev/picgo/20260522174737095.png)

进入后台后，先添加 Kiro 账号。账号配置完成后，可以在后台生成 API Key，后面配置到 CC Switch 或其他工具时会用到。

## 在 CC Switch 中配置

打开 CC Switch，新建一个 API 配置。

如果按默认端口启动，基础地址可以填：

```text
http://localhost:8080
```

如果你映射的是 `8912` 端口，则填写：

```text
http://localhost:8912
```

API Key 填写刚刚在 Kiro-Go 后台生成的 Key。

![配置](https://pub-7843c36ae8c74acbb64998494a352f61.r2.dev/picgo/20260522175051450.png)

配置完成后，点击获取模型列表。只要模型列表能正常拉取，说明 Kiro-Go、账号池和 CC Switch 的连接基本没问题。

接下来就可以把这个配置切换到 Claude Code、Codex 或其他兼容 OpenAI / Anthropic 接口的工具里使用。

## 常见问题

### 1. 管理后台打不开

先确认容器是否正常运行：

```bash
docker ps | grep kiro-go
```

再查看日志：

```bash
docker logs -f kiro-go
```

如果你修改过端口映射，要注意访问的是宿主机端口。例如 `-p 8912:8080` 对应的是 `http://localhost:8912/admin`，不是 `http://localhost:8080/admin`。

### 2. 模型列表获取失败

优先检查这几项：

- Kiro-Go 后台账号是否添加成功
- API Key 是否复制完整
- CC Switch 里的基础地址是否填写到端口，不要多写 `/admin`
- 网络环境是否需要在 Kiro-Go 后台配置出站代理

### 3. 不建议直接裸奔到公网

如果要部署到服务器并开放给外部使用，至少要做好这些事情：

- 修改默认后台密码
- 不要泄露 API Key
- 使用 Nginx / Caddy 配置 HTTPS
- 给管理后台加访问限制
- 定期备份 `/app/data` 目录



