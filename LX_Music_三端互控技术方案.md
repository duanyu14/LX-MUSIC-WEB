# LX Music 三端互控技术方案

> 基于 lx-music-mobile、lx-music-desktop、LX-MUSIC-WEB 三个项目的二次开发方案，实现移动端、桌面端、网页端之间的互相播放控制。

---

## 目录

- [一、项目现状分析](#一项目现状分析)
  - [1.1 技术栈对比](#11-技术栈对比)
  - [1.2 已有通信能力](#12-已有通信能力)
  - [1.3 改动量评估](#13-改动量评估)
- [二、架构设计](#二架构设计)
  - [2.1 整体架构](#21-整体架构)
  - [2.2 通信协议选型](#22-通信协议选型)
  - [2.3 设备发现机制](#23-设备发现机制)
- [三、统一控制协议定义](#三统一控制协议定义)
  - [3.1 数据结构](#31-数据结构)
  - [3.2 RemoteControlAPI 接口](#32-remotecontrolapi-接口)
- [四、各端适配实现方案](#四各端适配实现方案)
  - [4.1 桌面端](#41-桌面端改动最小)
  - [4.2 网页端](#42-网页端改动中等)
  - [4.3 移动端](#43-移动端改动最大)
- [五、实现路线图](#五实现路线图)
  - [Phase 1: 基础协议 + 桌面端 (2-3周)](#phase-1-基础协议--桌面端-2-3周)
  - [Phase 2: 网页端适配 (2-3周)](#phase-2-网页端适配-2-3周)
  - [Phase 3: 移动端适配 (2-3周)](#phase-3-移动端适配-2-3周)
- [六、技术难点与解决方案](#六技术难点与解决方案)
- [七、推荐依赖清单](#七推荐依赖清单)

---

## 一、项目现状分析

### 1.1 技术栈对比

| 维度 | 移动端 (lx-music-mobile) | 桌面端 (lx-music-desktop) | 网页端 (LX-MUSIC-WEB) |
|------|--------------------------|--------------------------|----------------------|
| **框架** | React Native 0.73.11 | Electron 40 + Vue 3 | Node.js + Vanilla JS |
| **编程语言** | TypeScript 71.3% / JS 23% | TypeScript / JS / Vue SFC | TypeScript + JavaScript |
| **播放引擎** | react-native-track-player (fork) | Web Audio API / HTML5 Audio | HTMLAudioElement + Web Audio |
| **状态管理** | Redux | Vue 3 响应式 + Store | 前端全局变量 / Redux(桌面端) |
| **目标平台** | Android 5+ | Windows / macOS / Linux | Web + Electron 桌面端 |

### 1.2 已有通信能力

| 能力 | 移动端 | 桌面端 | 网页端 |
|------|--------|--------|--------|
| **WebSocket 客户端** | 有 (仅列表同步) | 有 (Sync Server) | 有 (message2call RPC) |
| **HTTP 服务** | 无 (仅请求封装) | **有 (OpenAPI, port 23330)** | 有 (REST API) |
| **SSE 推送** | 无 | **有 (播放器状态订阅)** | 有 (同步状态/解析进度) |
| **IPC 通信** | 无 (使用插件系统) | 有 (完整 IPC 通道体系) | 有 (ipcNames 定义) |
| **远程播放控制** | 无 | **已有完整 HTTP API** | 无 |
| **设备发现** | 无 (手动输入地址) | 无 | 无 |
| **数据同步** | 列表同步 (WebSocket) | 列表同步 (WebSocket Server) | 列表同步 (WebSocket + HTTP) |

**关键发现**：桌面端 `src/main/modules/openApi/` 已经是一个完整的本地 HTTP 服务器，支持以下操作：
- `GET /play` — 播放
- `GET /pause` — 暂停
- `GET /skip-next` — 下一曲
- `GET /skip-prev` — 上一曲
- `GET /seek?offset=30` — 跳转进度
- `GET /volume?v=80` — 调整音量
- `GET /mute` — 静音切换
- `GET /status` — 获取播放器状态
- `GET /subscribe-player-status` (SSE) — 实时订阅播放器状态

### 1.3 改动量评估

```
桌面端  ██░░░░░░░░  小 (已有 OpenAPI + SSE 基础设施)
网页端  ████░░░░░░  中 (需新增 WebSocket 控制层)
移动端  ██████░░░░  大 (RN 无法直接运行 WebSocket Server)
```

---

## 二、架构设计

### 2.1 整体架构

采用 **"中心发现 + P2P 直连"** 的混合架构：

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   移动端       │         │   桌面端       │         │   网页端       │
│  React Native │         │   Electron    │         │   Node.js     │
│              │         │              │         │              │
│  WS Client   │◄───────►│  WS Server   │◄───────►│  WS Server   │
│  控制面板 UI  │         │  控制面板 UI  │         │  控制面板 UI  │
│  播放器引擎   │         │  播放器引擎   │         │  播放器引擎   │
└──────┬───────┘         └──────┬───────┘         └──────┬───────┘
       │                        │                        │
       └────────────────────────┼────────────────────────┘
                                │
                        ┌───────▼───────┐
                        │  mDNS 发现层   │
                        │  (局域网设备发现) │
                        │  _lxmusic-     │
                        │  remote._tcp   │
                        └───────────────┘
```

**核心原则**：
1. 每个客户端同时是**控制者**和**被控者**
2. 控制者连接被控者的 WebSocket 服务
3. 通过 `message2call` 双向 RPC 实现方法调用
4. 通过 mDNS 实现局域网自动发现

### 2.2 通信协议选型

| 候选方案 | 优点 | 缺点 | 决策 |
|----------|------|------|------|
| **WebSocket + message2call** | 三个项目均已使用；双向 RPC；低延迟 | 无内置重连 | **选定** |
| HTTP 轮询 | 实现简单 | 高延迟；浪费带宽 | 不采用 |
| WebRTC DataChannel | 真正 P2P；低延迟 | 实现复杂；需要 STUN/TURN | 备选(广域网) |
| MQTT | 轻量级；支持 QoS | 需要额外 Broker | 备选(大规模) |

选择 **WebSocket + message2call** 的理由：
- 三个项目都已依赖 `ws` 和 `message2call`，**零新增依赖成本**
- `message2call` 提供双向 RPC 能力，调用远程方法如同调用本地函数
- WebSocket 天然支持双向通信，适合播放控制的实时性要求

### 2.3 设备发现机制

使用 **mDNS (Bonjour/Avahi)** 实现局域网设备自动发现：

```
服务类型:  _lxmusic-remote._tcp.local.
默认端口:  23331
TXT 记录:  type=desktop/mobile/web, version=x.x.x, id=device-uuid
```

发现流程：
1. 每个设备启动时，通过 mDNS 广播自己的信息（设备名、类型、地址、端口）
2. 同时监听同类型服务，发现其他 LX Music 设备
3. 用户在设备列表中选择目标设备并连接
4. 可选：PIN 码配对认证

---

## 三、统一控制协议定义

### 3.1 数据结构

#### DeviceInfo — 设备信息

```typescript
interface DeviceInfo {
  id: string;           // UUID 格式唯一标识
  name: string;         // 设备显示名称 (如 "我的手机")
  type: 'mobile' | 'desktop' | 'web';
  version: string;      // 应用版本号
  address: string;      // ws://192.168.1.100:23331
}
```

#### PlayerState — 播放器状态

```typescript
interface PlayerState {
  playing: boolean;
  currentSong: {
    name: string;
    singer: string;
    album?: string;
    duration: number;    // 秒
    songId: string;
    source: string;      // kw/kg/mg/tx/wy
  } | null;
  playMode: 'sequential' | 'loop_single' | 'loop_list' | 'shuffle';
  volume: number;        // 0-100
  muted: boolean;
  position: number;      // 当前播放位置 (秒)
  duration: number;      // 当前歌曲总时长 (秒)
}
```

#### SongInfo — 歌曲信息

```typescript
interface SongInfo {
  name: string;
  singer: string;
  album?: string;
  duration: number;
  songId: string;
  source: string;        // 音源平台标识
  interval?: any;        // 其他扩展信息
}
```

### 3.2 RemoteControlAPI 接口

通过 `message2call` 在 WebSocket 连接上暴露的远程控制接口：

```typescript
interface RemoteControlAPI {
  // ===== 状态查询 =====
  getPlayerState(): Promise<PlayerState>;
  getPlayList(): Promise<SongInfo[]>;

  // ===== 播放控制 =====
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
  playNext(): Promise<void>;
  playPrev(): Promise<void>;

  // ===== 进度与音量 =====
  seek(position: number): Promise<void>;       // 跳转到指定位置(秒)
  seekByOffset(offset: number): Promise<void>; // 按偏移量跳转(秒)
  setVolume(volume: number): Promise<void>;    // 设置音量(0-100)
  toggleMute(): Promise<void>;                  // 静音切换

  // ===== 播放模式 =====
  setPlayMode(mode: PlayMode): Promise<void>;

  // ===== 列表操作 =====
  playSong(songInfo: SongInfo, listId: string): Promise<void>;
  addToQueue(songInfo: SongInfo): Promise<void>;
  clearQueue(): Promise<void>;

  // ===== 收藏操作 =====
  collectCurrentSong(): Promise<void>;
  uncollectCurrentSong(): Promise<void>;

  // ===== 状态回调 (被动推送) =====
  onPlayerStateChange(callback: (state: PlayerState) => void): void;
  onPlayListChange(callback: (songs: SongInfo[]) => void): void;
}
```

---

## 四、各端适配实现方案

### 4.1 桌面端 (改动最小)

桌面端已有最完善的基础设施（OpenAPI + SSE + Sync Server），改动量最小。

#### 4.1.1 新增 WebSocket 控制服务

在 `src/main/modules/` 下新增 `remoteControl/` 模块：

```typescript
// src/main/modules/remoteControl/server.ts
import { WebSocketServer } from 'ws';
import { message2call } from 'message2call';
import { mainSend, mainHandle } from '@common/mainIpc';

const REMOTE_CONTROL_PORT = 23331;

export class RemoteControlServer {
  private wss: WebSocketServer;

  start() {
    this.wss = new WebSocketServer({ port: REMOTE_CONTROL_PORT });

    this.wss.on('connection', (ws, req) => {
      const deviceInfo = this.authenticateClient(req);

      const remoteApi = {
        getPlayerState: () => mainHandle('player_status'),
        play: () => mainSend('player_play'),
        pause: () => mainSend('player_pause'),
        togglePlay: () => mainSend('player_toggle_play'),
        playNext: () => mainSend('player_play_next'),
        playPrev: () => mainSend('player_play_prev'),
        seek: (position: number) => mainSend('player_seek', position),
        seekByOffset: (offset: number) => mainSend('player_seek_offset', offset),
        setVolume: (volume: number) => mainSend('player_set_volume', volume),
        toggleMute: () => mainSend('player_toggle_mute'),
        setPlayMode: (mode: string) => mainSend('player_set_play_mode', mode),
        playSong: (song, listId) => mainSend('player_play_song', { song, listId }),
        addToQueue: (song) => mainSend('player_add_to_queue', song),
        clearQueue: () => mainSend('player_clear_queue'),
        collectCurrentSong: () => mainSend('player_collect'),
        uncollectCurrentSong: () => mainSend('player_uncollect'),
      };

      // 通过 message2call 建立 RPC 通道
      const { callObj, remote } = message2call({
        sendMessage: (msg) => ws.send(JSON.stringify(msg)),
        onMessage: (handler) =>
          ws.on('message', (data) => handler(JSON.parse(data.toString()))),
        callObj: remoteApi,
      });

      // remote 对象 = 对方设备暴露的控制接口
      // callObj = 本设备暴露给对方调用的接口

      ws.on('close', () => { /* 清理资源 */ });
    });
  }
}
```

#### 4.1.2 mDNS 设备广播

```typescript
// src/main/modules/remoteControl/discovery.ts
import Bonjour from 'bonjour-service';

const bonjour = Bonjour();

export function startDiscovery(deviceId: string, deviceName: string) {
  bonjour.publish({
    name: deviceName,
    type: 'lxmusic-remote',     // _lxmusic-remote._tcp.local.
    port: 23331,
    txt: { type: 'desktop', version: 'x.x.x', id: deviceId },
  });

  bonjour.find({ type: 'lxmusic-remote' }, (service) => {
    console.log('Found device:', service.name);
    // 通知 UI 层更新设备列表
  });
}
```

#### 4.1.3 远程控制 UI (Vue 3)

在 `src/renderer/components/` 新增 `RemoteControl/` 目录，包含：
- `DeviceList.vue` — 已发现设备列表
- `RemotePlayer.vue` — 远程播放器迷你面板 (播放/暂停/切歌/进度/音量)
- `index.vue` — 组合入口

#### 4.1.4 桌面端改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/modules/remoteControl/server.ts` | 新增 | WebSocket 控制服务 |
| `src/main/modules/remoteControl/discovery.ts` | 新增 | mDNS 设备发现与广播 |
| `src/main/modules/remoteControl/index.ts` | 新增 | 模块入口 |
| `src/main/modules/index.ts` | 修改 | 注册 remoteControl 模块 |
| `src/common/ipcNames.ts` | 修改 | 新增远程控制相关 IPC 通道名 |
| `src/renderer/components/RemoteControl/` | 新增 | 远程控制 UI 组件目录 |

---

### 4.2 网页端 (改动中等)

网页端是 Node.js 服务，已有 WebSocket + HTTP + SSE 基础设施。

#### 4.2.1 扩展 WebSocket 控制服务

在 `src/server/` 下新增远程控制模块：

```typescript
// src/server/remoteControl.ts
export function setupRemoteControl(wss) {
  wss.on('connection', (ws, req) => {
    // 设备认证
    const deviceInfo = authenticate(req);

    // 暴露给远程调用的控制接口
    const remoteApi = {
      play: () => broadcastToFrontend({ action: 'play' }),
      pause: () => broadcastToFrontend({ action: 'pause' }),
      togglePlay: () => broadcastToFrontend({ action: 'toggle_play' }),
      seek: (pos) => broadcastToFrontend({ action: 'seek', position: pos }),
      setVolume: (vol) => broadcastToFrontend({ action: 'volume', volume: vol }),
      // ... 其他方法
    };

    const { callObj, remote } = message2call({
      sendMessage: (msg) => ws.send(JSON.stringify(msg)),
      onMessage: (h) => ws.on('message', (d) => h(JSON.parse(d))),
      callObj: remoteApi,
    });
  });
}
```

#### 4.2.2 前端播放器适配

在 `public/music/js/` 新增远程控制接收模块：

```javascript
// public/music/js/remote_control_receiver.js
(function() {
  const socket = new WebSocket(`ws://${location.host}/api/remote/ws`);

  socket.onmessage = (event) => {
    const cmd = JSON.parse(event.data);
    switch (cmd.action) {
      case 'play': audio.play(); break;
      case 'pause': audio.pause(); break;
      case 'toggle_play': audio.paused ? audio.play() : audio.pause(); break;
      case 'seek': audio.currentTime = cmd.position; break;
      case 'volume': audio.volume = cmd.volume / 100; break;
      case 'next': playNext(); break;
      case 'prev': playPrev(); break;
    }
  };

  // 将本地播放状态上报给服务端
  function reportState() {
    socket.send(JSON.stringify({
      type: 'state_update',
      state: {
        playing: !audio.paused,
        position: audio.currentTime,
        volume: Math.round(audio.volume * 100),
        duration: audio.duration,
        // ...
      }
    }));
  }

  setInterval(reportState, 1000);
  audio.addEventListener('play', reportState);
  audio.addEventListener('pause', reportState);
  audio.addEventListener('seeked', reportState);
})();
```

#### 4.2.3 网页端改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/server/remoteControl.ts` | 新增 | WebSocket 远程控制服务 |
| `src/server/server.ts` | 修改 | 注册远程控制 WebSocket 处理 |
| `public/music/js/remote_control_receiver.js` | 新增 | 前端远程控制接收模块 |
| `public/music/js/remote_control_panel.js` | 新增 | 远程控制 UI 面板 (Vanilla JS) |
| `public/music/remote-control.html` | 新增 | 远程控制面板页面 (可选) |

---

### 4.3 移动端 (改动最大)

移动端使用 React Native，**无法直接运行 WebSocket Server**，需要特殊处理。

#### 4.3.1 控制端实现 (作为遥控器)

移动端作为控制端连接其他设备，这部分实现简单：

```typescript
// src/plugins/remoteControl/client.ts
import { message2call } from 'message2call';

export async function connectToDevice(address: string): Promise<RemoteControlAPI> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(address);

    ws.onopen = () => {
      const { callObj } = message2call({
        sendMessage: (msg) => ws.send(JSON.stringify(msg)),
        onMessage: (handler) =>
          ws.on('message', (e) => handler(JSON.parse(e.data))),
      });

      // callObj 就是远程设备的 RemoteControlAPI
      resolve(callObj);
    };

    ws.onerror = reject;
  });
}
```

#### 4.3.2 被控端实现 (中继方案 — 推荐)

由于 React Native 无法运行 WebSocket Server，采用**中继模式**：

```
其他设备 ──► 桌面端/网页端 (中继) ◄── 移动端
  控制指令      转发控制指令         注册控制接口
```

```typescript
// src/plugins/remoteControl/relay.ts
export class MobileRelayClient {
  private remoteApi: RemoteControlAPI;

  constructor() {
    // 将本机播放器方法包装为 RemoteControlAPI
    // 注册到中继设备 (桌面端/网页端)
    this.remoteApi = {
      play: () => playerPlugin.setPlay(),
      pause: () => playerPlugin.setPause(),
      togglePlay: () => {
        const state = store.getState().player;
        state.playing ? playerPlugin.setPause() : playerPlugin.setPlay();
      },
      seek: (pos) => playerPlugin.setCurrentTime(pos),
      setVolume: (vol) => playerPlugin.volume(vol),
      toggleMute: () => { /* ... */ },
      playNext: () => { /* ... */ },
      playPrev: () => { /* ... */ },
      getPlayerState: () => {
        const state = store.getState().player;
        return { /* 映射为 PlayerState */ };
      },
      // ... 其他方法
    };
  }

  // 连接中继设备并注册本机控制接口
  async registerWithRelay(relayAddress: string) {
    const ws = new WebSocket(relayAddress);
    const { callObj } = message2call({
      sendMessage: (msg) => ws.send(JSON.stringify(msg)),
      onMessage: (h) => ws.on('message', (e) => h(JSON.parse(e.data))),
      callObj: this.remoteApi,  // 暴露本机接口给中继
    });
  }
}
```

#### 4.3.3 设备发现

```typescript
// src/plugins/remoteControl/discovery.ts
import Zeroconf from 'react-native-zeroconf';

const zeroconf = new Zeroconf();

export function startDiscovery(onDeviceFound: (device: DeviceInfo) => void) {
  zeroconf.scan('lxmusic-remote', 'tcp', 'local.');

  zeroconf.on('found', (service) => {
    onDeviceFound({
      id: service.txt.id,
      name: service.name,
      type: service.txt.type,
      address: `ws://${service.addresses[0]}:${service.port}`,
    });
  });
}
```

#### 4.3.4 移动端改动文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/plugins/remoteControl/client.ts` | 新增 | 远程控制客户端 |
| `src/plugins/remoteControl/relay.ts` | 新增 | 中继模式被控端 |
| `src/plugins/remoteControl/discovery.ts` | 新增 | mDNS 设备发现 |
| `src/plugins/remoteControl/api.ts` | 新增 | 播放器接口桥接 |
| `src/screens/RemoteControlScreen.tsx` | 新增 | 远程控制页面 |
| `src/navigation/` | 修改 | 注册新页面路由 |
| `src/store/remoteControl/` | 新增 | 远程控制状态管理 |

---

## 五、实现路线图

### Phase 1: 基础协议 + 桌面端 (2-3周)

| 编号 | 任务 | 具体内容 | 工期 | 优先级 |
|------|------|---------|------|--------|
| 1.1 | 创建协议包 | 新建 `lx-music-remote-protocol` npm 包，定义 RemoteControlAPI、DeviceInfo、PlayerState 类型 | 3天 | P0 |
| 1.2 | 桌面端 WS 控制服务 | 新增 `src/main/modules/remoteControl/`，WebSocket Server (port 23331) + message2call | 3天 | P0 |
| 1.3 | 桌面端 mDNS 广播 | bonjour-service 广播设备信息 | 2天 | P1 |
| 1.4 | 桌面端远程控制 UI | Vue 3 组件：设备列表 + 远程播放器面板 | 4天 | P0 |
| 1.5 | 桌面端状态推送 | 监听播放器状态变更 → WS 实时推送 | 2天 | P0 |
| 1.6 | 联调测试 | 两个桌面端实例互控测试 | 1天 | P0 |

**交付物**：可工作的桌面端互控 + 协议包

### Phase 2: 网页端适配 (2-3周)

| 编号 | 任务 | 具体内容 | 工期 | 优先级 |
|------|------|---------|------|--------|
| 2.1 | 网页端 WS 控制服务 | 扩展 WebSocket，新增远程控制协议 | 3天 | P0 |
| 2.2 | 前端播放器适配 | remote_control_receiver.js 接收远程指令 | 3天 | P0 |
| 2.3 | 状态上报机制 | 前端播放状态上报服务端 | 2天 | P1 |
| 2.4 | 网页端 mDNS | 服务端 bonjour-service 广播 | 1天 | P1 |
| 2.5 | 网页端控制 UI | Vanilla JS 侧边栏/浮动面板 | 3天 | P0 |
| 2.6 | 桌面↔网页联调 | 双向互控测试 | 2天 | P0 |

**交付物**：桌面端与网页端互通互控

### Phase 3: 移动端适配 (2-3周)

| 编号 | 任务 | 具体内容 | 工期 | 优先级 |
|------|------|---------|------|--------|
| 3.1 | 移动端控制客户端 | WebSocket 客户端 + message2call 调用远程 API | 3天 | P0 |
| 3.2 | 移动端 mDNS 发现 | react-native-zeroconf 扫描设备 | 2天 | P1 |
| 3.3 | 移动端被控 (中继) | 连接中继设备，暴露播放控制接口 | 4天 | P1 |
| 3.4 | 移动端控制 UI | 设备列表 + 远程播放器面板 | 4天 | P0 |
| 3.5 | 移动端播放器桥接 | 包装 player 插件为 RemoteControlAPI | 2天 | P0 |
| 3.6 | 三端联调测试 | 全链路互控测试 | 3天 | P0 |

**交付物**：三端完整互控能力

---

## 六、技术难点与解决方案

| 难点 | 难度 | 解决方案 | 备选方案 |
|------|------|---------|---------|
| **移动端无法运行 WebSocket Server** | 高 | 中继模式：移动端连接桌面端/网页端作为中继 | react-native-tcp 原生 TCP 服务 + 自定义协议 |
| **非同一局域网 (网络穿透)** | 中 | 可选部署 frp/ngrok 内网穿透服务 | WebRTC + STUN/TURN 真正 P2P 直连 |
| **设备认证与安全** | 中 | 复用桌面端 Sync 认证 (设备密钥 + AES 加密) | 6 位 PIN 码快速配对 |
| **播放器状态同步延迟** | 低 | WebSocket 天然低延迟 + 事件回调推送 | WebRTC DataChannel (极致低延迟) |
| **协议版本兼容性** | 中 | 语义化版本号 + 消息头版本字段 + 能力协商 | 接口废弃标记 + Graceful Degradation |
| **桌面端播放器在渲染进程** | 中 | 通过 IPC (mainSend/mainHandle) 转发到渲染进程 | 已有成熟机制，风险低 |
| **多设备同时控制冲突** | 中 | 最后操作者优先 + 操作锁 + 广播通知 | 令牌桶模式：持有令牌者可控制 |
| **断线重连与状态恢复** | 中 | 自动重连 + 重连后拉取最新状态快照 | 指数退避重连 + 本地状态缓存 |

---

## 七、推荐依赖清单

| 依赖名称 | 用途 | 适用端 | 说明 |
|----------|------|--------|------|
| `bonjour-service` | mDNS 局域网设备发现 | 桌面端 / 网页端 | Node.js 的 Bonjour/Avahi 实现 |
| `react-native-zeroconf` | React Native mDNS | 移动端 | 封装 iOS NSNetService / Android NsdManager |
| `ws` | WebSocket 服务端/客户端 | 桌面端 / 网页端 | 三个项目均已有此依赖 (^8.17.1) |
| `message2call` | 双向 RPC 框架 | 三端共用 | 三个项目均已使用 (^0.1.3) |
| `crypto-js` | AES 加密通信 | 三端共用 | 桌面端和网页端已有，移动端需安装 |
| `react-native-tcp` | 原生 TCP 服务 (可选) | 移动端 | 移动端被控备选方案，复杂度高 |
| `frp` / `ngrok` | 内网穿透 (可选) | 部署端 | 支持广域网远程控制，非 Phase 1-3 必须 |

---

> **总结**：核心思路是复用三个项目已有的 `message2call` + WebSocket 通信模式，扩展为播放控制级别的远程操控协议。桌面端改动最小（已有 OpenAPI 基础），网页端中等（需新增 WebSocket 控制层），移动端最大（RN 无法直接做 WebSocket Server，需中继方案）。通过 mDNS 实现局域网自动发现，三个 Phase 依次递进，每个 Phase 结束都有可交付的互控能力。
