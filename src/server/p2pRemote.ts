import http from 'node:http'
import dgram from 'node:dgram'
import { WebSocketServer, WebSocket } from 'ws'
import { accessLog } from '@/utils/log4js'
import { getAddress } from '@/utils/tools'

const DEFAULT_PORT = 9528
const DISCOVERY_PORT = 23333
const DISCOVERY_INTERVAL = 3000

interface DeviceConnection {
  ws: WebSocket
  deviceInfo: LX.P2PRemote.DeviceInfo | null
  authed: boolean
  lastPong: number
}

const connections = new Map<string, DeviceConnection>()
const stateCache = new Map<string, { state: LX.P2PRemote.PlayerState; time: number }>()

let pairCode = ''
let serverPort = DEFAULT_PORT
let httpServer: http.Server
let wss: WebSocketServer
let bridgeWs: WebSocket | null = null

const HEARTBEAT_INTERVAL = 30000
const HEARTBEAT_TIMEOUT = 60000
let heartbeatTimer: NodeJS.Timeout | null = null

const generateConnId = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

const getLocalDeviceName = (): string => 'LX Music Web'

const getLocalIPs = (): string[] => getAddress()

const buildSelfInfo = (): LX.P2PRemote.DeviceInfo => ({
  deviceId: global.lx.p2pDeviceId ?? 'unknown',
  name: getLocalDeviceName(),
  deviceType: 'web',
  version: global.lx.version ?? '1.0.0',
  ip: getLocalIPs()[0] ?? '127.0.0.1',
  port: serverPort,
})

const sendJson = (ws: WebSocket, msg: LX.P2PRemote.Message) => {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)) } catch (err) {
      accessLog.warn('[P2PRemote] send error:', (err as Error).message)
    }
  }
}

const sendToBridge = (msg: LX.P2PRemote.Message) => {
  if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
    try { bridgeWs.send(JSON.stringify(msg)) } catch {}
  }
}

const handleDeviceConnection = (ws: WebSocket) => {
  const connId = generateConnId()
  const conn: DeviceConnection = { ws, deviceInfo: null, authed: false, lastPong: Date.now() }
  connections.set(connId, conn)

  ws.on('message', (raw) => {
    let msg: LX.P2PRemote.Message
    try {
      const data = Buffer.isBuffer(raw) ? raw.toString() : String(raw)
      msg = JSON.parse(data)
    } catch { return }

    switch (msg.type) {
      case 'hello': {
        conn.deviceInfo = msg.data
        if (pairCode) {
          sendJson(ws, { type: 'auth_required' })
          return
        }
        conn.authed = true
        sendJson(ws, { type: 'hello_ack', data: buildSelfInfo() })
        accessLog.info('[P2PRemote] Device connected:', conn.deviceInfo?.name, 'from', conn.deviceInfo?.ip)
        sendToBridge({ type: 'device_offline', data: { devices: getConnectedDevices() } })
        break
      }
      case 'auth': {
        if (msg.data?.code === pairCode) {
          conn.authed = true
          sendJson(ws, { type: 'auth_result', success: true })
          sendJson(ws, { type: 'hello_ack', data: buildSelfInfo() })
        } else {
          sendJson(ws, { type: 'auth_result', success: false })
          ws.close(4001, '配对码错误')
        }
        break
      }
      case 'command': {
        if (!conn.authed || !conn.deviceInfo) return
        sendToBridge({ type: 'command', id: msg.id, command: msg.command, params: msg.params, data: { fromDevice: conn.deviceInfo } })
        sendJson(ws, { type: 'command_result', id: msg.id, success: true })
        break
      }
      case 'get_state': {
        if (!conn.authed || !conn.deviceInfo) return
        sendToBridge({ type: 'get_state', id: msg.id, data: { fromDevice: conn.deviceInfo } })
        break
      }
      case 'search': {
        if (!conn.authed || !conn.deviceInfo) return
        sendToBridge({ type: 'search', id: msg.id, params: msg.params, data: { fromDevice: conn.deviceInfo } })
        break
      }
      case 'state_update': {
        if (conn.deviceInfo) {
          stateCache.set(conn.deviceInfo.deviceId, { state: msg.data, time: Date.now() })
          sendToBridge({ type: 'state_update', data: { state: msg.data, fromDevice: conn.deviceInfo } })
        }
        break
      }
      case 'state_response': {
        // 设备响应我们的 get_state 请求（被动连入场景）
        if (conn.deviceInfo) {
          sendToBridge({ type: 'state_response', id: msg.id, data: { state: msg.data, fromDevice: conn.deviceInfo } })
        }
        break
      }
      case 'search_result': {
        // 设备响应我们的 search 请求（被动连入场景）
        if (conn.deviceInfo) {
          sendToBridge({ type: 'search_result', id: msg.id, data: { result: msg.data, fromDevice: conn.deviceInfo } })
        }
        break
      }
      case 'ping':
        sendJson(ws, { type: 'pong' })
        break
      case 'pong':
        conn.lastPong = Date.now()
        break
    }
  })

  ws.on('close', () => {
    connections.delete(connId)
    if (conn.deviceInfo) {
      accessLog.info('[P2PRemote] Device disconnected:', conn.deviceInfo.name)
      stateCache.delete(conn.deviceInfo.deviceId)
      sendToBridge({ type: 'device_offline', data: { deviceId: conn.deviceInfo.deviceId, devices: getConnectedDevices() } })
    }
  })

  ws.on('error', (err) => {
    accessLog.warn('[P2PRemote] WS error:', err.message)
  })
}

const startHeartbeat = () => {
  if (heartbeatTimer) return
  heartbeatTimer = setInterval(() => {
    const now = Date.now()
    for (const [connId, conn] of connections.entries()) {
      if (conn.ws.readyState !== WebSocket.OPEN) continue
      if (now - conn.lastPong > HEARTBEAT_TIMEOUT) {
        try { conn.ws.close(4002, '心跳超时') } catch {}
        connections.delete(connId)
        if (conn.deviceInfo) {
          sendToBridge({ type: 'device_offline', data: { deviceId: conn.deviceInfo.deviceId, devices: getConnectedDevices() } })
        }
        continue
      }
      sendJson(conn.ws, { type: 'ping' })
    }
  }, HEARTBEAT_INTERVAL)
}

const stopHeartbeat = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

const handleBridgeConnection = (ws: WebSocket) => {
  bridgeWs = ws
  accessLog.info('[P2PRemote] Local bridge connected')

  ws.on('message', (raw) => {
    let msg: LX.P2PRemote.Message
    try {
      const data = Buffer.isBuffer(raw) ? raw.toString() : String(raw)
      msg = JSON.parse(data)
    } catch { return }

    switch (msg.type) {
      case 'state_update': {
        const data = JSON.stringify({ type: 'state_update', data: msg.data })
        for (const conn of connections.values()) {
          if (conn.authed && conn.ws.readyState === WebSocket.OPEN) {
            try { conn.ws.send(data) } catch {}
          }
        }
        break
      }
      case 'state_response': {
        const target = Array.from(connections.values()).find(c => c.deviceInfo?.deviceId === msg.data?.targetDeviceId)
        if (target) sendJson(target.ws, { type: 'state_response', id: msg.id, data: msg.data?.state })
        break
      }
      case 'search_result': {
        const target = Array.from(connections.values()).find(c => c.deviceInfo?.deviceId === msg.data?.targetDeviceId)
        if (target) sendJson(target.ws, { type: 'search_result', id: msg.id, data: msg.data?.result })
        break
      }
      case 'send_command_to': {
        // 浏览器请求向某个被动连入的设备发送命令
        const targetConnId = (msg as any).targetConnId
        const target = connections.get(targetConnId)
        if (target && target.authed && target.ws.readyState === WebSocket.OPEN) {
          sendJson(target.ws, { type: 'command', id: msg.id, command: (msg as any).command, params: (msg as any).params })
        }
        break
      }
      case 'send_search_to': {
        // 浏览器请求向某个被动连入的设备发送搜索请求
        const targetConnId = (msg as any).targetConnId
        const target = connections.get(targetConnId)
        if (target && target.authed && target.ws.readyState === WebSocket.OPEN) {
          sendJson(target.ws, { type: 'search', id: msg.id, params: (msg as any).params })
        }
        break
      }
      case 'send_get_state_to': {
        // 浏览器请求查询某个被动连入设备的状态
        const targetConnId = (msg as any).targetConnId
        const target = connections.get(targetConnId)
        if (target && target.authed && target.ws.readyState === WebSocket.OPEN) {
          sendJson(target.ws, { type: 'get_state', id: msg.id })
        }
        break
      }
      case 'disconnect_device': {
        // 浏览器请求断开某个被动连入的设备
        const targetConnId = (msg as any).targetConnId
        const target = connections.get(targetConnId)
        if (target) {
          try { target.ws.close() } catch {}
        }
        break
      }
      case 'get_devices': {
        sendJson(ws, { type: 'discovery_response', data: { devices: getConnectedDevices() } })
        break
      }
      case 'ping':
        sendJson(ws, { type: 'pong' })
        break
    }
  })

  ws.on('close', () => {
    bridgeWs = null
    accessLog.info('[P2PRemote] Local bridge disconnected')
  })

  ws.on('error', (err) => {
    accessLog.warn('[P2PRemote] Bridge WS error:', err.message)
  })
}

// === UDP 设备发现广播 ===
let broadcastSocket: dgram.Socket | null = null
let broadcastTimer: NodeJS.Timeout | null = null
const discoveredDevices = new Map<string, LX.P2PRemote.DeviceInfo & { lastSeen: number }>()

const startDiscovery = () => {
  if (broadcastSocket) return
  try {
    broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

    broadcastSocket.on('error', (err) => {
      accessLog.warn('[P2PRemote] UDP error:', err.message)
    })

    broadcastSocket.on('message', (msg, rinfo) => {
      try {
        const data = JSON.parse(msg.toString())
        if (data.action !== 'lx_music_discovery') return
        if (data.deviceId === global.lx.p2pDeviceId) return
        discoveredDevices.set(data.deviceId, { ...data, lastSeen: Date.now() })
        accessLog.info(`[P2PRemote] Discovered device: ${data.name} (${data.ip}:${data.port})`)
      } catch {}
    })

    broadcastSocket.bind(DISCOVERY_PORT, () => {
      broadcastSocket?.setBroadcast(true)
      broadcastSocket?.setMulticastLoopback(true)
      broadcastTimer = setInterval(broadcast, DISCOVERY_INTERVAL)
      broadcast()
      accessLog.info('[P2PRemote] UDP discovery started on port', DISCOVERY_PORT)
    })
  } catch (err) {
    accessLog.warn('[P2PRemote] UDP discovery failed to start:', (err as Error).message)
  }
}

const broadcast = () => {
  if (!broadcastSocket) return
  const msg = JSON.stringify({
    action: 'lx_music_discovery',
    ...buildSelfInfo(),
  })
  broadcastSocket.send(msg, 0, Buffer.byteLength(msg), DISCOVERY_PORT, '255.255.255.255', (err) => {
    if (err) accessLog.warn('[P2PRemote] broadcast error:', err.message)
  })
}

const stopDiscovery = () => {
  if (broadcastTimer) { clearInterval(broadcastTimer); broadcastTimer = null }
  if (broadcastSocket) {
    try { broadcastSocket.close() } catch {}
    broadcastSocket = null
  }
  discoveredDevices.clear()
}

const handleHttpRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url ?? '/'
  if (url === '/discovery' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      action: 'lx_music_discovery',
      ...buildSelfInfo(),
    }))
    return
  }

  if (url === '/discovered' && req.method === 'GET') {
    const now = Date.now()
    const devices = Array.from(discoveredDevices.values())
      .filter(d => now - d.lastSeen < 15000)
      .map(({ lastSeen, ...info }) => info)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ devices }))
    return
  }

  if (url === '/info' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      enabled: isRunning(),
      port: serverPort,
      addresses: getLocalIPs(),
      deviceId: global.lx.p2pDeviceId ?? 'unknown',
      pairCodeRequired: !!pairCode,
    }))
    return
  }

  if (url === '/api/state' && req.method === 'GET') {
    const pollState: LX.P2PRemote.PollState = {
      connections: Array.from(connections.entries()).map(([id, c]) => ({
        connId: id,
        device: c.deviceInfo,
      })),
      lastStates: Array.from(stateCache.entries()),
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(pollState))
    return
  }

  res.writeHead(404)
  res.end('Not Found')
}

export const startP2PRemoteServer = (config: LX.P2PRemote.ServerConfig): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!config.enabled) { resolve(); return }

    pairCode = config.pairCode
    serverPort = config.port || DEFAULT_PORT

    httpServer = http.createServer(handleHttpRequest)
    wss = new WebSocketServer({ noServer: true })

    httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '/'
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (url.startsWith('/bridge')) {
          handleBridgeConnection(ws)
        } else {
          handleDeviceConnection(ws)
        }
      })
    })

    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`P2P 互控端口 ${serverPort} 已被占用`))
      } else {
        reject(err)
      }
    })

    httpServer.listen(serverPort, '0.0.0.0', () => {
      accessLog.info(`[P2PRemote] Server started on port ${serverPort}`)
      startHeartbeat()
      startDiscovery()
      resolve()
    })
  })
}

export const stopP2PRemoteServer = async(): Promise<void> => {
  stopHeartbeat()
  stopDiscovery()
  if (bridgeWs) { try { bridgeWs.close() } catch {}; bridgeWs = null }
  for (const conn of connections.values()) {
    try { conn.ws.close() } catch {}
  }
  connections.clear()
  stateCache.clear()
  if (wss) { wss.close(); wss = null as any }
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer.close(() => { httpServer = null as any; resolve() })
    })
  }
}

export const isRunning = (): boolean => !!httpServer && httpServer.listening

export const getConnectedDevices = (): LX.P2PRemote.ConnectedDevice[] => {
  return Array.from(connections.entries()).map(([id, conn]) => ({
    connId: id,
    device: conn.deviceInfo,
  }))
}

export const getServerInfo = () => ({
  enabled: isRunning(),
  port: serverPort,
  address: getLocalIPs().map(ip => `ws://${ip}:${serverPort}`).join(', '),
  pairCode,
})
