---
title: 页面刷新后cookie消失的bug
date: 2025-11-1 15:14:34
tags: [前端, Cookie, CORS]
categories: [技术分享]
---

# 问题发现

今天在用 Cookie 做登录态时遇到一个诡异问题：刷新页面后，Cookie 自动消失；并且再次发起请求也不携带 Cookie。

---

## 复现

```js
export const userApi = {
  // 发送登录验证码
  sendLoginCode(phone) {
    return api.postForm('/userLogin/sendLoginCode', { phone })
  },

  // 手机号+验证码登录
  login(phone, code) {
    return api.postForm('/userLogin/login', { phone, code })
  },
}
//在发送完请求后成功获取了cookie
```



![image-20251101171555217](https://pub-a57df07920d249cb9197910fe28b84a5.r2.dev/PicGo/image-20251101171555217.png) 

```
现象：
- 发送新的请求并不会携带 Cookie
- 页面刷新后 Cookie 就会消失
```



---

## 问题原因

![image-20251101172152297](https://pub-a57df07920d249cb9197910fe28b84a5.r2.dev/PicGo/image-20251101171555217.png)



浏览器为了提高安全性，要求所有设置了 `SameSite=None` 的 cookies 都必须使用 `Secure` 属性，以确保它们仅通过 HTTPS 发送，防止中间人攻击和其他安全漏洞


进一步说明：
- Chrome 等现代浏览器对 `SameSite=None` 的 Cookie，如果没有同时设置 `Secure`，会直接拒绝或在刷新后丢弃。
- 本地开发若使用 `http://localhost`，即使是同源，若你的后端设置了 `SameSite=None`，也必须配合 `Secure` 并通过 HTTPS 传输，否则浏览器不予保留/发送。

---

## 解决方案

服务器端正确设置 Cookie（示例以 Node.js/Express）：

```js
// 服务器: 设置登录态 Cookie
res.cookie('token', token, {
  httpOnly: true,      // 避免 JS 访问，降低 XSS 风险
  secure: true,        // 只在 HTTPS 下发送（SameSite=None 必须搭配）
  sameSite: 'None',    // 跨站请求需要携带 Cookie
  maxAge: 7 * 24 * 3600 * 1000, // 7 天
  path: '/',
})
```

客户端开启携带凭据（以 Axios 为例）：

```js
import axios from 'axios'

axios.defaults.withCredentials = true
// 或者: axios.create({ withCredentials: true })

// 发起请求
axios.post('https://api.example.com/userLogin/login', { phone, code })
```

服务端 CORS 必须允许携带凭据：

```js
// Express CORS
import cors from 'cors'
app.use(cors({
  origin: 'https://web.example.com', // 不能用 *，需明确来源
  credentials: true,                  // 允许凭据（Cookie）
}))

// 或手动设置头
res.setHeader('Access-Control-Allow-Origin', 'https://web.example.com')
res.setHeader('Access-Control-Allow-Credentials', 'true')
```

域与路径设置：
- `domain` 应设置为需要生效的主域或子域，避免跨域不匹配。
- `path` 一般设为 `/`，否则部分路由下不会发送 Cookie。

---

## 本地开发的可选方案

- 使用 HTTPS：通过 Nginx/Caddy 反向代理本地服务并签发本地证书（可用 `mkcert` 信任开发证书）。
- 如果暂时无法 HTTPS，又需要跨站携带 Cookie：
  - 避免使用 `SameSite=None`，改为同站开发（前后端同源），或在需要时使用 Token 方案。
  - 但注意：`SameSite=Lax/Strict` 在跨站请求场景下通常不会携带 Cookie。

---

## 常见坑排查清单

- 是否设置了 `SameSite=None` 却没有 `Secure`。
- 是否启用了 `withCredentials`，同时服务端 `Access-Control-Allow-Credentials: true` 且 `Allow-Origin` 为具体域。
- Cookie 是否为 `HttpOnly`（JS 不可读），但这不会影响请求是否携带。
- 是否设置了 `domain`/`path` 导致作用域不匹配。
- 是否仅为“会话 Cookie”（无 `Expires/Max-Age`）：刷新通常不丢失，但关闭浏览器会失效。
- 是否存在子域/端口不同导致跨站。

---

## 总结

刷新后 Cookie 消失，往往是因为浏览器的新安全策略：`SameSite=None` 必须配合 `Secure` 且通过 HTTPS 传输。配合前端 `withCredentials` 和服务端正确的 CORS 设置，并确保域与路径匹配，即可稳定保留与携带 Cookie。

