declare namespace LX {
  namespace RemoteControl {

    type DeviceType = 'mobile' | 'desktop' | 'web'

    interface DeviceInfo {
      id: string
      name: string
      type: DeviceType
      version: string
      address: string
    }

    interface PlayerState {
      playing: boolean
      currentSong: {
        name: string
        singer: string
        album?: string
        duration: number
        songId: string
        source: string
      } | null
      playMode: 'sequential' | 'loop_single' | 'loop_list' | 'shuffle'
      volume: number
      muted: boolean
      position: number
      duration: number
    }

    interface SongInfo {
      name: string
      singer: string
      album?: string
      duration: number
      songId: string
      source: string
      interval?: any
    }

    type PlayMode = 'sequential' | 'loop_single' | 'loop_list' | 'shuffle'

    interface RemoteControlAPI {
      getPlayerState(): Promise<PlayerState>
      getPlayList(): Promise<SongInfo[]>
      play(): Promise<void>
      pause(): Promise<void>
      togglePlay(): Promise<void>
      playNext(): Promise<void>
      playPrev(): Promise<void>
      seek(position: number): Promise<void>
      seekByOffset(offset: number): Promise<void>
      setVolume(volume: number): Promise<void>
      toggleMute(): Promise<void>
      setPlayMode(mode: PlayMode): Promise<void>
      playSong(songInfo: SongInfo, listId: string): Promise<void>
      addToQueue(songInfo: SongInfo): Promise<void>
      clearQueue(): Promise<void>
      collectCurrentSong(): Promise<void>
      uncollectCurrentSong(): Promise<void>
    }

    interface FrontendPlayerState {
      playing: boolean
      position: number
      duration: number
      volume: number
      muted: boolean
      currentSong: SongInfo | null
      playMode: PlayMode
      currentIndex: number
      playlist: SongInfo[]
    }

    type RemoteControlAction =
      | 'play'
      | 'pause'
      | 'toggle_play'
      | 'next'
      | 'prev'
      | 'seek'
      | 'volume'
      | 'toggle_mute'
      | 'set_play_mode'
      | 'get_state'
      | 'state_update'
      | 'play_song'
      | 'add_to_queue'
      | 'clear_queue'
      | 'collect_current_song'
      | 'uncollect_current_song'
      | 'reportState'

    interface RemoteControlMessage {
      action: RemoteControlAction
      [key: string]: any
    }
  }
}
