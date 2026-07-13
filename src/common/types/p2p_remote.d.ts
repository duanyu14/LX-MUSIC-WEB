declare namespace LX {
  namespace P2PRemote {
    type DeviceType = 'mobile' | 'desktop' | 'web'

    interface DeviceInfo {
      deviceId: string
      name: string
      deviceType: DeviceType
      version: string
      ip: string
      port: number
    }

    type PlayMode = 'sequential' | 'loop_single' | 'loop_list' | 'shuffle'

    interface CurrentSong {
      name: string
      singer: string
      album?: string
      duration: number
      songId: string
      source: string
    }

    interface PlayerState {
      playing: boolean
      position: number
      duration: number
      volume: number
      muted: boolean
      currentSong: CurrentSong | null
      playMode: PlayMode
    }

    interface SongInfo {
      name: string
      singer: string
      source: string
      songId: string
      albumName?: string
      interval?: string
      img?: string
      types: { type: string; size?: string; hash?: string }[]
    }

    type MessageType =
      | 'hello'
      | 'hello_ack'
      | 'auth_required'
      | 'auth'
      | 'auth_result'
      | 'command'
      | 'command_result'
      | 'state_update'
      | 'get_state'
      | 'state_response'
      | 'search'
      | 'search_result'
      | 'ping'
      | 'pong'
      | 'discovery_response'
      | 'device_offline'
      | 'get_devices'
      | 'send_command_to'
      | 'send_search_to'
      | 'send_get_state_to'
      | 'disconnect_device'

    interface Message {
      type: MessageType
      id?: string
      data?: any
      command?: string
      params?: any
      success?: boolean
    }

    interface ServerConfig {
      enabled: boolean
      port: number
      pairCode: string
    }

    interface ConnectedDevice {
      connId: string
      device: DeviceInfo | null
    }

    interface PollState {
      connections: ConnectedDevice[]
      lastStates: Array<[string, { state: PlayerState; time: number }]>
    }
  }
}
