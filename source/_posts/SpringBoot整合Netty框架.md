---
title: Spring Boot 整合Netty框架
date: 2025-11-4 20:08:55
tags: [Spring Boot, Im系统, Netty框架]
categories: [技术分享]
description: 基于 Spring Boot 整合 Netty 高性能网络通信框架，实现自定义协议长连接、心跳检测与断线重连，适用于高并发 IM 即时通讯系统。
---


---

# 一、Maven 依赖

```xml
<dependencies>
        <dependency>
            <groupId>io.netty</groupId>
            <artifactId>netty-all</artifactId>
            <version>4.1.97.Final</version>
        </dependency>
        <dependency>
            <groupId>com.alibaba</groupId>
            <artifactId>fastjson</artifactId>
            <version>2.0.10</version>
        </dependency>
</dependencies>
```

---

# 二、模块概览与结构

- 核心功能：基于 Netty 的 IM 长连接服务，统一编解码与消息路由。
- 主要目录与类：
  - `common/`
    - `ImMsg`：消息模型，固定头（magic、len、code）+ 变长体（body）。
    - `ImMsgDecode`：解码器，校验 magic，读取长度与消息码，解析 body。
    - `ImMsgEncode`：编码器，按顺序写入头部与消息体。
  - `handler/`
    - `ImServerCoreHandler`：核心入站处理器，统一转发到工厂。
    - `ImHandlerFactory`、`ImHandlerFactoryImpl`：根据消息码路由到具体处理器。
    - `SimplyHandler`：处理器接口，`handle(ctx, msg)`。
    - `impl/`：`LoginMsgHandler`、`LogoutMsgHandler`、`HearteatMsgHandler`、`BizImMsgHandler`。
  - 根包：`NettyImServerApplication`：Netty 服务端启动入口。

---

# 三、服务端启动流程（NettyImServerApplication）

- 事件循环：创建 `bossGroup`（处理 accept）与 `workerGroup`（处理 read/write）。
- 服务引导：`ServerBootstrap` 绑定 NIO 通道 `NioServerSocketChannel`。
- Pipeline 初始化：
  - 添加 `ImMsgDecode`（解码）、`ImMsgEncode`（编码）。
  - 添加 `ImServerCoreHandler`（统一分发）。
- 关闭钩子：JVM 退出时优雅关闭两个事件循环组。
- 绑定监听：端口示例 `9090`，阻塞主线程等待 `closeFuture`。

```java
public class NettyImServerApplication {
    private static final Logger LOGGER = LoggerFactory.getLogger(NettyImServerApplication.class);
    //指定端口
    private int port;

    public int getPort() {
        return port;
    }

    public void setPort(int port) {
        this.port = port;
    }
    //基于netty启动java进程
    public void startApplication(int port) throws InterruptedException {
        setPort(port);
        //处理accept事件
        NioEventLoopGroup bossGroup = new NioEventLoopGroup();
        //处理read&write事件
        NioEventLoopGroup workerGroup = new NioEventLoopGroup();
        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup);
        bootstrap.channel(NioServerSocketChannel.class);
        //netty初始化相关handler
        bootstrap.childHandler(new ChannelInitializer<>() {
            @Override
            protected void initChannel(Channel channel) throws Exception {
                //打印日志
                LOGGER.info("初始化连接通道");
                //设计消息体
                //添加编码器
                //添加解码器
                channel.pipeline().addLast(new ImMsgDecode());
                channel.pipeline().addLast(new ImMsgEncode());
                //添加核心handler
                channel.pipeline().addLast(new ImServerCoreHandler());

            }
        });
        //基于jvm钩子函数实现关闭
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            //关闭线程池
            bossGroup.shutdownGracefully();
            //关闭线程池
            workerGroup.shutdownGracefully();
        }));
        ChannelFuture channelFuture = bootstrap.bind(port).sync();
        LOGGER.info("netty im server 启动成功，监听端口：{}" + port);
        //阻塞主线程，直到channel关闭
        channelFuture.channel().closeFuture().sync();

    }
     public static void main(String[] args) throws InterruptedException {
        NettyImServerApplication server = new NettyImServerApplication();
        server.startApplication(9090);
    }
}

```

---

# 四、协议与编解码设计（ImMsg / ImMsgDecode / ImMsgEncode）

- 消息头部：
  - `magic`：`short` 魔数校验，模块设定为 `19231`。
  - `len`：`int`，消息体字节长度。
  - `code`：`int`，消息类型码（登录、登出、心跳、业务）。
- 消息体：`byte[] body`，变长二进制内容。
- 解码关键点：
  - 先判断可读字节是否满足基础头部长度（`BASE_LEN = 2 + 4 + 4`）。
  - 读取并校验 `magic` 不合法直接 `ctx.close()`。
  - 读取 `len` 与 `code` 后，如果缓冲区不足，回滚读指针并等待。
  - 读取 `body` 并封装为 `ImMsg` 对象。
- 编码流程：按头部顺序写出，再写入 `body`。
- 快速构造体：`ImMsg.build(code, data)` 便于测试。

```java
public class ImMsg implements Serializable {
    private static final long serialVersionUID = -448787845159289179L;
    //基本校验
    private short magic;

    //内容长度
    private int len;

    //消息类型
    private int code;

    //存储消息内容
    private byte[] body;


    public short getMagic() {
        return magic;
    }

    public void setMagic(short magic) {
        this.magic = magic;
    }

    public int getLen() {
        return len;
    }

    public void setLen(int len) {
        this.len = len;
    }

    public int getCode() {
        return code;
    }

    public void setCode(int code) {
        this.code = code;
    }

    public byte[] getBody() {
        return body;
    }

    public void setBody(byte[] body) {
        this.body = body;
    }
    
    public static ImMsg build(int code,String data) {
        ImMsg imMsg = new ImMsg();
        imMsg.setMagic((short) 19231);
        imMsg.setLen(data.getBytes().length);
        imMsg.setCode(code);
        imMsg.setBody(data.getBytes());
        return imMsg;
    }
}

public class ImMsgDecode extends ByteToMessageDecoder {

    private final int BASE_LEN = 2 + 4 + 4; // magic + len + code

    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf byteBuf, List<Object> out) throws Exception {
        if (byteBuf.readableBytes() < BASE_LEN) {
            return;
        }

        byteBuf.markReaderIndex(); // 标记读指针

        short magic = byteBuf.readShort();
        if (magic != 19231) {
            ctx.close();
            return;
        }

        int len = byteBuf.readInt();
        int code = byteBuf.readInt();

        if (byteBuf.readableBytes() < len) {
            byteBuf.resetReaderIndex(); // 回滚，等待更多数据
            return;
        }

        byte[] body = new byte[len];
        byteBuf.readBytes(body);

        ImMsg imMsg = new ImMsg();
        imMsg.setMagic(magic);
        imMsg.setLen(len);
        imMsg.setCode(code);
        imMsg.setBody(body);
        out.add(imMsg);
    }
}

public class ImMsgEncode extends MessageToByteEncoder {

    @Override
    protected void encode(ChannelHandlerContext ctx, Object msg, ByteBuf out) throws Exception {
        ImMsg imMsg = (ImMsg) msg;
        out.writeShort(imMsg.getMagic());
        out.writeInt(imMsg.getLen());
        out.writeInt(imMsg.getCode());
        out.writeBytes(imMsg.getBody());
    }
}


```

---

# 五、统一消息路由与处理（Handler 体系）

- 入站统一：`ImServerCoreHandler` 只接收 `ImMsg`，否则抛错，随后委派到工厂：

```java
public class ImServerCoreHandler extends SimpleChannelInboundHandler {
    //处理消息的工厂
    private ImHandlerFactory imHandlerFactory = new ImHandlerFactoryImpl();
    @Override
    protected void channelRead0(ChannelHandlerContext ctx, Object msg) throws Exception {
        if(!(msg instanceof ImMsg)){
            throw new Exception("msg is not instance of ImMsg");
        }
        ImMsg imMsg = (ImMsg) msg;
        imHandlerFactory.doMsgHandler(ctx, imMsg);

    }
}
```

- 工厂路由：`ImHandlerFactoryImpl` 以 `Map<Integer, SimplyHandler>` 维护消息码与处理器映射，示例注册：
  - 登录：`LoginMsgHandler`
  - 登出：`LogoutMsgHandler`
  - 心跳：`HearteatMsgHandler`
  - 业务：`BizImMsgHandler`

```java
public interface SimplyHandler {
    void handle(ChannelHandlerContext ctx, ImMsg msg);
}


public class BizImMsgHandler implements SimplyHandler {
    @Override
    public void handle(ChannelHandlerContext ctx, ImMsg msg) {
        System.out.println("收到业务消息" + msg.toString());
        ctx.writeAndFlush(msg);
    }
}
public class HearteatMsgHandler implements SimplyHandler {
    @Override
    public void handle(ChannelHandlerContext ctx, ImMsg msg) {
        System.out.println("收到心跳消息" + msg.toString());
        ctx.writeAndFlush(msg);
    }
}
public class LoginMsgHandler implements SimplyHandler {
    @Override
    public void handle(ChannelHandlerContext ctx, ImMsg msg) {
        System.out.println("收到登入消息" + msg.toString());
        ctx.writeAndFlush(msg);
    }
}
public class LogoutMsgHandler implements SimplyHandler {
    @Override
    public void handle(ChannelHandlerContext ctx, ImMsg msg) {
        System.out.println("收到登出消息" + msg.toString());
        ctx.writeAndFlush(msg);
    }
}
```


- 处理器当前行为：打印收到的消息并 `ctx.writeAndFlush(msg)` 回显，便于联调。
- 扩展建议：
  - 登录：校验令牌、绑定 `channel <-> userId`、记录上线状态。
  - 心跳：更新会话最近活动时间、设置超时剔除策略。
  - 业务：根据 `code` 子类型或 `body` 路由到具体业务处理，支持单聊/群聊。
  - 登出：解绑会话、释放资源、通知好友在线状态变化。



```java
public interface ImHandlerFactory {
    /**
     * 根据code获取对应的handler
     * @param channelContext
     * @param imMsg
     */
    void doMsgHandler(ChannelHandlerContext channelContext, ImMsg imMsg);
}


public class ImHandlerFactoryImpl implements ImHandlerFactory {
    // 存放handler的map，key为消息码，value为handler
    private static Map<Integer, SimplyHandler> handlerMap = new HashMap<>();

    static {
        // 注册登入消息处理器
        handlerMap.put(ImMsgCodeEnum.IM_LOGIN_MSG.getCode(), new LoginMsgHandler());
        // 注册登出消息处理器
        handlerMap.put(ImMsgCodeEnum.IM_LOGOUT_MSG.getCode(), new LogoutMsgHandler());
        // 注册心跳消息处理器
        handlerMap.put(ImMsgCodeEnum.IM_HEARTBEAT_MSG.getCode(), new HearteatMsgHandler());
        // 注册常规业务消息处理器
        handlerMap.put(ImMsgCodeEnum.IM_BIZ_MSG.getCode(), new BizImMsgHandler());
    }

    @Override
    public void doMsgHandler(ChannelHandlerContext channelContext, ImMsg imMsg) {
        // 从map中获取handler
        SimplyHandler handler = handlerMap.get(imMsg.getCode());
        if (handler == null) {
           throw new IllegalArgumentException("未注册的消息码：" + imMsg.getCode());
        }
        // 调用handler的handle方法
        handler.handle(channelContext, imMsg);
    }
}

```

---

# 六、与 Spring Boot 的整合方式

- 当前模块定位：独立 Netty 进程（`main` 方法直接启动）。
- 两种常见整合路径：
  - 独立服务进程：与 Spring Boot Web 应用通过 HTTP/WebSocket/消息队列交互，IM 服务专注长连接与消息中转。
  - Spring Bean 管理：将 `NettyImServerApplication` 作为 Bean 注入，在 `ApplicationRunner`/`CommandLineRunner` 中启动，在 `@PreDestroy` 中优雅关闭。

示例（伪代码）：

```java
@Configuration
public class ImServerConfig {
    @Bean
    public NettyImServerApplication imServer() { return new NettyImServerApplication(); }

    @Bean
    public ApplicationRunner runner(NettyImServerApplication imServer) {
        return args -> imServer.startApplication(9090);
    }
}
```

---

# 七、客户端测试

```java
public class ImClientApplication {

    private void startConnection(String ip, int port) throws Exception {
        EventLoopGroup group = new NioEventLoopGroup();
        Bootstrap bootstrap = new Bootstrap();
        bootstrap.group(group);
        bootstrap.channel(NioSocketChannel.class);
        bootstrap.handler(new ChannelInitializer<SocketChannel>() {
            @Override
            protected void initChannel(SocketChannel ch) throws Exception {
                System.out.println("初始化成功");
                ch.pipeline().addLast(new ImMsgDecode());
                ch.pipeline().addLast(new ImMsgEncode());
                ch.pipeline().addLast(new ClientHandler());

            }
        });
        ChannelFuture future = bootstrap.connect(ip, port).sync();
        // 等待连接成功
        Channel channel = future.channel();
        for(int i = 0; i < 10; i++){
            channel.writeAndFlush(ImMsg.build(ImMsgCodeEnum.IM_LOGIN_MSG.getCode(), "login"));
            channel.writeAndFlush(ImMsg.build(ImMsgCodeEnum.IM_BIZ_MSG.getCode(), "biz"));
            channel.writeAndFlush(ImMsg.build(ImMsgCodeEnum.IM_HEARTBEAT_MSG.getCode(), "heartbeat"));
            channel.writeAndFlush(ImMsg.build(ImMsgCodeEnum.IM_LOGOUT_MSG.getCode(), "logout"));
            Thread.sleep(3000);
        }
    }

    public static void main(String[] args) throws Exception {
        ImClientApplication client = new ImClientApplication();
        client.startConnection("localhost",9090);
    }
}

public class ClientHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
        ImMsg imMsg = (ImMsg) msg;
        System.out.println("[服务端响应] message: " + imMsg);
    }
}

```


---

# 八、运行与联调建议

- 本地启动：直接运行 `NettyImServerApplication.main`，默认端口 `9090`。可通过 VM 参数配置端口。

- 客户端联调：自定义二进制协议，建议使用 Netty 客户端发送 `ImMsg.build(code, json)` 测试。

- 消息码定义：依赖 `ImMsgCodeEnum`（位于 `interfaces` 模块），保持服务端与客户端统一。

- 日志观察：关注连接初始化日志与各 Handler 打印，便于定位协议与路由问题。

  

---

# 九、后续规划与优化点

- 会话管理：支持多端登录、设备标识绑定、在线状态同步。
- 心跳与超时：空闲检测与踢出策略、动态心跳周期。
- 鉴权与安全：接入令牌校验、签名验真、限流与防刷。
- 消息可靠：落库与离线消息、ACK 机制、重试策略。
- 可观测性：接入指标与追踪，压力测试与容量规划。
- 集群能力：多节点部署、连接迁移、消息广播与一致性。

---

>  作者：NowPion  
>  用代码驱动业务，让通信更稳定、更可观测。
