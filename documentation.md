# WebRTC 示例图表

本文档包含图表，用于说明此 WebRTC 应用程序的架构和数据流。您可以在任何支持 Mermaid.js 的 Markdown 编辑器中查看这些图表。

---

## 1. 应用程序流程图

此流程图从用户角度展示了从加载页面到结束通话的常规事件序列。

```mermaid
flowchart TD
    A[开始: 页面加载] --> B{生成加密密钥};
    B --> C{密钥是否生成?};
    C -- 是 --> D[启用 '启动摄像头' / '分享屏幕' 按钮];
    C -- 否 --> E[显示致命错误];

    D --> F[用户点击开始];
    F --> G{获取本地媒体流};
    G -- 成功 --> H[显示本地视频并启用 '呼叫' 按钮];
    G -- 失败 --> I[显示媒体错误];

    H --> J[用户点击 '呼叫'];
    J --> K[初始化对等连接];
    K --> L(信令: 发送 Offer);
    L --> M{等待 Answer};
    M --> N(信令: 接收 Answer);
    N --> O{P2P 连接已建立};
    O --> P[聊天和文件传输已启用];
    P --> Q[用户点击 '挂断'];
    Q --> R[关闭连接并重置 UI];
    R --> A;
```

---

## 2. 连接设置时序图

此图说明了建立对等连接所需的详细信令过程。它显示了两个客户端（发起方和接收方）以及信令服务器的角色。

```mermaid
sequenceDiagram
    participant 客户端 A (发起方)
    participant 信令服务器
    participant 客户端 B (接收方)

    autonumber

    客户端A->>客户端A: 生成加密密钥对 A
    客户端B->>客户端B: 生成加密密钥对 B

    Note over 客户端 A: 用户启动摄像头并点击 '呼叫'

    客户端A->>客户端A: createPeerConnection()
    客户端A->>客户端A: createOffer()
    客户端A->>客户端A: setLocalDescription(offer)
    客户端A->>信令服务器: 发送 Offer SDP + 公钥 A

    信令服务器->>客户端B: 转发 Offer SDP + 公钥 A

    客户端B->>客户端B: createPeerConnection()
    客户端B->>客户端B: setRemoteDescription(offer)
    客户端B->>客户端B: 派生共享密钥 (使用私钥 B + 公钥 A)
    客户端B->>客户端B: createAnswer()
    客户端B->>客户端B: setLocalDescription(answer)
    客户端B->>信令服务器: 发送 Answer SDP + 公钥 B

    信令服务器->>客户端A: 转发 Answer SDP + 公钥 B

    客户端A->>客户端A: setRemoteDescription(answer)
    客户端A->>客户端A: 派生共享密钥 (使用私钥 A + 公钥 B)

    Note over 客户端 A, 客户端 B: 两个客户端现在都有用于 E2EE 的共享密钥。

    loop ICE 候选者交换
        客户端A->>信令服务器: 发送 ICE 候选者
        信令服务器->>客户端B: 转发 ICE 候选者
        客户端B->>信令服务器: 发送 ICE 候选者
        信令服务器->>客户端A: 转发 ICE 候选者
    end

    Note over 客户端 A, 客户端 B: 直接 P2P 连接已建立
```

---

## 3. 加密消息流程图

此图显示了在一个用户向另一个用户发送加密消息时所涉及的步骤（在连接建立后）。

```mermaid
flowchart TD
    subgraph 发送方
        direction LR
        S1[开始: 用户发送消息] --> S2{消息是否为空?};
        S2 -- 否 --> S3[生成随机 12 字节 IV];
        S3 --> S4[使用共享密钥 + IV 加密消息];
        S4 --> S5[将 IV 附加到加密数据前];
        S5 --> S6[通过数据通道发送组合数据];
        S6 --> S7[结束];
        S2 -- 是 --> S7;
    end

    subgraph 接收方
        direction LR
        R1[开始: 收到数据] --> R2[从数据开头提取 12 字节 IV];
        R2 --> R3[提取剩余的加密消息];
        R3 --> R4{使用共享密钥 + IV 解密消息};
        R4 -- 成功 --> R5[解码并显示消息];
        R4 -- 失败 --> R6[记录解密错误];
        R5 --> R7[结束];
        R6 --> R7;
    end

    发送方 -- "RTCDataChannel" --> 接收方;
```