(function () {
    'use strict';

    const LOG_PREFIX = '[RCPanel] ';
    const log = {
        info: (...args) => console.log(LOG_PREFIX + 'INFO', ...args),
        warn: (...args) => console.warn(LOG_PREFIX + 'WARN', ...args),
        error: (...args) => console.error(LOG_PREFIX + 'ERROR', ...args),
        debug: (...args) => console.debug(LOG_PREFIX + 'DEBUG', ...args),
    };

    const RCP = {
        isPanelOpen: false,
        connectedDevice: null,
        connectedMode: null,
        playerState: null,
        positionUpdateInterval: null,
        statePollingInterval: null,
        directWs: null,
        directConnected: false,
        directHttpBase: null,
    };

    const formatTime = (seconds) => {
        if (!seconds || !Number.isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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

    const createPanelHTML = () => {
        return `
        <div id="remote-control-panel" class="fixed inset-y-0 right-0 w-80 t-bg-panel shadow-2xl z-[70] transform translate-x-full transition-transform duration-300 flex flex-col">
            <div class="h-16 flex items-center justify-between px-4 border-b t-border-main">
                <div class="flex items-center gap-2">
                    <i class="fas fa-satellite-dish text-emerald-500 text-lg"></i>
                    <span class="font-bold t-text-main">远程控制</span>
                </div>
                <button onclick="RemoteControlPanel.close()" class="p-2 hover:t-bg-main rounded-lg transition-colors t-text-muted hover:text-red-500">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div id="rc-connect-view" class="flex-1 flex flex-col overflow-hidden">
                <div class="flex border-b t-border-main">
                    <button id="rc-tab-server" onclick="RemoteControlPanel.switchTab('server')"
                        class="flex-1 py-3 text-sm font-medium transition-colors border-b-2 border-emerald-500 text-emerald-500">
                        <i class="fas fa-server mr-1"></i>服务端模式
                    </button>
                    <button id="rc-tab-direct" onclick="RemoteControlPanel.switchTab('direct')"
                        class="flex-1 py-3 text-sm font-medium transition-colors border-b-2 border-transparent t-text-muted hover:text-emerald-500">
                        <i class="fas fa-plug mr-1"></i>直连桌面端
                    </button>
                </div>

                <div id="rc-tab-server-content" class="flex-1 flex flex-col overflow-hidden">
                    <div class="p-4 border-b t-border-main">
                        <div class="text-sm font-medium t-text-main mb-2 flex items-center justify-between">
                            <span>发现的设备</span>
                            <button onclick="RemoteControlPanel.refreshDevices()" class="text-xs text-emerald-500 hover:text-emerald-600 flex items-center gap-1">
                                <i class="fas fa-sync-alt"></i>
                                刷新
                            </button>
                        </div>
                        <div id="rc-device-list" class="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                            <div class="text-xs t-text-muted text-center py-4">
                                <i class="fas fa-spinner fa-spin mr-2"></i>
                                正在搜索设备...
                            </div>
                        </div>
                    </div>

                    <div class="p-4 flex-1 overflow-y-auto custom-scrollbar">
                        <div class="text-sm font-medium t-text-main mb-2">使用说明</div>
                        <ul class="text-xs t-text-muted space-y-2 list-disc list-inside">
                            <li>确保设备在同一局域网内</li>
                            <li>所有设备连接到同一个服务器</li>
                            <li>点击设备列表中的设备进行连接</li>
                            <li>连接后可控制对方的音乐播放</li>
                        </ul>
                        <div class="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                            <div class="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                                <i class="fas fa-info-circle mr-1"></i>排查提示
                            </div>
                            <div class="text-xs text-amber-600 dark:text-amber-500">
                                按 F12 打开开发者工具，查看 Console 中 [RemoteControl] 开头的日志
                            </div>
                        </div>
                    </div>
                </div>

                <div id="rc-tab-direct-content" class="flex-1 flex-col overflow-hidden hidden">
                    <div class="p-4 border-b t-border-main">
                        <div class="text-sm font-medium t-text-main mb-3">直连桌面端</div>
                        <div class="text-xs t-text-muted mb-3">
                            使用桌面端原生的 HTTP API（推荐，端口 23330）
                        </div>
                        <div class="space-y-3">
                            <div>
                                <label class="text-xs t-text-muted block mb-1">桌面端 IP 地址</label>
                                <input type="text" id="rc-direct-ip" placeholder="192.168.1.100"
                                    class="w-full px-3 py-2 text-sm t-bg-main border t-border-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 t-text-main">
                            </div>
                            <div>
                                <label class="text-xs t-text-muted block mb-1">HTTP API 端口</label>
                                <input type="number" id="rc-direct-port" placeholder="23330" value="23330"
                                    class="w-full px-3 py-2 text-sm t-bg-main border t-border-main rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 t-text-main">
                            </div>
                            <div>
                                <label class="text-xs t-text-muted block mb-1">地址预览</label>
                                <div id="rc-direct-url-preview" class="text-xs font-mono t-bg-main border t-border-main rounded-lg px-3 py-2 t-text-muted break-all">
                                    http://192.168.1.100:23330/status
                                </div>
                            </div>
                            <button onclick="RemoteControlPanel.connectHttp()"
                                class="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors">
                                <i class="fas fa-link mr-2"></i>连接桌面端
                            </button>
                        </div>
                    </div>

                    <div class="p-4 flex-1 overflow-y-auto custom-scrollbar">
                        <div class="text-sm font-medium t-text-main mb-2">快速连接</div>
                        <div class="space-y-2">
                            <button onclick="RemoteControlPanel.fillHttp('127.0.0.1', '23330')"
                                class="w-full text-left px-3 py-2 text-sm t-bg-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border t-border-main rounded-lg transition-colors t-text-main">
                                <i class="fas fa-desktop mr-2 text-emerald-500"></i>
                                本机 (127.0.0.1:23330)
                            </button>
                            <button onclick="RemoteControlPanel.fillHttp('192.168.31.172', '23330')"
                                class="w-full text-left px-3 py-2 text-sm t-bg-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border t-border-main rounded-lg transition-colors t-text-main">
                                <i class="fas fa-wifi mr-2 text-emerald-500"></i>
                                局域网 (192.168.31.172:23330)
                            </button>
                            <button onclick="RemoteControlPanel.fillHttp('192.168.43.1', '23330')"
                                class="w-full text-left px-3 py-2 text-sm t-bg-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border t-border-main rounded-lg transition-colors t-text-main">
                                <i class="fas fa-network-wired mr-2 text-emerald-500"></i>
                                热点网关 (192.168.43.1:23330)
                            </button>
                            <button onclick="RemoteControlPanel.fillHttp('192.168.52.1', '23330')"
                                class="w-full text-left px-3 py-2 text-sm t-bg-main hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border t-border-main rounded-lg transition-colors t-text-main">
                                <i class="fas fa-network-wired mr-2 text-emerald-500"></i>
                                虚拟网卡 (192.168.52.1:23330)
                            </button>
                        </div>
                        <div class="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                            <div class="text-xs font-medium text-green-700 dark:text-green-400 mb-1">
                                <i class="fas fa-check-circle mr-1"></i>已验证可用
                            </div>
                            <ul class="text-xs text-green-600 dark:text-green-500 space-y-1 list-disc list-inside">
                                <li>播放 / 暂停 / 上一首 / 下一首</li>
                                <li>进度跳转</li>
                                <li>实时状态查询</li>
                            </ul>
                        </div>
                        <div class="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                            <div class="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                                <i class="fas fa-exclamation-triangle mr-1"></i>使用前提
                            </div>
                            <ul class="text-xs text-amber-600 dark:text-amber-500 space-y-1 list-disc list-inside">
                                <li>桌面端 LX Music 正在运行</li>
                                <li>桌面端已开启「远程控制」</li>
                                <li>两端在同一局域网内</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            <div id="rc-control-view" class="flex-1 flex-col hidden overflow-hidden">
                <div class="p-4 border-b t-border-main">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                            <i id="rc-connected-icon" class="fas fa-desktop text-emerald-500 text-xl"></i>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div id="rc-connected-name" class="font-bold t-text-main truncate">设备名称</div>
                            <div class="flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                <span id="rc-connected-type" class="text-xs t-text-muted">已连接</span>
                            </div>
                        </div>
                        <button onclick="RemoteControlPanel.disconnect()"
                            class="px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                            断开
                        </button>
                    </div>
                </div>

                <div class="flex-1 flex flex-col justify-center p-6 overflow-y-auto custom-scrollbar">
                    <div class="text-center mb-6">
                        <div id="rc-song-cover" class="w-32 h-32 mx-auto rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg flex items-center justify-center mb-4">
                            <i class="fas fa-music text-white text-4xl"></i>
                        </div>
                        <div id="rc-song-name" class="font-bold t-text-main text-lg truncate mb-1">暂无播放</div>
                        <div id="rc-song-singer" class="text-sm t-text-muted truncate">-</div>
                    </div>

                    <div class="mb-6">
                        <div class="relative h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full mb-2 cursor-pointer" id="rc-progress-bar">
                            <div id="rc-progress-fill" class="absolute left-0 top-0 h-full bg-emerald-500 rounded-full" style="width: 0%"></div>
                            <div id="rc-progress-thumb" class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-emerald-500 rounded-full shadow-md" style="left: 0%"></div>
                        </div>
                        <div class="flex justify-between text-xs t-text-muted">
                            <span id="rc-position">0:00</span>
                            <span id="rc-duration">0:00</span>
                        </div>
                    </div>

                    <div class="flex items-center justify-center gap-4 mb-6">
                        <button onclick="RemoteControlPanel.prev()" class="w-12 h-12 rounded-full hover:t-bg-main flex items-center justify-center t-text-muted hover:text-emerald-500 transition-colors">
                            <i class="fas fa-step-backward text-xl"></i>
                        </button>
                        <button onclick="RemoteControlPanel.togglePlay()" class="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg transition-colors">
                            <i id="rc-play-icon" class="fas fa-play text-xl ml-1"></i>
                        </button>
                        <button onclick="RemoteControlPanel.next()" class="w-12 h-12 rounded-full hover:t-bg-main flex items-center justify-center t-text-muted hover:text-emerald-500 transition-colors">
                            <i class="fas fa-step-forward text-xl"></i>
                        </button>
                    </div>
                </div>
            </div>

            <div class="p-4 border-t t-border-main text-center">
                <div id="rc-status-text" class="text-xs t-text-muted">
                    <span class="inline-block w-2 h-2 rounded-full bg-gray-400 mr-2"></span>
                    <span id="rc-status-text-content">未连接</span>
                </div>
            </div>
        </div>

        <div id="rc-overlay" class="fixed inset-0 bg-black/50 z-[65] hidden backdrop-blur-sm" onclick="RemoteControlPanel.close()"></div>
        `;
    };

    const setupProgressBar = () => {
        const progressBar = document.getElementById('rc-progress-bar');
        if (!progressBar) return;

        let isDragging = false;

        const updateProgress = (e) => {
            const rect = progressBar.getBoundingClientRect();
            const clientX = e.clientX || (e.touches && e.touches[0]?.clientX) || 0;
            const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const duration = RCP.playerState?.duration || 0;
            const position = pct * duration;

            document.getElementById('rc-progress-fill').style.width = `${pct * 100}%`;
            document.getElementById('rc-progress-thumb').style.left = `${pct * 100}%`;
            document.getElementById('rc-position').textContent = formatTime(position);

            return position;
        };

        progressBar.addEventListener('mousedown', (e) => {
            isDragging = true;
            updateProgress(e);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            updateProgress(e);
        });

        document.addEventListener('mouseup', (e) => {
            if (!isDragging) return;
            isDragging = false;
            const position = updateProgress(e);
            sendCommand('seek', { position });
        });

        progressBar.addEventListener('touchstart', (e) => {
            isDragging = true;
            updateProgress(e);
        });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            updateProgress(e);
        });

        document.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            const position = updateProgress(e);
            sendCommand('seek', { position });
        });
    };

    const setupDirectInputs = () => {
        const ipInput = document.getElementById('rc-direct-ip');
        const portInput = document.getElementById('rc-direct-port');
        const preview = document.getElementById('rc-direct-url-preview');

        const updatePreview = () => {
            const ip = ipInput?.value || '';
            const port = portInput?.value || '';
            if (ip && port) {
                preview.textContent = `http://${ip}:${port}/status`;
            } else {
                preview.textContent = '请填写 IP 和端口';
            }
        };

        if (ipInput) ipInput.addEventListener('input', updatePreview);
        if (portInput) portInput.addEventListener('input', updatePreview);
    };

    const updatePlayerUI = (state) => {
        if (!state) return;

        const playIcon = document.getElementById('rc-play-icon');
        if (playIcon) {
            playIcon.className = state.playing ? 'fas fa-pause text-xl' : 'fas fa-play text-xl ml-1';
        }

        if (state.currentSong) {
            const songNameEl = document.getElementById('rc-song-name');
            const singerEl = document.getElementById('rc-song-singer');
            if (songNameEl) songNameEl.textContent = state.currentSong.name || '未知歌曲';
            if (singerEl) singerEl.textContent = state.currentSong.singer || '未知歌手';
        }

        const duration = state.duration || 0;
        const position = state.position || 0;
        const pct = duration > 0 ? (position / duration) * 100 : 0;

        const progressFill = document.getElementById('rc-progress-fill');
        const progressThumb = document.getElementById('rc-progress-thumb');
        const positionEl = document.getElementById('rc-position');
        const durationEl = document.getElementById('rc-duration');

        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressThumb) progressThumb.style.left = `${pct}%`;
        if (positionEl) positionEl.textContent = formatTime(position);
        if (durationEl) durationEl.textContent = formatTime(duration);
    };

    const renderDeviceList = () => {
        const listEl = document.getElementById('rc-device-list');
        if (!listEl) return;

        const devices = window.RemoteControl ? window.RemoteControl.getDevices() : [];
        log.info('Rendering device list, count:', devices.length);

        if (devices.length === 0) {
            listEl.innerHTML = `
                <div class="text-xs t-text-muted text-center py-4">
                    <i class="fas fa-search mr-2"></i>
                    未发现其他设备
                </div>
            `;
            return;
        }

        listEl.innerHTML = devices.map(device => `
            <div onclick="RemoteControlPanel.connectDevice('${device.id}')"
                class="flex items-center gap-3 p-3 rounded-lg hover:t-bg-main cursor-pointer transition-colors border border-transparent hover:t-border-main">
                <div class="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <i class="${getDeviceIcon(device.type)} text-emerald-500"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium t-text-main truncate">${device.name}</div>
                    <div class="text-xs t-text-muted">${getDeviceTypeName(device.type)}</div>
                </div>
                <i class="fas fa-chevron-right text-xs t-text-muted"></i>
            </div>
        `).join('');
    };

    const setStatus = (text, type = 'default') => {
        const statusContent = document.getElementById('rc-status-text-content');
        const statusDot = document.querySelector('#rc-status-text span:first-child');
        if (statusContent) statusContent.textContent = text;
        if (statusDot) {
            statusDot.className = 'inline-block w-2 h-2 rounded-full mr-2';
            if (type === 'success') statusDot.classList.add('bg-green-500');
            else if (type === 'error') statusDot.classList.add('bg-red-500');
            else if (type === 'loading') statusDot.classList.add('bg-yellow-500', 'animate-pulse');
            else statusDot.classList.add('bg-gray-400');
        }
    };

    const showConnectView = () => {
        document.getElementById('rc-connect-view').classList.remove('hidden');
        document.getElementById('rc-connect-view').classList.add('flex');
        document.getElementById('rc-control-view').classList.add('hidden');
        document.getElementById('rc-control-view').classList.remove('flex');
    };

    const showControlView = () => {
        document.getElementById('rc-connect-view').classList.add('hidden');
        document.getElementById('rc-connect-view').classList.remove('flex');
        document.getElementById('rc-control-view').classList.remove('hidden');
        document.getElementById('rc-control-view').classList.add('flex');
    };

    const httpGet = async (path) => {
        if (!RCP.directHttpBase) return null;
        const url = `${RCP.directHttpBase}${path}`;
        log.debug('HTTP GET:', url);
        try {
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) {
                log.warn('HTTP error:', response.status, response.statusText);
                return null;
            }
            const text = await response.text();
            try {
                return JSON.parse(text);
            } catch (e) {
                return text;
            }
        } catch (e) {
            log.error('HTTP request failed:', e.message);
            return null;
        }
    };

    const sendCommand = (command, params) => {
        log.info('Send command:', command, 'mode:', RCP.connectedMode);

        if (RCP.connectedMode === 'server') {
            if (!RCP.connectedDevice || !window.RemoteControl) {
                log.warn('Cannot send: not connected to server device');
                return;
            }
            window.RemoteControl.sendCommand(RCP.connectedDevice.id, command, params);
        } else if (RCP.connectedMode === 'http') {
            if (!RCP.directHttpBase) {
                log.warn('Cannot send: no HTTP base URL');
                return;
            }
            sendHttpCommand(command, params);
        } else if (RCP.connectedMode === 'direct') {
            if (!RCP.directWs || RCP.directWs.readyState !== WebSocket.OPEN) {
                log.warn('Cannot send: direct WS not open');
                return;
            }
            RCP.directWs.send(JSON.stringify({
                type: 'command',
                command,
                params: params || {},
            }));
        }
    };

    const sendHttpCommand = (command, params) => {
        switch (command) {
            case 'play':
                httpGet('/play');
                break;
            case 'pause':
                httpGet('/pause');
                break;
            case 'toggle_play':
                if (RCP.playerState?.playing) {
                    httpGet('/pause');
                } else {
                    httpGet('/play');
                }
                break;
            case 'next':
                httpGet('/skip-next');
                break;
            case 'prev':
                httpGet('/skip-prev');
                break;
            case 'seek':
                if (params?.position != null) {
                    httpGet(`/seek?offset=${Math.floor(params.position)}`);
                }
                break;
            default:
                log.warn('Unsupported HTTP command:', command);
        }

        setTimeout(fetchHttpState, 300);
    };

    const fetchHttpState = async () => {
        const data = await httpGet('/status');
        if (!data) return;

        const state = {
            playing: data.status === 'playing',
            position: data.progress || 0,
            duration: data.duration || 0,
            volume: data.volume != null ? data.volume : 75,
            muted: !!data.muted,
            currentSong: {
                name: data.name || '',
                singer: data.singer || '',
                album: data.albumName || '',
                duration: data.duration || 0,
            },
            playMode: 'loop_list',
        };

        RCP.playerState = state;
        updatePlayerUI(state);
    };

    const requestState = () => {
        if (RCP.connectedMode === 'server') {
            if (!RCP.connectedDevice || !window.RemoteControl) return;
            window.RemoteControl.requestState(RCP.connectedDevice.id);
        } else if (RCP.connectedMode === 'http') {
            fetchHttpState();
        } else if (RCP.connectedMode === 'direct') {
            if (!RCP.directWs || RCP.directWs.readyState !== WebSocket.OPEN) return;
            RCP.directWs.send(JSON.stringify({ type: 'get_state' }));
        }
    };

    const handleDeviceListChange = () => {
        if (RCP.isPanelOpen) {
            renderDeviceList();
        }
    };

    const handleStateUpdate = (event) => {
        const message = event.detail;
        if (!message || !RCP.connectedDevice) return;

        if (RCP.connectedMode === 'server' && message.fromDeviceId === RCP.connectedDevice.id && message.state) {
            RCP.playerState = message.state;
            updatePlayerUI(RCP.playerState);
        }
    };

    const handleDirectMessage = (event) => {
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (e) {
            log.error('Failed to parse direct message:', e);
            return;
        }

        log.debug('← Direct message:', message.type || message.action);

        if (message.type === 'state_update' || message.action === 'state_update') {
            RCP.playerState = message.state || message.data;
            updatePlayerUI(RCP.playerState);
        } else if (message.type === 'state_response') {
            RCP.playerState = message.state;
            updatePlayerUI(RCP.playerState);
        } else if (message.state) {
            RCP.playerState = message.state;
            updatePlayerUI(RCP.playerState);
        }
    };

    const init = () => {
        if (document.getElementById('remote-control-panel')) return;

        log.info('Initializing remote control panel');
        const panelHTML = createPanelHTML();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = panelHTML;
        document.body.appendChild(tempDiv.firstElementChild);
        document.body.appendChild(tempDiv.firstElementChild);

        setTimeout(() => {
            setupProgressBar();
            setupDirectInputs();
        }, 100);

        if (window.RemoteControl) {
            window.RemoteControl.setOnDeviceListChange(handleDeviceListChange);
        }

        document.addEventListener('remote-state-update', handleStateUpdate);
    };

    const switchTab = (tab) => {
        const serverTab = document.getElementById('rc-tab-server');
        const directTab = document.getElementById('rc-tab-direct');
        const serverContent = document.getElementById('rc-tab-server-content');
        const directContent = document.getElementById('rc-tab-direct-content');

        if (tab === 'server') {
            serverTab.classList.add('border-emerald-500', 'text-emerald-500');
            serverTab.classList.remove('border-transparent', 't-text-muted');
            directTab.classList.remove('border-emerald-500', 'text-emerald-500');
            directTab.classList.add('border-transparent', 't-text-muted');
            serverContent.classList.remove('hidden');
            serverContent.classList.add('flex');
            directContent.classList.add('hidden');
            directContent.classList.remove('flex');
            log.info('Switched to server mode tab');
        } else {
            directTab.classList.add('border-emerald-500', 'text-emerald-500');
            directTab.classList.remove('border-transparent', 't-text-muted');
            serverTab.classList.remove('border-emerald-500', 'text-emerald-500');
            serverTab.classList.add('border-transparent', 't-text-muted');
            directContent.classList.remove('hidden');
            directContent.classList.add('flex');
            serverContent.classList.add('hidden');
            serverContent.classList.remove('flex');
            log.info('Switched to direct mode tab');
        }
    };

    const fillHttp = (ip, port) => {
        const ipInput = document.getElementById('rc-direct-ip');
        const portInput = document.getElementById('rc-direct-port');
        const preview = document.getElementById('rc-direct-url-preview');

        if (ipInput) ipInput.value = ip;
        if (portInput) portInput.value = port;
        if (preview) preview.textContent = `http://${ip}:${port}/status`;

        log.info('Filled HTTP connection:', ip, port);
    };

    const connectHttp = async () => {
        const ip = document.getElementById('rc-direct-ip')?.value?.trim();
        const port = document.getElementById('rc-direct-port')?.value?.trim();

        if (!ip) {
            alert('请输入 IP 地址');
            return;
        }
        if (!port) {
            alert('请输入端口号');
            return;
        }

        const baseUrl = `http://${ip}:${port}`;
        log.info('HTTP connecting to:', baseUrl);
        setStatus('正在连接...', 'loading');

        try {
            const testResponse = await fetch(`${baseUrl}/status`, { method: 'GET' });
            if (!testResponse.ok) {
                throw new Error(`HTTP ${testResponse.status}`);
            }
            const testData = await testResponse.json();
            log.info('✓ HTTP connection successful, got status:', testData.status);
        } catch (e) {
            log.error('HTTP connection failed:', e.message);
            setStatus('连接失败', 'error');
            alert(`连接失败！\n\n原因: ${e.message}\n\n请检查：\n1. 桌面端 LX Music 是否正在运行\n2. 远程控制是否已开启\n3. IP 和端口是否正确\n4. 防火墙是否拦截`);
            return;
        }

        RCP.directHttpBase = baseUrl;
        RCP.connectedMode = 'http';
        RCP.connectedDevice = {
            id: 'http-' + ip,
            name: `${ip}:${port}`,
            type: 'desktop',
        };

        setStatus('已连接 ' + ip, 'success');
        document.getElementById('rc-connected-name').textContent = ip + ':' + port;
        document.getElementById('rc-connected-type').textContent = '桌面端 (HTTP)';
        document.getElementById('rc-connected-icon').className = 'fas fa-desktop text-emerald-500 text-xl';

        showControlView();
        fetchHttpState();

        if (RCP.statePollingInterval) clearInterval(RCP.statePollingInterval);
        RCP.statePollingInterval = setInterval(() => {
            if (RCP.connectedMode === 'http') {
                fetchHttpState();
            }
        }, 1000);
    };

    const open = () => {
        init();
        RCP.isPanelOpen = true;
        document.getElementById('remote-control-panel').classList.remove('translate-x-full');
        document.getElementById('rc-overlay').classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        if (RCP.connectedMode) {
            setStatus('已连接', 'success');
            showControlView();
        } else if (window.RemoteControl && window.RemoteControl.isConnected()) {
            setStatus('已连接服务器', 'success');
        } else {
            setStatus('未连接', 'default');
        }

        renderDeviceList();
    };

    const close = () => {
        RCP.isPanelOpen = false;
        const panel = document.getElementById('remote-control-panel');
        const overlay = document.getElementById('rc-overlay');
        if (panel) panel.classList.add('translate-x-full');
        if (overlay) overlay.classList.add('hidden');
        document.body.style.overflow = '';
    };

    const toggle = () => {
        if (RCP.isPanelOpen) {
            close();
        } else {
            open();
        }
    };

    const refreshDevices = () => {
        log.info('Refreshing device list');
        const listEl = document.getElementById('rc-device-list');
        if (listEl) {
            listEl.innerHTML = `
                <div class="text-xs t-text-muted text-center py-4">
                    <i class="fas fa-spinner fa-spin mr-2"></i>
                    正在搜索设备...
                </div>
            `;
        }

        if (window.RemoteControl) {
            window.RemoteControl.refreshDeviceList();
            setTimeout(renderDeviceList, 500);
        } else {
            log.warn('RemoteControl module not available');
            setTimeout(renderDeviceList, 1000);
        }
    };

    const connectDevice = (deviceId) => {
        if (!window.RemoteControl) {
            alert('远程控制模块未初始化');
            return;
        }

        const devices = window.RemoteControl.getDevices();
        const device = devices.find(d => d.id === deviceId);
        if (!device) {
            alert('设备不存在');
            return;
        }

        log.info('Connecting to device:', device.name, 'id:', deviceId);
        RCP.connectedDevice = device;
        RCP.connectedMode = 'server';
        setStatus('已连接 ' + device.name, 'success');

        document.getElementById('rc-connected-name').textContent = device.name;
        document.getElementById('rc-connected-type').textContent = getDeviceTypeName(device.type);
        document.getElementById('rc-connected-icon').className = getDeviceIcon(device.type) + ' text-emerald-500 text-xl';

        showControlView();
        requestState();

        if (RCP.positionUpdateInterval) clearInterval(RCP.positionUpdateInterval);
        RCP.positionUpdateInterval = setInterval(() => {
            if (RCP.playerState && RCP.playerState.playing) {
                RCP.playerState.position += 1;
                if (RCP.playerState.position > RCP.playerState.duration) {
                    RCP.playerState.position = RCP.playerState.duration;
                }
                updatePlayerUI(RCP.playerState);
            }
        }, 1000);
    };

    const disconnect = () => {
        log.info('Disconnecting, mode:', RCP.connectedMode);

        if (RCP.connectedMode === 'direct' && RCP.directWs) {
            RCP.directWs.close();
            RCP.directWs = null;
        }

        if (RCP.statePollingInterval) {
            clearInterval(RCP.statePollingInterval);
            RCP.statePollingInterval = null;
        }

        RCP.directHttpBase = null;
        RCP.connectedDevice = null;
        RCP.connectedMode = null;
        RCP.playerState = null;

        if (RCP.positionUpdateInterval) {
            clearInterval(RCP.positionUpdateInterval);
            RCP.positionUpdateInterval = null;
        }

        setStatus('已断开', 'default');
        showConnectView();
        renderDeviceList();
    };

    const togglePlay = () => {
        sendCommand('toggle_play');
        if (RCP.playerState) {
            RCP.playerState.playing = !RCP.playerState.playing;
            updatePlayerUI(RCP.playerState);
        }
    };

    const next = () => {
        sendCommand('next');
    };

    const prev = () => {
        sendCommand('prev');
    };

    window.RemoteControlPanel = {
        open,
        close,
        toggle,
        switchTab,
        fillHttp,
        connectHttp,
        refreshDevices,
        connectDevice,
        disconnect,
        togglePlay,
        next,
        prev,
    };
})();
