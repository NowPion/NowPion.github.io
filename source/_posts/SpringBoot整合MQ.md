---
title: Spring Boot 整合MQ
date: 2025-11-8 14:08:55
tags: [Spring Boot, 消息队列,rocketmq ]
categories: [技术分享]
description: 详细介绍在 Spring Boot 项目中整合 RocketMQ 消息队列，实现异步解耦与流量削峰，涵盖生产端发送与消费端监听的完整配置实战。
---

# Spring Boot 整合 RocketMQ

本文档介绍如何在 Spring Boot 项目中集成和使用 RocketMQ 消息队列。

---

## 一、Maven 依赖

### 1.1 引入 RocketMQ 客户端

在项目的 `pom.xml` 文件中添加 RocketMQ 客户端依赖：

```xml
<dependency>
    <groupId>org.apache.rocketmq</groupId>
    <artifactId>rocketmq-client</artifactId>
    <version>4.8.0</version>
</dependency>
```

### 1.2 Spring Boot 相关依赖

确保项目中已引入 Spring Boot 相关依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter</artifactId>
</dependency>
```

---

## 二、配置文件

在 `application.yml` 或 `application.properties` 中配置 RocketMQ 相关参数。

### 2.1 YAML 格式配置

```yaml
rocketmq:
  name-server: 192.168.1.100:9876  # RocketMQ NameServer 地址
  producer:
    group: my-producer-group  # 生产者组名称
    send-message-timeout: 3000  # 发送消息超时时间（毫秒）
    retry-times-when-send-failed: 2  # 发送失败重试次数
  consumer:
    group: my-consumer-group  # 消费者组名称
```

### 2.2 Properties 格式配置

```properties
# RocketMQ NameServer 地址
rocketmq.name-server=192.168.1.100:9876

# 生产者配置
rocketmq.producer.group=my-producer-group
rocketmq.producer.send-message-timeout=3000
rocketmq.producer.retry-times-when-send-failed=2

# 消费者配置
rocketmq.consumer.group=my-consumer-group
```

### 2.3 配置说明

| 配置项 | 说明 | 必填 |
|--------|------|------|
| `rocketmq.name-server` | RocketMQ NameServer 地址 | ✅ |
| `rocketmq.producer.group` | 生产者组名称 | ✅ |
| `rocketmq.producer.send-message-timeout` | 发送消息超时时间（毫秒） | ❌ |
| `rocketmq.producer.retry-times-when-send-failed` | 发送失败重试次数 | ❌ |
| `rocketmq.consumer.group` | 消费者组名称 | ✅ |

---

## 三、生产者使用

### 3.1 创建生产者配置类

```java
package com.example.config;

import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.client.producer.DefaultMQProducer;
import org.apache.rocketmq.client.producer.MQProducer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RocketMQProducerConfig {
    
    @Value("${rocketmq.name-server}")
    private String nameServer;
    
    @Value("${rocketmq.producer.group}")
    private String producerGroup;
    
    @Value("${rocketmq.producer.send-message-timeout:3000}")
    private int sendMessageTimeout;
    
    @Value("${rocketmq.producer.retry-times-when-send-failed:2}")
    private int retryTimes;
    
    @Bean
    public MQProducer mqProducer() throws MQClientException {
        DefaultMQProducer producer = new DefaultMQProducer();
        producer.setProducerGroup(producerGroup);
        producer.setNamesrvAddr(nameServer);
        producer.setSendMsgTimeout(sendMessageTimeout);
        producer.setRetryTimesWhenSendFailed(retryTimes);
        producer.start();
        return producer;
    }
}
```

### 3.2 使用生产者发送消息

```java
package com.example.service;

import org.apache.rocketmq.client.producer.MQProducer;
import org.apache.rocketmq.client.producer.SendResult;
import org.apache.rocketmq.common.message.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class MessageProducerService {
    
    private static final Logger logger = LoggerFactory.getLogger(MessageProducerService.class);
    
    @Autowired
    private MQProducer mqProducer;
    
    /**
     * 发送消息
     * 
     * @param topic 主题
     * @param tags 标签
     * @param body 消息体
     * @return 发送结果
     */
    public SendResult sendMessage(String topic, String tags, String body) {
        try {
            Message message = new Message();
            message.setTopic(topic);
            message.setTags(tags);
            message.setBody(body.getBytes());
            
            SendResult result = mqProducer.send(message);
            logger.info("消息发送成功, topic:{}, tags:{}, result:{}", topic, tags, result);
            return result;
        } catch (Exception e) {
            logger.error("消息发送失败, topic:{}, tags:{}", topic, tags, e);
            throw new RuntimeException("消息发送失败", e);
        }
    }
    
    /**
     * 发送带 keys 的消息（用于消息追踪和去重）
     */
    public SendResult sendMessageWithKeys(String topic, String tags, String keys, String body) {
        try {
            Message message = new Message();
            message.setTopic(topic);
            message.setTags(tags);
            message.setKeys(keys);
            message.setBody(body.getBytes());
            
            SendResult result = mqProducer.send(message);
            logger.info("消息发送成功, topic:{}, tags:{}, keys:{}, result:{}", 
                    topic, tags, keys, result);
            return result;
        } catch (Exception e) {
            logger.error("消息发送失败, topic:{}, tags:{}, keys:{}", topic, tags, keys, e);
            throw new RuntimeException("消息发送失败", e);
        }
    }
}
```

### 3.3 生产者使用示例

```java
@RestController
@RequestMapping("/api/message")
public class MessageController {
    
    @Autowired
    private MessageProducerService messageProducerService;
    
    @PostMapping("/send")
    public String sendMessage(@RequestBody Map<String, String> params) {
        String topic = params.get("topic");
        String tags = params.get("tags");
        String body = params.get("body");
        
        SendResult result = messageProducerService.sendMessage(topic, tags, body);
        return "消息发送成功: " + result.getMsgId();
    }
}
```

---

## 四、消费者使用

### 4.1 创建消费者配置类

```java
package com.example.config;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.common.consumer.ConsumeFromWhere;
import org.apache.rocketmq.common.message.MessageExt;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RocketMQConsumerConfig {
    
    private static final Logger logger = LoggerFactory.getLogger(RocketMQConsumerConfig.class);
    
    @Value("${rocketmq.name-server}")
    private String nameServer;
    
    @Value("${rocketmq.consumer.group}")
    private String consumerGroup;
    
    @Bean
    public DefaultMQPushConsumer mqPushConsumer() throws MQClientException {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer();
        consumer.setConsumerGroup(consumerGroup);
        consumer.setNamesrvAddr(nameServer);
        // 设置消费起始位置：从队列头部开始消费
        consumer.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_FIRST_OFFSET);
        // 设置批量消费消息数量
        consumer.setConsumeMessageBatchMaxSize(10);
        // 订阅主题，"*" 表示订阅所有 tags
        consumer.subscribe("your-topic-name", "*");
        
        // 注册消息监听器
        consumer.registerMessageListener(new MessageListenerConcurrently() {
            @Override
            public ConsumeConcurrentlyStatus consumeMessage(
                    java.util.List<MessageExt> msgs,
                    org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyContext context) {
                try {
                    for (MessageExt msg : msgs) {
                        String body = new String(msg.getBody());
                        logger.info("收到消息, topic:{}, tags:{}, keys:{}, body:{}", 
                                msg.getTopic(), msg.getTags(), msg.getKeys(), body);
                        // 处理消息业务逻辑
                        processMessage(body);
                    }
                    return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
                } catch (Exception e) {
                    logger.error("消息消费失败", e);
                    return ConsumeConcurrentlyStatus.RECONSUME_LATER;
                }
            }
        });
        
        consumer.start();
        logger.info("RocketMQ 消费者启动成功, consumerGroup:{}", consumerGroup);
        return consumer;
    }
    
    /**
     * 处理消息的业务逻辑
     */
    private void processMessage(String body) {
        // TODO: 实现具体的业务逻辑
        logger.info("处理消息: {}", body);
    }
}
```

### 4.2 使用 @Component 方式创建消费者

```java
package com.example.consumer;

import org.apache.rocketmq.client.consumer.DefaultMQPushConsumer;
import org.apache.rocketmq.client.consumer.listener.ConsumeConcurrentlyStatus;
import org.apache.rocketmq.client.consumer.listener.MessageListenerConcurrently;
import org.apache.rocketmq.client.exception.MQClientException;
import org.apache.rocketmq.common.consumer.ConsumeFromWhere;
import org.apache.rocketmq.common.message.MessageExt;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class MessageConsumer implements InitializingBean {
    
    private static final Logger logger = LoggerFactory.getLogger(MessageConsumer.class);
    
    @Value("${rocketmq.name-server}")
    private String nameServer;
    
    @Value("${rocketmq.consumer.group}")
    private String consumerGroup;
    
    @Override
    public void afterPropertiesSet() throws Exception {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer();
        consumer.setConsumerGroup(consumerGroup);
        consumer.setNamesrvAddr(nameServer);
        consumer.setConsumeFromWhere(ConsumeFromWhere.CONSUME_FROM_FIRST_OFFSET);
        consumer.setConsumeMessageBatchMaxSize(10);
        // 订阅主题
        consumer.subscribe("your-topic-name", "*");
        
        consumer.setMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            for (MessageExt msg : msgs) {
                String body = new String(msg.getBody());
                logger.info("收到消息: {}", body);
                // 处理消息
            }
            return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
        });
        
        consumer.start();
        logger.info("消费者启动成功");
    }
}
```

### 4.3 消费者配置说明

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `setConsumerGroup()` | 消费者组名称 | 同一组内的消费者负载均衡消费 |
| `setNamesrvAddr()` | NameServer 地址 | 从配置文件读取 |
| `setConsumeFromWhere()` | 消费起始位置 | `CONSUME_FROM_FIRST_OFFSET` 从第一条开始 |
| `setConsumeMessageBatchMaxSize()` | 批量消费数量 | 建议设置为 10 |
| `subscribe()` | 订阅 Topic 和 Tag | `subscribe("topic", "*")` 订阅所有 tags |

### 4.4 消费状态说明

- `ConsumeConcurrentlyStatus.CONSUME_SUCCESS`：消费成功，消息会被确认
- `ConsumeConcurrentlyStatus.RECONSUME_LATER`：消费失败，消息会重新投递

---

## 五、Topic 和 Tag 说明

### 5.1 Topic（主题）

Topic 是消息的逻辑分类，一个 Topic 可以包含多个消息队列。

### 5.2 Tag（标签）

Tag 是 Topic 下的子分类，用于更细粒度的消息过滤。

### 5.3 使用建议

```java
// 生产者：设置 Topic 和 Tag
Message message = new Message();
message.setTopic("order-topic");      // 订单主题
message.setTags("order-create");      // 创建订单标签
message.setBody("订单数据".getBytes());

// 消费者：订阅 Topic，可以指定 Tag 表达式
consumer.subscribe("order-topic", "order-create");  // 只消费创建订单的消息
consumer.subscribe("order-topic", "*");             // 消费所有标签的消息
consumer.subscribe("order-topic", "order-create || order-pay");  // 消费多个标签
```

---

## 六、消息发送方式

### 6.1 同步发送

```java
SendResult result = producer.send(message);
```

### 6.2 异步发送

```java
producer.send(message, new SendCallback() {
    @Override
    public void onSuccess(SendResult sendResult) {
        logger.info("异步发送成功: {}", sendResult);
    }
    
    @Override
    public void onException(Throwable e) {
        logger.error("异步发送失败", e);
    }
});
```

### 6.3 单向发送（不关心结果）

```java
producer.sendOneway(message);
```

---

## 七、注意事项

1. **NameServer 地址**：确保所有服务连接到同一个 RocketMQ NameServer
2. **消费者组名称**：同一消费者组内的消费者会负载均衡消费消息
3. **Topic 创建**：确保 Topic 已在 RocketMQ 中创建，否则消息发送会失败
4. **消息体格式**：消息体必须是字节数组，字符串需要转换为 `byte[]`
5. **异常处理**：生产者和消费者都要做好异常处理和日志记录
6. **消费幂等性**：确保消息消费的幂等性，避免重复消费导致的问题
7. **资源释放**：应用关闭时，记得关闭生产者和消费者

---

## 八、常见问题

### 8.1 连接失败

**问题**：`connect to null failed`

**原因**：配置文件中 NameServer 地址未配置或配置错误

**解决**：检查配置文件中的 `rocketmq.name-server` 配置

### 8.2 消息发送失败

**问题**：消息发送抛出异常

**原因**：
- Topic 不存在
- NameServer 连接失败
- 网络问题

**解决**：
- 确保 Topic 已在 RocketMQ 中创建
- 检查 NameServer 地址是否正确
- 检查网络连接

### 8.3 消息消费不到

**问题**：消费者启动成功但收不到消息

**原因**：
- Topic 名称不一致
- Tag 表达式不匹配
- 消费者组名称冲突

**解决**：
- 确认生产者和消费者使用相同的 Topic
- 检查 Tag 表达式（建议使用 `"*"` 订阅所有）
- 确保消费者组名称唯一

---

> 作者：NowPion  
> 用代码驱动业务，让通信更稳定、更可观测。
