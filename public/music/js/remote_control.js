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
        return {
            playing: audioEl ? !audioEl.paused : false,
            position: audioEl ? (audioEl.currentTime || 0) : 0,
            duration: audioEl ? (audioEl.duration || 0) : 0,
            volume: Math.round((typeof currentVolume !== 'undefined' ? currentVolume : (audioEl ? audioEl.volume : 0.75)) * 100),
            muted: (typeof isMuted !== 'undefined' ? isMuted : false) || (audioEl ? audioEl.muted : false),
            currentSong: song ? {
                name: song.name || '',
                singer: song.singer || '',
                album: song.albumName || song.album || '',
                duration: song.duration || (audioEl ? audioEl.duration : 0) || 0,
                songId: song.songId || song.id || song.songmid || '',
                source: song.source || '',
            } : null,
            playMode: mapPlayModeToRemote(typeof playMode !== 'undefined' ? playMode : 'list'),
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
                if (P2PRemote.onStateUpdate && msg.data?.fromDevice) {
                    P2PRemote.onStateUpdate(msg.data.state, msg.data.fromDevice);
                }
                break;
            case 'state_response':
                // 被动连入设备的状态响应
                if (P2PRemote.onStateUpdate && msg.data?.fromDevice) {
                    P2PRemote.onStateUpdate(msg.data.state, msg.data.fromDevice);
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
                if (P2PRemote.onConnectionChange) P2PRemote.onConnectionChange(getAllPeers());
                break;
            case 'discovery_response':
                incomingDevices = msg.data?.devices || [];
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
                            if (P2PRemote.onStateUpdate) P2PRemote.onStateUpdate(msg.data, peer.deviceInfo);
                        }
                        break;
                    }
                    case 'get_state':
                        ws.send(JSON.stringify({ type: 'state_response', id: msg.id, data: getLocalState() }));
                        break;
                    case 'state_response': {
                        const peer = peers.get(connId);
                        if (peer && P2PRemote.onStateUpdate) {
                            peer.state = msg.data;
                            P2PRemote.onStateUpdate(msg.data, peer.deviceInfo);
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
        connectTo,
        sendCommand,
        sendSearch,
        requestState,
        disconnect,
        getPeerList: getAllPeers,
        scanDevices,
        getLocalState,
        broadcastLocalState,
        isBridgeConnected: () => bridgeConnected,
        onConnectionChange: null,
        onStateUpdate: null,
        onSearchResult: null,
    };
})();
