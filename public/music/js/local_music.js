/**
 * LocalMusicManager (本地音乐模块)
 * 处理在本地音乐Tab下的列表加载、刷选、删除功能
 */

window.LocalMusicManager = {
    originalData: [],
    displayData: [],
    batchMode: false,
    selectedItems: new Set(),
    searchKeyword: '',
    filterFolder: 'all',  // 单选，'all' | 'cache' | 'music'
    filterQuality: new Set(), // 多选 Set，空集合 = 不限制
    filterStatus: new Set(),  // 多选 Set，空集合 = 不限制
    filterSource: new Set(),  // 多选 Set，空集合 = 不限制
    sortBy: 'mtime',
    sortOrder: 'desc',
    quickSearchKeyword: '',
    searchTimer: null,
    isFilterPanelOpen: false,
    manualIndexTargetItem: null, // 当前正在手动关联的本地项
    currentManualResults: [],    // 搜索回来的结果缓存
    currentManualPage: 1,        // 当前搜索页码
    isManualSearching: false,    // 全局锁，防止滚动触发多次加载
    selectedSubPath: '',         // [New] 当前选中的子目录
    subPathModalMode: 'filter',  // [New] 'filter' | 'categorize'
    cacheKey: 'lx_lm_filters',   // [New] localStorage key

    saveFilters() {
        const filters = {
            searchKeyword: this.searchKeyword,
            filterFolder: this.filterFolder,
            filterQuality: Array.from(this.filterQuality),
            filterStatus: Array.from(this.filterStatus),
            filterSource: Array.from(this.filterSource),
            sortBy: this.sortBy,
            sortOrder: this.sortOrder,
            selectedSubPath: this.selectedSubPath
        };
        localStorage.setItem(this.cacheKey, JSON.stringify(filters));
    },

    loadFilters() {
        try {
            const cached = localStorage.getItem(this.cacheKey);
            if (cached) {
                const filters = JSON.parse(cached);
                this.searchKeyword = filters.searchKeyword || '';
                this.filterFolder = filters.filterFolder || 'all';
                const toSet = (v) => {
                    if (!v || v === 'all') return new Set();
                    if (Array.isArray(v)) return new Set(v);
                    return new Set([v]);
                };
                this.filterQuality = toSet(filters.filterQuality);
                this.filterStatus = toSet(filters.filterStatus);
                this.filterSource = toSet(filters.filterSource);
                this.sortBy = filters.sortBy || 'mtime';
                this.sortOrder = filters.sortOrder || 'desc';
                this.selectedSubPath = filters.selectedSubPath || '';

                // Update UI elements
                if (document.getElementById('lm-search-input')) document.getElementById('lm-search-input').value = this.searchKeyword;
                if (document.getElementById('lm-sort-by')) document.getElementById('lm-sort-by').value = this.sortBy;
                if (document.getElementById('lm-sort-order')) document.getElementById('lm-sort-order').value = this.sortOrder;
                if (document.getElementById('lm-folder-select')) {
                    document.getElementById('lm-folder-select').value = this.filterFolder;
                    this._syncSelectActive('lm-folder-select');
                }
                // 标签按钮 UI 更新
                this._syncTagUI('lm-quality-tags', this.filterQuality);
                this._syncTagUI('lm-source-tags', this.filterSource);
                this._syncTagUI('lm-status-tags', this.filterStatus);

                const subPathText = document.getElementById('lm-subpath-text');
                if (subPathText) {
                    let displayText = this.selectedSubPath;
                    if (this.selectedSubPath === '') displayText = '全部';
                    else if (this.selectedSubPath === '__ROOT__') displayText = '根目录';
                    subPathText.innerText = displayText;
                }
            }
        } catch (e) {
            console.error('Failed to load cached filters:', e);
        }
    },

    // 同步标签按钮的激活状态
    _syncTagUI(containerId, filterSet) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('[data-filter-value]').forEach(btn => {
            const val = btn.dataset.filterValue;
            if (filterSet.has(val)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    },

    // 切换某个筛选标签的选中状态
    toggleFilterTag(filterKey, value) {
        const setMap = {
            quality: 'filterQuality',
            source: 'filterSource',
            folder: 'filterFolder',
            status: 'filterStatus'
        };
        const tagContainerMap = {
            quality: 'lm-quality-tags',
            source: 'lm-source-tags',
            folder: 'lm-folder-tags',
            status: 'lm-status-tags'
        };
        const prop = setMap[filterKey];
        if (!prop) return;
        const set = this[prop];
        if (set.has(value)) {
            set.delete(value);
        } else {
            set.add(value);
        }
        this._syncTagUI(tagContainerMap[filterKey], set);
        this.applyFilters();
    },

    // 同步 select 下拉框的激活状态样式
    _syncSelectActive(id) {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.value !== 'all' && el.value !== 'mtime' && el.value !== 'desc') {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    },

    init() {
        // Initialization can run when the tab is clicked, or immediately.
        // Try reading global cache location to sync the selector.
        this.syncLocationSelector();
        this.loadFilters(); // Load cached filters
        this.fetchData();

        // Listen to tab switch to trigger refresh if we are on this tab
        const origSwitchTab = window.switchTab;
        window.switchTab = function (tabId) {
            origSwitchTab(tabId);
            if (tabId === 'localmusic') {
                window.LocalMusicManager.syncLocationSelector();
                window.LocalMusicManager.fetchData(true); // silent fetch
            } else {
                // Auto exit batch mode when leaving
                if (window.LocalMusicManager.batchMode) {
                    window.LocalMusicManager.toggleBatchMode();
                }
            }
        };
    },

    syncLocationSelector() {
        // Let's assume 'data' or 'root' based on the config. 
        // We might not have async config sync in UI immediately, but we can read from global.
        // Fallback: we fetch stats or just assume what we get.
        // Setting it via API is the most robust way.
    },

    async changeLocation() {
        const el = document.getElementById('lm-location-select');
        const val = el.value;
        try {
            await fetch('/api/music/cache/config', {
                method: 'POST',
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {},
                body: JSON.stringify({ location: val })
            });
            // Reset subpath when changing location
            this.selectedSubPath = '';
            const subPathText = document.getElementById('lm-subpath-text');
            if (subPathText) subPathText.innerText = '全部';

            this.refresh();
        } catch (e) {
            if (typeof showError === 'function') showError('切换目录失败');
        }
    },

    changeFolder() {
        const el = document.getElementById('lm-folder-select');
        this.filterFolder = el.value;
        this.applyFilters();
    },

    toggleUnindexed() {
        const el = document.getElementById('lm-unindexed-filter');
        this.filterUnindexed = el.checked;
        this.applyFilters();
    },

    debounceSearch() {
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => {
            const el = document.getElementById('lm-search-input');
            this.searchKeyword = (el.value || '').trim().toLowerCase();
            this.applyFilters();
        }, 300);
    },

    async refresh() {
        const btn = document.querySelector('button[title="同步并刷新"] i');
        if (btn) btn.classList.add('fa-spin');

        try {
            // First trigger sync on server
            if (typeof showInfo === 'function') showInfo('正在同步物理文件...');
            const syncRes = await fetch('/api/music/cache/sync', {
                method: 'POST',
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });
            const syncResult = await syncRes.json();
            if (!syncResult.success) {
                console.warn('Sync failed:', syncResult.message);
            }
        } catch (e) {
            console.error('Sync request error:', e);
        }

        await this.fetchData();
        if (btn) btn.classList.remove('fa-spin');
    },

    toggleFilterPanel() {
        const panel = document.getElementById('lm-filter-panel');
        const btn = document.getElementById('lm-filter-toggle-btn');
        this.isFilterPanelOpen = !this.isFilterPanelOpen;

        if (this.isFilterPanelOpen) {
            if (panel) panel.classList.remove('hidden');
            if (btn) btn.classList.add('t-bg-main', 'shadow-inner');
        } else {
            if (panel) panel.classList.add('hidden');
            if (btn) btn.classList.remove('t-bg-main', 'shadow-inner');
        }
    },

    handleQuickSearch(e) {
        this.quickSearchKeyword = (e.target.value || '').trim().toLowerCase();
        this.applyFilters();
    },

    clearFilters() {
        this.searchKeyword = '';
        this.quickSearchKeyword = '';
        this.filterFolder = 'all';
        this.filterQuality = new Set();
        this.filterStatus = new Set();
        this.filterSource = new Set();
        this.sortBy = 'mtime';
        this.sortOrder = 'desc';

        const si = document.getElementById('lm-search-input');
        if (si) si.value = '';
        const qs = document.getElementById('lm-quick-search');
        if (qs) qs.value = '';
        document.getElementById('lm-sort-by').value = 'mtime';
        document.getElementById('lm-sort-order').value = 'desc';

        if (document.getElementById('lm-folder-select')) {
            document.getElementById('lm-folder-select').value = 'all';
            this._syncSelectActive('lm-folder-select');
        }

        // 清空所有标签按钮激活状态
        this._syncTagUI('lm-quality-tags', this.filterQuality);
        this._syncTagUI('lm-source-tags', this.filterSource);
        this._syncTagUI('lm-status-tags', this.filterStatus);

        this.selectedSubPath = '';
        const subPathText = document.getElementById('lm-subpath-text');
        if (subPathText) subPathText.innerText = '全部';

        this.saveFilters();
        this.applyFilters();
    },

    async fetchData(silent = false) {
        if (!silent) {
            const container = document.getElementById('lm-list-container');
            if (container) {
                container.innerHTML = `
                    <div class="text-center py-20 text-gray-500 animate-fade-in">
                        <i class="fas fa-circle-notch fa-spin text-4xl mb-4 text-emerald-500"></i>
                        <p class="font-bold tracking-wider">正在加载本地音乐...</p>
                    </div>`;
            }
        }

        try {
            const res = await fetch('/api/music/cache/list', {
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });
            const result = await res.json();
            if (result.success) {
                this.originalData = result.data || [];
                // Sort by mtime initially descending
                this.originalData.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
                this.applyFilters();

                // Attempt to auto-sync location switch UI if not selected manually
                // (Only works if we know somehow what the backend uses, but we can ignore for now)
            }
        } catch (err) {
            if (typeof showError === 'function') showError('拉取本地列表失败');
            console.error('LocalMusic Fetch Error:', err);
        }
    },

    applyFilters() {
        let current = this.originalData;

        // 2. Read current filter values from input
        const searchInput = document.getElementById('lm-search-input');
        if (searchInput) this.searchKeyword = searchInput.value.trim().toLowerCase();

        const sortBySelect = document.getElementById('lm-sort-by');
        if (sortBySelect) this.sortBy = sortBySelect.value;
        const sortOrderSelect = document.getElementById('lm-sort-order');
        if (sortOrderSelect) this.sortOrder = sortOrderSelect.value;

        // [New] Save to localStorage
        this.saveFilters();

        // 3. Apply Filters（多选 Set，空集合表示不限制；Folder 为单选）
        current = current.filter(item => {
            // Folder check（单选）
            if (this.filterFolder !== 'all' && item.folder !== this.filterFolder) return false;

            // Quality check（多选）
            if (this.filterQuality.size > 0 && !this.filterQuality.has(item.quality)) return false;

            // Source check（多选）
            if (this.filterSource.size > 0 && !this.filterSource.has(item.source)) return false;

            // Metadata Status check（多选：任意一个条件命中即显示）
            if (this.filterStatus.size > 0) {
                const isUnindexed = item.source === 'unknown' || (item.songmid && item.songmid.includes(' - '));
                const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';
                const missingID3 = isNoTag(item.name) || isNoTag(item.singer) || isUnindexed;
                const missingCover = !item.hasCover;
                const missingLyric = !item.hasLyric && !item.lyricFilename;
                const missingEmbedLyric = !item.hasEmbedLyric;

                const statusMap = {
                    'unindexed': isUnindexed,
                    'missing_id3': missingID3,
                    'missing_cover': missingCover,
                    'missing_lyric': missingLyric,
                    'missing_lyric_file': missingLyric,
                    'missing_embed_lyric': missingEmbedLyric,
                };
                // 只要勾选的状态中任一命中即保留（OR 逻辑）
                const matched = Array.from(this.filterStatus).some(s => statusMap[s]);
                if (!matched) return false;
            }

            // Keyword search (Complex)
            const k = this.searchKeyword;
            const qk = this.quickSearchKeyword;

            const matchKeywords = (keyword) => {
                if (!keyword) return true;
                return (item.name || '').toLowerCase().includes(keyword) ||
                    (item.singer || '').toLowerCase().includes(keyword) ||
                    (item.album || '').toLowerCase().includes(keyword) ||
                    (item.filename || '').toLowerCase().includes(keyword);
            };

            if (!matchKeywords(k)) return false;
            // SubPath check
            if (this.selectedSubPath !== '') {
                const target = this.selectedSubPath === '__ROOT__' ? '' : this.selectedSubPath;
                if ((item.subPath || '') !== target) return false;
            }

            return true;
        });

        // 3.0.1 Update SubPath Button State
        const subPathBtn = document.getElementById('lm-subpath-btn');
        if (subPathBtn) {
            if (this.filterFolder !== 'music') {
                if (this.selectedSubPath !== '') {
                    this.selectedSubPath = '';
                    const subPathText = document.getElementById('lm-subpath-text');
                    if (subPathText) subPathText.innerText = '全部';
                    // Re-filter if we just reset
                    return setTimeout(() => window.LocalMusicManager.applyFilters(), 0);
                }
            }
        }

        // 3.1 Apply Sorting
        current.sort((a, b) => {
            let valA, valB;
            switch (this.sortBy) {
                case 'name':
                    valA = (a.name || a.filename || '').toLowerCase();
                    valB = (b.name || b.filename || '').toLowerCase();
                    break;
                case 'singer':
                    valA = (a.singer || '').toLowerCase();
                    valB = (b.singer || '').toLowerCase();
                    break;
                case 'album':
                    valA = (a.album || '').toLowerCase();
                    valB = (b.album || '').toLowerCase();
                    break;
                case 'source':
                    valA = (a.source || '').toLowerCase();
                    valB = (b.source || '').toLowerCase();
                    break;
                case 'size':
                    valA = a.size || 0;
                    valB = b.size || 0;
                    break;
                case 'subPath':
                    valA = (a.subPath || '').toLowerCase();
                    valB = (b.subPath || '').toLowerCase();
                    break;
                case 'mtime':
                default:
                    valA = a.mtime || 0;
                    valB = b.mtime || 0;
                    break;
            }

            if (valA < valB) return this.sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        // 4. Update UI Indicator
        const dot = document.getElementById('lm-filter-active-dot');
        const hasActiveFilters = this.searchKeyword || this.filterQuality.size > 0 || this.filterFolder !== 'all' || this.filterStatus.size > 0 || this.filterSource.size > 0;
        if (dot) {
            if (hasActiveFilters) dot.classList.remove('hidden');
            else dot.classList.add('hidden');
        }

        // 同步所有 select 的 active 状态（非 all 时背景高亮）
        this._syncSelectActive('lm-folder-select');
        this._syncSelectActive('lm-sort-by');
        this._syncSelectActive('lm-sort-order');

        const countEl = document.getElementById('lm-total-count');
        if (countEl) countEl.innerText = `共 ${current.length} 首`;

        this.displayData = current;

        // Clean up selected items that are no longer in display
        const displayIdentifiers = new Set(this.displayData.map(i => i.filename));
        for (const sel of this.selectedItems) {
            if (!displayIdentifiers.has(sel)) {
                this.selectedItems.delete(sel);
            }
        }
        this.updateBatchUI();

        this.render();
    },

    render() {
        const container = document.getElementById('lm-list-container');
        if (!container) return;

        if (this.displayData.length === 0) {
            container.innerHTML = `
                <div class="text-center py-20 text-gray-500">
                    <i class="fas fa-inbox text-4xl mb-4 opacity-50"></i>
                    <p>没有找到相关本地音乐</p>
                </div>`;
            return;
        }

        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';

        let html = '';
        this.displayData.forEach((item, index) => {
            const isUnindexed = item.source === 'unknown' || (item.songmid && item.songmid.includes(' - '));
            const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';
            const missingID3 = isNoTag(item.name) || isNoTag(item.singer) || isUnindexed;
            const missingCover = !item.hasCover;
            const missingLyric = !item.hasLyric && !item.lyricFilename;

            const isSelected = this.selectedItems.has(item.filename);
            const qualityClass = window.QualityManager && window.QualityManager.getQualityColor ? window.QualityManager.getQualityColor(item.quality) : 'bg-gray-100 text-gray-600';
            const qualityName = window.QualityManager ? window.QualityManager.getQualityDisplayName(item.quality) : item.quality;

            let coverHtml = `<div class="w-10 h-10 md:w-12 md:h-12 rounded-lg bg-gray-100/50 flex-shrink-0 flex items-center justify-center border t-border-main mr-2.5 md:mr-4 ml-0.5 md:ml-3">
                                <i class="fas fa-music t-text-muted text-xs"></i>
                             </div>`;
            if (item.hasCover) {
                const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
                const coverUrl = `/api/music/cache/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}&t=${Date.now()}`;
                coverHtml = `<img src="${coverUrl}" onerror="this.src='/music/assets/logo.svg'" loading="lazy" class="w-10 h-10 md:w-12 md:h-12 rounded-lg object-cover shadow-sm flex-shrink-0 border t-border-main mr-2.5 md:mr-4 ml-0.5 md:ml-3">`;
            }

            const formatSize = (bytes) => {
                if (!bytes) return '--';
                return (bytes / 1024 / 1024).toFixed(1) + 'M';
            };

            const formatTime = (ts) => {
                if (!ts) return '';
                const d = new Date(ts);
                return d.toLocaleDateString() + ' ' + d.toLocaleTimeString().slice(0, 5);
            };

            const folderIcon = item.folder === 'music' ? '<i class="fas fa-download text-blue-500 mr-1" title="下载目录"></i>' : '<i class="fas fa-hdd text-emerald-500 mr-1" title="缓存目录"></i>';

            html += `
            <div class="grid grid-cols-12 gap-2 md:gap-4 p-3 md:p-2 items-center rounded-xl hover:t-bg-item-hover transition-all t-border-main border-b last:border-b-0 group relative ${isSelected ? 't-bg-item-hover ring-1 ring-emerald-500/30' : ''}" data-lm-filename="${item.filename}">
                <!-- # / Batch -->
                <div class="col-span-1 text-center text-xs font-mono t-text-muted flex-shrink-0 flex items-center justify-center">
                    <div class="${this.batchMode ? 'hidden' : 'block'}">${index + 1}</div>
                    <div class="${this.batchMode ? 'block' : 'hidden'}">
                        <label class="flex items-center justify-center w-full h-full cursor-pointer">
                            <input type="checkbox" onchange="window.LocalMusicManager.toggleSelect('${item.filename.replace(/'/g, "\\'")}', this.checked)" ${isSelected ? 'checked' : ''}
                                class="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500 mx-auto cursor-pointer transition-all">
                        </label>
                    </div>
                </div>

                <!-- Song & Cover -->
                <div class="col-span-8 sm:col-span-5 md:col-span-4 lg:col-span-4 flex items-center min-w-0 pr-2">
                    ${coverHtml}
                    <div class="min-w-0 flex-1 truncate">
                        <div class="font-bold text-sm md:text-base t-text-main truncate group-hover:text-emerald-500 transition-colors cursor-pointer" onclick="window.LocalMusicManager.playItem(${index})">
                            ${item.name || '未知歌曲'}
                        </div>
                        <div class="text-[10px] md:text-xs t-text-muted mt-0.5 truncate flex items-center gap-1.5 flex-wrap">
                            <span class="sm:hidden font-medium text-emerald-600/70 mr-0.5">${item.singer || '未知歌手'}</span>
                            <span class="px-1.5 py-[1px] rounded-md border t-border-main ${qualityClass} scale-90 origin-left inline-block">${qualityName || '标准'}</span>
                            ${item.bitrate ? `<span class="text-[10px] opacity-60 font-mono hidden sm:inline-block">${Math.round(item.bitrate)}kbps</span>` : ''}
                            ${item.sampleRate ? `<span class="text-[10px] opacity-60 font-mono hidden sm:inline-block">${(item.sampleRate / 1000).toFixed(1)}kHz</span>` : ''}
                            ${item.bitDepth && item.bitDepth > 16 ? `<span class="text-[10px] opacity-60 font-mono hidden sm:inline-block">${item.bitDepth}bit</span>` : ''}
                            ${item.hasEmbedLyric ? '<span class="text-[10px] text-emerald-500 border border-gray-400/40 dark:border-gray-600/50 rounded px-1 scale-90 hidden sm:inline-block" title="已嵌入歌词标签">词</span>' : ''}
                            ${item.hasCover ? '<span class="text-[10px] text-emerald-500 border border-gray-400/40 dark:border-gray-600/50 rounded px-1 scale-90 hidden sm:inline-block" title="已嵌入封面">封</span>' : ''}
                        </div>
                        <!-- Mobile extra info (second row) -->
                        <div class="sm:hidden text-[9px] mt-1.5 flex items-center gap-1.5 flex-wrap">
                            <div class="flex items-center gap-1 px-1.5 py-0.5 bg-gray-100/80 dark:bg-gray-800/80 rounded-full t-text-muted">
                                ${folderIcon}
                                <span class="font-bold uppercase tracking-tighter">${item.source === 'unknown' ? '未知' : item.source}</span>
                            </div>
                            
                            ${item.subPath ? `<span class="t-text-muted opacity-50 truncate max-w-[60px] italic">${item.subPath}</span>` : ''}
                            
                            <div class="flex items-center gap-1">
                                ${missingID3 ? '<span class="px-1 py-0 bg-red-50 text-red-500 border border-red-100 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/30 rounded-sm font-medium">缺标签</span>' : ''}
                                ${missingCover ? '<span class="px-1 py-0 bg-orange-50 text-orange-500 border border-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-900/30 rounded-sm font-medium">缺封面</span>' : ''}
                                ${missingLyric ? '<span class="px-1 py-0 bg-yellow-50 text-yellow-600 border border-yellow-100 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-900/30 rounded-sm font-medium">缺词</span>' : ''}
                                ${(!missingID3 && !missingCover && !missingLyric) ? '<span class="px-1 py-0 bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900/30 rounded-sm font-medium">完整</span>' : ''}
                            </div>

                            ${isUnindexed ? `
                                <button onclick="window.LocalMusicManager.openManualIndexModal(${index})"
                                        class="px-1.5 py-0.5 bg-emerald-500 text-white rounded-md font-bold shadow-sm shadow-emerald-500/20 active:scale-95 transition-all flex items-center gap-1">
                                    <i class="fas fa-link text-[8px]"></i>关联
                                </button>
                            ` : ''}
                            
                            <div class="ml-auto flex items-center gap-1">
                                ${item.hasEmbedLyric ? '<span class="w-4 h-4 flex items-center justify-center bg-emerald-500 text-white rounded text-[8px] font-bold shadow-sm shadow-emerald-500/20" title="已嵌入歌词标签">词</span>' : ''}
                                ${item.hasCover ? '<span class="w-4 h-4 flex items-center justify-center bg-blue-500 text-white rounded text-[8px] font-bold shadow-sm shadow-blue-500/20" title="已嵌入封面">封</span>' : ''}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Singer -->
                <div class="hidden sm:block sm:col-span-4 md:col-span-3 lg:col-span-2 text-xs t-text-main truncate pr-2">
                    ${item.singer || '未知歌手'}
                </div>

                <!-- Album -->
                <div class="hidden lg:block lg:col-span-2 text-xs t-text-muted truncate pr-2">
                    ${item.album || '--'}
                </div>

                <!-- Source/Info with Metadata Status -->
                <div class="hidden md:flex flex-col md:col-span-2 lg:col-span-1 text-xs t-text-muted pr-2">
                    <div class="flex items-center gap-1 mb-1">
                        ${folderIcon}
                        <span class="truncate font-medium">${item.source === 'unknown' ? '未知' : item.source}</span>
                    </div>
                    ${item.subPath ? `<div class="text-[9px] text-emerald-500 font-mono truncate mb-1" title="${item.subPath}"><i class="far fa-folder mr-1 opacity-70"></i>${item.subPath}</div>` : ''}
                    <div class="flex flex-wrap gap-1">
                        ${missingID3 ? '<span class="px-1 py-0 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded text-[9px] font-bold">缺标签</span>' : ''}
                        ${missingCover ? '<span class="px-1 py-0 bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 rounded text-[9px] font-bold">缺封面</span>' : ''}
                        ${missingLyric ? '<span class="px-1 py-0 bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400 rounded text-[9px] font-bold">缺词</span>' : ''}
                        ${(!missingID3 && !missingCover && !missingLyric) ? '<span class="px-1 py-0 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 rounded text-[9px] font-bold">完整</span>' : ''}
                    </div>
                    <div class="text-[9px] mt-1 opacity-70 scale-90 origin-left">${formatTime(item.mtime)}</div>
                </div>

                <!-- Action Button -->
                <div class="col-span-3 sm:col-span-2 md:col-span-2 lg:col-span-2 flex items-center justify-end gap-1 md:gap-2">
                    <div class="hidden lg:block text-xs text-right pr-2 font-mono t-text-muted shrink-0 mr-1">
                        ${formatSize(item.size)}
                    </div>
                    ${isUnindexed ? `
                        <button onclick="window.LocalMusicManager.openManualIndexModal(${index})"
                                class="hidden sm:flex w-8 h-8 md:w-7 md:h-7 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 transition-all shadow-sm shrink-0" title="手动关联">
                            <i class="fas fa-link text-[10px]"></i>
                        </button>
                    ` : ''}
                    <button onclick="window.LocalMusicManager.playItem(${index})"
                            class="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main t-text-main hover:text-emerald-500 hover:border-emerald-300 transition-all shadow-sm shrink-0" title="播放">
                        <i class="fas fa-play text-[10px] ml-0.5"></i>
                    </button>
                    <!-- Download -->
                    <button onclick="window.LocalMusicManager.downloadSingle(${index})"
                            class="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main t-text-main hover:text-blue-500 hover:border-blue-300 transition-all shadow-sm shrink-0" title="保存到设备">
                        <i class="fas fa-download text-[10px]"></i>
                    </button>
                    <!-- Deletion from single operations -->
                    <button onclick="window.LocalMusicManager.deleteSingle('${item.filename.replace(/'/g, "\\'")}')"
                            class="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center rounded-full t-bg-main border t-border-main t-text-muted hover:text-red-500 hover:border-red-300 transition-all shadow-sm shrink-0" title="删除">
                        <i class="far fa-trash-alt text-[10px]"></i>
                    </button>
                </div>
            </div>
            `;
        });

        container.innerHTML = html;
    },

    toggleSelect(filename, checked) {
        if (checked) {
            this.selectedItems.add(filename);
        } else {
            this.selectedItems.delete(filename);
        }

        // Update DOM visually immediately if possible
        const row = document.querySelector(`[data-lm-filename="${filename}"]`);
        if (row) {
            if (checked) {
                row.classList.add('t-bg-item-hover', 'ring-1', 'ring-emerald-500/30');
            } else {
                row.classList.remove('t-bg-item-hover', 'ring-1', 'ring-emerald-500/30');
            }
        }

        this.updateBatchUI();
    },

    toggleBatchMode() {
        this.batchMode = !this.batchMode;
        if (!this.batchMode) {
            this.selectedItems.clear();
        }

        const tb = document.getElementById('lm-batch-toolbar');
        if (tb) {
            if (this.batchMode) {
                tb.classList.remove('hidden');
                tb.classList.add('flex');

                // [New] Show categorize button only for music folder
                const catBtn = document.getElementById('lm-batch-categorize-btn');
                if (catBtn) {
                    if (this.filterFolder === 'music') catBtn.classList.remove('hidden');
                    else catBtn.classList.add('hidden');
                }
            } else {
                tb.classList.add('hidden');
                tb.classList.remove('flex');
            }
        }

        this.updateBatchUI();
        this.render(); // Re-render to show/hide checkboxes globally
    },

    selectAll() {
        this.displayData.forEach(item => this.selectedItems.add(item.filename));
        this.updateBatchUI();
        this.render();
    },

    deselectAll() {
        this.selectedItems.clear();
        this.updateBatchUI();
        this.render();
    },

    updateBatchUI() {
        const span = document.getElementById('lm-batch-selected-count');
        if (span) span.textContent = this.selectedItems.size;
    },

    playItem(index) {
        const item = this.displayData[index];
        if (!item) return;

        // Transform into songInfo for global player
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

        // Important: Use existing checkCache via global logic if possible, 
        // or directly supply local URL
        const songInfo = {
            ...item.songInfo,
            // Reconstruct full URL locally
            url: `/api/music/cache/file/${encodeURIComponent(username)}/${encodeURIComponent(item.filename)}?folder=${item.folder}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`,
            pic: `/api/music/cache/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}&t=${Date.now()}`,
            isLocal: true,
            folder: item.folder
        };

        // If 'app.js' exposes playSong(song), we use it.
        // We might want to construct a playlist of local tracks.
        const playlist = this.displayData.map(d => ({
            ...d.songInfo,
            url: `/api/music/cache/file/${encodeURIComponent(username)}/${encodeURIComponent(d.filename)}?folder=${d.folder}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`,
            pic: `/api/music/cache/cover?filename=${encodeURIComponent(d.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}&t=${Date.now()}`,
            isLocal: true
        }));

        if (typeof window.updatePlaylist === 'function') {
            window.updatePlaylist(playlist, index, 'local_all');
        } else if (typeof window.playSong === 'function') {
            // Fallback for older versions
            window.playSong(songInfo, index);
        } else {
            console.error('Playback functions are not defined globally.');
        }
    },

    async deleteSingle(filename) {
        if (typeof showSelect === 'function') {
            if (!(await showSelect('删除本地文件', '确定要删除此文件吗?', { danger: true }))) return;
        } else {
            if (!confirm('确定要删除此文件吗?')) return;
        }
        this._executeDelete([filename]);
    },

    async batchDelete() {
        if (this.selectedItems.size === 0) {
            if (typeof showError === 'function') showError('请先选择要删除的文件');
            return;
        }
        if (typeof showSelect === 'function') {
            if (!(await showSelect('删除本地文件', `确定要批量删除这 ${this.selectedItems.size} 个文件吗?`, { danger: true }))) return;
        } else {
            if (!confirm(`确定要删除 ${this.selectedItems.size} 个文件吗?`)) return;
        }
        this._executeDelete(Array.from(this.selectedItems));
    },

    async _executeDelete(filenames) {
        try {
            const res = await fetch('/api/music/cache/remove', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames })
            });
            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`成功删除了 ${result.deletedCount || filenames.length} 个文件`);
                // Clear selection
                for (const f of filenames) this.selectedItems.delete(f);
                this.updateBatchUI();
                await this.refresh();
            } else {
                throw new Error(result.message || 'Server returned error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('删除失败: ' + e.message);
            console.error('Delete error:', e);
        }
    },

    async batchFetchLyrics() {
        // Find items that don't have lyrics
        const targetFilenames = Array.from(this.selectedItems);
        const targets = this.displayData.filter(i => targetFilenames.includes(i.filename) && !i.hasLyric);

        if (targets.length === 0) {
            if (typeof showInfo === 'function') showInfo('选中的歌曲中没有需要补充歌词的项');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('补全歌词', `选中的文件中有 ${targets.length} 首没有对应的歌词，确定要向服务器请求补全吗?`))) return;
        }

        let success = 0;
        let fail = 0;

        for (const item of targets) {
            if (!item.songInfo || !item.songInfo.source || item.songInfo.source === 'unknown') {
                fail++;
                continue;
            }
            try {
                // If single_song_ops exposes requestServerLyricCache
                if (typeof window.requestServerLyricCache === 'function') {
                    await window.requestServerLyricCache(item.songInfo, item.quality, true);
                    success++;
                    if (typeof showInfo === 'function') showInfo(`[${success}/${targets.length}] 成功补全: ${item.name}`);
                } else {
                    fail++;
                }
            } catch (e) {
                fail++;
            }
        }

        if (typeof showInfo === 'function') {
            showInfo(`补全操作完成。成功 ${success} 项，失败/不支持 ${fail} 项`);
        }
        this.refresh();
    },

    async batchEmbedLyric() {
        const targetFilenames = Array.from(this.selectedItems);
        if (targetFilenames.length === 0) {
            if (typeof showError === 'function') showError('请先选择要嵌入歌词的文件');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('嵌入歌词到文件',
                `将对选中的 ${targetFilenames.length} 首歌曲嵌入歌词到 USLT 标签。\n` +
                `• 已有歌词标签的歌曲将跳过\n` +
                `• 有 .lrc 文件的直接读取嵌入\n` +
                `• 没有 .lrc 文件的将尝试从网络获取\n\n确定继续吗?`
            ))) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在嵌入歌词，请稍候...');
            const res = await fetch('/api/music/cache/embedLyric', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                const { successCount = 0, skippedCount = 0, failCount = 0 } = result;
                if (typeof showInfo === 'function') {
                    showInfo(`嵌入完成：成功 ${successCount} 首，跳过（已有） ${skippedCount} 首，失败 ${failCount} 首`);
                }
                // 打印详情供排查
                if (result.details && result.details.length > 0) {
                    const failed = result.details.filter(d => d.status === 'fail');
                    if (failed.length > 0) {
                        console.warn('[EmbedLyric] 失败详情:', failed);
                    }
                }
            } else {
                throw new Error(result.message || '服务器返回错误');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('嵌入歌词失败: ' + e.message);
            console.error('[EmbedLyric] Error:', e);
        }
    },

    async batchUpdateMetadata() {
        const targetFilenames = Array.from(this.selectedItems);
        const targets = this.displayData.filter(i => targetFilenames.includes(i.filename));

        if (targets.length === 0) {
            if (typeof showInfo === 'function') showInfo('请先选择需要补全元信息的文件');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('补全元信息', `确定要向服务器请求补全这 ${targets.length} 个文件的元信息(包含封面与ID3标签)吗?`))) return;
        } else {
            if (!confirm(`确定要补全这 ${targets.length} 个文件的元信息吗?`)) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在处理，请稍候...');
            const res = await fetch('/api/music/cache/updateMetadata', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`元信息补全完成。成功 ${result.successCount} 项，失败 ${result.failCount} 项`);
                this.refresh();
            } else {
                throw new Error(result.message || 'Server returned error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('补全元信息失败: ' + e.message);
        }
    },

    async batchSwitchFolder() {
        const originalFilenames = Array.from(this.selectedItems);
        if (originalFilenames.length === 0) {
            if (typeof showError === 'function') showError('请先选择要移动的文件');
            return;
        }

        let targetFilenames = [...originalFilenames];
        let skipCount = 0;

        // [Constraint Check] 识别在 'music' 目录下的子目录歌曲
        // 移动（下载 -> 缓存）时，缓存目录不支持子目录结构
        if (this.filterFolder === 'music') {
            targetFilenames = originalFilenames.filter(fname => {
                const item = this.originalData.find(i => i.filename === fname);
                const hasSub = item && item.subPath && item.subPath !== '';
                if (hasSub) skipCount++;
                return !hasSub;
            });
        }

        if (targetFilenames.length === 0) {
            if (skipCount > 0) {
                if (typeof showError === 'function') showError(`选中的 ${skipCount} 个文件均包含分类，缓存目录不支持分类，无法移动`);
            }
            return;
        }

        let confirmMsg = `确定要将选中的 ${targetFilenames.length} 个文件在 下载目录 与 缓存目录 之间互相转移吗?`;
        if (skipCount > 0) {
            confirmMsg += `\n提示：选中的歌曲中有 ${skipCount} 首带分类，将无法移动到缓存目录，操作时将自动跳过。`;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('移动目录', confirmMsg))) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在移动文件，请稍候...');
            const res = await fetch('/api/music/cache/move', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`目录转移完成。成功 ${result.successCount} 项，失败 ${result.failCount} 项`);
                this.deselectAll();
                this.refresh();
            } else {
                throw new Error(result.message || 'Server returned error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('移动失败: ' + e.message);
        }
    },

    async batchSwitchBaseLocation() {
        const targetFilenames = Array.from(this.selectedItems);
        if (targetFilenames.length === 0) {
            if (typeof showError === 'function') showError('请先选择要转移的文件');
            return;
        }

        const el = document.getElementById('lm-location-select');
        const currentLocName = el ? (el.value === 'data' ? '云端(Data)' : '本地(Root)') : '当前目录';
        const targetLocName = el ? (el.value === 'data' ? '本地(Root)' : '云端(Data)') : '另一目录';

        if (typeof showSelect === 'function') {
            if (!(await showSelect('云端同步', `确定要将选中的 ${targetFilenames.length} 个文件从 ${currentLocName} 转移到 ${targetLocName} 吗?`))) return;
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在跨目录转移文件，请稍候...');
            const res = await fetch('/api/music/cache/switch-base', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames: targetFilenames })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo(`跨目录转移完成。成功 ${result.successCount} 项，失败 ${result.failCount} 项`);
                this.deselectAll();
                this.refresh();
            } else {
                throw new Error(result.message || 'Server returned error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('转移失败: ' + e.message);
        }
    },



    downloadSingle(index) {
        const item = this.displayData[index];
        if (!item) return;
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';
        const url = `/api/music/cache/file/${encodeURIComponent(username)}/${encodeURIComponent(item.filename)}?folder=${item.folder}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`;

        const a = document.createElement('a');
        a.href = url;
        a.download = item.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    batchDownloadToDevice() {
        const targetFilenames = Array.from(this.selectedItems);
        const targets = this.displayData.filter(i => targetFilenames.includes(i.filename));

        if (targets.length === 0) {
            if (typeof showError === 'function') showError('请先选择要保存的文件');
            return;
        }

        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

        // Use a slight delay to prevent browser from blocking multiple downloads
        targets.forEach((item, idx) => {
            setTimeout(() => {
                const url = `/api/music/cache/file/${encodeURIComponent(username)}/${encodeURIComponent(item.filename)}?folder=${item.folder}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}`;
                const a = document.createElement('a');
                a.href = url;
                a.download = item.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }, idx * 500);
        });

        if (typeof showInfo === 'function') showInfo(`已开始下载 ${targets.length} 个文件到设备`);
        this.deselectAll();
    },

    async openManualIndexModal(index) {
        console.log('[ManualIndex] Opening modal for index:', index);
        const item = this.displayData[index];
        if (!item) {
            console.error('[ManualIndex] Item not found at index:', index);
            return;
        }

        this.manualIndexTargetItem = item;
        const modal = document.getElementById('modal-manual-index');
        const content = document.getElementById('modal-manual-index-content');
        const input = document.getElementById('manual-index-search-input');
        const filenameEl = document.getElementById('manual-index-target-filename');
        const durationEl = document.getElementById('manual-index-target-duration');

        if (filenameEl) filenameEl.textContent = item.filename;
        if (durationEl) durationEl.textContent = item.interval || '--:--';

        // 默认搜索词：优先使用已有标签，否则使用文件名
        let defaultSearch = '';
        const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';

        if (!isNoTag(item.name)) defaultSearch += item.name;
        if (!isNoTag(item.singer)) defaultSearch += ' ' + item.singer;

        if (!defaultSearch.trim()) {
            defaultSearch = item.filename.replace(/\.[^/.]+$/, "").replace(/_-_/g, " ").replace(/ - /g, " ");
        }

        if (input) {
            input.value = defaultSearch.trim();
        }

        if (modal) {
            console.log('[ManualIndex] Modifying modal styles for visibility');
            // 确保移除所有可能导致残留隐藏的属性
            modal.classList.remove('hidden');
            modal.style.setProperty('display', 'flex', 'important');
            modal.style.setProperty('z-index', '9999', 'important');
            modal.style.setProperty('opacity', '1', 'important');

            // 监听滚动加载更多
            const resContainer = document.getElementById('manual-index-results');
            if (resContainer) {
                // 移除旧监听器防止重复
                resContainer.onscroll = null;
                resContainer.onscroll = () => {
                    if (this.isManualSearching) return;
                    // 距离底部 50px 时触发
                    if (resContainer.scrollTop + resContainer.clientHeight >= resContainer.scrollHeight - 50) {
                        this.doManualSearch(this.currentManualPage + 1);
                    }
                };
            }

            setTimeout(() => {
                if (content) {
                    content.classList.remove('scale-95', 'opacity-0');
                    content.classList.add('scale-100', 'opacity-100');
                    content.style.opacity = '1';
                    content.style.transform = 'scale(1)';
                }
                if (input) input.focus();
            }, 50);
        } else {
            console.error('[ManualIndex] Modal element not found!');
        }

        if (input && input.value) {
            this.currentManualPage = 1; // 重置页码
            this.doManualSearch(1);
        }
    },

    closeManualIndexModal() {
        const modal = document.getElementById('modal-manual-index');
        const content = document.getElementById('modal-manual-index-content');
        if (content) {
            content.classList.add('scale-95', 'opacity-0');
            content.classList.remove('scale-100', 'opacity-100');
        }
        setTimeout(() => {
            if (modal) {
                modal.classList.add('hidden');
                modal.style.display = 'none';
            }
            const resultsContainer = document.getElementById('manual-index-results');
            if (resultsContainer) {
                resultsContainer.innerHTML = `
                    <div class="flex flex-col items-center justify-center h-full opacity-30 mt-10">
                        <i class="fas fa-magnifying-glass text-6xl mb-4"></i>
                        <p class="text-sm font-bold tracking-wider">搜索在线歌曲以建立关联</p>
                    </div>`;
            }
            this.manualIndexTargetItem = null;
            this.currentManualResults = [];

            // Reset identify button
            const btn = document.getElementById('btn-manual-identify');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-fingerprint text-xl"></i>';
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }, 300);
    },

    async identifyTargetSong() {
        const item = this.manualIndexTargetItem;
        if (!item) return;

        const btn = document.getElementById('btn-manual-identify');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin text-xl"></i>';
            btn.classList.add('opacity-50', 'cursor-not-allowed');
        }

        try {
            const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';
            const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

            const resp = await fetch('/api/music/identify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-name': username,
                    'x-user-token': authToken
                },
                body: JSON.stringify({ filename: item.filename, folder: item.folder })
            });

            const result = await resp.json();
            if (result.success && result.results && result.results.length > 0) {
                const bestMatch = result.results[0];
                const searchInput = document.getElementById('manual-index-search-input');
                if (searchInput) {
                    searchInput.value = `${bestMatch.singer} - ${bestMatch.name}`;
                    // Trigger search
                    this.doManualSearch();
                }
                const scorePct = Math.round(bestMatch.score * 100);
                if (typeof showInfo === 'function') showInfo(`特征识别成功: ${bestMatch.singer} - ${bestMatch.name} (置信度: ${scorePct}%)`);
            } else {
                if (typeof showInfo === 'function') showInfo('无法识别该歌曲特征');
            }
        } catch (e) {
            console.error('[Identify] Failed:', e);
            if (typeof showInfo === 'function') showInfo('识别失败: ' + e.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-fingerprint text-xl"></i>';
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
    },

    async doManualSearch(page = 1) {
        if (this.isManualSearching) return;

        const input = document.getElementById('manual-index-search-input');
        const keyword = input ? input.value.trim() : '';
        const sourceEl = document.getElementById('manual-index-source-select');
        const source = (sourceEl ? sourceEl.value : '') || 'tx';
        const container = document.getElementById('manual-index-results');
        const btn = document.getElementById('btn-do-manual-search');

        if (!keyword) return;

        this.currentManualPage = page;
        this.isManualSearching = true;

        const origBtnHtml = btn ? btn.innerHTML : '搜索';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
        }

        console.log('[ManualIndex] Searching for:', keyword, 'on source:', source, 'page:', page);

        if (page === 1 && container) {
            this.currentManualResults = [];
            container.innerHTML = `
                <div class="flex flex-col items-center justify-center h-full py-20 animate-fade-in">
                    <div class="music-visualizer-loader mb-12">
                        <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                    </div>
                    <div class="text-center">
                        <p class="text-xl t-text-main font-black tracking-[0.2em] mb-2 uppercase">Searching ${source}</p>
                        <div class="flex items-center justify-center gap-2 text-emerald-500 font-bold mb-4">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                            <span class="text-sm">正在请求第 ${page} 页</span>
                        </div>
                    </div>
                </div>`;
        }

        try {
            const url = `/api/music/search?name=${encodeURIComponent(keyword)}&source=${source}&page=${page}&limit=20`;
            const res = await fetch(url, {
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });

            if (!res.ok) throw new Error(`Status: ${res.status}`);
            const result = await res.json();

            let newList = [];
            if (Array.isArray(result)) newList = result;
            else if (result.success && result.data && result.data.list) newList = result.data.list;
            else if (result.list) newList = result.list;

            if (newList && newList.length > 0) {
                // 如果是第1页则替换，否则追加
                if (page === 1) {
                    this.currentManualResults = newList;
                } else {
                    // 去重合并
                    const existingIds = new Set(this.currentManualResults.map(r => String(r.id || r.songmid)));
                    const filteredNew = newList.filter(n => !existingIds.has(String(n.id || n.songmid)));
                    this.currentManualResults = [...this.currentManualResults, ...filteredNew];
                    if (filteredNew.length === 0 && page > 1) {
                        if (typeof showInfo === 'function') showInfo('已经到底啦');
                    }
                }
                this.renderManualSearchResults(this.currentManualResults);
            } else {
                if (page === 1 && container) {
                    container.innerHTML = `<div class="text-center py-20 opacity-50 font-bold">未找到相关结果</div>`;
                } else if (page > 1) {
                    if (typeof showInfo === 'function') showInfo('没有更多搜索结果了');
                }
            }
        } catch (e) {
            console.error('[ManualIndex] Search failed:', e);
            if (page === 1 && container) {
                container.innerHTML = `<div class="text-center py-20 text-red-500 font-bold">搜索失败: ${e.message}</div>`;
            }
        } finally {
            this.isManualSearching = false;
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origBtnHtml;
            }
        }
    },

    renderManualSearchResults(results) {
        const container = document.getElementById('manual-index-results');
        if (!container || !this.manualIndexTargetItem) return;

        const targetInterval = this.manualIndexTargetItem.interval;
        const targetSecs = this.parseInterval(targetInterval);

        // 排序逻辑：时长匹配的排在前面
        const sortedResults = [...results].sort((a, b) => {
            const aSecs = this.parseInterval(a.interval);
            const bSecs = this.parseInterval(b.interval);
            const aDiff = targetSecs > 0 ? Math.abs(aSecs - targetSecs) : 999;
            const bDiff = targetSecs > 0 ? Math.abs(bSecs - targetSecs) : 999;

            if (aDiff <= 3 && bDiff > 3) return -1;
            if (bDiff <= 3 && aDiff > 3) return 1;
            return 0;
        });

        let html = '';
        sortedResults.forEach((item) => {
            const itemSecs = this.parseInterval(item.interval);
            const isMatch = targetSecs > 0 && Math.abs(itemSecs - targetSecs) <= 3;

            // 找到原始索引
            const originalIdx = results.findIndex(r => r === item);

            html += `
                <div class="flex items-center p-3 md:p-4 t-bg-main border t-border-main rounded-2xl md:rounded-3xl hover:border-emerald-400 group transition-all shadow-sm">
                    <div class="w-12 h-12 rounded-xl overflow-hidden mr-4 flex-shrink-0 bg-gray-100 border t-border-main">
                        <img src="${item.img || '/music/assets/logo.svg'}" onerror="this.src='/music/assets/logo.svg'" loading="lazy" class="w-full h-full object-cover">
                    </div>
                    <div class="flex-1 min-w-0 mr-4">
                        <div class="font-bold t-text-main text-sm md:text-base truncate group-hover:text-emerald-500 transition-colors">${item.name}</div>
                        <div class="text-[11px] t-text-muted truncate mt-0.5 font-medium">${item.singer} · ${item.albumName || '未知专辑'}</div>
                    </div>
                    <div class="text-right mr-5 flex-shrink-0">
                        <div class="text-[10px] uppercase font-black t-text-muted opacity-30 tracking-widest mb-0.5">${item.source}</div>
                        <div class="text-[11px] font-mono font-bold ${isMatch ? 'text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded-lg' : 't-text-main'}">${item.interval || '--:--'}</div>
                    </div>
                    <button onclick="window.LocalMusicManager.linkItem(${originalIdx})"
                        class="px-6 py-2.5 ${isMatch ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20' : 't-bg-track hover:t-bg-item-hover t-text-main border t-border-main'} font-bold text-xs rounded-xl shadow-lg transition-all active:scale-95">
                        关联
                    </button>
                </div>
            `;
        });

        container.innerHTML = html || `<div class="text-center py-20 opacity-50 font-bold">未找到搜索结果</div>`;
    },

    async linkItem(idx) {
        if (!this.manualIndexTargetItem || !this.currentManualResults || !this.currentManualResults[idx]) return;

        const onlineItem = this.currentManualResults[idx];
        const targetSecs = this.parseInterval(this.manualIndexTargetItem.interval);
        const itemSecs = this.parseInterval(onlineItem.interval);
        const isMatch = targetSecs > 0 && Math.abs(itemSecs - targetSecs) <= 3;

        if (!isMatch && targetSecs > 0) {
            if (typeof showSelect === 'function') {
                if (!(await showSelect('时长不匹配', `选中的歌曲时长 (${onlineItem.interval}) 与本地文件 (${this.manualIndexTargetItem.interval}) 相差较大，确定要强制关联吗?`))) return;
            } else {
                if (!confirm('时长不匹配，确定要关联吗?')) return;
            }
        }

        try {
            if (typeof showInfo === 'function') showInfo('正在关联并同步元数据...');
            const res = await fetch('/api/music/cache/link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({
                    filename: this.manualIndexTargetItem.filename,
                    songInfo: onlineItem
                })
            });

            const result = await res.json();
            if (result.success) {
                if (typeof showInfo === 'function') showInfo('关联成功！文件名及标签已更新');
                this.closeManualIndexModal();
                this.refresh();
            } else {
                throw new Error(result.message || 'Server error');
            }
        } catch (e) {
            if (typeof showError === 'function') showError('关联操作失败: ' + e.message);
        }
    },

    async autoLinkAll() {
        const unindexed = this.originalData.filter(item =>
            item.source === 'unknown' || (item.songmid && item.songmid.includes(' - ')) || !item.name || item.name === '未知歌曲'
        );

        if (unindexed.length === 0) {
            if (typeof showInfo === 'function') showInfo('所有歌曲已关联，无需自动处理');
            return;
        }

        if (typeof showSelect === 'function') {
            if (!(await showSelect('自动关联', `共发现 ${unindexed.length} 首未关联歌曲，系统将尝试通过多源搜索并匹配时长（误差±2s内）进行自动识别，确定开始吗？`))) return;
        }

        let successCount = 0;
        let failCount = 0;
        const total = unindexed.length;

        for (let i = 0; i < total; i++) {
            const item = unindexed[i];
            if (typeof showInfo === 'function') showInfo(`正在自动识别 (${i + 1}/${total}): ${item.name || item.filename}`);

            const match = await this.findBestMatch(item);
            if (match) {
                try {
                    const res = await fetch('/api/music/cache/link', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                        },
                        body: JSON.stringify({
                            filename: item.filename,
                            songInfo: match
                        })
                    });
                    const result = await res.json();
                    if (result.success) {
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (e) {
                    failCount++;
                }
            } else {
                failCount++;
            }
        }

        if (typeof showSelect === 'function') {
            await showSelect('自动关联完成', `成功关联: ${successCount} 首\n未能识别: ${failCount} 首\n未识别歌曲建议手动关联。`, { okOnly: true });
        } else {
            alert(`自动关联完成！\n成功: ${successCount}\n失败: ${failCount}`);
        }
        this.refresh();
    },

    async findBestMatch(localItem) {
        const sources = ['tx', 'wy', 'kg', 'kw', 'mg'];
        const targetSecs = this.parseInterval(localItem.interval);
        if (targetSecs <= 0) return null;

        // 1. 优先：使用 AcoustID 指纹识别
        console.log('[AutoLink] Using AcoustID first for:', localItem.filename);
        try {
            const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';
            const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null) || localStorage.getItem('lx_user_token') || '';

            const resp = await fetch('/api/music/identify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-name': username,
                    'x-user-token': authToken
                },
                body: JSON.stringify({ filename: localItem.filename, folder: localItem.folder })
            });

            const result = await resp.json();
            if (result.success && result.results && result.results.length > 0) {
                const bestIdentify = result.results[0];
                const scorePct = Math.round(bestIdentify.score * 100);
                if (typeof showInfo === 'function') showInfo(`[指纹识别] ${bestIdentify.singer} - ${bestIdentify.name} (${scorePct}%)`);

                // 使用识别出的信息再次在各源中搜索以获取规范的 songInfo
                const identifyKeyword = `${bestIdentify.singer} ${bestIdentify.name}`;
                for (const source of sources) {
                    const results = await this.searchSingleSource(identifyKeyword, source);
                    const match = results.find(r => {
                        const rSecs = this.parseInterval(r.interval);
                        return Math.abs(rSecs - targetSecs) <= 3;
                    });
                    if (match) return match;
                }
            }
        } catch (e) {
            console.error('[AutoLink] AcoustID indentify failed:', e);
        }

        // 2. 兜底：关键词搜索
        // Try to get clean keywords
        let keyword = localItem.name;
        const isNoTag = (n) => !n || n === '未知歌曲' || n === '未知歌手' || n.toLowerCase() === 'unknown';

        if (isNoTag(keyword)) {
            keyword = localItem.filename.replace(/\.[^/.]+$/, "").replace(/^[0-9\-_\s]+/, "");
        } else if (localItem.singer && !isNoTag(localItem.singer)) {
            keyword = `${localItem.name} ${localItem.singer}`;
        }

        console.log('[AutoLink] Falling back to keyword search:', keyword);
        for (const source of sources) {
            try {
                const results = await this.searchSingleSource(keyword, source);
                if (results && results.length > 0) {
                    // Look for precise duration match
                    const match = results.find(r => {
                        const rSecs = this.parseInterval(r.interval);
                        return Math.abs(rSecs - targetSecs) <= 2;
                    });
                    if (match) return match;
                }
            } catch (e) {
                console.warn(`Search failed for ${source}:`, e);
            }
        }

        return null;
    },

    async searchSingleSource(text, source) {
        try {
            const res = await fetch(`/api/music/search?name=${encodeURIComponent(text)}&source=${source}&page=1&limit=10`, {
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });
            const result = await res.json();

            // Normalize result format (supporting array or object)
            if (Array.isArray(result)) return result;
            if (result.list && Array.isArray(result.list)) return result.list;
            if (result.data && result.data.list) return result.data.list;
            return [];
        } catch (e) {
            return [];
        }
    },

    parseInterval(str) {
        if (!str) return 0;
        if (typeof str === 'number') return str;
        const pts = str.split(':');
        if (pts.length === 2) return parseInt(pts[0]) * 60 + parseInt(pts[1]);
        if (pts.length === 3) return parseInt(pts[0]) * 3600 + parseInt(pts[1]) * 60 + parseInt(pts[2]);
        return parseInt(str) || 0;
    },

    async openSubPathModal(mode = 'filter') {
        if (this.filterFolder !== 'music') {
            if (typeof showInfo === 'function') showInfo('请先在筛选中选择“下载”目录');
            return;
        }
        this.subPathModalMode = mode;
        const modal = document.getElementById('subpath-select-modal');
        const content = document.getElementById('subpath-select-modal-content');
        if (!modal || !content) return;

        // Update modal title based on mode
        const title = modal.querySelector('h3');
        if (title) title.innerText = mode === 'categorize' ? '移动到分类' : '选择子目录';

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }, 10);

        try {
            const res = await fetch(`/api/music/cache/subdirs?folder=music`, {
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });
            const { data } = await res.json();
            this.renderSubPathList(data || []);
        } catch (e) {
            console.error('Failed to fetch subdirs:', e);
            if (typeof showError === 'function') showError('获取子目录失败');
        }
    },

    closeSubPathModal() {
        const modal = document.getElementById('subpath-select-modal');
        const content = document.getElementById('subpath-select-modal-content');
        if (!modal || !content) return;

        content.classList.remove('scale-100', 'opacity-100');
        content.classList.add('scale-95', 'opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }, 300);
    },

    renderSubPathList(dirs) {
        const list = document.getElementById('subpath-select-list');
        if (!list) return;

        let html = '';

        if (this.subPathModalMode === 'filter') {
            // [All Directories] Option
            html += `
                <button onclick="window.LocalMusicManager.selectSubPath('')" class="p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${this.selectedSubPath === '' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 't-border-main hover:border-emerald-500 hover:bg-emerald-50/50'}">
                    <i class="fas fa-layer-group text-xl t-text-muted group-hover:text-emerald-500"></i>
                    <span class="text-xs font-bold t-text-main truncate w-full text-center">全部目录</span>
                </button>
            `;
            // [Root Only] Option
            html += `
                <button onclick="window.LocalMusicManager.selectSubPath('__ROOT__')" class="p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${this.selectedSubPath === '__ROOT__' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 't-border-main hover:border-emerald-500 hover:bg-emerald-50/50'}">
                    <i class="fas fa-home text-xl t-text-muted group-hover:text-emerald-500"></i>
                    <span class="text-xs font-bold t-text-main truncate w-full text-center">根目录</span>
                </button>
            `;
        } else {
            // [Categorize to Root] Option
            html += `
                <button onclick="window.LocalMusicManager.selectSubPath('')" class="p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${this.selectedSubPath === '' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 't-border-main hover:border-emerald-500 hover:bg-emerald-50/50'}">
                    <i class="fas fa-home text-xl t-text-muted group-hover:text-emerald-500"></i>
                    <span class="text-xs font-bold t-text-main truncate w-full text-center">移动到根目录 (/)</span>
                </button>
            `;
        }

        dirs.forEach(dir => {
            const isActive = this.selectedSubPath === dir;
            html += `
                <button onclick="window.LocalMusicManager.selectSubPath('${dir.replace(/'/g, "\\'")}')" class="p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 group ${isActive ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : 't-border-main hover:border-emerald-500 hover:bg-emerald-50/50'}">
                    <i class="fas fa-folder text-xl t-text-muted group-hover:text-emerald-500"></i>
                    <span class="text-xs font-bold t-text-main truncate w-full text-center" title="${dir}">${dir}</span>
                </button>
            `;
        });

        list.innerHTML = html;
    },

    selectSubPath(path) {
        if (this.subPathModalMode === 'categorize') {
            const target = path === '__ROOT__' ? '' : path;
            this.batchCategorize(target);
            return;
        }
        this.selectedSubPath = path;
        const text = document.getElementById('lm-subpath-text');
        let displayText = path;
        if (path === '') displayText = '全部';
        else if (path === '__ROOT__') displayText = '根目录';
        if (text) text.innerText = displayText;
        this.closeSubPathModal();
        this.applyFilters();
    },

    async batchCategorize(targetSubPath) {
        const filenames = Array.from(this.selectedItems);
        if (filenames.length === 0) return;

        if (typeof showMsg === 'function') showMsg(`正在移动 ${filenames.length} 首歌曲到 ${targetSubPath || '根目录'}...`, 'info');

        try {
            const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '_open';
            const res = await fetch(`/api/music/cache/categorize?user=${encodeURIComponent(username)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ filenames, subPath: targetSubPath })
            });
            const data = await res.json();
            if (data.success) {
                if (typeof showMsg === 'function') showMsg(`成功移动 ${data.successCount} 首, 失败 ${data.failCount} 首`, 'success');
                this.closeSubPathModal();
                this.selectedItems.clear();
                this.updateBatchUI();
                // We need to reload data because filenames/paths in memory are now invalid
                await this.fetchData(true);
            } else {
                if (typeof showError === 'function') showError('移动文件失败');
            }
        } catch (e) {
            console.error('Categorize failed:', e);
            if (typeof showError === 'function') showError('网络请求失败');
        }
    },

    openCategorizeModal() {
        this.openSubPathModal('categorize');
    },

    async createSubFolder() {
        const input = document.getElementById('new-subfolder-input');
        if (!input) return;
        const subPath = input.value.trim();
        if (!subPath) return;

        try {
            const res = await fetch('/api/music/cache/mkdir', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
                },
                body: JSON.stringify({ folder: 'music', subPath })
            });
            const { success } = await res.json();
            if (success) {
                if (typeof showMsg === 'function') showMsg('文件夹创建成功', 'success');
                input.value = '';
                // Re-open/refresh modal
                this.openSubPathModal();
            } else {
                if (typeof showError === 'function') showError('文件夹已存在或创建失败');
            }
        } catch (e) {
            console.error('Failed to create subdir:', e);
        }
    }
};

window.toggleLmBatchMode = () => window.LocalMusicManager.toggleBatchMode();

// Auto init when script loads (if in scope), else done manually
setTimeout(() => {
    if (window.LocalMusicManager) {
        window.LocalMusicManager.init();
    }
}, 500);
