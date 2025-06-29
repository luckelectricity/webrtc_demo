# WebRTC 数据通道双向通信问题修复文档

本文档旨在说明和解决 `webrtc_demo` 中数据通道（聊天和文件传输）存在的单向通信问题，并详细阐述了修复步骤。

## 问题一：接收方（Callee）无法向呼叫方（Caller）发送消息和文件

### 问题描述

在初始代码中，只有发起呼叫的客户端（Caller）能够向对方发送消息和文件，而接收方（Callee）虽然能接收，但无法发送。

### 原因分析

该问题源于数据通道的创建和设置方式。在 WebRTC 中，通常由一方（Caller）创建数据通道，另一方（Callee）通过 `ondatachannel` 事件监听并接收这个通道。

在本项目中：
*   **Caller** 通过 `createDataChannel` 创建了 `chatChannel` 和 `fileChannel`，并将其分别赋值给了全局变量 `sendChannel` 和 `fileSendChannel`。
*   **Callee** 在 `ondatachannel` 事件回调中，虽然接收到了 `channel` 对象，并设置了 `onmessage` 监听器，但**没有**将这个 `channel` 赋值给相应的全局发送变量（`sendChannel` 和 `fileSendChannel`）。

因此，当 Callee 尝试发送消息或文件时，由于 `sendChannel` 或 `fileSendChannel` 未定义，导致发送失败。

### 解决步骤

为了修复这个问题，我们需要在 Callee 接收到数据通道时，同时将其设置为自己的发送和接收通道。

1.  **修复文件发送**：
    在 `setupFileReceiveChannel` 函数中，将接收到的 `channel` 同时赋值给 `fileReceiveChannel` 和 `fileSendChannel`。

    ```javascript
    // 修复前
    function setupFileReceiveChannel(channel) {
        fileReceiveChannel = channel;
        fileReceiveChannel.binaryType = 'arraybuffer';
        fileReceiveChannel.onmessage = handleFileReceiveMessage;
        fileReceiveChannel.onopen = () => console.log('文件接收通道已打开');
        fileReceiveChannel.onclose = () => console.log('文件接收通道已关闭');
    }

    // 修复后
    function setupFileReceiveChannel(channel) {
        fileReceiveChannel = channel;
        fileSendChannel = channel; // 关键修复：确保 Callee 也能发送文件
        fileReceiveChannel.binaryType = 'arraybuffer';
        fileReceiveChannel.onmessage = handleFileReceiveMessage;
        fileReceiveChannel.onopen = () => {
            console.log('文件接收通道已打开');
            sendBtn.disabled = false; // 为 Callee 启用发送按钮
        };
        fileReceiveChannel.onclose = () => {
            console.log('文件接收通道已关闭');
            sendBtn.disabled = true; // 为 Callee 禁用发送按钮
        };
    }
    ```

2.  **修复消息发送**：
    在 `setupChatReceiveChannel` 函数中，将接收到的 `channel` 同时赋值给 `receiveChannel` 和 `sendChannel`。

    ```javascript
    // 修复前
    function setupChatReceiveChannel(channel) {
        receiveChannel = channel;
        receiveChannel.binaryType = 'arraybuffer';
        receiveChannel.onmessage = handleReceiveMessage;
        // ...
    }

    // 修复后
    function setupChatReceiveChannel(channel) {
        receiveChannel = channel;
        sendChannel = channel; // 关键修复：确保 Callee 也能发送消息
        receiveChannel.binaryType = 'arraybuffer';
        receiveChannel.onmessage = handleReceiveMessage;
        receiveChannel.onopen = () => {
            console.log('聊天接收通道已打开');
            sendMessageBtn.disabled = false; // 为 Callee 启用发送按钮
        };
        receiveChannel.onclose = () => {
            console.log('聊天接收通道已关闭');
            sendMessageBtn.disabled = true; // 为 Callee 禁用发送按钮
        };
    }
    ```

## 问题二：呼叫方（Caller）无法接收对方的消息和文件

### 问题描述

在修复了问题一之后，虽然 Callee 可以发送了，但 Caller 这边却无法接收到任何返回的消息或文件。

### 原因分析

这个问题与问题一相对。Caller 在创建数据通道时（`setupChatSendChannel` 和 `setupFileSendChannel` 函数），只设置了 `onopen` 和 `onclose` 事件，而**没有设置 `onmessage` 事件监听器**。

这意味着，当 Callee 发送数据过来时，Caller 的数据通道虽然是打开的，但没有相应的处理逻辑来接收和处理这些数据。

### 解决步骤

解决方案是在 Caller 创建数据通道时，为其添加 `onmessage` 事件处理函数。

1.  **修复聊天消息接收**：
    在 `setupChatSendChannel` 函数中，添加 `onmessage` 事件监听。

    ```javascript
    // 修复前
    function setupChatSendChannel() {
        sendChannel = peerConnection.createDataChannel('chatChannel');
        sendChannel.binaryType = 'arraybuffer';
        sendChannel.onopen = () => { /* ... */ };
        sendChannel.onclose = () => { /* ... */ };
    }

    // 修复后
    function setupChatSendChannel() {
        sendChannel = peerConnection.createDataChannel('chatChannel');
        sendChannel.binaryType = 'arraybuffer';
        sendChannel.onopen = () => { /* ... */ };
        sendChannel.onclose = () => { /* ... */ };
        sendChannel.onmessage = handleReceiveMessage; // 关键修复：让 Caller 也能接收消息
    }
    ```

2.  **修复文件接收**：
    在 `setupFileSendChannel` 函数中，添加 `onmessage` 事件监听。

    ```javascript
    // 修复前
    function setupFileSendChannel() {
        fileSendChannel = peerConnection.createDataChannel('fileChannel');
        fileSendChannel.binaryType = 'arraybuffer';
        fileSendChannel.onopen = () => { /* ... */ };
        fileSendChannel.onclose = () => { /* ... */ };
    }

    // 修复后
    function setupFileSendChannel() {
        fileSendChannel = peerConnection.createDataChannel('fileChannel');
        fileSendChannel.binaryType = 'arraybuffer';
        fileSendChannel.onopen = () => { /* ... */ };
        fileSendChannel.onclose = () => { /* ... */ };
        fileSendChannel.onmessage = handleFileReceiveMessage; // 关键修复：让 Caller 也能接收文件
    }
    ```

## 总结

通过以上两个步骤的修复，我们确保了无论是 Caller 还是 Callee，在数据通道建立后都：
1.  拥有可以发送数据的通道引用（`sendChannel` 和 `fileSendChannel`）。
2.  为通道设置了 `onmessage` 事件监听器来处理传入的数据。

这样，就实现了真正意义上的双向通信，解决了之前版本中存在的单向数据流问题。
