(function () {
    'use strict';

    const LOG_PREFIX = '[RemoteControl] ';

    const log = {
        info: (...args) => console.log(LOG_PREFIX + 'INFO', ...args),
        warn: (...args) => console.warn(LOG_PREFIX + 'WARN', ...args),
        error: (...args) => console.error(LOG_PREFIX + 'ERROR', ...args),
        debug: (...args) => console.debug(LOG_PREFIX + 'DEBUG', ...args),
    };

    const RC = {
        ws: null,
        reconnectAttempts: 0,
        maxReconnectAttempts: Infinity,
        reconnectDelay: 1000,
        isConnected: false,
        isRegistered: false,
        deviceId: null,
        devices: [],
        stateReportInterval: null,
        lastReportedState: null,
        onDeviceListChange: null,
    };

    const getWsUrl = () => {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = location.host;
        return `${protocol}//${host}/api/remote/ws`;
    };

    const mapPlayModeToRemote = (mode) => {
        switch (mode) {
            case 'list': return 'loop_list';
            case 'single': return 'loop_single';
            case 'random': return 'shuffle';
            case 'order': return 'sequential';
            default: return 'loop_list';
        }
    };

    const mapPlayModeFromRemote = (mode) => {
        switch (mode) {
            case 'loop_list': return 'list';
            case 'loop_single': return 'single';
            case 'shuffle': return 'random';
            case 'sequential': return 'order';
            default: return 'list';
        }
    };

    const getCurrentState = () => {
        const song = window.currentPlayingSong || null;
        const currentSong = song ? {
            name: song.name || '',
            singer: song.singer || '',
            album: song.albumName || song.album || '',
            duration: song.duration || audio.duration || 0,
            songId: song.songId || song.id || song.songmid || '',
            source: song.source || '',
        } : null;

        return {
            playing: !audio.paused,
            position: audio.currentTime || 0,
            duration: audio.duration || 0,
            volume: Math.round((typeof currentVolume !== 'undefined' ? currentVolume : audio.volume) * 100),
            muted: isMuted || audio.muted,
            currentSong,
            playMode: mapPlayModeToRemote(playMode),
            currentIndex: currentIndex || -1,
            playlist: currentPlaylist || [],
        };
    };

    const send = (message) => {
        if (!RC.ws || RC.ws.readyState !== WebSocket.OPEN) return false;
        try {
            RC.ws.send(JSON.stringify(message));
            return true;
        } catch (e) {
            log.error('Send error:', e);
            return false;
        }
    };

    const reportState = () => {
        if (!RC.isRegistered) return;

        const state = getCurrentState();
        const stateStr = JSON.stringify(state);

        if (stateStr === RC.lastReportedState) return;

        RC.lastReportedState = stateStr;

        send({
            type: 'state_update',
            data: state,
        });
    };

    const registerDevice = () => {
        const deviceName = 'LX Music Web - ' + (navigator.platform || 'Browser');
        log.info('Registering device:', deviceName);
        send({
            type: 'register',
            data: {
                name: deviceName,
                type: 'web',
                version: '1.0.0',
                address: location.host,
            },
        });
    };

    const handleCommand = (message) => {
        const { command, params, fromDeviceId, fromDeviceName } = message;
        const { position, volume, mode, songInfo, listId } = params || {};

        log.info('Received command from', fromDeviceName, ':', command);

        switch (command) {
            case 'play':
                if (typeof togglePlay === 'function' && audio.paused) {
                    togglePlay();
                }
                break;

            case 'pause':
                if (typeof togglePlay === 'function' && !audio.paused) {
                    togglePlay();
                }
                break;

            case 'toggle_play':
                if (typeof togglePlay === 'function') {
                    togglePlay();
                }
                break;

            case 'next':
                if (typeof playNext === 'function') {
                    playNext();
                }
                break;

            case 'prev':
                if (typeof playPrev === 'function') {
                    playPrev();
                }
                break;

            case 'seek':
                if (typeof position === 'number' && audio.duration) {
                    audio.currentTime = Math.max(0, Math.min(position, audio.duration));
                }
                break;

            case 'volume':
                if (typeof volume === 'number') {
                    const vol = Math.max(0, Math.min(100, volume)) / 100;
                    if (typeof currentVolume !== 'undefined') {
                        currentVolume = vol;
                    }
                    audio.volume = vol;
                    isMuted = false;
                    audio.muted = false;
                    if (typeof updateVolumeUI === 'function') {
                        updateVolumeUI();
                    }
                }
                break;

            case 'toggle_mute':
                if (typeof toggleMute === 'function') {
                    toggleMute();
                }
                break;

            case 'set_play_mode':
                if (typeof setPlayMode === 'function' && mode) {
                    const localMode = mapPlayModeFromRemote(mode);
                    setPlayMode(localMode);
                }
                break;

            case 'play_song':
                if (songInfo && typeof playSong === 'function') {
                    const song = {
                        ...songInfo,
                        id: songInfo.songId || songInfo.id,
                        songmid: songInfo.songId || songInfo.songmid,
                    };
                    playSong(song, 0);
                }
                break;

            case 'add_to_queue':
                if (songInfo && typeof addToQueue === 'function') {
                    addToQueue(songInfo);
                }
                break;

            case 'clear_queue':
                if (typeof clearQueue === 'function') {
                    clearQueue();
                }
                break;

            case 'collect_current_song':
                if (typeof toggleFavorite === 'function') {
                    toggleFavorite();
                }
                break;

            case 'uncollect_current_song':
                if (typeof toggleFavorite === 'function') {
                    toggleFavorite();
                }
                break;

            case 'get_state': {
                const state = getCurrentState();
                send({
                    type: 'state_response',
                    targetId: fromDeviceId,
                    state,
                });
                break;
            }
        }

        setTimeout(reportState, 100);
    };

    const handleMessage = (event) => {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (e) {
            log.error('Parse error:', e);
            return;
        }

        const { type } = message;
        log.debug('← Received message type:', type);

        switch (type) {
            case 'registered':
                RC.isRegistered = true;
                RC.deviceId = message.deviceId;
                RC.devices = message.deviceList || [];
                log.info('Registered! deviceId:', RC.deviceId);
                log.info('Found', RC.devices.length, 'other devices:', RC.devices.map(d => d.name).join(', '));
                if (RC.onDeviceListChange) RC.onDeviceListChange(RC.devices);
                reportState();
                break;

            case 'device_list':
                RC.devices = message.devices || [];
                log.info('Device list updated, total:', RC.devices.length);
                log.debug('Devices:', RC.devices.map(d => `${d.name} (${d.type})`).join(', '));
                if (RC.onDeviceListChange) RC.onDeviceListChange(RC.devices);
                break;

            case 'command':
                handleCommand(message);
                break;

            case 'get_state': {
                const state = getCurrentState();
                log.debug('State requested by:', message.fromDeviceId);
                send({
                    type: 'state_response',
                    targetId: message.fromDeviceId,
                    state,
                });
                break;
            }

            case 'state_update':
                log.debug('State update from:', message.fromDeviceName || message.fromDeviceId);
                document.dispatchEvent(new CustomEvent('remote-state-update', {
                    detail: {
                        fromDeviceId: message.fromDeviceId,
                        fromDeviceName: message.fromDeviceName,
                        state: message.state,
                    },
                }));
                break;

            case 'command_ack':
                log.debug('Command ack:', message.command, 'success:', message.success);
                if (!message.success) {
                    log.warn('Command failed:', message.command, 'error:', message.error);
                }
                break;

            case 'pong':
                log.debug('Pong received');
                break;

            default:
                log.warn('Unknown message type:', type);
        }
    };

    const connect = () => {
        const wsUrl = getWsUrl();
        log.info('Connecting to server:', wsUrl);
        try {
            RC.ws = new WebSocket(wsUrl);

            RC.ws.onopen = () => {
                log.info('✓ Connected to server');
                RC.isConnected = true;
                RC.reconnectAttempts = 0;
                registerDevice();

                if (!RC.stateReportInterval) {
                    RC.stateReportInterval = setInterval(reportState, 1000);
                }
            };

            RC.ws.onmessage = handleMessage;

            RC.ws.onerror = (error) => {
                log.error('WebSocket error:', error);
            };

            RC.ws.onclose = (event) => {
                log.warn('Disconnected from server. Code:', event.code, 'Reason:', event.reason || 'unknown');
                RC.isConnected = false;
                RC.isRegistered = false;
                RC.devices = [];
                if (RC.onDeviceListChange) RC.onDeviceListChange([]);

                if (RC.stateReportInterval) {
                    clearInterval(RC.stateReportInterval);
                    RC.stateReportInterval = null;
                }

                RC.reconnectAttempts++;
                const delay = Math.min(RC.reconnectDelay * Math.pow(1.5, RC.reconnectAttempts - 1), 30000);
                log.info(`Reconnecting in ${Math.round(delay)}ms (attempt ${RC.reconnectAttempts})`);
                setTimeout(connect, delay);
            };
        } catch (e) {
            log.error('Failed to create WebSocket:', e);
        }
    };

    const init = () => {
        if (typeof audio === 'undefined') {
            log.warn('Audio element not found, waiting...');
            setTimeout(init, 1000);
            return;
        }

        log.info('Initializing remote control module...');
        connect();

        const stateChangeEvents = ['play', 'pause', 'ended', 'seeked', 'volumechange'];
        stateChangeEvents.forEach(event => {
            audio.addEventListener(event, () => {
                setTimeout(reportState, 50);
            });
        });
    };

    const sendCommand = (targetId, command, params) => {
        return send({
            type: 'command',
            targetId,
            command,
            params: params || {},
        });
    };

    const requestState = (targetId) => {
        return send({
            type: 'get_state',
            targetId,
        });
    };

    const refreshDeviceList = () => {
        return send({
            type: 'get_device_list',
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.RemoteControl = {
        isConnected: () => RC.isConnected,
        isRegistered: () => RC.isRegistered,
        getDeviceId: () => RC.deviceId,
        getDevices: () => RC.devices,
        reconnect: connect,
        getState: getCurrentState,
        sendCommand,
        requestState,
        refreshDeviceList,
        setOnDeviceListChange: (callback) => { RC.onDeviceListChange = callback; },
    };
})();
