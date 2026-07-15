(function () {
    'use strict';

    const LOG = {
        info: (...a) => console.log('[P2PRemote]', ...a),
        warn: (...a) => console.warn('[P2PRemote]', ...a),
        error: (...a) => console.error('[P2PRemote]', ...a),
    };

    const P2P_PORT = 9528;
    const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

    // 已建立的直连（作为客户端主动连出的）
    const peers = new Map(); // connId → { ws, deviceInfo, state, lastStateStr }

    // 本地桥接（连接到本机 9528 端口的 P2P 服务器，用于接收被动连入的设备事件）
    let bridgeWs = null;
    let bridgeConnected = false;

    // 被动连入的设备列表（通过桥接获取）
    let incomingDevices = [];

    // 心跳
    let heartbeatTimer = null;

    const mapPlayModeToRemote = (mode) => {
        const map = { list: 'loop_list', single: 'loop_single', random: 'shuffle', order: 'sequential' };
        return map[mode] || 'loop_list';
    };

    const mapPlayModeFromRemote = (mode) => {
        const map = { loop_list: 'list', loop_single: 'single', shuffle: 'random', sequential: 'order' };
        return map[mode] || 'list';
    };

    const getLocalState = () => {
        const song = (typeof window !== 'undefined' && window.currentPlayingSong) || null;
        const audioEl = typeof audio !== 'undefined' ? audio : null;

        let currentSong = null;
        if (song) {
            currentSong = {
                name: song.name || '',
                singer: song.singer || '',
                album: song.albumName || song.album || '',
                duration: song.duration || (audioEl ? audioEl.duration : 0) || 0,
                songId: song.songId || song.id || song.songmid || '',
                source: song.source || '',
                picUrl: song.picUrl || song.img || song.pic || '',
                img: song.img || song.pic || '',
                pic: song.pic || '',
                songmid: song.songmid || song.songId || '',
                hash: song.hash || '',
                interval: song.interval || '',
                copyrightId: song.copyrightId || '',
                albumId: song.albumId || '',
                types: song.types || [],
            };
        }

        const playlist = (typeof window !== 'undefined' && window.currentPlaylist || []).map(item => ({
            name: item.name || '',
            singer: item.singer || '',
            songId: item.songId || item.id || '',
            source: item.source || '',
            duration: item.duration || 0,
            picUrl: item.picUrl || item.img || item.pic || '',
            img: item.img || item.pic || '',
            pic: item.pic || '',
        }));

        return {
            playing: audioEl ? !audioEl.paused : false,
            position: audioEl ? (audioEl.currentTime || 0) : 0,
            duration: audioEl ? (audioEl.duration || 0) : 0,
            volume: Math.round((typeof currentVolume !== 'undefined' ? currentVolume : (audioEl ? audioEl.volume : 0.75)) * 100),
            muted: (typeof isMuted !== 'undefined' ? isMuted : false) || (audioEl ? audioEl.muted : false),
            playMode: mapPlayModeToRemote(typeof playMode !== 'undefined' ? playMode : 'list'),
            playbackRate: audioEl ? (audioEl.playbackRate || 1) : 1,
            currentSong: currentSong,
            currentIndex: typeof currentIndex !== 'undefined' ? currentIndex : 0,
            playlist: playlist,
            isFavorite: typeof getFavoriteStatus === 'function' ? getFavoriteStatus() : false,
        };
    };

    const broadcastLocalState = () => {
        const state = getLocalState();
        const stateStr = JSON.stringify(state);

        // 广播给主动连出的设备
        const msg = JSON.stringify({ type: 'state_update', data: state });
        for (const [, peer] of peers) {
            if (peer.ws.readyState === 1 && peer.lastStateStr !== stateStr) {
                try { peer.ws.send(msg); peer.lastStateStr = stateStr; } catch {}
            }
        }

        // 通过桥接广播给被动连入的设备
        if (bridgeWs && bridgeWs.readyState === 1) {
            try { bridgeWs.send(JSON.stringify({ type: 'state_update', data: state })); } catch {}
        }
    };

    const handleCommand = (msg) => {
        const command = msg.command;
        const params = msg.params || {};
        LOG.info('Received command:', command);
        try {
            switch (command) {
                case 'play': if (typeof audio !== 'undefined' && audio.paused && typeof togglePlay === 'function') togglePlay(); break;
                case 'pause': if (typeof audio !== 'undefined' && !audio.paused && typeof togglePlay === 'function') togglePlay(); break;
                case 'toggle_play': if (typeof togglePlay === 'function') togglePlay(); break;
                case 'next': if (typeof playNext === 'function') playNext(); break;
                case 'prev': if (typeof playPrev === 'function') playPrev(); break;
                case 'seek':
                    if (typeof audio !== 'undefined' && typeof params.position === 'number' && audio.duration) {
                        audio.currentTime = Math.max(0, Math.min(params.position, audio.duration));
                    }
                    break;
                case 'volume':
                    if (typeof params.volume === 'number') {
                        const vol = Math.max(0, Math.min(100, params.volume)) / 100;
                        if (typeof currentVolume !== 'undefined') currentVolume = vol;
                        if (typeof audio !== 'undefined') audio.volume = vol;
                        if (typeof isMuted !== 'undefined') isMuted = false;
                        if (typeof audio !== 'undefined') audio.muted = false;
                        if (typeof updateVolumeUI === 'function') updateVolumeUI();
                    }
                    break;
                case 'toggle_mute': if (typeof toggleMute === 'function') toggleMute(); break;
                case 'set_play_mode':
                    if (typeof setPlayMode === 'function' && params.mode) {
                        setPlayMode(mapPlayModeFromRemote(params.mode));
                    }
                    break;
                case 'play_song':
                    if (params?.songInfo && typeof playSong === 'function') {
                        const s = params.songInfo;
                        const song = {
                            ...s,
                            id: s.songId || s.id,
                            songmid: s.songId || s.songmid,
                        };
                        playSong(song, 0);
                    }
                    break;
                case 'add_to_queue':
                    if (params?.songInfo && typeof playSong === 'function') {
                        const s = params.songInfo;
                        const song = { ...s, id: s.songId || s.id, songmid: s.songId || s.songmid };
                        if (typeof currentPlaylist !== 'undefined' && typeof currentIndex !== 'undefined') {
                            currentPlaylist.push(song);
                        }
                    }
                    break;
                case 'clear_queue': if (typeof clearQueue === 'function') clearQueue(); break;
                case 'set_playback_rate':
                    if (typeof setPlaybackRate === 'function' && typeof params?.rate === 'number') {
                        setPlaybackRate(params.rate);
                    }
                    break;
                case 'remove_from_queue':
                    if (typeof removeFromQueue === 'function' && typeof params?.index === 'number') {
                        removeFromQueue(params.index);
                    }
                    break;
                case 'reorder_queue':
                    if (typeof reorderQueue === 'function' && typeof params?.fromIndex === 'number' && typeof params?.toIndex === 'number') {
                        reorderQueue(params.fromIndex, params.toIndex);
                    }
                    break;
                case 'set_sleep_timer':
                    if (typeof setSleepTimer === 'function' && typeof params?.minutes === 'number') {
                        setSleepTimer(params.minutes);
                    }
                    break;
                case 'cancel_sleep_timer':
                    if (typeof cancelSleepTimer === 'function') cancelSleepTimer();
                    break;
                case 'collect_current_song':
                case 'uncollect_current_song':
                    if (typeof toggleFavorites === 'function') toggleFavorites();
                    break;
            }
        } catch (err) {
            LOG.error('Command execution error:', err);
        }
        setTimeout(() => broadcastLocalState(), 150);
    };

    // 处理桥接消息（来自被动连入设备）
    const handleBridgeMessage = (msg) => {
        switch (msg.type) {
            case 'command':
                handleCommand(msg);
                break;
            case 'get_state':
                if (bridgeWs && bridgeWs.readyState === 1) {
                    bridgeWs.send(JSON.stringify({
                        type: 'state_response',
                        id: msg.id,
                        data: { targetDeviceId: msg.data?.fromDevice?.deviceId, state: getLocalState() },
                    }));
                }
                break;
            case 'search':
                if (typeof window.performSearch === 'function') {
                    window.performSearch(msg.params?.keywords || '', msg.params?.source).then(results => {
                        if (bridgeWs && bridgeWs.readyState === 1) {
                            bridgeWs.send(JSON.stringify({
                                type: 'search_result',
                                id: msg.id,
                                data: { targetDeviceId: msg.data?.fromDevice?.deviceId, result: results },
                            }));
                        }
                    });
                }
                break;
            case 'state_update':
                if (msg.data?.fromDevice) {
                    if (currentCastTarget && currentCastTarget.deviceInfo?.deviceId === msg.data.fromDevice.deviceId) {
                        applyRemoteStateToPlayerBar(msg.data.state);
                    }
                    if (P2PRemote.onStateUpdate) P2PRemote.onStateUpdate(msg.data.state, msg.data.fromDevice);
                }
                break;
            case 'state_response':
                // 被动连入设备的状态响应
                if (msg.data?.fromDevice) {
                    if (currentCastTarget && currentCastTarget.deviceInfo?.deviceId === msg.data.fromDevice.deviceId) {
                        applyRemoteStateToPlayerBar(msg.data.state);
                    }
                    if (P2PRemote.onStateUpdate) P2PRemote.onStateUpdate(msg.data.state, msg.data.fromDevice);
                }
                break;
            case 'search_result':
                // 被动连入设备的搜索结果
                if (P2PRemote.onSearchResult) {
                    P2PRemote.onSearchResult(msg.data?.result ?? msg.data, msg.id);
                }
                break;
            case 'device_offline':
                incomingDevices = msg.data?.devices || [];
                updateCastUI();
                if (P2PRemote.onConnectionChange) P2PRemote.onConnectionChange(getAllPeers());
                break;
            case 'discovery_response':
                incomingDevices = msg.data?.devices || [];
                updateCastUI();
                if (P2PRemote.onConnectionChange) P2PRemote.onConnectionChange(getAllPeers());
                break;
        }
    };

    const connectBridge = () => {
        if (bridgeWs && bridgeWs.readyState <= 1) return;
        try {
            const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = location.hostname;
            bridgeWs = new WebSocket(`${wsProtocol}//${wsHost}:${P2P_PORT}/bridge`);

            bridgeWs.onopen = () => {
                bridgeConnected = true;
                LOG.info('Bridge connected to local P2P server');
                bridgeWs.send(JSON.stringify({ type: 'get_devices' }));
            };

            bridgeWs.onmessage = (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch { return; }
                handleBridgeMessage(msg);
            };

            bridgeWs.onclose = () => {
                bridgeConnected = false;
                bridgeWs = null;
                LOG.warn('Bridge disconnected, retrying in 3s...');
                setTimeout(connectBridge, 3000);
            };

            bridgeWs.onerror = () => {
                LOG.warn('Bridge connection error');
            };
        } catch (err) {
            LOG.warn('Bridge connect failed:', err.message);
            setTimeout(connectBridge, 3000);
        }
    };

    // 主动连接到目标设备
    const connectTo = (ip, port, pairCodeStr) => {
        return new Promise((resolve, reject) => {
            const wsUrl = `ws://${ip}:${port}`;
            const ws = new WebSocket(wsUrl);
            const connId = genId();
            const state = { resolved: false };

            ws.onopen = () => {
                LOG.info('Connecting to', wsUrl);
                ws.send(JSON.stringify({
                    type: 'hello',
                    data: {
                        deviceId: P2PRemote.localDeviceId,
                        name: 'LX Music Web - ' + (navigator.platform || 'Browser'),
                        deviceType: 'web',
                        version: P2PRemote.version,
                        ip: '0.0.0.0',
                        port: P2P_PORT,
                    },
                }));
            };

            ws.onmessage = (e) => {
                let msg;
                try { msg = JSON.parse(e.data); } catch { return; }
                switch (msg.type) {
                    case 'hello_ack':
                        if (!state.resolved) {
                            state.resolved = true;
                            peers.set(connId, { ws, deviceInfo: msg.data, state: null, lastStateStr: '' });
                            resolve(msg.data);
                            updateCastUI();
                if (P2PRemote.onConnectionChange) P2PRemote.onConnectionChange(getAllPeers());
                            ws.send(JSON.stringify({ type: 'get_state', id: genId() }));
                        }
                        break;
                    case 'auth_required':
                        if (!pairCodeStr) {
                            state.resolved = true;
                            ws.close();
                            reject(new Error('AUTH_REQUIRED'));
                        } else {
                            ws.send(JSON.stringify({ type: 'auth', data: { code: pairCodeStr } }));
                        }
                        break;
                    case 'auth_result':
                        if (msg.success === false && !state.resolved) {
                            state.resolved = true;
                            ws.close();
                            reject(new Error('配对码错误'));
                        }
                        break;
                    case 'command':
                        handleCommand(msg);
                        break;
                    case 'state_update': {
                        const peer = peers.get(connId);
                        if (peer) {
                            peer.state = msg.data;
                            if (currentCastTarget && currentCastTarget.connId === connId) {
                                applyRemoteStateToPlayerBar(msg.data);
                            }
                            if (P2PRemote.onStateUpdate) P2PRemote.onStateUpdate(msg.data, peer.deviceInfo);
                        }
                        break;
                    }
                    case 'get_state':
                        ws.send(JSON.stringify({ type: 'state_response', id: msg.id, data: getLocalState() }));
                        break;
                    case 'state_response': {
                        const peer = peers.get(connId);
                        if (peer) {
                            peer.state = msg.data;
                            if (currentCastTarget && currentCastTarget.connId === connId) {
                                applyRemoteStateToPlayerBar(msg.data);
                            }
                            if (P2PRemote.onStateUpdate) P2PRemote.onStateUpdate(msg.data, peer.deviceInfo);
                        }
                        break;
                    }
                    case 'search_result':
                        if (P2PRemote.onSearchResult) P2PRemote.onSearchResult(msg.data, msg.id);
                        break;
                    case 'pong': break;
                }
            };

            ws.onerror = () => { if (!state.resolved) { state.resolved = true; reject(new Error('连接失败')); } };
            ws.onclose = () => {
                peers.delete(connId);
                updateCastUI();
                if (P2PRemote.onConnectionChange) P2PRemote.onConnectionChange(getAllPeers());
            };
        });
    };

    const sendCommand = (connId, command, params) => {
        const peer = peers.get(connId);
        if (peer) {
            if (peer.ws.readyState !== 1) return false;
            const id = genId();
            peer.ws.send(JSON.stringify({ type: 'command', id, command, params }));
            return true;
        }
        // 被动连入设备：通过桥接转发
        const incoming = (incomingDevices || []).find(d => d.connId === connId);
        if (incoming && bridgeWs && bridgeWs.readyState === 1) {
            const id = genId();
            bridgeWs.send(JSON.stringify({
                type: 'send_command_to',
                id,
                targetConnId: connId,
                command,
                params: params || {},
            }));
            return true;
        }
        return false;
    };

    const sendSearch = (connId, keywords, source) => {
        const peer = peers.get(connId);
        if (peer) {
            if (peer.ws.readyState !== 1) return null;
            const id = genId();
            peer.ws.send(JSON.stringify({ type: 'search', id, params: { keywords, source } }));
            return id;
        }
        // 被动连入设备：通过桥接转发
        const incoming = (incomingDevices || []).find(d => d.connId === connId);
        if (incoming && bridgeWs && bridgeWs.readyState === 1) {
            const id = genId();
            bridgeWs.send(JSON.stringify({
                type: 'send_search_to',
                id,
                targetConnId: connId,
                params: { keywords, source },
            }));
            return id;
        }
        return null;
    };

    const disconnect = (connId) => {
        const peer = peers.get(connId);
        if (peer) { peer.ws.close(); peers.delete(connId); }
        else if (bridgeWs && bridgeWs.readyState === 1) {
            // 通过桥接请求断开被动连入的设备
            bridgeWs.send(JSON.stringify({ type: 'disconnect_device', targetConnId: connId }));
        }
        if (P2PRemote.onConnectionChange) P2PRemote.onConnectionChange(getAllPeers());
    };

    const getAllPeers = () => {
        const outgoing = Array.from(peers.entries()).map(([id, p]) => ({
            connId: id, direction: 'outgoing', connected: p.ws.readyState === 1,
            ...p.deviceInfo, state: p.state,
        }));
        const incoming = (incomingDevices || []).map(d => ({
            connId: d.connId, direction: 'incoming', connected: true,
            ...d.device,
        }));
        return [...outgoing, ...incoming];
    };

    // 局域网设备扫描（HTTP 轮询方式）
    const scanDevices = async () => {
        const results = [];
        const seenIds = new Set();

        // 1. 先从本地 P2P 服务器获取 UDP 发现的设备（快速）
        try {
            const proto = location.protocol;
            const discoveredResp = await fetch(`${proto}//${location.hostname}:${P2P_PORT}/discovered`, { signal: AbortSignal.timeout(2000) });
            if (discoveredResp.ok) {
                const data = await discoveredResp.json();
                if (data.devices && Array.isArray(data.devices)) {
                    for (const d of data.devices) {
                        if (d.deviceId && !seenIds.has(d.deviceId)) {
                            seenIds.add(d.deviceId);
                            results.push(d);
                        }
                    }
                }
            }
        } catch (e) {
            // 本地 P2P 服务器可能未启动，继续走 HTTP 扫描
        }

        // 2. 快速检查本机（开发环境两端可能同机）
        const localChecks = [
            fetch(`http://localhost:23331/discovery`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`http://127.0.0.1:23331/discovery`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`http://localhost:9528/discovery`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok ? r.json() : null).catch(() => null),
        ];
        const localResults = await Promise.all(localChecks);
        for (const r of localResults) {
            if (r && r.action === 'lx_music_discovery' && r.deviceId && !seenIds.has(r.deviceId)) {
                seenIds.add(r.deviceId);
                results.push(r);
            }
        }

        // 3. HTTP 扫描局域网（补充 UDP 未发现的设备）
        const localIP = await getLocalIP();
        if (localIP) {
            const subnet = localIP.split('.').slice(0, 3).join('.');
            const ports = [P2P_PORT, 23331];

            const batchSize = 20;
            for (const port of ports) {
                for (let i = 1; i <= 254; i += batchSize) {
                    const batch = [];
                    for (let j = i; j < i + batchSize && j <= 254; j++) {
                        const ip = `${subnet}.${j}`;
                        batch.push(
                            fetch(`http://${ip}:${port}/discovery`, { signal: AbortSignal.timeout(1500) })
                                .then(r => r.ok ? r.json() : null)
                                .catch(() => null)
                        );
                    }
                    const batchResults = await Promise.all(batch);
                    for (const r of batchResults) {
                        if (r && r.action === 'lx_music_discovery' && r.deviceId && !seenIds.has(r.deviceId)) {
                            seenIds.add(r.deviceId);
                            results.push(r);
                        }
                    }
                }
            }
        }
        return results;
    };

    const getLocalIP = async () => {
        try {
            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel('');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            return new Promise((resolve) => {
                pc.onicecandidate = (e) => {
                    if (!e.candidate) { pc.close(); return; }
                    const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
                    if (match) { pc.close(); resolve(match[1]); }
                };
                setTimeout(() => { pc.close(); resolve(null); }, 3000);
            });
        } catch { return null; }
    };

    const startHeartbeat = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
            for (const peer of peers.values()) {
                if (peer.ws.readyState === 1) {
                    try { peer.ws.send(JSON.stringify({ type: 'ping' })); } catch {}
                }
            }
            if (bridgeWs && bridgeWs.readyState === 1) {
                try { bridgeWs.send(JSON.stringify({ type: 'ping' })); } catch {}
            }
        }, 30000);
    };

    // ===== 投屏模式 =====
    let currentCastTarget = null; // { connId, deviceInfo }

    const setCastTarget = (connId) => {
        if (connId === null) {
            currentCastTarget = null;
            restoreLocalPlayerBar();
        } else {
            const peer = peers.get(connId);
            const incoming = (incomingDevices || []).find(d => d.connId === connId);
            if (peer) {
                currentCastTarget = { connId, deviceInfo: peer.deviceInfo, direction: 'outgoing' };
                requestState(connId);
            } else if (incoming) {
                currentCastTarget = { connId, deviceInfo: incoming.device, direction: 'incoming' };
                requestState(connId);
            } else {
                return;
            }
        }
        updateCastUI();
        const menu = document.getElementById('cast-menu');
        if (menu) menu.classList.add('hidden');
    };

    const toggleCastMenu = (e) => {
        if (e) e.stopPropagation();
        const menu = document.getElementById('cast-menu');
        if (!menu) return;
        menu.classList.toggle('hidden');
        if (!menu.classList.contains('hidden')) {
            renderCastMenu();
        }
    };

    const renderCastMenu = () => {
        const listEl = document.getElementById('cast-menu-list');
        if (!listEl) return;
        let html = `<div class="px-3 py-2 cursor-pointer hover:t-bg-main ${!currentCastTarget ? 't-text-primary font-medium' : 't-text-muted'}" onclick="P2PRemote.setCastTarget(null)">
            <i class="fas fa-check mr-2 ${!currentCastTarget ? '' : 'opacity-0'}"></i>本机
        </div><div class="border-t t-border-main"></div>`;
        const allPeers = getAllPeers();
        if (allPeers.length === 0) {
            html += `<div class="px-3 py-2 text-xs t-text-muted text-center">未连接设备</div>`;
        } else {
            for (const p of allPeers) {
                const isCurrent = currentCastTarget && currentCastTarget.connId === p.connId;
                const icon = p.deviceType === 'desktop' ? 'fa-desktop' : p.deviceType === 'mobile' ? 'fa-mobile-alt' : 'fa-globe';
                html += `<div class="px-3 py-2 cursor-pointer hover:t-bg-main ${isCurrent ? 't-text-primary font-medium' : 't-text-muted'}" onclick="P2PRemote.setCastTarget('${p.connId}')">
                    <i class="fas fa-check mr-2 ${isCurrent ? '' : 'opacity-0'}"></i><i class="fas ${icon} mr-1"></i>${p.name || '未知设备'}
                </div>`;
            }
        }
        listEl.innerHTML = html;
    };

    const updateCastUI = () => {
        const btn = document.getElementById('btn-cast');
        const label = document.getElementById('cast-target-label');
        const nameSpan = document.getElementById('cast-target-name');
        const allPeers = getAllPeers();

        if (currentCastTarget) {
            if (btn) btn.classList.remove('hidden');
            if (label) {
                label.classList.remove('hidden');
                if (nameSpan) nameSpan.textContent = currentCastTarget.deviceInfo?.name || '未知设备';
            }
        } else if (allPeers.length > 0) {
            if (btn) btn.classList.remove('hidden');
            if (label) label.classList.add('hidden');
        } else {
            if (btn) btn.classList.add('hidden');
            if (label) label.classList.add('hidden');
        }
    };

    const onOutsideClick = (e) => {
        const menu = document.getElementById('cast-menu');
        const btn = document.getElementById('btn-cast');
        if (!menu || menu.classList.contains('hidden')) return;
        if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
        menu.classList.add('hidden');
    };

    const applyRemoteStateToPlayerBar = (state) => {
        if (!currentCastTarget) return;

        P2PRemote._updatingFromRemote = true;

        const titleEl = document.getElementById('player-title');
        const artistEl = document.getElementById('player-artist');
        const coverEl = document.getElementById('player-cover') || document.querySelector('#player-song-info img');
        const progressBar = document.getElementById('progress-bar');
        const timeCurrent = document.getElementById('time-current');
        const timeTotal = document.getElementById('time-total');
        const playIcon = document.querySelector('#btn-play i');
        const volumeBar = document.getElementById('volume-bar');
        const volumeIcon = document.getElementById('volume-icon');
        const modeBtn = document.getElementById('btn-play-mode');
        const favBtn = document.getElementById('player-like-btn');
        const rateDisplay = document.getElementById('playback-rate-display');

        if (state.currentSong) {
            if (titleEl) {
                titleEl.textContent = state.currentSong.name || '暂无播放';
                titleEl.setAttribute('data-text', state.currentSong.name || '暂无播放');
            }
            if (artistEl) {
                artistEl.textContent = state.currentSong.singer || '';
                artistEl.setAttribute('data-text', state.currentSong.singer || '');
            }

            const coverUrl = state.currentSong.picUrl || state.currentSong.img || state.currentSong.pic || '';
            if (coverEl && coverUrl) {
                if (coverEl.tagName === 'IMG') {
                    coverEl.src = coverUrl;
                } else {
                    coverEl.style.backgroundImage = `url(${coverUrl})`;
                }
            }
        }

        if (typeof state.playing === 'boolean' && playIcon) {
            playIcon.className = state.playing ? 'fas fa-pause text-xl md:text-2xl' : 'fas fa-play ml-1 text-xl md:text-2xl';
        }

        if (state.duration > 0 && progressBar && !P2PRemote._seekDragging) {
            progressBar.style.width = (state.position / state.duration * 100) + '%';
        }
        if (timeCurrent) timeCurrent.textContent = formatTime(state.position || 0);
        if (timeTotal) timeTotal.textContent = formatTime(state.duration || 0);

        if (typeof state.volume === 'number') {
            const displayVol = state.muted ? 0 : state.volume;
            if (volumeBar) volumeBar.style.width = displayVol + '%';
            if (volumeIcon) {
                if (state.muted || state.volume === 0) {
                    volumeIcon.className = 'fas fa-volume-mute w-4';
                } else if (state.volume < 50) {
                    volumeIcon.className = 'fas fa-volume-down w-4';
                } else {
                    volumeIcon.className = 'fas fa-volume-up w-4';
                }
            }
        }

        if (modeBtn) {
            const modeIconMap = { loop_list: 'fa-repeat', loop_single: 'fa-1', shuffle: 'fa-shuffle', sequential: 'fa-arrow-right-long' };
            const icon = modeBtn.querySelector('i');
            if (icon) icon.className = 'fas ' + (modeIconMap[state.playMode] || 'fa-repeat');
        }

        if (favBtn) {
            const icon = favBtn.querySelector('i');
            if (icon) {
                icon.className = state.isFavorite ? 'fas fa-heart text-red-500 text-base md:text-lg' : 'fas fa-heart text-gray-300 text-base md:text-lg';
            }
        }

        if (rateDisplay) rateDisplay.textContent = state.playbackRate + 'x';

        updateCastModeButtons();

        setTimeout(() => { P2PRemote._updatingFromRemote = false; }, 50);
    };

    const updateCastModeButtons = () => {
        const isCast = !!currentCastTarget;
        const hideIds = ['btn-download', 'btn-lyric-card', 'btn-equalizer', 'btn-visualizer'];
        hideIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (isCast) el.classList.add('hidden');
                else el.classList.remove('hidden');
            }
        });
        if (isCast) document.body.classList.add('cast-mode');
        else document.body.classList.remove('cast-mode');
    };

    const restoreLocalPlayerBar = () => {
        const song = typeof window !== 'undefined' && window.currentPlayingSong;
        const audioEl = typeof audio !== 'undefined' ? audio : null;

        if (song) {
            const titleEl = document.getElementById('player-title');
            const artistEl = document.getElementById('player-artist');
            if (titleEl) {
                titleEl.textContent = song.name || '';
                titleEl.setAttribute('data-text', song.name || '');
            }
            if (artistEl) {
                artistEl.textContent = song.singer || '';
                artistEl.setAttribute('data-text', song.singer || '');
            }

            const coverUrl = song.picUrl || song.img || song.pic || '';
            const coverEl = document.getElementById('player-cover') || document.querySelector('#player-song-info img');
            if (coverEl && coverUrl) {
                if (coverEl.tagName === 'IMG') {
                    coverEl.src = coverUrl;
                } else {
                    coverEl.style.backgroundImage = `url(${coverUrl})`;
                }
            }
        }

        if (audioEl) {
            const playIcon = document.querySelector('#btn-play i');
            if (playIcon) {
                playIcon.className = !audioEl.paused ? 'fas fa-pause text-xl md:text-2xl' : 'fas fa-play ml-1 text-xl md:text-2xl';
            }

            if (audioEl.duration) {
                const progressBar = document.getElementById('progress-bar');
                const timeCurrent = document.getElementById('time-current');
                const timeTotal = document.getElementById('time-total');
                if (progressBar) progressBar.style.width = (audioEl.currentTime / audioEl.duration * 100) + '%';
                if (timeCurrent) timeCurrent.textContent = formatTime(audioEl.currentTime);
                if (timeTotal) timeTotal.textContent = formatTime(audioEl.duration);
            }
        }

        if (typeof updateVolumeUI === 'function') updateVolumeUI();

        if (typeof updatePlayModeUI === 'function') updatePlayModeUI();

        if (song && typeof updatePlayerInfo === 'function') {
            updatePlayerInfo(song);
        }

        if (typeof updatePlaybackRateUI === 'function') updatePlaybackRateUI();

        const hideIds = ['btn-download', 'btn-lyric-card', 'btn-equalizer', 'btn-visualizer'];
        hideIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('hidden');
        });

        document.body.classList.remove('cast-mode');
        P2PRemote._updatingFromRemote = false;
    };

    const formatTime = (sec) => {
        sec = Math.floor(sec || 0);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const requestState = (connId) => {
        const peer = peers.get(connId);
        if (peer && peer.ws.readyState === 1) {
            const id = genId();
            peer.ws.send(JSON.stringify({ type: 'get_state', id }));
            return id;
        }
        // 被动连入设备：通过桥接请求状态
        const incoming = (incomingDevices || []).find(d => d.connId === connId);
        if (incoming && bridgeWs && bridgeWs.readyState === 1) {
            const id = genId();
            bridgeWs.send(JSON.stringify({ type: 'send_get_state_to', id, targetConnId: connId }));
            return id;
        }
        return null;
    };

    const init = () => {
        if (typeof audio === 'undefined') { setTimeout(init, 500); return; }

        P2PRemote.localDeviceId = localStorage.getItem('lx_p2p_device_id') || genId();
        localStorage.setItem('lx_p2p_device_id', P2PRemote.localDeviceId);

        ['play', 'pause', 'ended', 'seeked', 'volumechange'].forEach(evt => {
            audio.addEventListener(evt, () => setTimeout(broadcastLocalState, 50));
        });
        if (typeof window !== 'undefined') {
            window.addEventListener('playmode-changed', () => setTimeout(broadcastLocalState, 50));
        }

        connectBridge();
        startHeartbeat();
        document.addEventListener('click', onOutsideClick, true);
        LOG.info('P2P Remote module initialized, deviceId:', P2PRemote.localDeviceId);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.P2PRemote = {
        localDeviceId: '',
        version: '1.9.5',
        _updatingFromRemote: false,
        _seekDragging: false,
        connectTo,
        sendCommand,
        sendSearch,
        requestState,
        disconnect,
        getPeerList: getAllPeers,
        getPeer: (connId) => peers.get(connId) || null,
        scanDevices,
        getLocalState,
        broadcastLocalState,
        isBridgeConnected: () => bridgeConnected,
        setCastTarget,
        toggleCastMenu,
        get currentCastTarget() { return currentCastTarget; },
        onConnectionChange: null,
        onStateUpdate: null,
        onSearchResult: null,
    };
})();
