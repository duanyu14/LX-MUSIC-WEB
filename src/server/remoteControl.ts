import { WebSocket } from 'ws'
import { getIP } from '@/utils/tools'
import { accessLog } from '@/utils/log4js'

const REMOTE_CONTROL_PATH = '/api/remote/ws'

interface DeviceClient {
  id: string
  ws: WebSocket
  deviceInfo: LX.RemoteControl.DeviceInfo | null
  playerState: LX.RemoteControl.FrontendPlayerState | null
  lastHeartbeat: number
}

const devices = new Map<string, DeviceClient>()

const generateClientId = (): string => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export const isRemoteControlRequest = (url: string | undefined): boolean => {
  if (!url) return false
  try {
    const pathname = new URL(url, 'http://localhost').pathname
    return pathname === REMOTE_CONTROL_PATH
  } catch {
    return false
  }
}

const getDeviceList = (excludeId?: string): LX.RemoteControl.DeviceInfo[] => {
  const list: LX.RemoteControl.DeviceInfo[] = []
  for (const device of devices.values()) {
    if (device.deviceInfo && device.id !== excludeId) {
      list.push({ ...device.deviceInfo })
    }
  }
  return list
}

const broadcastDeviceList = () => {
  const allDevices = getDeviceList()
  const msg = JSON.stringify({
    type: 'device_list',
    devices: allDevices,
  })
  for (const device of devices.values()) {
    if (device.ws.readyState === WebSocket.OPEN) {
      device.ws.send(msg)
    }
  }
}

const sendToDevice = (targetId: string, message: any) => {
  const target = devices.get(targetId)
  if (target && target.ws.readyState === WebSocket.OPEN) {
    target.ws.send(JSON.stringify(message))
    return true
  }
  return false
}

const handleMessage = (device: DeviceClient, rawData: string) => {
  let message: any
  try {
    message = JSON.parse(rawData)
  } catch {
    accessLog.warn('[RemoteControl] Failed to parse message from device', device.id, 'raw length:', rawData.length)
    return
  }

  const { type, action, data } = message
  accessLog.debug('[RemoteControl] ← Received from', device.deviceInfo?.name || device.id, 'type:', type)

  switch (type) {
    case 'register': {
      const deviceInfo = {
        id: device.id,
        ...(data || {}),
      } as LX.RemoteControl.DeviceInfo
      device.deviceInfo = deviceInfo
      accessLog.info('[RemoteControl] Device registered:', deviceInfo.name, 'type:', deviceInfo.type, 'id:', device.id)
      device.ws.send(JSON.stringify({
        type: 'registered',
        deviceId: device.id,
        deviceList: getDeviceList(device.id),
      }))
      accessLog.info('[RemoteControl] Broadcasting device list, total devices:', getDeviceList().length + 1)
      broadcastDeviceList()
      break
    }

    case 'get_device_list':
      device.ws.send(JSON.stringify({
        type: 'device_list',
        devices: getDeviceList(device.id),
      }))
      break

    case 'state_update':
      device.playerState = data
      break

    case 'command': {
      const { targetId, command, params } = message
      if (!targetId) {
        accessLog.warn('[RemoteControl] Command missing targetId from', device.id)
        return
      }

      accessLog.info('[RemoteControl] Command:', command, 'from', device.deviceInfo?.name || device.id, '→', targetId)

      const success = sendToDevice(targetId, {
        type: 'command',
        fromDeviceId: device.id,
        fromDeviceName: device.deviceInfo?.name || '未知设备',
        command,
        params,
      })

      if (success) {
        accessLog.debug('[RemoteControl] Command forwarded successfully:', command)
        device.ws.send(JSON.stringify({
          type: 'command_ack',
          success: true,
          targetId,
          command,
        }))
      } else {
        accessLog.warn('[RemoteControl] Target device not found or offline:', targetId)
        device.ws.send(JSON.stringify({
          type: 'command_ack',
          success: false,
          targetId,
          command,
          error: '设备不在线',
        }))
      }
      break
    }

    case 'state_response': {
      const { targetId, state } = message
      if (targetId) {
        sendToDevice(targetId, {
          type: 'state_update',
          fromDeviceId: device.id,
          fromDeviceName: device.deviceInfo?.name || '未知设备',
          state,
        })
      }
      break
    }

    case 'get_state': {
      const { targetId } = message
      if (targetId) {
        const target = devices.get(targetId)
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({
            type: 'get_state',
            fromDeviceId: device.id,
          }))
        } else {
          device.ws.send(JSON.stringify({
            type: 'command_ack',
            success: false,
            targetId,
            error: '设备不在线',
          }))
        }
      }
      break
    }

    case 'ping':
      device.lastHeartbeat = Date.now()
      device.ws.send(JSON.stringify({ type: 'pong' }))
      break

    case 'pong':
      device.lastHeartbeat = Date.now()
      break
  }
}

export const handleRemoteControlConnection = (ws: WebSocket, req: any) => {
  const deviceId = generateClientId()
  const ip = getIP(req)
  const ua = req.headers['user-agent'] || 'unknown'
  accessLog.info('[RemoteControl] New connection:', ip, 'id:', deviceId, 'UA:', ua.substring(0, 80))

  const device: DeviceClient = {
    id: deviceId,
    ws,
    deviceInfo: null,
    playerState: null,
    lastHeartbeat: Date.now(),
  }
  devices.set(deviceId, device)
  accessLog.info('[RemoteControl] Total connected devices:', devices.size)

  ws.on('message', (data) => {
    if (typeof data !== 'string') return
    handleMessage(device, data)
  })

  ws.on('close', (code, reason) => {
    accessLog.info('[RemoteControl] Device disconnected:', device.deviceInfo?.name || ip,
      'id:', device.id, 'code:', code, 'reason:', reason?.toString() || 'unknown')
    devices.delete(deviceId)
    accessLog.info('[RemoteControl] Remaining devices:', devices.size)
    if (device.deviceInfo) {
      broadcastDeviceList()
    }
  })

  ws.on('error', (err) => {
    console.error('[RemoteControl] WS error:', err.message)
  })
}

export const setupRemoteControl = (wss: any) => {
  wss.on('connection', (ws: WebSocket, request: any) => {
    if (isRemoteControlRequest(request.url)) {
      handleRemoteControlConnection(ws, request)
    }
  })
}

export const getRemoteControlStatus = () => {
  return {
    deviceCount: devices.size,
    devices: Array.from(devices.values())
      .filter(d => d.deviceInfo)
      .map(d => ({
        id: d.id,
        name: d.deviceInfo!.name,
        type: d.deviceInfo!.type,
        address: d.deviceInfo!.address,
        hasPlayerState: !!d.playerState,
      })),
  }
}
