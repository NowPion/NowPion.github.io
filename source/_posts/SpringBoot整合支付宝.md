---
title: Spring Boot 整合支付宝
date: 2025-10-30 20:08:55
tags: [Spring Boot, 支付宝, 支付集成]
categories: [技术分享]
---

# 一、前提准备

在开始整合之前，你需要准备以下配置：

- **AppID**：支付宝应用唯一标识  
- **应用私钥（appPrivateKey）**：自己生成，用于签名  
- **支付宝公钥（alipayPublicKey）**：从支付宝开放平台获取  
- **应用公钥（appPublicKey）**：配置在支付宝后台  
- **异步回调地址（notifyUrl）**：支付成功后支付宝通知的接口  
- **支付宝网关地址**（沙箱环境为 `https://openapi-sandbox.dl.alipaydev.com/gateway.do`）

---

# 二、Maven 依赖

```xml
<dependencies>
    <!-- 支付宝 Easy SDK -->
    <dependency>
        <groupId>com.alipay.sdk</groupId>
        <artifactId>alipay-easysdk</artifactId>
        <version>2.2.0</version>
    </dependency>

    <!-- 支付宝官方 Java SDK -->
    <dependency>
        <groupId>com.alipay.sdk</groupId>
        <artifactId>alipay-sdk-java</artifactId>
        <version>4.34.0.ALL</version>
    </dependency>
</dependencies>
```

> 💡 推荐使用 **Easy SDK** 进行业务封装，但如需更灵活的控制，可配合官方 SDK 一起使用。

---

# 三、配置文件（application.yml）

```yaml
alipay:
  appId:           # 支付宝应用AppID
  appPrivateKey:   # 应用私钥
  alipayPublicKey: # 支付宝公钥
  notifyUrl:       # 支付成功后的异步回调地址
```

---

# 四、支付宝配置类初始化

```java
@Data
@Component
@ConfigurationProperties(prefix = "alipay")
public class AliPayConfig {
    private String appId;
    private String appPrivateKey;
    private String alipayPublicKey;
    private String notifyUrl;

    @PostConstruct
    public void init() {
        Config config = new Config();
        config.protocol = "https";
        config.gatewayHost = "openapi.alipaydev.com"; // 沙箱网关
        config.signType = "RSA2";
        config.appId = this.appId;
        config.merchantPrivateKey = this.appPrivateKey;
        config.alipayPublicKey = this.alipayPublicKey;
        config.notifyUrl = this.notifyUrl;
        Factory.setOptions(config);
        System.out.println("✅ 支付宝SDK初始化成功");
    }
}
```

---

# 五、支付与回调接口

```java
@RestController
@RequestMapping("/alipay")
@Transactional(rollbackFor = Exception.class)
public class AliPayController {

    @Resource
    private AliPayConfig aliPayConfig;

    private static final String GATEWAY_URL = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
    private static final String FORMAT = "JSON";
    private static final String CHARSET = "utf-8";
    private static final String SIGN_TYPE = "RSA2";

    /** 获取支付二维码 **/
    @GetMapping("/pay") // /alipay/pay?subject=测试订单&traceNo=123456&totalAmount=0.01
    public Object pay(AliPay aliPay) throws Exception {
        AlipayClient client = new DefaultAlipayClient(
                GATEWAY_URL,
                aliPayConfig.getAppId(),
                aliPayConfig.getAppPrivateKey(),
                FORMAT,
                CHARSET,
                aliPayConfig.getAlipayPublicKey(),
                SIGN_TYPE
        );

        AlipayTradePrecreateRequest request = new AlipayTradePrecreateRequest();
        AlipayTradePrecreateModel model = new AlipayTradePrecreateModel();
        model.setOutTradeNo(aliPay.getTraceNo());
        model.setSubject(aliPay.getSubject());
        model.setTotalAmount(String.valueOf(aliPay.getTotalAmount()));
        request.setBizModel(model);
        request.setNotifyUrl(aliPayConfig.getNotifyUrl());

        AlipayTradePrecreateResponse response = client.execute(request);
        return response;
    }

    /** 支付宝异步通知回调 **/
    @PostMapping("/notify")
    public String notify(HttpServletRequest request) throws Exception {
        if ("TRADE_SUCCESS".equals(request.getParameter("trade_status"))) {
            System.out.println("========= 支付宝异步回调 =========");

            Map<String, String> params = new HashMap<>();
            request.getParameterMap().forEach((k, v) -> params.put(k, v[0]));

            if (Factory.Payment.Common().verifyNotify(params)) {
                // ✅ 验签通过
                System.out.println("交易名称: " + params.get("subject"));
                System.out.println("交易状态: " + params.get("trade_status"));
                System.out.println("支付宝交易凭证号: " + params.get("trade_no"));
                System.out.println("商户订单号: " + params.get("out_trade_no"));
                System.out.println("交易金额: " + params.get("total_amount"));
                System.out.println("买家ID: " + params.get("buyer_id"));
                System.out.println("付款时间: " + params.get("gmt_payment"));
                // TODO: 更新订单状态为“已支付”
            }
        }
        return "success";
    }
}
```

---

# 六、生成支付二维码

返回的 JSON 数据中会包含一个 `qrCode` 字段，
可使用第三方工具（如 `ZXing`）生成二维码进行扫码支付。

例如：
```java
String qrCode = response.getQrCode();
QRCodeUtil.generate(qrCode, "alipay_qr.png");
```

> 在支付宝沙箱模式中，你可以使用沙箱钱包 App 扫码模拟支付。

---

# 七、常见问题 & 建议

1.  **测试环境**  
   使用 [支付宝开放平台沙箱环境](https://open.alipay.com/developmentAccess/devSandbox) 测试，无需真实支付。  

2.  **异步通知**  
   回调接口必须为公网可访问地址，否则支付宝无法回调。  

3.  **密钥安全**  
   请勿在前端或公开仓库暴露私钥信息。  

4.  **生产环境网关**  
   正式环境网关为 `https://openapi.alipay.com/gateway.do`。

---

# 八、总结

本文通过简单的配置和代码实现了：
- 支付宝 SDK 初始化  
- 生成支付二维码接口  
- 异步回调验签逻辑  

至此，一个完整的 **支付宝扫码支付功能** 就整合完成了。  
如需扩展，可继续实现退款、查询、关闭订单等接口。

---

> ✍️ *Author: NowPion*  
> 💬 “用代码驱动业务，让支付更简单。”
