/**
 * 通用通知引擎
 * 核心特性：
 * 1. 优先级控制：System > Remote
 * 2. 队列系统：FIFO 队列处理
 * 3. 智能样式：根据 type 和 title 自动匹配图标与配色
 */
(function () {
    // ================= 1. 基础配置与资源 =================
    const CONFIG = {
        getLocalVersion: () => (window.CONFIG && window.CONFIG.version) ? window.CONFIG.version : '0.0.0'
    };

    // 图标库 (SVG Path)
    const ICONS = {
        bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>',
        rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path><path d="M9 12H4s.55-3.03 2-4c1.62-1.1 2.73-1.68 4.12-1.98"></path><path d="M15 13v5c0 1.8.71 2.93 2 4 1.15-1.46 1.83-2.6 1.98-4.02.26-2.48.51-3.66 1.02-4.98"></path>',
        warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
        check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
        info: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>'
    };

    // 队列状态
    const NOTIFICATION_QUEUE = [];
    let isShowing = false;

    // ================= 2. 工具函数 =================

    function compareVersions(local, remote) {
        if (!local || !remote) return 0;
        const v1 = local.replace(/^v/, '').split('.').map(Number);
        const v2 = remote.replace(/^v/, '').split('.').map(Number);
        const len = Math.max(v1.length, v2.length);
        for (let i = 0; i < len; i++) {
            const n1 = v1[i] || 0;
            const n2 = v2[i] || 0;
            if (n1 < n2) return -1;
            if (n1 > n2) return 1;
        }
        return 0;
    }

    function processQueue() {
        if (isShowing || NOTIFICATION_QUEUE.length === 0) return;

        const { item, storageKey } = NOTIFICATION_QUEUE.shift();
        isShowing = true;
        console.log(`[Notification] Showing from queue: ${item.id}`);

        renderModal(item, storageKey, () => {
            isShowing = false;
            setTimeout(processQueue, 300);
        });
    }

    // 智能获取样式配置
    function getStyleConfig(type, title) {
        const t = title.toLowerCase();

        if (type === 'version' || t.includes('update') || t.includes('更新') || t.includes('版本')) {
            return {
                icon: ICONS.rocket,
                color: 'var(--c-600, #2563eb)',
                bg: 'var(--c-50, #eff6ff)',
                label: 'New Update'
            };
        }

        if (t.includes('维护') || t.includes('警告') || t.includes('失败') || t.includes('error') || t.includes('warning')) {
            return {
                icon: ICONS.warning,
                color: '#f59e0b',
                bg: '#fffbeb',
                label: 'System Alert'
            };
        }

        if (t.includes('成功') || t.includes('success') || t.includes('完成')) {
            return {
                icon: ICONS.check,
                color: '#10b981',
                bg: '#ecfdf5',
                label: 'Success'
            };
        }

        return {
            icon: ICONS.bell,
            color: 'var(--c-600, #4b5563)',
            bg: 'var(--c-50, #f3f4f6)',
            label: 'Notification'
        };
    }

    // 渲染 UI
    function renderModal(item, storageKey, onClose) {
        const styleConfig = getStyleConfig(item.type, item.ui.title);
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center p-4';
        modal.innerHTML = `
            <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="closeModal()"></div>
            <div class="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-[fadeIn_0.2s_ease-out]">
                <div class="p-6 border-b border-gray-200 dark:border-gray-700" style="background: linear-gradient(135deg, ${styleConfig.bg} 0%, transparent 100%);">
                    <div class="flex items-start gap-4">
                        <div class="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style="background-color: ${styleConfig.bg}; border: 2px solid ${styleConfig.color};">
                            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${styleConfig.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                ${styleConfig.icon}
                            </svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <span class="inline-block px-2.5 py-0.5 text-xs font-medium rounded-full mb-1" style="background-color: ${styleConfig.bg}; color: ${styleConfig.color};">
                                ${styleConfig.label}
                            </span>
                            <h3 class="text-lg font-semibold text-gray-900 dark:text-white">${item.ui.title}</h3>
                        </div>
                        <button onclick="closeModal()" class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" class="text-gray-400">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="p-6">
                    <p class="text-gray-600 dark:text-gray-300 leading-relaxed">${item.ui.message}</p>
                </div>
                <div class="px-6 pb-6 flex gap-3">
                    ${item.ui.cancel_text ? `<button onclick="closeModal()" class="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">${item.ui.cancel_text}</button>` : ''}
                    <button onclick="handleConfirm()" class="flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors" style="background-color: ${styleConfig.color}; color: white;">${item.ui.confirm_text}</button>
                </div>
            </div>
        `;

        function closeModal() {
            modal.remove();
            if (onClose) onClose();
        }

        function handleConfirm() {
            if (item.action?.type === 'link' && item.action.url) {
                window.open(item.action.url, '_blank');
            }
            closeModal();
        }

        document.body.appendChild(modal);
        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
        });
    }

    // ================= 3. 检查更新 =================
    async function checkUpdates(isManual = false) {
        if (isManual) {
            const message = '由于在线更新检测服务已禁用，请查看更新日志了解最新版本信息。';
            const errorItem = {
                id: 'manual_check_disabled',
                type: 'info',
                ui: {
                    title: '检查更新',
                    message: message,
                    confirm_text: '确定',
                    cancel_text: ''
                },
                action: { type: 'close' },
                logic: { interval_hours: 0 }
            };
            renderModal(errorItem, 'temp_manual_disabled', null);
        }
    }

    // 暴露给全局的方法
    window.LxNotification = {
        checkUpdates: checkUpdates
    };

})();
