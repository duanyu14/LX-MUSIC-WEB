# MusicSDK 修改记录

本文档记录了对原始 lx-music-desktop 的 musicSDK 所做的必要修改，以便在服务器端（Node.js）环境中运行。

## 修改原则

根据用户要求（见 `WEB_PLAYER_DEVELOPMENT_PLAN.md` 第8条）：
> 尽量不要修改获取歌词或者获取歌曲列表的 musicSdk，因为原作者经常维护这个，需要经常覆盖这个文件。如果无论如何都需要修改请你在 musicSDK.md 中说清楚。

我们尽可能保持对 musicSDK 的最小化修改，所有修改都记录在此。

---

## 修改清单

### 1. 服务器端适配 - `api-source.js`

**修改日期**: 2026-02-03

**问题**: 
原始的 `api-source.js` 导入了 `@renderer/store`（Vue 响应式对象），在 Node.js 服务器端无法运行。

**影响的文件**:
- `src/modules/utils/musicSdk/api-source.js`

**修改内容**:

#### `api-source.js` (完整重写)
```javascript
// ========================================
// 服务器端版本的 api-source.js
// 移除了对 @renderer/store 的依赖
// ========================================

import apiSourceInfo from './api-source-info'

// 服务器端不使用内置的测试 API，全部走自定义源
const allApi = {}

// 服务器端的 userApi 引用（延迟加载避免循环依赖）
let userApiModule = null

const getUserApi = () => {
  if (!userApiModule) {
    try {
      userApiModule = require('../../../server/userApi')
    } catch (err) {
      console.error('[api-source] Failed to load userApi:', err.message)
      userApiModule = { getLoadedApis: () => [] }
    }
  }
  return userApiModule
}

// 获取已加载的自定义源 API
const getUserApis = () => {
  const userApi = getUserApi()
  const loadedApis = userApi.getLoadedApis ? userApi.getLoadedApis() : []
  
  const apis = {}
  
  for (const apiInfo of loadedApis) {
    if (!apiInfo.enabled || !apiInfo.sources) continue
    
    for (const source of Object.keys(apiInfo.sources)) {
      apis[source] = {
        getMusicUrl: (songInfo, type) => {
          return userApi.callUserApiGetMusicUrl(source, songInfo, type)
        },
      }
    }
  }
  
  return apis
}

const apis = source => {
  // 服务器端：优先使用自定义源
  const userApis = getUserApis()
  
  if (userApis[source]) {
    return userApis[source]
  }
  
  throw new Error(`Api is not found for source: ${source}. Please enable a custom source that supports this platform.`)
}

export { apis, supportQuality }
```

**原理说明**:
- 桌面端的 `api-source.js` 依赖 Vue 的 `apiSource.value` 和 `userApi.apis` 响应式引用
- 服务器端版本通过 `require()` 动态加载 `userApi` 模块，避免循环依赖
- 直接调用 `callUserApiGetMusicUrl()` 来使用自定义源的 JS 脚本
- 如果没有启用的自定义源支持该音源，会抛出错误

**好处**:
1. ✅ `kg/index.js` 和 `mg/index.js` 等文件**无需修改**，保持与上游一致
2. ✅ 所有音源统一通过 `apis()` 函数获取实现
3. ✅ 优先使用自定义源，提供最大的灵活性
4. ✅ 只需要维护一个文件（`api-source.js`）的修改

**如何更新 musicSDK**:

当从上游更新 musicSDK 时，只需要重新应用对 `api-source.js` 的修改：

1. 从 lx-music-desktop 复制最新的 musicSDK 文件到 `src/modules/utils/musicSdk/`
2. **备份** `api-source.js` 到临时位置（因为它已被修改为服务器端版本）
3. 复制上游新文件
4. **恢复** 之前备份的服务器端版本 `api-source.js`

所有其他文件（`kg/index.js`, `mg/index.js` 等）都可以直接覆盖，无需修改！

**自动化脚本建议**:

```powershell
# scripts/update-musicSdk.ps1
# Windows PowerShell 脚本

$UPSTREAM = "lx-music-desktop-master\src\renderer\utils\musicSdk"
$TARGET = "src\modules\utils\musicSdk"
$BACKUP = "musicSDK_backup"

# 1. 备份服务器端版本的 api-source.js
Copy-Item "$TARGET\api-source.js" "$BACKUP\api-source.js" -Force
Write-Host "✓ 已备份 api-source.js"

# 2. 从上游复制所有文件（排除 api-source.js）
Get-ChildItem "$UPSTREAM" -Recurse -File | 
    Where-Object { $_.Name -ne "api-source.js" } |
    ForEach-Object {
        $dest = $_.FullName.Replace($UPSTREAM, $TARGET)
        $destDir = Split-Path $dest
        if (!(Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        Copy-Item $_.FullName $dest -Force
    }
Write-Host "✓ 已复制上游 musicSDK 文件"

# 3. 恢复服务器端版本的 api-source.js
Copy-Item "$BACKUP\api-source.js" "$TARGET\api-source.js" -Force
Write-Host "✓ 已恢复服务器端 api-source.js"

Write-Host "`n🎉 MusicSDK 更新完成！"
```

---

## 未修改的部分

以下文件保持与上游一致，无需修改：

- `musicSearch.js` (所有源) - 搜索逻辑
- `lyric.js` (所有源) - 歌词获取
- `leaderboard.js` - 排行榜
- `songList.js` - 歌单
- `hotSearch.js` - 热搜
- `comment.js` - 评论
- `pic.js` - 封面图片

这些文件可以直接从上游覆盖更新，无需任何修改。

---

## 测试验证

修改后，请测试以下功能确保正常工作：

1. **酷狗音乐播放**: 
   ```bash
   curl -X POST http://localhost:9527/api/music/url \
     -H "Content-Type: application/json" \
     -d '{"songInfo": {"source": "kg", "hash": "XXX", "_types": {"128k": {"hash": "YYY"}}}, "quality": "128k"}'
   ```

2. **咪咕音乐播放**:
   ```bash
   curl -X POST http://localhost:9527/api/music/url \
     -H "Content-Type: application/json" \
     -d '{"songInfo": {"source": "mg", "copyrightId": "XXX"}, "quality": "128k"}'
   ```

预期结果: 返回包含 `url` 字段的 JSON 响应。

---

## 相关文档

- [WEB_PLAYER_DEVELOPMENT_PLAN.md](./WEB_PLAYER_DEVELOPMENT_PLAN.md) - Web 播放器开发计划
- [自定义源播放机制分析.md](./.gemini/antigravity/brain/.../自定义源播放机制分析.md) - 详细的技术文档
