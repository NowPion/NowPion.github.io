---

title: Redis + AOP 实现的接口限流
date: 2025-11-12 20:08:55
tags: [Spring Boot, Redis, AOP]
categories: [技术分享]
description: 介绍在 Spring Boot 项目中利用 Redis 与自定义 AOP 注解实现分布式接口限流的完整方案，有效防止高并发刷接口与突发流量导致系统崩溃。
---

# 一、前言

在高并发系统中，为了防止接口被恶意频繁访问、刷接口或突发流量导致系统崩溃，我们需要 **限流（Rate Limiting）**。本文将介绍如何通过 **Redis + AOP** 在 Spring Boot 项目中实现轻量级、可复用的接口限流功能。

相比使用 Guava 或令牌桶算法的单机实现，Redis 版本支持 **分布式限流**，非常适合多实例部署场景。

---

# 二、Maven 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>

```

---

# 三、自定义注解

通过注解来灵活定义接口限流的规则，例如访问时间窗口与次数。

```java

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface CurrentLimiting {

    /**
     * Redis 缓存 key 前缀
     */
    String key() default "apiVisits:";

    /**
     * 限流时间窗口（单位：秒）
     */
    int time() default 5;

    /**
     * 时间窗口内允许的最大访问次数
     */
    int count() default 10;
}
```

---

# 四、AOP 切面实现

利用 AOP 在接口调用前拦截请求，并基于 Redis 的 **ZSet（有序集合）** 实现滑动时间窗口限流。

```java
@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
public class CurrentLimitingAspect {

    private final RedisTemplate<String, Object> redisTemplate;

    /**
     * 拦截带有 @CurrentLimiting 注解的方法
     */
    @Before("@annotation(currentLimiting)")
    public void doBefore(JoinPoint point, CurrentLimiting currentLimiting) throws Throwable {
        int time = currentLimiting.time();
        int count = currentLimiting.count();

        // 构建 Redis Key
        String key = getCurrentLimitingKey(currentLimiting.key(), point);

        // 使用 ZSet 存储每次访问时间戳
        ZSetOperations<String, Object> zSetOps = redisTemplate.opsForZSet();
        long currentTime = System.currentTimeMillis();

        zSetOps.add(key, currentTime, currentTime);
        redisTemplate.expire(key, time, TimeUnit.SECONDS);

        // 删除窗口外的记录
        zSetOps.removeRangeByScore(key, 0, currentTime - time * 1000);

        // 统计当前时间窗口内访问次数
        Long currentCount = zSetOps.zCard(key);

        if (currentCount != null && currentCount > count) {
            log.warn("接口限流触发 -> key:{}, count:{}, currentCount:{}", key, count, currentCount);
            throw new RuntimeException("访问过于频繁，请稍后再试!");
        }
    }

    /**
     * 拼接 Redis key：前缀 + 用户IP + 类名 + 方法名
     */
    private String getCurrentLimitingKey(String prefixKey, JoinPoint point) {
        StringBuilder sb = new StringBuilder(prefixKey);

        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        HttpServletRequest request = attributes.getRequest();

        String ip = request.getRemoteAddr(); // 可替换为自定义 IpUtil
        MethodSignature signature = (MethodSignature) point.getSignature();
        Method method = signature.getMethod();
        Class<?> targetClass = method.getDeclaringClass();

        return sb.append(ip)
                .append(":")
                .append(targetClass.getName())
                .append(":")
                .append(method.getName())
                .toString();
    }
}
```

---

# 五、注解使用示例

在控制器方法上直接使用 `@CurrentLimiting` 注解即可，灵活控制不同接口的限流策略。

```java
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DemoController {

    @GetMapping("/hello")
    @CurrentLimiting(time = 5, count = 2)
    public String hello() {
        return "Hello, World!";
    }
}
```

运行后，访问 `/hello` 接口 5 秒内超过 2 次，将触发异常：

```
访问过于频繁，请稍后再试!
```

---

# 六、总结

 使用 Redis ZSet 实现滑动窗口算法，统计当前时间段内访问次数。

 AOP 拦截 + 自定义注解，使限流逻辑与业务逻辑完全解耦。

 可轻松扩展至分布式系统，配合 Lua 脚本可实现原子操作。

---

>  作者：NowPion  