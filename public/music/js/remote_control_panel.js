(function () {
    'use strict';

    const LOG_PREFIX = '[RCPanel] ';
    const log = {
        info: (...args) => console.log(LOG_PREFIX, ...args),
        warn: (...args) => console.warn(LOG_PREFIX, ...args),
        error: (...args) => console.error(LOG_PREFIX, ...args),
    };

    // 默认 P2P 端口（Web 端）
    const DEFAULT_P2P_PORT = 9528;
    const DEFAULT_DESKTOP_PORT = 23331;

    const state = {
        activeConnId: null,
        activeDeviceInfo: null,
        playerState: null,
        positionTimer: null,
        searchSource: 'wy',
        scanInProgress: false,
        localAddr: '',
        bridgeOk: false,
        discoveredDevices: [],
    };

    const formatTime = (s) => {
        if (!s || !Number.isFinite(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const getDeviceIcon = (type) => {
        switch (type) {
            case 'desktop': return 'fas fa-desktop';
            case 'mobile': return 'fas fa-mobile-alt';
            case 'web': return 'fas fa-globe';
            default: return 'fas fa-music';
        }
    };

    const getDeviceTypeName = (type) => {
        switch (type) {
            case 'desktop': return '桌面端';
            case 'mobile': return '移动端';
            case 'web': return '网页端';
            default: return '未知';
        }
    };

    const getPlayModeIcon = (mode) => {
        switch (mode) {
            case 'loop_single': return 'fas fa-redo';
            case 'shuffle': return 'fas fa-random';
            case 'sequential': return 'fas fa-sort-numeric-down';
            case 'loop_list':
            default: return 'fas fa-redo-alt';
        }
    };

    const getMuteIcon = (muted, volume) => {
        if (muted || volume === 0) return 'fas fa-volume-mute';
        if (volume < 50) return 'fas fa-volume-down';
        return 'fas fa-volume-up';
    };

    const setStatus = (text, type = 'default') => {
        const content = document.getElementById('rc-status-text-content');
        const dot = document.querySelector('#rc-status-text span:first-child');
        if (content) content.textContent = text;
        if (dot) {
            dot.className = 'inline-block w-1.5 h-1.5 rounded-full';
            if (type === 'success') dot.classList.add('bg-green-500');
            else if (type === 'error') dot.classList.add('bg-red-500');
            else if (type === 'loading') dot.classList.add('bg-yellow-500', 'animate-pulse');
            else dot.classList.add('bg-gray-400');
        }
    };

    const setBridgeStatus = (ok) => {
        state.bridgeOk = ok;
        const el = document.getElementById('rc-bridge-status');
        if (el) el.textContent = '桥接: ' + (ok ? '已连接' : '未连接');
    };

    const setLocalAddr = (addr) => {
        state.localAddr = addr;
        const el = document.getElementById('rc-local-addr');
        if (el) el.textContent = addr || '未启动';
    };

    const showEmpty = () => {
        document.getElementById('rc-control-empty')?.classList.remove('hidden');
        document.getElementById('rc-control-empty')?.classList.add('flex');
        document.getElementById('rc-control-panel')?.classList.add('hidden');
        document.getElementById('rc-control-panel')?.classList.remove('flex');
    };

    const showPanel = () => {
        document.getElementById('rc-control-empty')?.classList.add('hidden');
        document.getElementById('rc-control-empty')?.classList.remove('flex');
        document.getElementById('rc-control-panel')?.classList.remove('hidden');
        document.getElementById('rc-control-panel')?.classList.add('flex');
    };

    const updatePlayerUI = (ps) => {
        if (!ps) return;
        state.playerState = ps;

        const playIcon = document.getElementById('rc-play-icon');
        if (playIcon) {
            playIcon.className = ps.playing ? 'fas fa-pause' : 'fas fa-play ml-0.5';
        }

        if (ps.currentSong) {
            const nameEl = document.getElementById('rc-song-name');
            const singerEl = document.getElementById('rc-song-singer');
            if (nameEl) nameEl.textContent = ps.currentSong.name || '未知歌曲';
            if (singerEl) singerEl.textContent = ps.currentSong.singer || '未知歌手';
        }

        const duration = ps.duration || 0;
        const position = ps.position || 0;
        const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

        const fill = document.getElementById('rc-progress-fill');
        const thumb = document.getElementById('rc-progress-thumb');
        if (fill) fill.style.width = pct + '%';
        if (thumb) thumb.style.left = pct + '%';
        document.getElementById('rc-position').textContent = formatTime(position);
        document.getElementById('rc-duration').textContent = formatTime(duration);

        const volume = ps.volume ?? 75;
        const volEl = document.getElementById('rc-volume');
        const volText = document.getElementById('rc-volume-text');
        if (volEl) volEl.value = volume;
        if (volText) volText.textContent = volume;

        const muteIcon = document.getElementById('rc-mute-icon');
        if (muteIcon) muteIcon.className = getMuteIcon(ps.muted, volume);

        const modeIcon = document.getElementById('rc-mode-icon');
        if (modeIcon) modeIcon.className = getPlayModeIcon(ps.playMode);
    };

    const renderDeviceList = () => {
        const listEl = document.getElementById('rc-device-list');
        const countEl = document.getElementById('rc-device-count');
        if (!listEl) return;

        const peers = window.P2PRemote ? window.P2PRemote.getPeerList() : [];
        const peerDeviceIds = new Set(peers.map(p => p.deviceId));

        // 合并：已连接的 peers + 扫描发现的设备（去重）
        const devices = [];
        for (const p of peers) {
            devices.push({
                connId: p.connId,
                deviceId: p.deviceId,
                name: p.name,
                deviceType: p.deviceType,
                ip: p.ip,
                port: p.port,
                connected: true,
            });
        }
        for (const d of state.discoveredDevices) {
            if (!peerDeviceIds.has(d.deviceId)) {
                devices.push({ ...d, connected: false });
            }
        }

        if (countEl) countEl.textContent = devices.length + ' 台';

        if (devices.length === 0) {
            listEl.innerHTML = `<div class="text-xs t-text-muted text-center py-6">${state.scanInProgress ? '<i class="fas fa-spinner fa-spin mr-1"></i>正在扫描...' : '未发现设备，点击「扫描」或手动输入 IP'}</div>`;
            return;
        }

        listEl.innerHTML = devices.map(d => {
            const isActive = state.activeConnId && d.connId === state.activeConnId;
            const connectBtn = d.connected
                ? (isActive
                    ? '<i class="fas fa-check text-emerald-500 text-xs"></i>'
                    : `<button onclick="event.stopPropagation();RemoteControlPanel.selectDevice('${d.connId}')" class="text-[10px] px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">选择</button>`)
                : `<button onclick="event.stopPropagation();RemoteControlPanel.connectToDevice('${d.ip}', ${d.port})" class="text-[10px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">连接</button>`;
            return `
            <div onclick="${d.connected ? `RemoteControlPanel.selectDevice('${d.connId}')` : `RemoteControlPanel.connectToDevice('${d.ip}', ${d.port})`}"
                class="flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors border ${isActive ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 'border-transparent hover:t-bg-main'}">
                <div class="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <i class="${getDeviceIcon(d.deviceType)} text-emerald-500 text-xs"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium t-text-main truncate">${d.name || '未命名设备'}</div>
                    <div class="text-[10px] t-text-muted truncate">${getDeviceTypeName(d.deviceType)} · ${d.ip || ''}:${d.port || ''}${d.connected ? ' · 已连接' : ''}</div>
                </div>
                ${connectBtn}
            </div>`;
        }).join('');
    };

    const setupProgressBar = () => {
        const bar = document.getElementById('rc-progress-bar');
        if (!bar || bar.dataset.bound === '1') return;
        bar.dataset.bound = '1';

        let dragging = false;
        const update = (e) => {
            const rect = bar.getBoundingClientRect();
            const x = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
            const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
            const dur = state.playerState?.duration || 0;
            const pos = pct * dur;
            document.getElementById('rc-progress-fill').style.width = (pct * 100) + '%';
            document.getElementById('rc-progress-thumb').style.left = (pct * 100) + '%';
            document.getElementById('rc-position').textContent = formatTime(pos);
            return pos;
        };
        bar.addEventListener('mousedown', (e) => { dragging = true; update(e); });
        document.addEventListener('mousemove', (e) => { if (dragging) update(e); });
        document.addEventListener('mouseup', (e) => {
            if (!dragging) return;
            dragging = false;
            const pos = update(e);
            sendCommand('seek', { position: pos });
        });
        bar.addEventListener('touchstart', (e) => { dragging = true; update(e); }, { passive: true });
        document.addEventListener('touchmove', (e) => { if (dragging) update(e); }, { passive: true });
        document.addEventListener('touchend', (e) => {
            if (!dragging) return;
            dragging = false;
            const pos = update(e);
            sendCommand('seek', { position: pos });
        });
    };

    const sendCommand = (command, params) => {
        if (!state.activeConnId || !window.P2PRemote) return false;
        return window.P2PRemote.sendCommand(state.activeConnId, command, params);
    };

    // 桥接状态与设备变化回调（由 P2PRemote 触发）
    const onConnectionChange = (peers) => {
        renderDeviceList();
        // 如果当前选中的连接已断开，回到空状态
        if (state.activeConnId && !peers.find(p => p.connId === state.activeConnId)) {
            state.activeConnId = null;
            state.activeDeviceInfo = null;
            showEmpty();
            setStatus('设备已离线', 'default');
        }
    };

    const onStateUpdate = (stateData, deviceInfo) => {
        // 只更新当前选中的设备状态
        if (!state.activeConnId || !deviceInfo) return;
        // 注意：P2PRemote 的 onStateUpdate 在桥接消息场景下可能没有 connId，但通过桥接来的状态属于"被动连入"的设备；
        // 由于本面板只控制主动连出的设备，这里只在 deviceInfo 与当前匹配时更新
        if (state.activeDeviceInfo && deviceInfo.deviceId === state.activeDeviceInfo.deviceId) {
            updatePlayerUI(stateData);
        } else if (state.activeDeviceInfo && state.activeDeviceInfo.ip === deviceInfo.ip) {
            updatePlayerUI(stateData);
        }
    };

    const onSearchResult = (data, reqId) => {
        const resultsEl = document.getElementById('rc-search-results');
        if (!resultsEl) return;
        const list = (data?.result || data?.list || data || []);
        if (!Array.isArray(list) || list.length === 0) {
            resultsEl.innerHTML = '<div class="text-center t-text-muted py-3">无搜索结果</div>';
            return;
        }
        resultsEl.innerHTML = list.slice(0, 30).map((s, i) => {
            const name = s.name || s.songName || '未知';
            const singer = s.singer || s.artistName || '';
            return `<div onclick='RemoteControlPanel.playSearchResult(${JSON.stringify(s).replace(/'/g, "&#39;")})'
                class="p-1.5 rounded hover:t-bg-main cursor-pointer flex items-center gap-2 transition-colors">
                <span class="text-[10px] t-text-muted w-4 text-right">${i + 1}</span>
                <div class="flex-1 min-w-0">
                    <div class="truncate t-text-main">${name}</div>
                    <div class="text-[10px] t-text-muted truncate">${singer}</div>
                </div>
                <i class="fas fa-play text-emerald-500 text-[10px]"></i>
            </div>`;
        }).join('');
    };

    // === P2PRemote API 初始化与绑定 ===
    const bindP2PRemote = () => {
        if (!window.P2PRemote) {
            setTimeout(bindP2PRemote, 1000);
            return;
        }
        window.P2PRemote.onConnectionChange = onConnectionChange;
        window.P2PRemote.onStateUpdate = onStateUpdate;
        window.P2PRemote.onSearchResult = onSearchResult;
        log.info('Bound to P2PRemote API');

        // 初始查询本地状态
        setBridgeStatus(window.P2PRemote.isBridgeConnected());
        const localState = window.P2PRemote.getLocalState();
        // 仅用于显示本地地址，需要在桥接连上后通过 /info 接口取得
        updateLocalAddrFromBridge();
    };

    const updateLocalAddrFromBridge = async () => {
        try {
            const proto = location.protocol === 'https:' ? 'https:' : 'http:';
            const resp = await fetch(`${proto}//${location.hostname}:${DEFAULT_P2P_PORT}/info`);
            if (resp.ok) {
                const info = await resp.json();
                if (info.addresses && info.addresses.length > 0) {
                    setLocalAddr(`ws://${info.addresses[0]}:${info.port}`);
                } else if (info.port) {
                    setLocalAddr(`ws://127.0.0.1:${info.port}`);
                }
                setBridgeStatus(true);
            } else {
                setLocalAddr('未启动');
                setBridgeStatus(false);
            }
        } catch (err) {
            setLocalAddr('未启动 (P2P 服务器未运行)');
            setBridgeStatus(false);
        }
    };

    const init = () => {
        if (document.getElementById('rc-control-panel')) {
            setupProgressBar();
        }
        bindP2PRemote();
    };

    // === 公开 API ===
    const scanDevices = async () => {
        if (state.scanInProgress) return;
        if (!window.P2PRemote) {
            setStatus('P2PRemote 未初始化', 'error');
            return;
        }
        state.scanInProgress = true;
        setStatus('正在扫描设备...', 'loading');
        const listEl = document.getElementById('rc-device-list');
        if (listEl) listEl.innerHTML = '<div class="text-xs t-text-muted text-center py-6"><i class="fas fa-spinner fa-spin mr-1"></i>正在扫描...</div>';
        try {
            const devices = await window.P2PRemote.scanDevices();
            log.info('Scan found', devices.length, 'devices');
            state.discoveredDevices = devices || [];
            renderDeviceList();
            if (devices.length > 0) {
                setStatus(`发现 ${devices.length} 台设备`, 'success');
            } else {
                setStatus('未发现设备', 'default');
            }
        } catch (err) {
            log.error('Scan failed:', err.message);
            setStatus('扫描失败: ' + err.message, 'error');
        } finally {
            state.scanInProgress = false;
            renderDeviceList();
        }
    };

    const selectDevice = (connId) => {
        if (!window.P2PRemote) return;
        const peers = window.P2PRemote.getPeerList();
        const peer = peers.find(p => p.connId === connId);
        if (!peer) {
            log.warn('Device not found:', connId);
            return;
        }
        state.activeConnId = connId;
        state.activeDeviceInfo = peer.deviceInfo || peer;
        state.playerState = peer.state || null;

        document.getElementById('rc-connected-name').textContent = peer.name || '未命名设备';
        document.getElementById('rc-connected-type').textContent = getDeviceTypeName(peer.deviceType) + ' · 已连接';
        document.getElementById('rc-connected-icon').className = getDeviceIcon(peer.deviceType) + ' text-emerald-500';

        showPanel();
        renderDeviceList();
        setStatus('已连接 ' + (peer.name || ''), 'success');

        // 请求远端状态（使用 requestState 而非 sendCommand('get_state')）
        window.P2PRemote.requestState(connId);

        // 启动位置自增（用于 UI 顺滑）
        if (state.positionTimer) clearInterval(state.positionTimer);
        state.positionTimer = setInterval(() => {
            if (state.playerState && state.playerState.playing) {
                state.playerState.position = (state.playerState.position || 0) + 1;
                if (state.playerState.position > (state.playerState.duration || 0)) {
                    state.playerState.position = state.playerState.duration || 0;
                }
                const dur = state.playerState.duration || 0;
                const pos = state.playerState.position;
                const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
                const fill = document.getElementById('rc-progress-fill');
                const thumb = document.getElementById('rc-progress-thumb');
                if (fill) fill.style.width = pct + '%';
                if (thumb) thumb.style.left = pct + '%';
                const posEl = document.getElementById('rc-position');
                if (posEl) posEl.textContent = formatTime(pos);
            }
        }, 1000);
    };

    const connectToDevice = async (ip, port) => {
        if (!window.P2PRemote) return;
        const pairCode = document.getElementById('rc-pair-code')?.value.trim() || '';
        setStatus(`正在连接 ${ip}:${port}...`, 'loading');
        try {
            const deviceInfo = await window.P2PRemote.connectTo(ip, port, pairCode);
            log.info('Connected to', deviceInfo);
            const peers = window.P2PRemote.getPeerList();
            const last = peers[peers.length - 1];
            if (last) {
                selectDevice(last.connId);
            }
            renderDeviceList();
        } catch (err) {
            log.error('Connect failed:', err);
            setStatus('连接失败: ' + err.message, 'error');
            if (err.message === 'AUTH_REQUIRED') {
                alert('对方需要配对码认证，请在上方填写配对码后再连接');
            } else if (err.message.includes('配对码')) {
                alert('配对码错误，请检查后重试');
            } else {
                alert('连接失败: ' + err.message);
            }
        }
    };

    const connectManual = async () => {
        const ip = document.getElementById('rc-manual-ip')?.value.trim();
        const portStr = document.getElementById('rc-manual-port')?.value.trim();
        const pairCode = document.getElementById('rc-pair-code')?.value.trim() || '';

        if (!ip) { alert('请输入 IP 地址'); return; }
        if (!portStr) { alert('请输入端口号'); return; }
        const port = parseInt(portStr);
        if (!port || port < 1 || port > 65535) { alert('端口号无效'); return; }

        if (!window.P2PRemote) { alert('P2PRemote 未初始化'); return; }

        setStatus('正在连接 ' + ip + ':' + port + '...', 'loading');
        try {
            const deviceInfo = await window.P2PRemote.connectTo(ip, port, pairCode);
            log.info('Connected to', deviceInfo);
            // 选中刚连上的设备
            const peers = window.P2PRemote.getPeerList();
            const last = peers[peers.length - 1];
            if (last) {
                selectDevice(last.connId);
            }
        } catch (err) {
            log.error('Connect failed:', err);
            setStatus('连接失败: ' + err.message, 'error');
            if (err.message === 'AUTH_REQUIRED') {
                alert('对方需要配对码认证，请在上方填写配对码后再连接');
            } else if (err.message.includes('配对码')) {
                alert('配对码错误，请检查后重试');
            } else {
                alert('连接失败: ' + err.message);
            }
        }
    };

    const disconnect = () => {
        if (!state.activeConnId) return;
        window.P2PRemote?.disconnect(state.activeConnId);
        state.activeConnId = null;
        state.activeDeviceInfo = null;
        state.playerState = null;
        if (state.positionTimer) { clearInterval(state.positionTimer); state.positionTimer = null; }
        showEmpty();
        renderDeviceList();
        setStatus('已断开', 'default');
    };

    const togglePlay = () => {
        sendCommand('toggle_play', {});
        if (state.playerState) {
            state.playerState.playing = !state.playerState.playing;
            const icon = document.getElementById('rc-play-icon');
            if (icon) icon.className = state.playerState.playing ? 'fas fa-pause' : 'fas fa-play ml-0.5';
        }
    };

    const next = () => sendCommand('next', {});
    const prev = () => sendCommand('prev', {});

    const toggleMute = () => {
        sendCommand('toggle_mute', {});
        if (state.playerState) {
            state.playerState.muted = !state.playerState.muted;
            const icon = document.getElementById('rc-mute-icon');
            if (icon) icon.className = getMuteIcon(state.playerState.muted, state.playerState.volume ?? 75);
        }
    };

    const togglePlayMode = () => {
        const modes = ['loop_list', 'loop_single', 'shuffle', 'sequential'];
        const cur = state.playerState?.playMode || 'loop_list';
        const nextMode = modes[(modes.indexOf(cur) + 1) % modes.length];
        sendCommand('set_play_mode', { mode: nextMode });
        if (state.playerState) {
            state.playerState.playMode = nextMode;
            const icon = document.getElementById('rc-mode-icon');
            if (icon) icon.className = getPlayModeIcon(nextMode);
        }
    };

    let volumeSendTimer = null;
    const onVolumeInput = (val) => {
        const v = parseInt(val) || 0;
        document.getElementById('rc-volume-text').textContent = v;
        const icon = document.getElementById('rc-mute-icon');
        if (icon) icon.className = getMuteIcon(v === 0, v);
        // 节流：300ms 内只发送一次
        if (volumeSendTimer) clearTimeout(volumeSendTimer);
        volumeSendTimer = setTimeout(() => {
            sendCommand('volume', { volume: v });
            volumeSendTimer = null;
        }, 300);
    };

    const setSearchSource = (src) => {
        state.searchSource = src;
        document.querySelectorAll('#rc-search-source button').forEach(b => {
            if (b.dataset.src === src) {
                b.classList.add('border-emerald-500', 'text-emerald-500');
            } else {
                b.classList.remove('border-emerald-500', 'text-emerald-500');
            }
        });
    };

    const search = () => {
        if (!state.activeConnId) {
            alert('请先连接设备');
            return;
        }
        const keywords = document.getElementById('rc-search-input').value.trim();
        if (!keywords) return;
        const resultsEl = document.getElementById('rc-search-results');
        if (resultsEl) resultsEl.innerHTML = '<div class="text-center t-text-muted py-3"><i class="fas fa-spinner fa-spin mr-1"></i>搜索中...</div>';
        const reqId = window.P2PRemote.sendSearch(state.activeConnId, keywords, state.searchSource);
        if (!reqId) {
            if (resultsEl) resultsEl.innerHTML = '<div class="text-center text-red-500 py-3">发送失败</div>';
        }
    };

    const playSearchResult = (songInfo) => {
        if (!state.activeConnId) return;
        // 远端播放这首歌
        sendCommand('play_song', { songInfo });
        // 同时也添加到队列
        sendCommand('add_to_queue', { songInfo });
    };

    // === 自动初始化 ===
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.RemoteControlPanel = {
        scanDevices,
        selectDevice,
        connectToDevice,
        connectManual,
        disconnect,
        togglePlay,
        next,
        prev,
        toggleMute,
        togglePlayMode,
        onVolumeInput,
        setSearchSource,
        search,
        playSearchResult,
    };

    // 兼容旧调用：将 open() 重定向到 switchTab('remote')
    window.RemoteControlPanel.open = () => { if (typeof switchTab === 'function') switchTab('remote'); };
})();
