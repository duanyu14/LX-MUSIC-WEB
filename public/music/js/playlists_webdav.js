/**
 * Playlists WebDAV Sync Module
 * 处理playlists.json文件的WebDAV同步功能
 */

// 配置存储键名
const PLAYLISTS_WEBDAV_CONFIG_KEY = 'playlists_webdav_config';
const PLAYLISTS_LOCAL_DATA_KEY = 'playlists_local_data';

// 默认配置
const defaultConfig = {
    url: '',
    username: '',
    password: '',
    path: '/playlists.json'
};

// 加载配置
function loadPlaylistsWebDAVConfig() {
    try {
        const saved = localStorage.getItem(PLAYLISTS_WEBDAV_CONFIG_KEY);
        if (saved) {
            return { ...defaultConfig, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.error('[PlaylistsWebDAV] Failed to load config:', e);
    }
    return { ...defaultConfig };
}

// 保存配置
function savePlaylistsWebDAVConfig() {
    const config = {
        url: document.getElementById('playlists-webdav-url')?.value || '',
        username: document.getElementById('playlists-webdav-user')?.value || '',
        password: document.getElementById('playlists-webdav-pass')?.value || '',
        path: document.getElementById('playlists-webdav-path')?.value || '/playlists.json'
    };
    localStorage.setItem(PLAYLISTS_WEBDAV_CONFIG_KEY, JSON.stringify(config));
    updatePlaylistsWebDAVStatus('配置已保存');
    return config;
}

// 加载配置到表单
function loadPlaylistsWebDAVConfigToForm() {
    const config = loadPlaylistsWebDAVConfig();
    const urlInput = document.getElementById('playlists-webdav-url');
    const userInput = document.getElementById('playlists-webdav-user');
    const passInput = document.getElementById('playlists-webdav-pass');
    const pathInput = document.getElementById('playlists-webdav-path');
    
    if (urlInput) urlInput.value = config.url;
    if (userInput) userInput.value = config.username;
    if (passInput) passInput.value = config.password;
    if (pathInput) pathInput.value = config.path;
    
    if (config.url) {
        updatePlaylistsWebDAVStatus('配置已加载', 'amber');
    } else {
        updatePlaylistsWebDAVStatus('状态: 未配置', 'gray');
    }
}

// 更新状态显示
function updatePlaylistsWebDAVStatus(message, color = 'gray') {
    const statusEl = document.getElementById('playlists-webdav-status');
    if (!statusEl) return;
    
    const colorMap = {
        gray: 'text-gray-300',
        amber: 'text-amber-500',
        green: 'text-green-500',
        red: 'text-red-500'
    };
    
    statusEl.innerHTML = `<i class="fas fa-circle text-[8px] ${colorMap[color] || colorMap.gray}"></i> ${message}`;
}

// 获取用户认证头
function getUserAuthHeaders() {
    if (typeof window.getUserAuthHeaders === 'function') {
        return window.getUserAuthHeaders();
    }
    return {};
}

// 测试WebDAV连接
async function testPlaylistsWebDAVConnection() {
    const config = savePlaylistsWebDAVConfig();
    
    if (!config.url || !config.username || !config.password) {
        updatePlaylistsWebDAVStatus('请填写完整的WebDAV配置', 'red');
        showNotification('请填写完整的WebDAV配置', 'warning');
        return;
    }
    
    updatePlaylistsWebDAVStatus('正在测试连接...', 'amber');
    
    try {
        const response = await fetch('/api/webdav/test-playlists', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getUserAuthHeaders()
            },
            body: JSON.stringify({
                url: config.url,
                username: config.username,
                password: config.password
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            updatePlaylistsWebDAVStatus('连接成功!', 'green');
            showNotification('WebDAV连接测试成功!', 'success');
        } else {
            updatePlaylistsWebDAVStatus('连接失败: ' + (result.message || '未知错误'), 'red');
            showNotification('WebDAV连接测试失败: ' + (result.message || '未知错误'), 'error');
        }
    } catch (error) {
        updatePlaylistsWebDAVStatus('连接失败: ' + error.message, 'red');
        showNotification('WebDAV连接测试失败: ' + error.message, 'error');
    }
}

// 从WebDAV拉取playlists.json
async function syncPlaylistsFromWebDAV() {
    const config = loadPlaylistsWebDAVConfig();
    
    if (!config.url || !config.username || !config.password) {
        showNotification('请先配置WebDAV信息', 'warning');
        return;
    }
    
    updatePlaylistsWebDAVStatus('正在拉取歌单...', 'amber');
    
    try {
        const response = await fetch('/api/webdav/fetch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getUserAuthHeaders()
            },
            body: JSON.stringify({
                url: config.url,
                username: config.username,
                password: config.password,
                path: config.path
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            // 保存到本地存储
            localStorage.setItem(PLAYLISTS_LOCAL_DATA_KEY, result.data);
            
            // 使用正确的解析函数统计歌单数量
            const playlists = parsePlaylistsData(result.data);
            const totalSongs = playlists.reduce((sum, p) => sum + (p.songs?.length || 0), 0);
            updatePlaylistsWebDAVStatus(`拉取成功! 共 ${playlists.length} 个歌单, ${totalSongs} 首歌曲`, 'green');
            showNotification('歌单拉取成功!', 'success');
            
            // 刷新我的歌曲页面
            if (typeof refreshMySongs === 'function') {
                refreshMySongs();
            }
        } else {
            updatePlaylistsWebDAVStatus('拉取失败: ' + (result.message || '未知错误'), 'red');
            showNotification('歌单拉取失败: ' + (result.message || '未知错误'), 'error');
        }
    } catch (error) {
        updatePlaylistsWebDAVStatus('拉取失败: ' + error.message, 'red');
        showNotification('歌单拉取失败: ' + error.message, 'error');
    }
}

// 上传playlists.json到WebDAV
async function syncPlaylistsToWebDAV() {
    const config = loadPlaylistsWebDAVConfig();
    
    if (!config.url || !config.username || !config.password) {
        showNotification('请先配置WebDAV信息', 'warning');
        return;
    }
    
    updatePlaylistsWebDAVStatus('正在上传歌单...', 'amber');
    
    try {
        // 获取本地数据
        const localData = localStorage.getItem(PLAYLISTS_LOCAL_DATA_KEY);
        const dataToUpload = localData || '[]';
        
        const response = await fetch('/api/webdav/upload', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getUserAuthHeaders()
            },
            body: JSON.stringify({
                url: config.url,
                username: config.username,
                password: config.password,
                path: config.path,
                data: dataToUpload
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            updatePlaylistsWebDAVStatus('上传成功!', 'green');
            showNotification('歌单上传成功!', 'success');
        } else {
            updatePlaylistsWebDAVStatus('上传失败: ' + (result.message || '未知错误'), 'red');
            showNotification('歌单上传失败: ' + (result.message || '未知错误'), 'error');
        }
    } catch (error) {
        updatePlaylistsWebDAVStatus('上传失败: ' + error.message, 'red');
        showNotification('歌单上传失败: ' + error.message, 'error');
    }
}

// 解析playlists.json数据
function parsePlaylistsData(data) {
    try {
        const rawData = typeof data === 'string' ? JSON.parse(data) : data;
        
        // 格式1: 标准歌单数组格式
        if (Array.isArray(rawData)) {
            return rawData.map((playlist, index) => {
                return {
                    id: playlist.id || `playlist-${index}`,
                    name: playlist.name || `歌单 ${index + 1}`,
                    songs: playlist.songs || playlist.tracks || [],
                    createTime: playlist.createTime || playlist.create_time || Date.now(),
                    updateTime: playlist.updateTime || playlist.update_time || Date.now()
                };
            });
        }
        
        // 格式2: 对象格式，包含data.defaultList（lxmusic导出格式）
        if (rawData.data && rawData.data.defaultList && Array.isArray(rawData.data.defaultList)) {
            return [{
                id: 'default',
                name: '默认歌单',
                songs: rawData.data.defaultList.map(song => ({
                    id: song.id || song.songId || `song-${Date.now()}`,
                    name: song.name,
                    singer: song.singer || song.artist || '未知歌手',
                    album: song.albumName || song.album || '',
                    duration: song.interval || song.duration || '',
                    source: song.source || '',
                    meta: song.meta || {}
                })),
                createTime: rawData.lastModified || Date.now(),
                updateTime: rawData.lastModified || Date.now()
            }];
        }
        
        // 格式3: 其他对象格式
        console.warn('[PlaylistsWebDAV] Unexpected data format:', typeof rawData);
        return [];
    } catch (e) {
        console.error('[PlaylistsWebDAV] Failed to parse playlists data:', e);
        return [];
    }
}

// 刷新我的歌曲页面
function refreshMySongs() {
    const localData = localStorage.getItem(PLAYLISTS_LOCAL_DATA_KEY);
    
    if (!localData) {
        updateMySongsUI([]);
        showNotification('请先从WebDAV拉取歌单', 'info');
        return;
    }
    
    const playlists = parsePlaylistsData(localData);
    updateMySongsUI(playlists);
    showNotification('已刷新歌单', 'success');
}

// 更新我的歌曲UI
function updateMySongsUI(playlists) {
    const playlistsContainer = document.getElementById('my-songs-playlists');
    const listContainer = document.getElementById('my-songs-list');
    const totalCount = document.getElementById('my-songs-total-count');
    
    if (!playlistsContainer || !listContainer) return;
    
    // 更新总数
    const totalSongs = playlists.reduce((sum, p) => sum + (p.songs?.length || 0), 0);
    if (totalCount) {
        totalCount.textContent = `共 ${totalSongs} 首`;
    }
    
    // 渲染歌单列表
    if (playlists.length === 0) {
        playlistsContainer.innerHTML = '<div class="p-3 text-sm t-text-muted text-center">暂无歌单</div>';
        listContainer.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center t-text-muted">
                    <i class="fas fa-music text-4xl mb-3 opacity-30"></i>
                    <p class="text-sm">请先从WebDAV拉取歌单</p>
                </div>
            </div>
        `;
        return;
    }
    
    playlistsContainer.innerHTML = playlists.map((playlist, index) => `
        <div class="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all duration-200 group ${index === 0 ? 'active-option bg-emerald-50 dark:bg-emerald-500/10' : 'hover:t-bg-panel'}"
             onclick="selectPlaylist(${index})" data-playlist-index="${index}">
            <i class="fas fa-music w-5 ${index === 0 ? 'text-emerald-500' : 't-text-muted group-hover:text-emerald-500'} transition-colors flex-shrink-0"></i>
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm truncate ${index === 0 ? 'text-emerald-600 dark:text-emerald-400' : 't-text-muted group-hover:t-text-main'}">${escapeHtml(playlist.name)}</div>
                <div class="text-[10px] t-text-muted">${playlist.songs?.length || 0} 首歌</div>
            </div>
            <span class="text-xs ${index === 0 ? 'text-emerald-500' : 'text-gray-400 group-hover:t-text-muted'} mr-1 flex-shrink-0">${playlist.songs?.length || 0}</span>
            <i class="fas fa-chevron-right text-[10px] t-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"></i>
        </div>
    `).join('');
    
    // 默认选中第一个歌单
    if (playlists.length > 0) {
        selectPlaylist(0);
    }
}

// 选择歌单
function selectPlaylist(index) {
    const localData = localStorage.getItem(PLAYLISTS_LOCAL_DATA_KEY);
    if (!localData) return;
    
    const playlists = parsePlaylistsData(localData);
    const playlist = playlists[index];
    
    if (!playlist) return;
    
    // 更新选中状态
    document.querySelectorAll('#my-songs-playlists > div').forEach((el, i) => {
        if (i === index) {
            el.classList.add('bg-emerald-50', 'dark:bg-emerald-500/10');
            el.querySelector('i.fas.fa-music')?.classList.add('text-emerald-500');
            el.querySelector('i.fas.fa-music')?.classList.remove('t-text-muted');
            el.querySelector('div.font-medium')?.classList.add('text-emerald-600', 'dark:text-emerald-400');
            el.querySelector('div.font-medium')?.classList.remove('t-text-muted');
            el.querySelector('span.text-xs')?.classList.add('text-emerald-500');
            el.querySelector('span.text-xs')?.classList.remove('text-gray-400');
        } else {
            el.classList.remove('bg-emerald-50', 'dark:bg-emerald-500/10');
            el.querySelector('i.fas.fa-music')?.classList.remove('text-emerald-500');
            el.querySelector('i.fas.fa-music')?.classList.add('t-text-muted');
            el.querySelector('div.font-medium')?.classList.remove('text-emerald-600', 'dark:text-emerald-400');
            el.querySelector('div.font-medium')?.classList.add('t-text-muted');
            el.querySelector('span.text-xs')?.classList.remove('text-emerald-500');
            el.querySelector('span.text-xs')?.classList.add('text-gray-400');
        }
    });
    
    // 更新当前歌单标题
    const titleEl = document.getElementById('my-songs-current-playlist');
    const countEl = document.getElementById('my-songs-list-count');
    
    if (titleEl) titleEl.textContent = playlist.name;
    if (countEl) countEl.textContent = `${playlist.songs?.length || 0} 首歌`;
    
    // 更新移动端歌单名称显示
    updateMobilePlaylistName(playlist.name);
    
    // 移动端：选择歌单后自动收起歌单面板
    const panel = document.getElementById('my-songs-playlist-panel');
    const arrow = document.getElementById('my-songs-playlist-arrow');
    if (panel && arrow && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        arrow.style.transform = 'rotate(0deg)';
    }
    
    // 渲染歌曲列表
    const listContainer = document.getElementById('my-songs-list');
    if (!listContainer) return;
    
    if (!playlist.songs || playlist.songs.length === 0) {
        listContainer.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center t-text-muted">
                    <i class="fas fa-music text-4xl mb-3 opacity-30"></i>
                    <p class="text-sm">该歌单暂无歌曲</p>
                </div>
            </div>
        `;
        return;
    }
    
    // 应用搜索过滤
    const filteredSongs = getFilteredSongs(playlist.songs, currentSearchKeyword);
    
    if (filteredSongs.length === 0) {
        listContainer.innerHTML = `
            <div class="flex items-center justify-center h-full">
                <div class="text-center t-text-muted">
                    <i class="fas fa-search text-4xl mb-3 opacity-30"></i>
                    <p class="text-sm">未找到匹配的歌曲</p>
                </div>
            </div>
        `;
        return;
    }
    
    // 同步 viewingPlaylist 供全局函数使用
    window.viewingPlaylist = playlist.songs;
    
    listContainer.innerHTML = filteredSongs.map((song, displayIndex) => {
        // 获取原始索引用于播放
        const songIndex = playlist.songs.findIndex(s => s.id === song.id);
        const actualIndex = songIndex >= 0 ? songIndex : displayIndex;
        const songName = song.name || song.title || '未知歌曲';
        const singer = song.singer || song.artists || song.artist || '未知歌手';
        const album = song.albumName || song.album || '未知专辑';
        const duration = song.interval || song.duration || '--:--';
        // 使用显示索引作为序号
        const rank = displayIndex + 1;
        const rankClass = rank <= 3 ? 'text-emerald-600 dark:text-emerald-500 font-black text-base' : 'text-gray-400 font-mono text-xs';
        
        const imgUrl = window.getImgUrl ? window.getImgUrl(song) : (song.picUrl || song.img || song.albumImg || '/music/assets/logo.svg');
        
        return `
            <div class="grid grid-cols-12 gap-2 md:gap-4 p-3 rounded-xl hover:t-bg-panel group transition-colors cursor-pointer"
                 onclick="playMySong(${index}, ${actualIndex})" data-song-id="${String(song.id)}">
                <!-- 序号 -->
                <div class="col-span-1 sm:col-span-1 text-center flex items-center justify-center">
                    <span class="${rankClass}">${rank}</span>
                </div>
                <!-- 封面 + 歌名 -->
                <div class="col-span-9 sm:col-span-7 md:col-span-5 lg:col-span-4 flex items-center gap-3 min-w-0">
                    <div class="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 relative rounded-lg overflow-hidden shadow-sm border t-border-main group-hover:shadow-md transition-all group-hover:scale-105 duration-300">
                        <img data-src="${imgUrl}" src="/music/assets/logo.svg"
                             class="lazy-image w-full h-full object-cover dynamic-logo is-placeholder"
                             onerror="this.src='/music/assets/logo.svg'; this.classList.add('is-placeholder');">
                        <div class="absolute inset-0 bg-black/20 hidden group-hover:flex items-center justify-center transition-all">
                            <i class="fas fa-play text-white text-xs"></i>
                        </div>
                    </div>
                    <div class="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                        <div class="font-bold text-sm t-text-main group-hover:text-emerald-500 transition-colors truncate">
                            ${escapeHtml(songName)}
                        </div>
                        <div class="flex items-center gap-1 mt-0.5 overflow-hidden">
                            ${window.getSourceTag ? window.getSourceTag(song.source) : ''}
                            <div class="md:hidden flex-1 min-w-0">
                                <span class="text-[10px] t-text-muted truncate">${escapeHtml(singer)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- 歌手 -->
                <div class="hidden md:flex md:col-span-3 items-center text-xs t-text-muted overflow-hidden truncate">
                    ${escapeHtml(singer)}
                </div>
                <!-- 专辑 -->
                <div class="hidden lg:flex lg:col-span-2 items-center text-xs t-text-muted truncate">
                    ${escapeHtml(album)}
                </div>
                <!-- 时长 -->
                <div class="hidden md:flex md:col-span-2 lg:col-span-1 items-center justify-end text-xs font-mono t-text-muted">
                    ${duration}
                </div>
                <!-- 操作 -->
                <div class="col-span-2 sm:col-span-1 md:col-span-1 flex items-center justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors"
                            title="播放"
                            onclick="event.stopPropagation(); playMySong(${index}, ${actualIndex})">
                        <i class="fas fa-play w-3.5 h-3.5"></i>
                    </button>
                    <button class="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                            title="下载"
                            onclick="event.stopPropagation(); downloadSong(${JSON.stringify(song).replace(/"/g, '&quot;')})">
                        <i class="fas fa-download w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    // 延迟加载图片和应用marquee效果
    setTimeout(() => {
        if (typeof window.lazyLoadImages === 'function') window.lazyLoadImages();
        if (typeof window.applyMarqueeChecks === 'function') window.applyMarqueeChecks();
    }, 50);
}

// 播放歌曲
function playMySong(playlistIndex, songIndex) {
    const localData = localStorage.getItem(PLAYLISTS_LOCAL_DATA_KEY);
    if (!localData) return;
    
    const playlists = parsePlaylistsData(localData);
    const playlist = playlists[playlistIndex];
    
    if (!playlist || !playlist.songs || !playlist.songs[songIndex]) return;
    
    const song = playlist.songs[songIndex];
    
    // 调用全局播放函数 (根据实际项目调整)
    if (typeof playSong === 'function') {
        playSong(song);
    } else if (typeof window.playSong === 'function') {
        window.playSong(song);
    } else {
        // 尝试通过事件通知
        window.dispatchEvent(new CustomEvent('play-my-song', { detail: { song, playlist, index: songIndex } }));
        showNotification(`准备播放: ${song.name || song.title}`, 'info');
    }
}

// 播放全部
function playAllMySongs() {
    const localData = localStorage.getItem(PLAYLISTS_LOCAL_DATA_KEY);
    if (!localData) {
        showNotification('请先从WebDAV拉取歌单', 'info');
        return;
    }
    
    const playlists = parsePlaylistsData(localData);
    if (playlists.length === 0) {
        showNotification('暂无歌单', 'info');
        return;
    }
    
    // 播放第一个歌单
    selectPlaylist(0);
    
    // 如果有歌曲，自动播放第一首
    const firstPlaylist = playlists[0];
    if (firstPlaylist.songs && firstPlaylist.songs.length > 0) {
        playMySong(0, 0);
    }
}

// HTML转义
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 搜索相关变量
let currentSearchKeyword = '';

// 搜索歌曲
function searchMySongs(keyword) {
    currentSearchKeyword = keyword.trim().toLowerCase();
    
    // 显示/隐藏清除按钮
    const clearBtn = document.getElementById('my-songs-search-clear');
    if (clearBtn) {
        clearBtn.style.opacity = currentSearchKeyword ? '1' : '0';
    }
    
    // 如果当前有选中的歌单，重新渲染
    const selectedPlaylistEl = document.querySelector('#my-songs-playlists > div.active-option, #my-songs-playlists > div.bg-emerald-50');
    if (selectedPlaylistEl) {
        const playlistIndex = parseInt(selectedPlaylistEl.getAttribute('data-playlist-index'));
        if (!isNaN(playlistIndex)) {
            selectPlaylist(playlistIndex);
        }
    }
}

// 清除搜索
function clearMySongsSearch() {
    const searchInput = document.getElementById('my-songs-search');
    if (searchInput) {
        searchInput.value = '';
    }
    searchMySongs('');
}

// 获取搜索后的歌曲列表
function getFilteredSongs(songs, keyword) {
    if (!keyword) return songs;
    
    return songs.filter(song => {
        const songName = (song.name || song.title || '').toLowerCase();
        const singer = (song.singer || song.artists || song.artist || '').toLowerCase();
        const album = (song.album || song.albumName || '').toLowerCase();
        
        return songName.includes(keyword) || singer.includes(keyword) || album.includes(keyword);
    });
}

// 移动端：切换歌单面板
function toggleMySongsPlaylistPanel() {
    const panel = document.getElementById('my-songs-playlist-panel');
    const arrow = document.getElementById('my-songs-playlist-arrow');
    
    if (!panel || !arrow) return;
    
    panel.classList.toggle('hidden');
    
    if (panel.classList.contains('hidden')) {
        arrow.style.transform = 'rotate(0deg)';
    } else {
        arrow.style.transform = 'rotate(180deg)';
    }
}

// 更新移动端歌单名称显示
function updateMobilePlaylistName(name) {
    const mobileTitle = document.getElementById('my-songs-current-playlist-mobile');
    if (mobileTitle) {
        mobileTitle.textContent = name || '请选择歌单';
    }
}

// 显示通知 (简单的实现)
function showNotification(message, type = 'info') {
    // 检查是否已存在通知容器
    let container = document.getElementById('notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notification-container';
        container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2';
        document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    const bgColors = {
        info: 'bg-blue-500',
        success: 'bg-green-500',
        warning: 'bg-amber-500',
        error: 'bg-red-500'
    };
    
    notification.className = `${bgColors[type] || bgColors.info} text-white px-4 py-2 rounded-lg shadow-lg text-sm animate-slide-up`;
    notification.textContent = message;
    
    container.appendChild(notification);
    
    // 3秒后移除
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translateX(100%)';
        notification.style.transition = 'all 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    // 加载配置到表单
    loadPlaylistsWebDAVConfigToForm();
    
    console.log('[PlaylistsWebDAV] Module initialized');
});

// 导出到全局
window.loadPlaylistsWebDAVConfigToForm = loadPlaylistsWebDAVConfigToForm;
window.savePlaylistsWebDAVConfig = savePlaylistsWebDAVConfig;
window.testPlaylistsWebDAVConnection = testPlaylistsWebDAVConnection;
window.syncPlaylistsFromWebDAV = syncPlaylistsFromWebDAV;
window.syncPlaylistsToWebDAV = syncPlaylistsToWebDAV;
window.refreshMySongs = refreshMySongs;
window.selectPlaylist = selectPlaylist;
window.playMySong = playMySong;
window.playAllMySongs = playAllMySongs;
