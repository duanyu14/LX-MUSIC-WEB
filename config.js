module.exports = {
  "serverName": "lxserver",
  "proxy.enabled": false,
  "proxy.header": "x-real-ip",
  "bindIP": "0.0.0.0",
  "port": 9527,
  "user.enablePath": true,
  "user.enableRoot": false,
  "user.enablePublicRestriction": true,
  "user.enableLoginCacheRestriction": false,
  "user.enableCacheSizeLimit": false,
  "user.cacheSizeLimit": 2000,
  "maxSnapshotNum": 10,
  "list.addMusicLocationType": "top",
  "disableTelemetry": false,
  "users": [
    {
      "name": "admin",
      "password": "password",
      "dataPath": "D:\\Documents\\Project\\lxmusic\\data\\users\\admin_21232f"
    }
  ],
  "frontend.password": "20060606",
  "webdav.url": "",
  "webdav.username": "",
  "webdav.password": "",
  "sync.interval": 60,
  "player.enableAuth": false,
  "player.password": "20060606",
  "proxy.all.enabled": false,
  "proxy.all.address": "",
  "admin.path": "",
  "player.path": "/music",
  "subsonic.enable": true,
  "subsonic.path": "/rest",
  "singer.sourcePriority": [
    "tx",
    "wy"
  ],
  "cache.namingPattern": "standard"
}