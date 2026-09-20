---
title: Spring Boot 实现扫码登录
date: 2026-3-30 14:08:55
tags: [Spring Boot, Redis, Zxing]
categories: [技术分享]
description: 基于 Spring Boot 3 与 Redis 实现安全的二维码扫码登录方案，包含二维码生成、轮询/状态管理、移动端确认授权与登录态同步全流程。
---

# Spring Boot 实现扫码登录

扫码登录是现代应用中常见的身份验证方式，本文将详细介绍基于 Spring Boot 3 的完整实现方案，包括二维码生成、状态管理、确认流程等核心环节。

---

## 一、Maven 依赖

### 1.1 核心依赖引入（pom.xml）

在项目的 `pom.xml` 文件中添加依赖：

```xml
<!-- SpringWeb 核心依赖 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>

<!-- Redis 依赖（存储扫码状态） -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>

<!-- 二维码生成依赖 -->
<dependency>
    <groupId>com.google.zxing</groupId>
    <artifactId>core</artifactId>
    <version>3.5.3</version>
</dependency>
<dependency>
    <groupId>com.google.zxing</groupId>
    <artifactId>javase</artifactId>
    <version>3.5.3</version>
</dependency>
```

---

## 二、配置文件

在 `application.yml` 或 `application.properties` 中配置Redis连接和二维码基础参数。

### 2.1 YAML 格式配置

```yaml
spring:
  servlet:
    multipart:
      max-file-size: 100MB
      max-request-size: 100MB
  data:
    redis:
      host: localhost # 本地Redis，生产环境替换为实际地址
      port: 6379
      database: 0
      timeout: 5000
      password:  # 无密码留空，生产环境需配置密码

# 自定义扫码登录配置
scan:
  login:
    qrcode:
      width: 200 # 二维码宽度
      height: 200 # 二维码高度
      expire-time: 300 # 二维码有效期（秒），默认5分钟
    redis:
      key-prefix: 'scan_login:' # Redis key前缀，避免key冲突
      state-key: 'scan_state:' # 扫码状态key前缀
```

---

## 三、核心功能实现

### 3.1 枚举类（扫码状态）

定义扫码的4种状态，避免魔法值，后续判断状态更直观

```java
import lombok.AllArgsConstructor;
import lombok.Getter;

/**
 * 扫码登录状态枚举
 * 实际项目中可根据需求增减状态
 */
@Getter
@AllArgsConstructor
public enum ScanLoginStatus {
    NOT_SCAN(0, "未扫码"),
    SCANNED(1, "已扫码，待确认"),
    CONFIRMED(2, "已确认登录"),
    EXPIRED(3, "二维码已过期");

    private final Integer code;
    private final String desc;

    // 根据code获取枚举，方便后续接口返回
    public static ScanLoginStatus getByCode(Integer code) {
        for (ScanLoginStatus status : values()) {
            if (status.getCode().equals(code)) {
                return status;
            }
        }
        return NOT_SCAN;
    }
}
```

### 3.2 二维码工具类

封装二维码生成逻辑，返回Base64字符串，方便前端直接渲染

```java
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * 二维码生成工具类
 * 无需修改，直接复用
 */
@Component
public class QrCodeUtil {

    @Value("${scan.login.qrcode.width}")
    private Integer qrcodeWidth;

    @Value("${scan.login.qrcode.height}")
    private Integer qrcodeHeight;

    /**
     * 生成二维码Base64字符串
     * @param content 二维码内容（这里存临时凭证uuid）
     * @return Base64字符串
     */
    public String generateQrCodeBase64(String content) {
        if (StringUtils.isBlank(content)) {
            throw new IllegalArgumentException("二维码内容不能为空");
        }

        // 二维码配置参数
        Map<EncodeHintType, Object> hints = new HashMap<>();
        hints.put(EncodeHintType.CHARACTER_SET, "UTF-8"); // 支持中文
        hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.H); // 30%容错率，适合户外/污损场景
        hints.put(EncodeHintType.MARGIN, 1); // 二维码边框空白宽度

        try {
            // 生成二维码矩阵
            MultiFormatWriter writer = new MultiFormatWriter();
            BitMatrix bitMatrix = writer.encode(content, BarcodeFormat.QR_CODE, qrcodeWidth, qrcodeHeight, hints);

            // 转换为BufferedImage
            BufferedImage image = new BufferedImage(qrcodeWidth, qrcodeHeight, BufferedImage.TYPE_INT_RGB);
            for (int x = 0; x < qrcodeWidth; x++) {
                for (int y = 0; y < qrcodeHeight; y++) {
                    // 黑色二维码，白色背景
                    image.setRGB(x, y, bitMatrix.get(x, y) ? Color.BLACK.getRGB() : Color.WHITE.getRGB());
                }
            }

            // 转换为Base64
            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            ImageIO.write(image, "png", outputStream);
            byte[] imageBytes = outputStream.toByteArray();
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(imageBytes);

        } catch (Exception e) {
            throw new RuntimeException("二维码生成失败", e);
        }
    }
}
```

### 3.3 核心接口实现（Controller）

```java
import cn.iocoder.boot.entity.ResultVo;
import cn.iocoder.boot.entity.ScanLoginStatus;
import cn.iocoder.boot.utils.QrCodeUtil;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 扫码登录核心接口
 * 接口路径可根据项目规范调整
 */
@RestController
@RequestMapping("/api/scan/login")
@Slf4j
public class ScanLoginController {

    @Resource
    private QrCodeUtil qrCodeUtil;

    @Resource
    private StringRedisTemplate stringRedisTemplate;

    @Value("${scan.login.qrcode.expire-time}")
    private Integer expireTime;

    @Value("${scan.login.redis.key-prefix}")
    private String redisKeyPrefix;

    @Value("${scan.login.redis.state-key}")
    private String stateKeyPrefix;

    /**
     * 1. 生成登录二维码（前端调用，获取二维码和临时凭证）
     * @return 二维码Base64 + 临时凭证uuid
     */
    @GetMapping("/qrcode")
    public ResultVo generateLoginQrCode() {
        // 生成唯一临时凭证（uuid），用于关联二维码和扫码状态
        String uuid = UUID.randomUUID().toString().replace("-", "");
        // 二维码内容：临时凭证（实际项目可拼接域名，方便手机端解析）
        String qrCodeContent = uuid;
        // 生成二维码Base64
        String qrCodeBase64 = qrCodeUtil.generateQrCodeBase64(qrCodeContent);

        // 存储二维码状态到Redis，初始状态：未扫码，设置过期时间
        String redisKey = redisKeyPrefix + uuid;
        stringRedisTemplate.opsForValue().set(redisKey, ScanLoginStatus.NOT_SCAN.getCode().toString(), expireTime, TimeUnit.SECONDS);

        // 返回结果（ResultVo是项目通用返回类，可替换为自己的返回格式）
        return ResultVo.success()
                .put("qrCodeBase64", qrCodeBase64)
                .put("uuid", uuid);
    }

    /**
     * 2. 查询扫码状态（前端轮询调用，间隔1-2秒）
     * @param uuid 临时凭证
     * @return 扫码状态 + 登录token（确认登录后返回）
     */
    @GetMapping("/state")
    public ResultVo queryScanState(@RequestParam String uuid) {
        if (StringUtils.isBlank(uuid)) {
            return ResultVo.error("临时凭证不能为空");
        }

        String redisKey = redisKeyPrefix + uuid;
        String statusCode = stringRedisTemplate.opsForValue().get(redisKey);

        // 二维码已过期（Redis中无数据）
        if (StringUtils.isBlank(statusCode)) {
            return ResultVo.success()
                    .put("status", ScanLoginStatus.EXPIRED.getCode())
                    .put("desc", ScanLoginStatus.EXPIRED.getDesc());
        }

        ScanLoginStatus status = ScanLoginStatus.getByCode(Integer.parseInt(statusCode));
        // 已确认登录，生成登录token（实际项目用JWT或Session，这里简化）
        if (status == ScanLoginStatus.CONFIRMED) {
            String loginToken = generateLoginToken(uuid);
            // 登录成功后，删除Redis中的临时状态（避免重复登录）
            stringRedisTemplate.delete(redisKey);
            return ResultVo.success()
                    .put("status", status.getCode())
                    .put("desc", status.getDesc())
                    .put("token", loginToken);
        }

        // 未扫码/已扫码待确认，返回当前状态
        return ResultVo.success()
                .put("status", status.getCode())
                .put("desc", status.getDesc());
    }

    /**
     * 3. 扫码确认登录（手机端调用，扫码后点击确认触发）
     * @param uuid 临时凭证（手机端解析二维码获取）
     * @param userId 手机端登录用户ID（实际项目从token中获取）
     * @return 确认结果
     */
    @PostMapping("/confirm")
    public ResultVo confirmLogin(@RequestParam String uuid, @RequestParam Long userId) {
        if (StringUtils.isBlank(uuid) || userId == null) {
            return ResultVo.error("参数不完整");
        }

        String redisKey = redisKeyPrefix + uuid;
        String statusCode = stringRedisTemplate.opsForValue().get(redisKey);

        // 二维码已过期或不存在
        if (StringUtils.isBlank(statusCode)) {
            return ResultVo.error("二维码已过期，请重新生成");
        }

        ScanLoginStatus status = ScanLoginStatus.getByCode(Integer.parseInt(statusCode));
        // 只有未扫码/已扫码待确认状态，才能确认登录
        if (status == ScanLoginStatus.NOT_SCAN || status == ScanLoginStatus.SCANNED) {
            // 更新状态为已确认登录，无需延长过期时间（确认后立即删除）
            stringRedisTemplate.opsForValue().set(redisKey, ScanLoginStatus.CONFIRMED.getCode().toString());
            log.info("用户{}扫码确认登录，临时凭证：{}", userId, uuid);
            return ResultVo.success("确认登录成功");
        }

        return ResultVo.error("当前状态无法确认登录");
    }

    /**
     * 生成登录token（简化版，实际项目用JWT，配置密钥和过期时间）
     * @param uuid 临时凭证
     * @return 登录token
     */
    private String generateLoginToken(String uuid) {
        // 实际项目中替换为JWT生成逻辑，这里仅做演示
        return "scan_login_" + uuid + "_" + System.currentTimeMillis();
    }
}
```

### 3.4 通用返回类（ResultVo）

```java
import lombok.Data;
import java.util.HashMap;
import java.util.Map;

/**
 * 通用返回类
 */
@Data
public class ResultVo {
    private Integer code; // 0：成功，1：失败
    private String msg;
    private Map<String, Object> data = new HashMap<>();

    // 成功返回
    public static ResultVo success() {
        return success("操作成功");
    }

    // 成功返回
    public static ResultVo success(String msg) {
        ResultVo resultVo = new ResultVo();
        resultVo.setCode(0);
        resultVo.setMsg(msg);
        return resultVo;
    }

    // 失败返回
    public static ResultVo error(String msg) {
        ResultVo resultVo = new ResultVo();
        resultVo.setCode(1);
        resultVo.setMsg(msg);
        return resultVo;
    }

    // 往返回数据中添加参数
    public ResultVo put(String key, Object value) {
        this.data.put(key, value);
        return this;
    }
}
```

---

## 四、前端配合实现

### 4.1 PC 端实现流程

1. **二维码渲染**：页面初始化后，调用后端 `/api/scan/login/qrcode` 接口，获取二维码 Base64 字符串和临时凭证 uuid，直接渲染到页面即可，无需额外处理二维码生成逻辑。

2. **状态轮询**：获取 uuid 后，以 1-2 秒为间隔，调用后端 `/api/scan/login/state` 接口，传入 uuid 查询扫码状态，同步展示状态提示（未扫码、待确认、已登录、已过期）。

3. **结果处理**：若查询到状态为"已确认登录"，保存后端返回的 token 到本地（localStorage/SessionStorage），立即停止轮询并跳转至系统首页；若状态为"二维码已过期"，显示已过期，允许用户重新调用二维码生成接口刷新。

### 4.2 手机端扫码确认流程

手机端用户在扫码后，解析二维码内容（即 uuid），调用后端 `/api/scan/login/confirm` 接口，传入 uuid 和当前登录用户 ID，完成确认操作。此时 PC 端会收到更新通知，完成登录流程。

---
