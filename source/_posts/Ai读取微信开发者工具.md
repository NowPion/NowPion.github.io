---
title: AI 调试微信开发者工具
date: 2026-05-26 10:14:34
tags: [MCP, 微信开发者工具, uniapp, 小程序, Codex]
categories: [技术分享]
description: 介绍 uniapp-wechat-mcp 开源工具，基于微信开发者工具 CLI 与 miniprogram-automator 封装为 MCP Server，让 AI 工具直接读取、控制与调试微信小程序。
---

微信小程序这个调试链路是真的烦，尤其是 uniapp 项目。

AI 看得到代码，但是看不到微信开发者工具里的页面、data、console、截图和编译结果。你让它改页面，它只能靠猜；你让它排查 bug，它还得让你一遍遍复制日志，整个过程就很笨。

所以这里做了一个 **uniapp-wechat-mcp**，把微信开发者工具的 CLI 和 `miniprogram-automator` SDK 封装成 MCP Server，让 Claude Code、Codex 这类 AI 工具可以直接读取和操作微信开发者工具。

npm 包：

```bash
npx -y uniapp-wechat-mcp
```

项目核心能力：

- 通过微信开发者工具官方 CLI 打开项目、登录、编译、预览、上传、构建 npm、清缓存
- 通过 `miniprogram-automator` 读取当前页面栈和页面 `data`
- 支持页面跳转，自动判断 tabBar 页面并选择 `switchTab` 或 `reLaunch`
- 支持元素点击、输入、读取元素信息、调用页面方法、调用 `wx` API
- 支持截图，默认保存到当前项目的 `screenshots` 目录
- 支持采集 console / exception 日志
- 支持读取小程序配置、页面列表、页面源码和单文件
- 支持把内置 `.agents/skills/wechat-devtools` 暴露给 AI 客户端读取

## 准备微信开发者工具

先确认本机已经安装微信开发者工具。

然后打开微信开发者工具，开启服务端口：

```text
设置 -> 安全设置 -> 服务端口 -> 开启
```

这个必须开，不然外部 CLI 和 automator 都连不上。很多连接失败的问题，最后都是这里没开。

还要找到微信开发者工具的 `cli` 路径，后面 MCP 配置会用到。

macOS 一般是：

```text
/Applications/wechatwebdevtools.app/Contents/MacOS/cli
```

Windows 一般是：

```text
C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat
```

如果你的安装目录不一样，就改成自己的实际路径。

## 在 MCP 客户端中配置

通常不需要全局安装，直接让 MCP 客户端用 `npx` 拉起：

```json
{
  "mcpServers": {
    "uniapp-wechat": {
      "command": "npx",
      "args": ["-y", "uniapp-wechat-mcp"],
      "env": {
        "WECHAT_DEVTOOLS_CLI": "/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
      }
    }
  }
}
```

Windows 示例：

```json
{
  "mcpServers": {
    "uniapp-wechat": {
      "command": "npx",
      "args": ["-y", "uniapp-wechat-mcp"],
      "env": {
        "WECHAT_DEVTOOLS_CLI": "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat"
      }
    }
  }
}
```

这里最关键的是 `WECHAT_DEVTOOLS_CLI`，它必须指向微信开发者工具官方的 `cli` 或 `cli.bat`。

配置完成后，重启一下 AI 客户端，让它重新加载 MCP Server。

## 项目路径怎么识别

工具调用时可以不传 `project_path`，MCP 会从当前 workspace 自动找小程序项目。

如果是 uniapp 项目，它会优先找这些目录：

```text
unpackage/dist/dev/mp-weixin
unpackage/dist/build/mp-weixin
dist/dev/mp-weixin
dist/build/mp-weixin
```

也就是说，你可以把 AI 开在 uniapp 源码根目录，它会自己去找编译后的微信小程序产物。

如果是原生微信小程序项目，那目录里至少要有：

```text
project.config.json
app.json
```

如果诊断里 AppID 是空的，优先怀疑是目录传错了。要么没指到 `mp-weixin`，要么还没生成小程序产物。

## 推荐调用流程

第一次连接或者新会话，先让 AI 检查环境：

```text
wechat_ide(action="status")
wechat_ide(action="is_login")
wechat_ide(action="open")
wechat_automator(action="start")
wechat_file(action="project_info")
wechat_automator(action="page_data")
```

只要 `page_data` 能读出来，说明 AI 已经能看到当前小程序页面了。

代码修改后，一般这样走：

```text
wechat_build(action="compile")
wechat_automator(action="page_data")
wechat_inspector(action="console", duration=3, detail_level="full")
```

页面调试时：

```text
wechat_file(action="list_pages")
wechat_navigate(page_path="pages/index/index", wait_ms=1000)
wechat_automator(action="page_data")
wechat_screenshot()
```

元素操作时：

```text
wechat_automator(action="element_info", selector=".target")
wechat_automator(action="tap", selector=".target")
wechat_automator(action="input", selector="input", value="hello")
```

这里的体验会比纯截图靠谱很多。截图只能看到长什么样，`page_data` 和源码能告诉 AI 当前到底在哪个页面、有什么字段、字段是不是空的、按钮真实 selector 是什么。

## 工具列表

主要暴露了这些 MCP 工具：

| Tool | 用途 |
| --- | --- |
| `wechat_ide` | 打开、登录、检查登录态、关闭或退出微信开发者工具 |
| `wechat_build` | 编译、预览、上传、构建 npm、清缓存 |
| `wechat_automator` | 启动自动化连接、点击、输入、读取页面 data、调用页面方法、调用 wx API、mock、evaluate、storage、scroll、reload |
| `wechat_inspector` | 采集 console / exception 日志 |
| `wechat_screenshot` | 截图并保存到本地 |
| `wechat_navigate` | 页面跳转，自动处理 tabBar，并返回页面栈、页面 data 和运行时日志 |
| `wechat_file` | 读取项目配置、页面列表、页面源码、单文件 |
| `agents` | 读取 npm 包内置的 `.agents` skill |

所有工具返回统一 JSON 结构，成功大概是：

```json
{
  "success": true,
  "data": {},
  "message": "操作描述"
}
```

失败时会返回：

```json
{
  "success": false,
  "error_code": "ERROR_CODE",
  "message": "失败原因",
  "hint": "可选修复建议"
}
```

这个统一返回很重要，AI 不需要从一堆乱七八糟的 CLI 输出里猜结果。

## 让 AI 读取内置 Skill

包里带了一份推荐工作流：

```text
.agents/skills/wechat-devtools/SKILL.md
```

支持 MCP resources 的客户端可以直接读：

```text
skill://wechat-devtools
```

如果客户端不会主动读取 resource，也可以用工具兜底：

```text
agents(action="read", name="wechat-devtools")
```

也可以查看列表和路径：

```text
agents(action="list")
agents(action="path")
```

这个 skill 的作用是告诉 AI：什么时候该 `open`，什么时候该 `compile`，什么时候只需要 `page_data`，什么时候不要乱调用 `upload` / `quit`。

## 常见问题

### 1. automator 连接失败

优先检查这几项：

- 微信开发者工具服务端口是否已开启
- 是否已经通过 `wechat_ide(action="open")` 打开项目
- 项目 AppID 是否有效
- `WECHAT_DEVTOOLS_CLI` 是否指向正确的 `cli` 路径

然后重试：

```text
wechat_automator(action="start")
```

### 2. 找不到项目

如果是 uniapp 项目，先确认已经生成微信小程序产物：

```text
unpackage/dist/dev/mp-weixin
```

如果没有这个目录，先在 HBuilderX 或构建命令里生成一下微信小程序。

如果你不想让它自动猜，也可以在工具调用里手动传 `project_path`。

### 3. AppID 为空

大概率是解析到的目录不是真正的小程序目录。

确认目标目录里有：

```text
project.config.json
app.json
```

并且 `project.config.json` 里有有效 AppID。

### 4. 元素点不到

不要先硬点，先让 AI 读页面和源码：

```text
wechat_automator(action="page_data")
wechat_file(action="read_page", page_path="pages/login/index")
wechat_automator(action="element_info", selector=".target")
```

确认当前页面路径、页面 data 和真实 class 之后，再调用 `tap`。

### 5. 编译显示成功但页面还是不对

微信开发者工具有时会出现 CLI 返回成功，但日志里其实有 fatal 错误的情况。

这个 MCP 里对常见 fatal compile 日志做了检测，如果命中会返回 `COMPILE_FAKE_SUCCESS`，这时候不要继续调页面，先看编译日志。

可以配合：

```text
wechat_build(action="compile")
wechat_inspector(action="console", duration=3, detail_level="full")
```

### 6. 不要随便 upload / quit

`wechat_build(action="upload")` 是发布上传操作，除非你明确要发版本，并且已经准备好 `version` 和 `desc`，否则不要让 AI 调。

`wechat_ide(action="quit")` 会直接影响你本地打开的开发者工具，一般调试过程中也没必要主动调用。

## 开发与测试

如果你要本地开发这个 MCP Server：

```bash
cd weixinNode
npm test
```

检查 npm 发布包内容：

```bash
npm pack --dry-run --json
```

