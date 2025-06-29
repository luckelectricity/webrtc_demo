const socket = io();
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startBtn = document.getElementById('startBtn');
const callBtn = document.getElementById('callBtn');
const hangupBtn = document.getElementById('hangupBtn');
const messages = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const secureStatus = document.getElementById('secure-status');
const setupStatus = document.getElementById('setup-status');
const shareTabBtn = document.getElementById('shareTabBtn');


let localStream; // 本地媒体流 (摄像头/屏幕分享)
let peerConnection; // RTCPeerConnection 实例
let sendChannel; // 发送数据通道 (用于聊天)
let receiveChannel; // 接收数据通道 (用于聊天)
let fileSendChannel; // 发送文件数据通道
let fileReceiveChannel; // 接收文件数据通道

// E2EE 变量
let myKeyPair; // 本地密钥对
let sharedSecret; // 共享密钥

// ICE 服务器配置 (STUN 服务器用于获取公网 IP)
const iceServers = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    }
  ]
};

// ============================================================================
// E2EE (端到端加密) 相关函数
// ============================================================================

/**
 * 生成 ECDH 密钥对。
 * @returns {Promise<CryptoKeyPair>} 生成的密钥对。
 */
async function generateKeys() {
    try {
        return await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" }, // 使用 ECDH 算法，P-256 曲线
            true, // 可导出
            ["deriveKey"] // 可用于派生密钥
        );
    } catch (e) {
        console.error(`密钥生成失败: ${e}`); // 打印到控制台
        alert(`密钥生成失败: ${e}`);
        return null;
    }
}

/**
 * 从我的私钥和对方的公钥派生共享密钥。
 * @param {CryptoKey} privateKey - 我的私钥。
 * @param {CryptoKey} publicKey - 对方的公钥。
 * @returns {Promise<CryptoKey>} 派生出的共享密钥。
 */
async function deriveSharedSecret(privateKey, publicKey) {
    try {
        return await window.crypto.subtle.deriveKey(
            { name: "ECDH", public: publicKey }, // 对方的公钥
            privateKey, // 我的私钥
            { name: "AES-GCM", length: 256 }, // 派生出 AES-GCM 256位密钥
            true, // 可导出
            ["encrypt", "decrypt"] // 可用于加解密
        );
    } catch (e) {
        console.error(`派生共享密钥失败: ${e}`); // 打印到控制台
        alert(`派生共享密钥失败: ${e}`);
        return null;
    }
}

/**
 * 使用共享密钥加密消息。
 * @param {string} message - 待加密的明文消息。
 * @returns {Promise<ArrayBuffer>} 加密后的数据 (包含 IV)。
 */
async function encryptMessage(message) {
    if (!sharedSecret) {
        alert("无法发送消息: 安全连接未建立。");
        return null;
    }
    try {
        console.log("--- 加密开始 ---");
        console.log("原始消息:", message);
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 初始化向量 (IV)，每次加密都不同
        console.log("IV:", iv);
        const encodedMessage = new TextEncoder().encode(message); // 将字符串编码为 Uint8Array

        const encryptedData = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv }, // 使用 AES-GCM 算法和 IV
            sharedSecret, // 共享密钥
            encodedMessage // 待加密数据
        );
        console.log("加密后的数据 (ArrayBuffer):", encryptedData);

        // 将 IV 和加密数据合并，以便一起发送
        const output = new Uint8Array(iv.length + encryptedData.byteLength);
        output.set(iv, 0);
        output.set(new Uint8Array(encryptedData), iv.length);
        console.log("要发送的完整数据 (IV + 加密数据):", output.buffer);
        console.log("--- 加密结束 ---");
        return output.buffer; // 返回 ArrayBuffer
    } catch (e) {
        console.error(`加密失败: ${e}`); // 打印到控制台
        alert(`加密失败: ${e}`);
        return null;
    }
}

/**
 * 使用共享密钥解密消息。
 * @param {ArrayBuffer} encryptedData - 待解密的加密数据 (包含 IV)。
 * @returns {Promise<string>} 解密后的明文消息。
 */
async function decryptMessage(encryptedData) {
    if (!sharedSecret) {
        console.error("无法解密消息: 共享密钥不可用。", encryptedData); // 打印原始数据
        return null;
    }
    try {
        console.log("--- 解密开始 ---");
        console.log("收到的完整加密数据 (ArrayBuffer):", encryptedData);
        const iv = new Uint8Array(encryptedData.slice(0, 12)); // 提取 IV
        console.log("提取的 IV:", iv);
        const data = new Uint8Array(encryptedData.slice(12)); // 提取加密数据
        console.log("提取的加密数据:", data);

        const decryptedData = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv }, // 使用 AES-GCM 算法和 IV
            sharedSecret, // 共享密钥
            data // 待解密数据
        );

        const decryptedMessage = new TextDecoder().decode(decryptedData);
        console.log("解密后的消息:", decryptedMessage);
        console.log("--- 解密结束 ---");
        return decryptedMessage; // 将解密后的数据解码为字符串
    } catch (e) {
        // 解密失败不弹窗，可能收到非加密的数据通道消息
        console.error(`解密失败: ${e}`);
        console.log("--- 解密结束 (失败) ---");
        return "DECRYPTION_FAILED"; // 返回特定标记
    }
}

// ============================================================================
// WebRTC 核心连接管理
// ============================================================================

/**
 * 创建并配置 RTCPeerConnection 实例。
 */
function createPeerConnection() {
  // 如果已存在连接，先关闭
  if (peerConnection) {
    peerConnection.close();
  }
  peerConnection = new RTCPeerConnection(iceServers); // 使用配置的 STUN/TURN 服务器

  // 监听 ICE Candidate 事件：当找到网络候选者时触发
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      // 通过信令服务器发送候选者给对方
      socket.emit('signal', event.candidate);
    }
  };

  // 监听远程轨道事件：当收到对方媒体流时触发
  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0]; // 在远程视频元素中显示
  };
  
  // 监听 PeerConnection 关闭事件
  peerConnection.onclose = () => {
    console.log("PeerConnection 已关闭。");
    peerConnection = null;
    remoteVideo.srcObject = null;
    sharedSecret = null; // 清除共享密钥
    updateSecureStatus(); // 更新安全状态显示
    initUIState(); // 重置 UI 状态
  };

  // 将当前的本地媒体流轨道添加到 PeerConnection 中
  if (localStream) {
      localStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, localStream);
      });
  }

  // 设置数据通道监听器 (用于接收对方创建的数据通道)
  peerConnection.ondatachannel = event => {
    const channel = event.channel;
    console.log(`收到数据通道: ${channel.label}`);
    if (channel.label === 'chatChannel') {
        setupChatReceiveChannel(channel);
    } else if (channel.label === 'fileChannel') {
        setupFileReceiveChannel(channel);
    }
  };
}

// ============================================================================
// 媒体流处理 (摄像头/屏幕分享)
// ============================================================================

/**
 * 停止当前的本地媒体流。
 */
function stopLocalStream() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
        localVideo.srcObject = null;
    }
}

/**
 * 获取摄像头和麦克风流。
 */
async function startCamera() {
  console.log("startCamera function called");
  try {
    stopLocalStream(); // 停止现有流
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream; // 在本地视频元素中显示
    callBtn.disabled = false; // 启用呼叫按钮
    hangupBtn.disabled = false; // 启用挂断按钮
    // 监听视频轨道结束事件 (例如用户关闭摄像头)
    localStream.getVideoTracks()[0].onended = () => {
        console.log("摄像头轨道已结束。");
        initUIState(); // 摄像头关闭后重置UI
    };
  } catch (error) {
    alert(`访问媒体设备错误: ${error.name}`);
  }
}

/**
 * 获取屏幕/标签页分享流。
 */
async function startScreenShare() {
    console.log("startScreenShare function called");
    try {
        stopLocalStream(); // 停止现有流
        // 请求屏幕/标签页分享
        localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        localVideo.srcObject = localStream; // 在本地视频元素中显示
        callBtn.disabled = false; // 启用呼叫按钮
        hangupBtn.disabled = false; // 启用挂断按钮

        // 如果 PeerConnection 已经存在，替换视频轨道
        if (peerConnection) {
            // 找到发送视频的 RTCRtpSender
            const videoSender = peerConnection.getSenders().find(sender => sender.track && sender.track.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(localStream.getVideoTracks()[0]); // 替换轨道
                console.log("已将视频轨道替换为屏幕分享。");
            } else {
                // 如果还没有视频发送器，则添加轨道
                localStream.getTracks().forEach(track => {
                    peerConnection.addTrack(track, localStream);
                });
                console.log("已添加屏幕分享轨道。");
            }
        }

        // 监听屏幕分享结束事件 (例如用户点击浏览器中的停止分享按钮)
        localStream.getVideoTracks()[0].onended = () => {
            console.log("屏幕分享已结束。");
            initUIState(); // 屏幕分享关闭后重置UI
        };

    } catch (error) {
        alert(`分享屏幕错误: ${error.name}`);
    }
}

// ============================================================================
// 数据通道处理 (聊天和文件传输)
// ============================================================================

/**
 * 设置聊天发送数据通道。
 */
function setupChatSendChannel() {
    sendChannel = peerConnection.createDataChannel('chatChannel');
    sendChannel.binaryType = 'arraybuffer'; // 设置为 arraybuffer 以便传输二进制数据 (加密消息)
    sendChannel.onopen = () => {
        console.log('聊天发送通道已打开');
        sendMessageBtn.disabled = false; // 启用发送消息按钮
    };
    sendChannel.onclose = () => {
        console.log('聊天发送通道已关闭');
        sendMessageBtn.disabled = true; // 禁用发送消息按钮
    };
}

/**
 * 设置聊天接收数据通道。
 * @param {RTCDataChannel} channel - 接收到的数据通道。
 */
function setupChatReceiveChannel(channel) {
    receiveChannel = channel;
    sendChannel = channel; // Use the same channel for sending and receiving
    receiveChannel.binaryType = 'arraybuffer'; // 设置为 arraybuffer
    receiveChannel.onmessage = handleReceiveMessage; // 监听接收消息事件
    receiveChannel.onopen = () => {
        console.log('聊天接收通道已打开');
        sendMessageBtn.disabled = false; // Enable send button for the callee
    };
    receiveChannel.onclose = () => {
        console.log('聊天接收通道已关闭');
        sendMessageBtn.disabled = true; // Disable send button for the callee
    };
}

/**
 * 处理接收到的聊天消息。
 * @param {MessageEvent} event - 消息事件。
 */
async function handleReceiveMessage(event) {
    const decryptedMessage = await decryptMessage(event.data);
    if (decryptedMessage && decryptedMessage !== "DECRYPTION_FAILED") {
        displayMessage(`对方: ${decryptedMessage}`); // 在界面上显示解密后的消息
    }
}

/**
 * 设置文件发送数据通道。
 */
function setupFileSendChannel() {
    fileSendChannel = peerConnection.createDataChannel('fileChannel');
    fileSendChannel.binaryType = 'arraybuffer';
    fileSendChannel.onopen = () => {
        console.log('文件发送通道已打开');
        sendBtn.disabled = false; // 启用发送文件按钮
    };
    fileSendChannel.onclose = () => {
        console.log('文件发送通道已关闭');
        sendBtn.disabled = true; // 禁用发送文件按钮
    };
    // 这里可以添加文件发送的进度处理等
}

/**
 * 设置文件接收数据通道。
 * @param {RTCDataChannel} channel - 接收到的数据通道。
 */
function setupFileReceiveChannel(channel) {
    fileReceiveChannel = channel;
    fileReceiveChannel.binaryType = 'arraybuffer';
    fileReceiveChannel.onmessage = handleFileReceiveMessage;
    fileReceiveChannel.onopen = () => console.log('文件接收通道已打开');
    fileReceiveChannel.onclose = () => console.log('文件接收通道已关闭');
    // 这里可以添加文件接收的进度处理等
}

/**
 * 处理接收到的文件数据。
 * (此处为简化实现，仅处理 ArrayBuffer，实际文件传输需更复杂的分块和重组逻辑)
 */
const receivedFileChunks = [];
let receivedFileName = '';
let receivedFileSize = 0;
let receivedBytes = 0;

function handleFileReceiveMessage(event) {
    // 假设第一条消息是文件元数据 (文件名和大小)
    if (typeof event.data === 'string' && event.data.startsWith('FILE_METADATA:')) {
        const metadata = JSON.parse(event.data.substring('FILE_METADATA:'.length));
        receivedFileName = metadata.name;
        receivedFileSize = metadata.size;
        receivedBytes = 0;
        receivedFileChunks.length = 0; // 清空数组
        fileProgress.innerText = `接收文件: ${receivedFileName} (${receivedFileSize} bytes)`;
    } else if (event.data instanceof ArrayBuffer) {
        receivedFileChunks.push(event.data);
        receivedBytes += event.data.byteLength;
        fileProgress.innerText = `接收文件: ${receivedFileName} - ${receivedBytes}/${receivedFileSize} bytes`;

        if (receivedBytes >= receivedFileSize) {
            const blob = new Blob(receivedFileChunks);
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = receivedFileName || 'received_file';
            a.innerText = `下载文件: ${receivedFileName}`;
            fileProgress.appendChild(a);
            console.log('文件接收完成。');
            receivedFileChunks.length = 0; // 清空
        }
    }
}

// ============================================================================
// UI 交互逻辑
// ============================================================================

/**
 * 初始化 UI 状态，禁用所有操作按钮，并显示初始化信息。
 */
function initUIState() {
    startBtn.disabled = true;
    shareTabBtn.disabled = true;
    callBtn.disabled = true;
    hangupBtn.disabled = true;
    sendMessageBtn.disabled = true;
    sendBtn.disabled = true;
    setupStatus.textContent = '正在初始化...';
    setupStatus.style.color = 'blue';
    secureStatus.textContent = '连接不安全';
    secureStatus.style.color = 'red';
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    messages.innerHTML = ''; // 清空聊天记录
    fileProgress.innerHTML = ''; // 清空文件进度
}

// 页面加载时执行
window.onload = async () => {
    console.log("window.onload event fired");
    initUIState(); // 初始化 UI 状态
    setupStatus.textContent = '正在生成加密密钥...';
    myKeyPair = await generateKeys(); // 生成本地密钥对
    if (myKeyPair) {
        setupStatus.textContent = '初始化完成。请启动摄像头或分享屏幕。';
        startBtn.disabled = false; // 启用启动摄像头按钮
        shareTabBtn.disabled = false; // 启用分享标签页按钮
    } else {
        setupStatus.textContent = '严重错误: 无法生成密钥。请刷新页面。';
        setupStatus.style.color = 'red';
    }
};

startBtn.onclick = startCamera;

shareTabBtn.onclick = startScreenShare;

// 呼叫按钮点击事件
callBtn.onclick = async () => {
  createPeerConnection(); // 创建 RTCPeerConnection 实例
  setupChatSendChannel(); // 创建聊天数据通道
  setupFileSendChannel(); // 创建文件数据通道

  const offer = await peerConnection.createOffer(); // 创建 Offer SDP
  await peerConnection.setLocalDescription(offer); // 设置本地描述

  try {
    // 导出本地公钥，并随 Offer 一起发送给信令服务器
    const publicKey = await window.crypto.subtle.exportKey("jwk", myKeyPair.publicKey);
    socket.emit('signal', { type: offer.type, sdp: offer.sdp, publicKey: publicKey });
  } catch(e) {
      alert(`导出公钥失败: ${e}`);
  }
};

// 挂断按钮点击事件
hangupBtn.onclick = () => {
  if (peerConnection) {
    peerConnection.close(); // 关闭 PeerConnection
  }
  stopLocalStream(); // 停止本地媒体流
  initUIState(); // 重置 UI 状态
};

// 发送消息按钮点击事件
sendMessageBtn.onclick = async () => {
    const message = messageInput.value;
    // 检查消息是否为空，数据通道是否打开
    if (message === '' || !sendChannel || sendChannel.readyState !== 'open') {
        return;
    }

    const encryptedMessage = await encryptMessage(message);
    if (encryptedMessage) {
        sendChannel.send(encryptedMessage);
        displayMessage(`我: ${message}`); // 在本地显示消息
        messageInput.value = ''; // 清空输入框
    }
};

// 文件输入框和发送按钮
const fileInput = document.getElementById('fileInput');
const sendBtn = document.getElementById('sendBtn');
const fileProgress = document.getElementById('file-progress');

sendBtn.onclick = () => {
  const file = fileInput.files[0];
  if (!file || !fileSendChannel || fileSendChannel.readyState !== 'open') {
    console.log('未选择文件或文件通道未打开');
    return;
  }

  // 发送文件元数据
  fileSendChannel.send(JSON.stringify({
      type: 'FILE_METADATA',
      name: file.name,
      size: file.size
  }));

  const chunkSize = 16384; // 16KB
  let offset = 0;

  const fileReader = new FileReader();
  fileReader.onerror = error => console.error('文件读取错误:', error);
  fileReader.onabort = event => console.log('文件读取中止:', event);
  fileReader.onload = e => {
    fileSendChannel.send(e.target.result);
    offset += e.target.result.byteLength;
    fileProgress.innerText = `发送文件: ${file.name} - ${offset}/${file.size} bytes`;
    if (offset < file.size) {
      readSlice(offset);
    }
  };

  const readSlice = o => {
    const slice = file.slice(o, o + chunkSize);
    fileReader.readAsArrayBuffer(slice);
  };
  readSlice(0);
};


/**
 * 在消息区域显示消息。
 * @param {string} message - 要显示的消息。
 */
function displayMessage(message) {
    const p = document.createElement('p');
    p.innerText = message;
    messages.appendChild(p);
    messages.scrollTop = messages.scrollHeight; // 滚动到底部
}

/**
 * 更新安全状态显示。
 */
function updateSecureStatus() {
    if (sharedSecret) {
        secureStatus.textContent = '连接已端到端加密';
        secureStatus.style.color = 'green';
    } else {
        secureStatus.textContent = '连接不安全';
        secureStatus.style.color = 'red';
    }
}

// ============================================================================
// 信令服务器通信
// ============================================================================

// 监听信令服务器消息
socket.on('signal', async (data) => {
  // 如果 PeerConnection 不存在，则创建 (通常是接收方第一次收到 Offer)
  if (!peerConnection) {
      createPeerConnection();
  }

  // 处理 Offer 消息
  if (data.type === 'offer') {
    try {
        // 导入对方的公钥，并派生共享密钥
        const remotePublicKey = await window.crypto.subtle.importKey("jwk", data.publicKey, { name: "ECDH", namedCurve: "P-256" }, true, []);
        sharedSecret = await deriveSharedSecret(myKeyPair.privateKey, remotePublicKey);
        updateSecureStatus(); // 更新安全状态
    } catch (e) {
        alert(`处理 Offer 公钥失败: ${e}`);
        return;
    }

    // 设置远程描述 (Offer)
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp }));
    const answer = await peerConnection.createAnswer(); // 创建 Answer SDP
    await peerConnection.setLocalDescription(answer); // 设置本地描述

    try {
        // 导出本地公钥，并随 Answer 一起发送给信令服务器
        const publicKey = await window.crypto.subtle.exportKey("jwk", myKeyPair.publicKey);
        socket.emit('signal', { type: answer.type, sdp: answer.sdp, publicKey: publicKey });
    } catch (e) {
        alert(`导出 Answer 公钥失败: ${e}`);
    }

  // 处理 Answer 消息
  } else if (data.type === 'answer') {
    try {
        // 导入对方的公钥，并派生共享密钥
        const remotePublicKey = await window.crypto.subtle.importKey("jwk", data.publicKey, { name: "ECDH", namedCurve: "P-256" }, true, []);
        sharedSecret = await deriveSharedSecret(myKeyPair.privateKey, remotePublicKey);
        updateSecureStatus(); // 更新安全状态
    } catch (e) {
        alert(`处理 Answer 公钥失败: ${e}`);
        return;
    }
    
    // 设置远程描述 (Answer)
    await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: data.type, sdp: data.sdp }));
  
  // 处理 ICE Candidate 消息
  } else if (data.candidate) {
    try {
        await peerConnection.addIceCandidate(data);
    } catch(e) {
        console.error("添加接收到的 ICE 候选者错误", e);
    }
  }
});