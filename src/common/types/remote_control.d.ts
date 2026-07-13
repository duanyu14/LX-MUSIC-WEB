// 旧的中转式远程控制已废弃，统一使用 P2P 互控类型
// 保留命名空间以兼容前端可能的类型引用
declare namespace LX {
  namespace RemoteControl {
    type DeviceType = LX.P2PRemote.DeviceType
    type PlayMode = LX.P2PRemote.PlayMode
    type DeviceInfo = LX.P2PRemote.DeviceInfo
    type PlayerState = LX.P2PRemote.PlayerState
    type SongInfo = LX.P2PRemote.SongInfo
    type CurrentSong = LX.P2PRemote.CurrentSong
  }
}
