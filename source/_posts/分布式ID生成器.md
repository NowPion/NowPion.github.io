---
title: "高效分布式ID生成服务代码解析"
date: 2025-10-18 12:40:00 
tags: [分布式, ID生成, Java] 
categories: [技术分享]
description: 解析高性能分布式 ID 生成服务的核心设计与代码实现，结合本地缓存号段模式与异步更新机制，支持高并发场景下顺序与无序 ID 快速分配。
---

# 分布式ID生成

本文以一个具体 Java 项目代码为例，解析其核心 ID 生成逻辑及设计亮点。
旨在帮助开发者理解如何结合本地缓存和异步更新策略，实现高性能的分布式 ID 生成服务。

---

## 项目背景

该服务提供 **顺序ID** 和 **无序ID** 两种生成方式，支持高并发场景下 ID 快速分配。
主要思想是利用本地缓存减少数据库访问压力，通过异步刷新机制实现 ID 区间动态更新，保障 ID 生成的效率与唯一性。

---

## 数据库表设计

核心表 `t_id_generate_config` 用于存储各业务 ID 配置及号段信息：

```sql
CREATE TABLE `t_id_generate_config` (
 `id` int NOT NULL AUTO_INCREMENT COMMENT '主键 id',
 `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '描述',
 `next_threshold` bigint DEFAULT NULL COMMENT '当前 id 所在阶段的阈值',
 `init_num` bigint DEFAULT NULL COMMENT '初始化值',
 `current_start` bigint DEFAULT NULL COMMENT '当前 id 所在阶段的开始值',
 `step` int DEFAULT NULL COMMENT 'id 递增区间',
 `is_seq` tinyint DEFAULT NULL COMMENT '是否有序（0 无序，1 有序）',
 `id_prefix` varchar(60) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '业务前缀码，如果没有则返回时不携带',
 `version` int NOT NULL DEFAULT '0' COMMENT '乐观锁版本号',
 `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
 `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
 PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

* 使用 **自增主键** 作为唯一标识。
* `is_seq` 标记是否为顺序 ID。
* `version` 用于乐观锁，防止多实例冲突。
* `current_start` 和 `next_threshold` 定义号段范围。

---

## 核心代码剖析

### 1️⃣ 本地缓存结构

```java
// 顺序ID缓存
private static Map<Integer, LocalSeqIdBo> localSeqIdBoMap = new ConcurrentHashMap<>();

// 无序ID缓存
private static Map<Integer, LocalUnSeqIdBo> localUnSeqIdBoMap = new ConcurrentHashMap<>();
```

* **顺序ID缓存**维护当前递增计数及区间阈值。
* **无序ID缓存**维护一个打乱顺序的 ID 队列，既支持连续 ID 生成，又满足无序需求。

---

### 2️⃣ ID 生成逻辑

**顺序 ID**生成通过调用 `incrementAndGet` 实现线程安全递增：

```java
long returnId = localSeqIdBo.getCurrentNum().incrementAndGet();
```

**无序 ID**生成通过从本地的 ID 队列中 `poll` 一个 ID：

```java
Long pollId = localUnSeqIdBo.getIdQueue().poll();
```

两种方式满足不同应用场景的 ID 生成需求。

---

### 3️⃣ 异步刷新机制

当缓存 ID 使用进度达到区间的 **75%** 时，代码采用 **信号量 + 线程池** 控制异步刷新 ID 区间，防止多线程并发更新数据库：

```java
if(localSeqIdBo.getCurrentNum().get() - localSeqIdBo.getCurrentStart() > step * UPDATE_RATE){
    Semaphore semaphore = semaphoreMap.get(localSeqIdBo.getId());
    if(semaphore.tryAcquire()){
        threadPoolExecutor.execute(() -> {
            try {
                tryUpdateMysqlRecord(idGenerateMapper.selectById(localSeqIdBo.getId()));
            } catch (Exception e) {
                LOGGER.error("同步失败", e);
            } finally {
                semaphoreMap.get(localSeqIdBo.getId()).release();
            }
        });
    }
}
```

* 异步更新提升响应速度。
* 信号量保证更新单一性，避免多线程冲突。

---

### 4️⃣ 并发控制与线程池

* 使用 **Semaphore** 确保数据库更新操作互斥访问。
* 使用带自定义命名线程的 **线程池** 提升异步执行效率，保证高并发环境稳定安全。

---

## 总结

该 ID 生成服务设计巧妙结合了：

* 本地缓存
* 高并发控制
* 异步刷新机制

极大降低数据库压力，实现了高性能的分布式 ID 生成。
适合单实例或有限多实例部署场景，代码结构清晰，易于扩展和维护。

> 理解和借鉴其设计思路，有助于构建稳定高效的分布式系统基础组件。

—— *NowPion*
