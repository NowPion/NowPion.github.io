---
title: 宿舍网络自由：Dell Wyse 3040 软路由实战 GiWiFi 校园网逆向与自动保活
date: 2026-10-13 16:35:00
tags: [软路由, iStoreOS, 校园网, 逆向工程, GiWiFi, OpenWrt, 爬虫, 网络安全]
categories: [技术分享, 软路由折腾]
description: 记录使用百元单网口小主机 Dell Wyse 3040 刷入 iStoreOS UEFI 固件，逆向分析高校 GiWiFi (gportal) 校园网 AES-128-CBC 认证协议，并实现全宿舍多设备防检测共享与断网秒级自动重连的完整实战。
---

# 宿舍网络自由：Dell Wyse 3040 软路由实战 GiWiFi 校园网逆向与自动保活

学校的校园网太几把贵了，一个月49块，这次国庆返校把家里吃灰的路由器拿学校看能不能连上校园网，试了试连倒是能连上但是老断，上游应该是有多设备检测，想着手里还有个吃灰的小主机就折腾了一下

---

## 一、 硬件选型与网络拓扑

### 1. 硬件：Dell Wyse 3040 与 TP路由器

<div align="center">
  <img src="https://pub-7843c36ae8c74acbb64998494a352f61.r2.dev/picgo/20261013170634824.jpg" width="35%" />
  <img src="https://pub-7843c36ae8c74acbb64998494a352f61.r2.dev/picgo/20261013170628937.jpg" width="45%" />
</div>



这次选用的软路由载体是矿渣/办公淘汰界的经典神机 —— **Dell Wyse 3040 瘦客户机**：

* **CPU**：Intel Atom x5-Z8350（4 核心 4 线程，x86_64 纯正架构）
* **内存**：2GB DDR3L
* **内置闪存**：板载 8GB eMMC
* **网络接口**：**单口千兆 RJ45**（Realtek RTL8111/8168）
* **扩展接口**：1x USB 3.0、3x USB 2.0、2x DisplayPort
* **功耗与发热**：整机日常待机仅 **3W~5W**，纯被动散热无风扇，7x24 小时开机几乎不耗电且零噪音。

相比普通几十块钱的 MT7621 路由器（内存通常只有 64M/128M，跑不动复杂解释器），Wyse 3040 拥有完整的 x86_64 架构和 2GB 大内存，系统空闲内存高达 1.6GB，能够轻松跑原生 Python 3、OpenSSL、Docker、AdGuardHome 去广告和各类科学分流工具。

---

### 2. 组网架构设计：单网口旁路由 + 旁路网关全局接管
由于 Wyse 3040 只有**单千兆网口**，无需花冤枉钱买外接 USB 网卡，最稳定成熟的玩法是：
**普通无线路由器做接入网关与 Wi-Fi AP + Wyse 3040 做旁路网关**。

#### 物理接线与双向网络拓扑

##### 1. 硬件线路图 

<img src="https://pub-7843c36ae8c74acbb64998494a352f61.r2.dev/picgo/20261013170622466.png" width="80%" />


##### 2. 逻辑双向流量走向图 

<img src="https://pub-7843c36ae8c74acbb64998494a352f61.r2.dev/picgo/20261014114330811.png" width="80%" />

##### 3. 为什么这个拓扑最稳定？（双轨分离机制）
* **控制面（认证保活）**：Wyse 3040 独立在后台与 `172.31.0.50` 对话，负责把路由器的 WAN 口 IP 变成“已认证白名单”；
* **数据面（全屋转发）**：路由器负责 Wi-Fi 空口吞吐，Wyse 3040 负责在局域网内部做 TTL 篡改和 NAT 折叠，两台设备各司其职，吞吐量不打折。

#### 核心网络参数规划
* **普通无线路由器**：
  * LAN IP：`192.168.1.1`
  * DHCP 服务：开启，但在 DHCP 高级设置中，将 **默认网关** 改为 `192.168.1.254`，**主 DNS** 改为 `192.168.1.254`。
* **Wyse 3040 (iStoreOS)**：
  * 静态 IP：`192.168.1.254`（掩码 `255.255.255.0`，网关 `192.168.1.1`，DNS `223.5.5.5`）；
  * DHCP 服务：**关闭**（勾选忽略此接口，防止双 DHCP 打架）；
  * **开启 NAT 伪装（masquerade）**：这是旁路由成功的灵魂，能防止同网段不对称路由丢包。

---

## 三、 逆向：深入 GiWiFi (gportal) 认证协议

以现场抓包的山东工程职业技术大学（网关代号 `jn_sdgc`）GiWiFi 系统为例，其 Portal 网关位于内网 `http://172.31.0.50`。

### 1. 抓包网络流与重定向分析
当未认证设备尝试访问外网（如 `http://www.baidu.com`）时，网关的接入控制器（AC）会拦截请求并返回 302 重定向：

```text
http://172.31.0.50/gportal/web/login?wlanuserip=172.20.59.194&wlanacname=jn_sdgc
```
* **`wlanuserip` (如 `172.20.59.194`)**：校园网 DHCP 分配给接入设备的内网 IP，也是认证成功后防火墙决定放行的对象；
* **`wlanacname` (`jn_sdgc`)**：区域接入控制器代号。

在网页上点击登录时，浏览器向鉴权接口发出 POST 请求：
* **接口**：`http://172.31.0.50/gportal/Web/loginAction`
* **载荷结构**：
  ```text
  data=<超长Base64密文>&iv=519607541ee5a1df
  ```

---

### 2. 前端 JS 逆向：定位加密算法
审查 Portal 页面的 JavaScript 源码，在内联脚本中直接发现了核心加密函数 `cryptoEncode`：

```javascript
/**
 * 逆向捕获自 http://172.31.0.50 登录页面的原生前端加密函数
 * @param {string} data - 表单序列化后的明文字符串
 * @param {string} iv - 前端随机生成的 16 字符 Hex 偏移量
 * @returns {Object} 包含 Base64 密文与明文 iv 的对象
 */
function cryptoEncode(data, iv){
    // 1. 密钥硬编码：16 字节明文字符串，对应 AES-128 位密钥
    var key = CryptoJS.enc.Utf8.parse("1234567887654321");
    
    // 2. 将 16 字符的随机 IV 解析为 UTF-8 字节向量
    var ivv = CryptoJS.enc.Utf8.parse(iv);
    
    // 3. 执行 AES 加密：模式为 CBC，填充方式为 ZeroPadding (非标准零填充)
    var encrypted = CryptoJS.AES.encrypt(data, key, { 
        iv: ivv, 
        mode: CryptoJS.mode.CBC, 
        padding: CryptoJS.pad.ZeroPadding 
    });
    
    // 4. 将加密结果转为 Base64 编码字符串
    data = encrypted.toString();
    
    // 5. 组装发往 /loginAction 的请求体参数
    var msg = {'data': data, 'iv': iv};
    return msg;
}
```

整个加密算法直接明牌暴露：
1. **算法**：**AES-128-CBC**；
2. **密钥 (Key)**：前端硬编码常量字符串 **`"1234567887654321"`**；
3. **偏移量 (IV)**：前端动态生成的 16 字符 Hex 字符串（如 `519607541ee5a1df`）；
4. **填充方式**：**ZeroPadding（零填充）**，即若明文长度不是 16 的倍数，在尾部全部填充 `\x00` 直到对齐。

---

### 3. 解密还原与表单明文审计
使用 Python 对抓包截获的 `data` 密文进行反解：

```python
import base64
import urllib.parse
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

# 1. 配置逆向获取的硬编码密钥与抓包获得的 IV
key = b"1234567887654321"     # 16 字节 AES-128 密钥
iv = b"519607541ee5a1df"      # 16 字节初始化向量

# 2. 对抓包提取的 data 密文先做 URL 解码，再做 Base64 解码得到二进制密文
ciphertext = base64.b64decode(urllib.parse.unquote(raw_data))

# 3. 初始化 AES-128-CBC 解密器
cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
decryptor = cipher.decryptor()

# 4. 执行解密并剔除 ZeroPadding 尾部填充的 \x00 空字节
decrypted_bytes = decryptor.update(ciphertext) + decryptor.finalize()
plaintext = decrypted_bytes.rstrip(b"\x00")

# 5. 打印还原出来的原始表单明文
print(plaintext.decode("utf-8"))
```

成功完整解密出原始表单结构：
```text
sign=fPIcWzT7YZKGgfd7VQtNjz8Dv...&sta_vlan=&sta_port=&sta_ip=172.20.59.194&nas_ip=&nas_name=jn_sdgc&last_url=&request_ip=172.20.59.194&device_mode=Windows%20NT%2010.0&device_type=1&device_os_type=3&is_mobile=0&iv=519607541ee5a1df&login_type=1&account_type=2&user_account=15318160417&user_password=xxxxxx
```

至此，整个协议链条完全理清：
* 网页返回的 `sign` 是单次会话防重放签名；
* 设备指纹被伪装成 `Windows NT 10.0` PC 端；
* 只需要动态获取 `sign`，填入账号密码，做一次 AES-128-CBC ZeroPadding 加密，再 POST 到 `/gportal/Web/loginAction` 即可实现脱机免浏览器鉴权！

---

## 四、 软路由端全自动认证与看门狗落地

Wyse 3040 搭载的 iStoreOS 采用了最新的 Alpine `apk` 包管理体系。在 Wyse 3040 终端中执行以下命令装载环境：

```bash
apk update
apk add python3
```

我们编写了一个轻量级、零第三方 Python 库依赖（纯调用系统级 OpenSSL 实现加解密）的自动化认证看门狗守护脚本，保存在 `/root/gwifi_login.py`。每个函数与参数均附带详尽注释：

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
项目名称: Dell Wyse 3040 iStoreOS - GiWiFi 校园网自动认证保活守护进程
适用学校: 山东工程职业技术大学 (jn_sdgc) 及采用通用 GiWiFi gportal 网关的高校
功能特性:
  1. 纯标准库 + 系统级 OpenSSL 实现，零第三方 pip 依赖，极省资源
  2. 自动嗅探网关 302 重定向，自适应获取最新的 sta_ip (内网IP) 与 sign (防重放Token)
  3. 100% 还原前端 JS 的 AES-128-CBC + ZeroPadding 算法
  4. 支持单次认证与后台常驻看门狗模式 (每30秒心跳探测，掉线自愈)
================================================================================
"""

import os
import sys
import time
import re
import secrets
import subprocess
import urllib.request
import urllib.parse
import http.cookiejar
import json

# ============================ 核心常量配置 ============================
# GiWiFi Portal 网关内网服务器地址
PORTAL_HOST = "http://172.31.0.50"

# 从前端 JavaScript (aes.js) 逆向出来的 AES-128 对称加密密钥 (固化常量)
AES_KEY = "1234567887654321"

# ============================ 功能函数定义 ============================

def check_internet(test_host="223.5.5.5"):
    """
    通过底层 ICMP ping 探测外网连通性
    :param test_host: 探测节点 (默认阿里公共 DNS 223.5.5.5)
    :return: True 表示外网畅通，False 表示已掉线或处于认证拦截期
    """
    # -c 2: 发送2个包; -W 2: 超时时间2秒; 标准输出重定向到空设备
    ret = subprocess.run(
        ["ping", "-c", "2", "-W", "2", test_host],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    return ret.returncode == 0


def get_redirect_or_login_url():
    """
    自动嗅探校园网的登录跳转地址与动态参数。
    当未认证时，访问任意外部 HTTP 页面会被校园网 AC 拦截并 302 重定向到：
    http://172.31.0.50/gportal/web/login?wlanuserip=xxx&wlanacname=jn_sdgc
    """
    try:
        # 发起探测请求触发网关 302 拦截
        req = urllib.request.Request(
            "http://www.google.cn/generate_204",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"}
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            # 如果发生了重定向且跳转到了 gportal，直接返回该完整 URL
            if resp.geturl() and "gportal" in resp.geturl():
                return resp.geturl()
    except Exception:
        pass
    
    # 若未被 302 拦截或外网直接无法建立连接，兜底使用标准登录入口
    return f"{PORTAL_HOST}/gportal/web/login"


def encrypt_data(plaintext_str, iv_str):
    """
    实现与前端完全一致的 AES-128-CBC + ZeroPadding (零填充) 加密
    :param plaintext_str: 待加密的明文字符串 (URL编码后的表单)
    :param iv_str: 16位 ASCII 字符的随机初始化向量 (IV)
    :return: Base64 编码的密文字符串
    """
    raw = plaintext_str.encode("utf-8")
    
    # ---------------- 步骤 1: ZeroPadding (零填充) ----------------
    # AES 是 128 位分组密码，数据块必须对齐 16 字节
    # ZeroPadding 规则: 若长度不是 16 的倍数，在末尾全部追加 \x00
    pad_len = 16 - (len(raw) % 16)
    if pad_len != 16:
        raw += b"\x00" * pad_len
        
    # ---------------- 步骤 2: 转换 Key 与 IV 为十六进制字符串 ----------------
    key_hex = AES_KEY.encode("utf-8").hex()   # "1234567887654321" -> 31323334353637383837363534333231
    iv_hex = iv_str.encode("utf-8").hex()     # 16位字符转32位hex

    # ---------------- 步骤 3: 调用系统底层 OpenSSL 执行高速度无依赖加密 ----------------
    # -aes-128-cbc: 采用 CBC 模式
    # -nopad: 禁用 OpenSSL 默认的 PKCS7 填充 (因为我们上面已手工做了 ZeroPadding)
    # -base64: 输出 Base64
    # -A: 输出单行 Base64 (防止自动追加换行符破坏 HTTP 传输)
    cmd = [
        "openssl", "enc", "-aes-128-cbc",
        "-K", key_hex,
        "-iv", iv_hex,
        "-nopad",
        "-base64", "-A"
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = p.communicate(input=raw)
    return out.decode("ascii").strip()


def do_login(username, password):
    """
    执行完整的单次校园网认证请求闭环
    :param username: 校园网宽带账号 (通常为手机号)
    :param password: 校园网宽带密码
    :return: True 登录成功, False 登录失败
    """
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 正在发起 GiWiFi 校园网认证...")
    
    # 启用 Cookie 容器，用于在第一步 GET 与第二步 POST 间维系 PHPSESSID 会话
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    
    # 获取网关最新登录地址 (自动带上当时的 wlanuserip)
    login_url = get_redirect_or_login_url()
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9"
    }
    
    # ---------------- 步骤 A: 抓取登录页面，提取动态防重放 Token ----------------
    try:
        req = urllib.request.Request(login_url, headers=headers)
        with opener.open(req, timeout=5) as resp:
            html = resp.read().decode("utf-8", "ignore")
    except Exception as e:
        print(f"拉取登录页失败: {e}")
        return False
        
    def get_input_val(name):
        """正则匹配提取 HTML 表单中的隐藏 input 字段值"""
        m = re.search(r'name=["']' + name + r'["']\s+value=["']([^"']*)["']', html)
        return m.group(1) if m else ""
        
    # 从 HTML 中解析出的关键隐藏参数
    sign = get_input_val("sign")                 # 服务器下发的单次动态签名 Token
    sta_ip = get_input_val("sta_ip")             # 客户端当前校园网内网 IP (例如 172.20.59.194)
    nas_name = get_input_val("nas_name") or "jn_sdgc"  # 接入控制器标识
    request_ip = get_input_val("request_ip") or sta_ip
    
    if not sign:
        print("未检测到有效 sign，可能已处于登录放行状态或网关异常")
        return False
        
    # ---------------- 步骤 B: 生成随机 IV 与构建明文表单 ----------------
    # 随机生成 8 个字节的十六进制字符串 (16 个 ASCII 字符，作为 AES IV)
    iv = secrets.token_hex(8)
    
    # 严格按照网页端 loginForm 的字段顺序与参数组装
    form_params = [
        ("sign", sign),                      # 动态防重放签名
        ("sta_vlan", ""),                    # VLAN 标识 (默认空)
        ("sta_port", ""),                    # 端口标识 (默认空)
        ("sta_ip", sta_ip),                  # 待放行的客户端内网 IP
        ("nas_ip", ""),                      # NAS IP (默认空)
        ("nas_name", nas_name),              # 控制器名称: jn_sdgc
        ("last_url", ""),                    # 跳转来源 (默认空)
        ("request_ip", request_ip),          # 请求来源 IP
        ("device_mode", "Windows NT 10.0"),  # 设备型号: 伪装为 Win10 单机
        ("device_type", "1"),                # 设备类型: 1 (PC端)
        ("device_os_type", "3"),             # 系统类别: 3 (Windows)
        ("is_mobile", "0"),                  # 是否手机: 0 (否)
        ("iv", iv),                          # 当前加密使用的随机 IV
        ("login_type", "1"),                 # 登录方式: 1 (账号密码)
        ("account_type", "2"),               # 账号类型: 2 (学生/正式用户)
        ("user_account", username),          # 你的宽带手机号/学号
        ("user_password", password)          # 你的宽带登录密码
    ]
    
    # 序列化为类似 sign=xxx&sta_ip=xxx 的标准 URL 编码字符串
    serialized = urllib.parse.urlencode(form_params)
    
    # ---------------- 步骤 C: 执行 AES 加密 ----------------
    encrypted_data = encrypt_data(serialized, iv)
    
    # ---------------- 步骤 D: 发送 POST 请求到网关鉴权接口 ----------------
    post_body = urllib.parse.urlencode({
        "data": encrypted_data,  # Base64 密文
        "iv": iv                 # 明文传输 IV (供后端对称解密使用)
    }).encode("utf-8")
    
    post_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": PORTAL_HOST,
        "Referer": login_url
    }
    
    try:
        post_req = urllib.request.Request(
            f"{PORTAL_HOST}/gportal/Web/loginAction",
            data=post_body,
            headers=post_headers
        )
        with opener.open(post_req, timeout=5) as resp:
            res = json.loads(resp.read().decode("utf-8", "ignore"))
            # 网关返回 status 为 1 表示认证成功，放通外网
            if res.get("status") in (1, "1"):
                print("【登录成功】校园网已成功放通外网！")
                return True
            else:
                print(f"【登录失败】网关提示: {res.get('info', '未知错误')}")
                return False
    except Exception as e:
        print(f"POST 请求发送异常: {e}")
        return False


def daemon_loop(username, password, interval=30):
    """
    后台常驻看门狗守护循环: 定期探测网络，掉线自动执行静默重登
    :param username: 校园网账号
    :param password: 校园网密码
    :param interval: 心跳检测间隔 (默认 30 秒)
    """
    print(f"GiWiFi 看门狗守护已就绪！检测周期: {interval}s，保活账号: {username}")
    while True:
        # 检测外网连通性
        if not check_internet():
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 探测到外网中断，执行自愈认证...")
            do_login(username, password)
        # 休眠等待下一轮探测
        time.sleep(interval)


# ============================ 脚本入口执行 ============================
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("=" * 60)
        print("用法:")
        print("  1. 单次手动登录: python3 gwifi_login.py <账号> <密码>")
        print("  2. 后台守护运行: python3 gwifi_login.py <账号> <密码> --daemon")
        print("=" * 60)
        sys.exit(1)
        
    user, pwd = sys.argv[1], sys.argv[2]
    
    # 守护模式
    if len(sys.argv) >= 4 and sys.argv[3] == "--daemon":
        daemon_loop(user, pwd)
    # 单次执行模式
    else:
        sys.exit(0 if do_login(user, pwd) else 1)
```

### 开机自启配置
编辑 Wyse 3040 的 `/etc/rc.local`，在 `exit 0` 前加入以下指令：
```bash
# 校园网自动认证看门狗: 开机静默后台拉起，标准输出重定向到空设备
nohup python3 /root/gwifi_login.py 你的账号 你的密码 --daemon > /dev/null 2>&1 &
```
现在，即便宿舍半夜断电、断网重拨，开机后 Wyse 3040 都会在后台默默拉起看门狗，30 秒内秒级自愈。

---

## 五、 宿舍防封与多设备对抗机制

宿舍挂路由器最怕被运营商多设备检测抓现行。针对校园网常见的特征探测，我们在软路由上构建了**四重防御体系**：

### 1. 认证层：单点代登
在登录报文里，Wyse 3040 永远将自身伪装为单一的 `Windows NT 10.0` 桌面终端。网关数据库里记录的永远只有 1 台电脑在线，其他手机和平板根本不产生鉴权请求。

### 2. 路由层：TTL 跳数绝对锁定
普通路由器 NAT 转发时会将 IP 包的 TTL 减 1（64 变成 63，128 变成 127），运营商网关一旦抓到 63/127 会立刻断定下挂了路由器。
我们在 Wyse 3040 的防火墙自定义规则中加入：

```bash
# 将所有从本地出网的数据包 TTL 强制写死为 64，抹除 NAT 减 1 痕迹
iptables -t mangle -A POSTROUTING -j TTL --ttl-set 64
```
**无论内网挂了多少台设备，所有出网的数据包 TTL 统一被强行改写为标准的 64**，彻底抹平多跳路由特征。

### 3. 系统层：禁用 TCP Timestamps
不同设备的操作系统时钟频率（晶振斜率）不同，深度包检测系统会通过 TCP 时间戳统计多设备并发。
在 Wyse 3040 执行：
```bash
# 立即临时禁用全局 TCP 时间戳
sysctl -w net.ipv4.tcp_timestamps=0

# 持久化固化到内核配置文件，重启不失效
echo "net.ipv4.tcp_timestamps=0" >> /etc/sysctl.conf
```
直接关闭 TCP 时间戳，彻底切断时钟特征探测。

### 4. 应用层：旁路由 NAT 折叠
全宿舍设备连上普通路由器的 Wi-Fi，数据包全部自动下发到旁路网关 `192.168.1.254`，经过 NAT Masquerade 伪装后由单一出口统一转发出去，合多为一。

---


