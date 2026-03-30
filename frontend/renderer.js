/**
 * Bloom AI Chat - Renderer Process Script
 * Offline AI chat renderer
 */

// DOM Elements
const loadingScreen = document.getElementById('loading-screen');
const backendStatus = document.getElementById('backend-status');
const appContainer = document.getElementById('app-container');
const chatArea = document.getElementById('chat-area');
const messageContainer = document.getElementById('message-container');
const welcomeMessage = document.getElementById('welcome-message');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const modelSelect = document.getElementById('model-select');
const currentModelDisplay = document.getElementById('current-model-display');
const newChatBtn = document.getElementById('new-chat-btn');
const sessionsList = document.getElementById('sessions-container');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const themeOptions = document.querySelectorAll('.theme-option');
const systemPromptInput = document.getElementById('system-prompt-input');
const temperatureSlider = document.getElementById('temperature-slider');
const tempValue = document.getElementById('temp-value');
const defaultModelSelect = document.getElementById('default-model-select');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const charCount = document.getElementById('char-count');
const inputWrapper = document.querySelector('.input-wrapper');
const addImageBtn = document.getElementById('add-image-btn');
const attachBtn = document.getElementById('attach-btn');
const windowTopbar = document.getElementById('window-topbar');
const windowMinimizeBtn = document.getElementById('window-minimize');
const windowMaximizeBtn = document.getElementById('window-maximize');
const windowCloseBtn = document.getElementById('window-close');
const windowMenu = document.getElementById('window-menu');
const menuPopover = document.getElementById('menu-popover');
const sidebar = document.querySelector('.sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarResizeZone = document.getElementById('sidebar-resize-zone');
const mainContent = document.querySelector('.main-content');
const skillsList = document.getElementById('skills-list');
const skillNameInput = document.getElementById('skill-name-input');
const skillContentInput = document.getElementById('skill-content-input');
const addSkillBtn = document.getElementById('add-skill-btn');
const uploadSkillBtn = document.getElementById('upload-skill-btn');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const monthlyTokenLimitInput = document.getElementById('monthly-token-limit');
const settingsAccountName = document.getElementById('settings-account-name');
const settingsPlan = document.getElementById('settings-plan');
const settingsTokenLimit = document.getElementById('settings-token-limit');
const settingsTokenUsed = document.getElementById('settings-token-used');
const settingsSessionCount = document.getElementById('settings-session-count');
const settingsMessageCount = document.getElementById('settings-message-count');
const settingsUsageProgress = document.getElementById('settings-usage-progress');
const settingsUsageFootnote = document.getElementById('settings-usage-footnote');
const settingsModelsPath = document.getElementById('settings-models-path');
const settingsSessionsPath = document.getElementById('settings-sessions-path');
const settingsMessageLimitNote = document.getElementById('settings-message-limit-note');
const settingsRuntimeStatus = document.getElementById('settings-runtime-status');
const settingsHardwareStatus = document.getElementById('settings-hardware-status');
const settingsPlatformStatus = document.getElementById('settings-platform-status');
const promptLibrary = document.getElementById('prompt-library');
const statusRuntime = document.getElementById('status-runtime');
const statusHardware = document.getElementById('status-hardware');
const statusModel = document.getElementById('status-model');
const statusSpeed = document.getElementById('status-speed');
const statusRuntimePill = document.getElementById('status-runtime-pill');
const statusHardwarePill = document.getElementById('status-hardware-pill');
const openModelsPathBtn = document.getElementById('open-models-path-btn');
const openSessionsPathBtn = document.getElementById('open-sessions-path-btn');
const API_BASE = 'http://127.0.0.1:8000';
const SETTINGS_SAVE_DEBOUNCE_MS = 250;
const APP_CONTROL_BLOCK_RESPONSE = "I can’t directly open Notepad or any other app on your computer right now in Bloom. I can guide you step-by-step, and direct app control may be added in a future update.";

// State
let currentSessionId = null;
let currentMessages = [];
let currentModel = 'llama3';
let chatHistory = [];
let availableModels = [];
let settings = {
    theme: 'dark',
    systemPrompt: 'You are a helpful AI assistant. Provide clear, concise responses.',
    temperature: 0.7,
    defaultModel: 'llama3',
    developerMode: false,
    skills: [],
    monthlyTokenLimit: 200000,
    sidebarWidth: 300
};
let isGenerating = false;
let abortController = null;
let zoomLevel = 1;
let activeMenuKey = null;
let isFullscreenMode = false;
let isInputComposing = false;
let settingsSaveTimer = null;
let usageSummary = null;
let isSidebarResizing = false;
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = 300;
let runtimeStatusTimer = null;
let generationStartedAt = null;
let generationCharCount = 0;


function apiUrl(pathname) {
    return `${API_BASE}${pathname}`;
}

function setGeneratingState(nextState) {
    isGenerating = Boolean(nextState);
    sendBtn.disabled = isGenerating;
    stopBtn.classList.toggle('active', isGenerating);
    if (!isGenerating && statusSpeed) {
        statusSpeed.textContent = 'Idle';
    }
}

function normalizeRoleForBackend(role) {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'assistant' || normalized === 'ai' || normalized === 'bot' || normalized === 'model') {
        return 'assistant';
    }
    if (normalized === 'system') {
        return 'system';
    }
    return 'user';
}

function isAssistantRole(role) {
    const normalized = String(role || '').toLowerCase();
    return normalized === 'assistant' || normalized === 'ai' || normalized === 'bot' || normalized === 'model';
}

async function getResponseErrorDetails(response) {
    try {
        const payload = await response.json();
        return payload?.detail || JSON.stringify(payload);
    } catch {
        try {
            return await response.text();
        } catch {
            return '';
        }
    }
}

function setWindowMaximizeIcon(isMaximized) {
    if (!windowMaximizeBtn) return;
    windowMaximizeBtn.innerHTML = isMaximized
        ? '<i class="fa-regular fa-clone"></i>'
        : '<i class="fa-regular fa-square"></i>';
    windowMaximizeBtn.title = isMaximized ? 'Restore' : 'Maximize';
}

function isCloudModel(name) {
    const modelName = String(name || '').toLowerCase();
    return modelName.includes(':cloud') || modelName.includes('-cloud');
}

function normalizeSkills(skills) {
    if (!Array.isArray(skills)) return [];

    return skills
        .map((skill, index) => {
            const name = String(skill?.name || `Skill ${index + 1}`).trim();
            const content = String(skill?.content || '').trim();
            if (!name || !content) return null;
            return {
                id: String(skill?.id || `${Date.now()}-${index}`),
                name,
                content,
                enabled: skill?.enabled !== false
            };
        })
        .filter(Boolean);
}

function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
}

function formatBytes(bytes) {
    const size = Number(bytes || 0);
    if (size <= 0) return '';
    const gb = size / (1024 ** 3);
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
}

function inferModelCategory(model) {
    const name = String(model?.name || '').toLowerCase();
    const sizeText = formatBytes(model?.size);

    let category = 'Chat';
    if (name.includes('coder') || name.includes('code') || name.includes('deepseek-coder') || name.includes('codellama')) {
        category = 'Coding';
    } else if (name.includes('vision') || name.includes('vl') || name.includes('llava')) {
        category = 'Vision';
    } else if (name.includes('cloud')) {
        category = 'Cloud';
    } else if ((model?.size || 0) > 0 && (model.size / (1024 ** 3)) <= 5) {
        category = 'Fast';
    }

    let speed = 'Balanced';
    const sizeGb = Number(model?.size || 0) / (1024 ** 3);
    if (name.includes('cloud')) {
        speed = 'Remote';
    } else if (sizeGb > 0 && sizeGb <= 5) {
        speed = 'Fast';
    } else if (sizeGb >= 12) {
        speed = 'Heavy';
    }

    return {
        category,
        speed,
        sizeText
    };
}


function highlightCode(code, language) {
    const text = String(code || '');
    const lang = String(language || 'plaintext').toLowerCase();
    const patterns = [];

    const commentPattern = lang === 'python'
        ? /#.*$/gm
        : /\/\/.*$|\/\*[\s\S]*?\*\//gm;

    patterns.push({ type: 'comment', regex: commentPattern });
    patterns.push({ type: 'string', regex: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g });
    patterns.push({ type: 'number', regex: /\b\d+(?:\.\d+)?\b/g });

    if (['javascript', 'typescript', 'js', 'ts', 'java', 'c', 'cpp', 'csharp'].includes(lang)) {
        patterns.push({ type: 'keyword', regex: /\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|import|export|try|catch|finally|async|await|public|private|static|void|int|float|double|char|bool)\b/g });
    } else if (['python', 'py'].includes(lang)) {
        patterns.push({ type: 'keyword', regex: /\b(def|class|return|if|elif|else|for|while|try|except|finally|import|from|as|with|lambda|yield|async|await|True|False|None)\b/g });
    } else if (['json'].includes(lang)) {
        patterns.push({ type: 'keyword', regex: /\b(true|false|null)\b/g });
    } else if (['bash', 'shell', 'sh', 'powershell', 'ps1'].includes(lang)) {
        patterns.push({ type: 'keyword', regex: /\b(if|then|fi|for|do|done|echo|export|function|param|Write-Host|Get-ChildItem|Where-Object)\b/g });
    }

    patterns.push({ type: 'function', regex: /\b([A-Za-z_][\w]*)\s*(?=\()/g });
    patterns.push({ type: 'operator', regex: /[=+\-*/<>!&|%]+/g });

    const matches = [];
    patterns.forEach((pattern) => {
        pattern.regex.lastIndex = 0;
        let match;
        while ((match = pattern.regex.exec(text)) !== null) {
            matches.push({
                start: match.index,
                end: match.index + match[0].length,
                type: pattern.type,
                value: match[0]
            });
            if (match.index === pattern.regex.lastIndex) {
                pattern.regex.lastIndex += 1;
            }
        }
    });

    matches.sort((a, b) => a.start - b.start || b.end - a.end);

    const filtered = [];
    let cursor = 0;
    for (const token of matches) {
        if (token.start < cursor) continue;
        filtered.push(token);
        cursor = token.end;
    }

    let result = '';
    let index = 0;
    for (const token of filtered) {
        result += escapeHtml(text.slice(index, token.start));
        result += `<span class="token-${token.type}">${escapeHtml(token.value)}</span>`;
        index = token.end;
    }
    result += escapeHtml(text.slice(index));
    return result;
}

function updateStatusBar() {
    if (statusModel) {
        statusModel.textContent = currentModel || 'Not selected';
    }
}

function updateRuntimeStatus(status) {
    if (!statusRuntime || !statusHardware) return;

    const ollamaText = status?.ollamaReady ? 'Ollama connected' : 'Ollama not ready';
    const backendText = status?.backendReady ? 'Backend live' : 'Backend offline';
    const runtimeSummary = `${ollamaText} | ${backendText}`;
    statusRuntime.textContent = runtimeSummary;
    statusRuntimePill?.classList.toggle('status-ok', Boolean(status?.ollamaReady && status?.backendReady));
    statusRuntimePill?.classList.toggle('status-warn', Boolean(!status?.ollamaReady || !status?.backendReady));

    const hardwareSummary = status?.gpuName
        ? `${status.gpuName}${status.gpuVramGb ? ` | ${status.gpuVramGb} GB VRAM` : ''}`
        : 'CPU / GPU info unavailable';

    statusHardware.textContent = hardwareSummary;
    statusHardwarePill?.classList.toggle('status-ok', Boolean(status?.gpuName));
    statusHardwarePill?.classList.toggle('status-warn', Boolean(!status?.gpuName));

    if (settingsRuntimeStatus) {
        settingsRuntimeStatus.textContent = runtimeSummary;
    }
    if (settingsHardwareStatus) {
        settingsHardwareStatus.textContent = hardwareSummary;
    }
    if (settingsPlatformStatus) {
        const platformBits = [status?.platform || 'unknown', status?.appVersion ? `v${status.appVersion}` : ''];
        settingsPlatformStatus.textContent = platformBits.filter(Boolean).join(' | ');
    }
}

async function refreshRuntimeStatus() {
    try {
        const status = await window.systemAPI?.getRuntimeStatus?.();
        updateRuntimeStatus(status || {});
    } catch (error) {
        console.warn('Runtime status fetch failed:', error);
        updateRuntimeStatus({ ollamaReady: false, backendReady: false });
    }
}

function applySidebarWidth(width, persist = false) {
    const nextWidth = Math.max(220, Math.min(460, Math.round(Number(width) || 300)));
    document.documentElement.style.setProperty('--sidebar-width', `${nextWidth}px`);

    if (persist) {
        settings.sidebarWidth = nextWidth;
        scheduleSettingsSave();
    }
}

function applyThemeSelection(theme) {
    const selectedTheme = theme === 'light' ? 'light' : 'dark';
    applyTheme(selectedTheme);
    themeOptions.forEach((option) => {
        option.classList.toggle('active', option.dataset.theme === selectedTheme);
    });
}

function renderSkillsList() {
    if (!skillsList) return;

    const skills = normalizeSkills(settings.skills);
    settings.skills = skills;
    skillsList.innerHTML = '';

    if (!skills.length) {
        const empty = document.createElement('div');
        empty.className = 'skills-empty';
        empty.textContent = 'No skills added yet. Add or upload a skill to use it in chats.';
        skillsList.appendChild(empty);
        return;
    }

    skills.forEach((skill) => {
        const row = document.createElement('div');
        row.className = 'skill-item';
        row.dataset.skillId = skill.id;
        row.innerHTML = `
            <input type="checkbox" class="skill-checkbox" ${skill.enabled ? 'checked' : ''} aria-label="Enable skill ${skill.name}">
            <div class="skill-meta">
                <div class="skill-name">${skill.name}</div>
                <div class="skill-preview">${skill.content.replace(/\s+/g, ' ').slice(0, 90)}${skill.content.length > 90 ? '...' : ''}</div>
            </div>
            <button class="skill-delete" title="Delete skill" aria-label="Delete skill ${skill.name}">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        skillsList.appendChild(row);
    });
}

async function loadUsageSummary() {
    try {
        const response = await fetch(apiUrl('/usage'));
        if (!response.ok) {
            const details = await getResponseErrorDetails(response);
            throw new Error(`Usage failed ${response.status}${details ? ` - ${details}` : ''}`);
        }
        usageSummary = await response.json();
    } catch (error) {
        console.warn('Usage summary unavailable:', error.message || error);
        usageSummary = null;
    }

    renderUsageSummary();
}

function renderUsageSummary() {
    if (!settingsAccountName) return;

    const usage = usageSummary || {};
    const tokenLimit = Number(settings.monthlyTokenLimit || usage.tokenLimitMonthly || 200000);
    const tokensUsed = Number(usage.estimatedTokensUsed || 0);
    const sessions = Number(usage.sessionCount || 0);
    const messages = Number(usage.messageCount || 0);
    const usagePercent = tokenLimit > 0 ? Math.min(100, (tokensUsed / tokenLimit) * 100) : 0;
    const remaining = Math.max(0, tokenLimit - tokensUsed);

    settingsAccountName.textContent = usage.accountName || 'Local User';
    settingsPlan.textContent = usage.plan || 'Free';
    settingsTokenLimit.textContent = formatNumber(tokenLimit);
    settingsTokenUsed.textContent = formatNumber(tokensUsed);
    settingsSessionCount.textContent = formatNumber(sessions);
    settingsMessageCount.textContent = formatNumber(messages);
    settingsUsageProgress.style.width = `${usagePercent.toFixed(2)}%`;
    settingsUsageFootnote.textContent = `${usagePercent.toFixed(1)}% used | ${formatNumber(remaining)} tokens remaining`;

    if (monthlyTokenLimitInput) {
        monthlyTokenLimitInput.value = String(tokenLimit);
    }
    if (settingsModelsPath) {
        settingsModelsPath.textContent = usage.modelsPath || pathForModelsFallback();
    }
    if (settingsSessionsPath) {
        settingsSessionsPath.textContent = usage.sessionsPath || 'Session path unavailable';
    }
    if (settingsMessageLimitNote) {
        const messageLimit = Number(usage.messageCharLimit || 4000);
        settingsMessageLimitNote.textContent = `Message limit: ${formatNumber(messageLimit)} characters`;
    }
}

function pathForModelsFallback() {
    return 'C:\\Users\\<user>\\.ollama\\models';
}

function getEffectiveSystemPrompt() {
    const base = String(settings.systemPrompt || '').trim();
    const cloud = isCloudModel(currentModel);
    const parts = [];

    if (base) {
        parts.push(base);
    }

    if (settings.developerMode) {
        parts.push(
            'You are a senior developer assistant. Give production-quality code, explain key decisions briefly, include edge cases, and suggest tests.'
        );
    }


    parts.push(
        'Default to English unless I explicitly ask for another response language. If I paste source material in another language, treat it as reference content and keep responding in English unless I clearly request a language switch.'
    );
    parts.push(
        'You do not have direct control of the user device in this Bloom build. Never claim you opened, closed, launched, edited, or executed anything on the computer. Never output tool-call JSON (for example {"tool":"open_app",...}). If asked to control apps/files/system directly, clearly say you cannot do that right now and that it may be available in a future update.'
    );

    const enabledSkills = normalizeSkills(settings.skills).filter((skill) => skill.enabled);
    if (enabledSkills.length) {
        const skillBlock = enabledSkills
            .map((skill, idx) => `Skill ${idx + 1} - ${skill.name}:\n${skill.content}`)
            .join('\n\n');
        parts.push(`Apply the following user-selected skills:\n\n${skillBlock}`);
    }

    return parts.join('\n\n').trim();
}

function isDirectAppControlRequest(message) {
    const text = String(message || '').trim().toLowerCase();
    if (!text) return false;

    const imperative = /^(can you\s+|could you\s+|please\s+)?(open|close|launch|start|run)\b/i.test(text);
    const appNames = /\b(notepad|calculator|calc|chrome|browser|vscode|vs code|visual studio code|explorer|file explorer|cmd|command prompt|powershell|terminal|spotify|discord|word|excel)\b/i.test(text);
    const appPhrase = /\b(open|close|launch|start|run)\b.{0,24}\b(app|application|program)\b/i.test(text);

    return (imperative && appNames) || appPhrase;
}

function normalizeAssistantOutput(rawContent, userMessage) {
    const content = String(rawContent || '').trim();
    if (!content) return rawContent;

    const mightBeToolJson = content.includes('"tool"') && content.includes('"params"');
    if (mightBeToolJson) {
        const stripped = content
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
        try {
            const parsed = JSON.parse(stripped);
            if (parsed && typeof parsed === 'object' && parsed.tool && parsed.params) {
                return APP_CONTROL_BLOCK_RESPONSE;
            }
        } catch {
            // Ignore parse failure and continue with heuristics below.
        }
    }

    if (isDirectAppControlRequest(userMessage) && /i('| a)?ll\s+(open|launch|start)|"tool"\s*:\s*"open_app"/i.test(content)) {
        return APP_CONTROL_BLOCK_RESPONSE;
    }

    return rawContent;
}

function applyZoomLevel(level) {
    zoomLevel = Math.max(0.8, Math.min(1.4, level));
    document.body.style.zoom = String(zoomLevel);
}

function getMenuItems(menuKey) {
    const sidebarCollapsed = sidebar?.classList.contains('collapsed');
    const isMaximized = windowMaximizeBtn?.title === 'Restore';

    const menuMap = {
        file: [
            { label: 'New Chat', action: 'newChat', shortcut: 'Ctrl+N' },
            { label: 'Open Settings', action: 'openSettings', shortcut: 'Ctrl+,' },
            { label: 'Clear History', action: 'clearHistory' },
            { separator: true },
            { label: 'Exit Bloom', action: 'closeApp' }
        ],
        edit: [
            { label: 'Undo', action: 'undo', shortcut: 'Ctrl+Z' },
            { label: 'Redo', action: 'redo', shortcut: 'Ctrl+Y' },
            { separator: true },
            { label: 'Cut', action: 'cut', shortcut: 'Ctrl+X' },
            { label: 'Copy', action: 'copy', shortcut: 'Ctrl+C' },
            { label: 'Paste', action: 'paste', shortcut: 'Ctrl+V' },
            { separator: true },
            { label: 'Select All', action: 'selectAll', shortcut: 'Ctrl+A' }
        ],
        view: [
            { label: 'Reload', action: 'reload', shortcut: 'Ctrl+R' },
            { label: sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar', action: 'toggleSidebar' },
            { separator: true },
            { label: 'Zoom In', action: 'zoomIn', shortcut: 'Ctrl++' },
            { label: 'Zoom Out', action: 'zoomOut', shortcut: 'Ctrl+-' },
            { label: 'Actual Size', action: 'zoomReset', shortcut: 'Ctrl+0' },
            { separator: true },
            { label: isFullscreenMode ? 'Exit Full Screen' : 'Enter Full Screen', action: 'toggleFullscreen', shortcut: 'F11' },
            { label: 'Toggle Developer Tools', action: 'toggleDevTools', shortcut: 'Ctrl+Shift+I' }
        ],
        window: [
            { label: 'Minimize', action: 'minimize' },
            { label: isMaximized ? 'Restore Window' : 'Maximize Window', action: 'toggleMaximize' },
            { label: 'Close Window', action: 'closeApp' }
        ],
        help: [
            { label: 'About Bloom', action: 'about' },
            { label: 'Open Help Center', action: 'openHelpCenter' }
        ]
    };

    return menuMap[menuKey] || [];
}

function closeMenuPopover() {
    if (menuPopover) {
        menuPopover.hidden = true;
        menuPopover.innerHTML = '';
    }
    activeMenuKey = null;
}

function openMenuPopover(menuKey, anchorButton) {
    if (!menuPopover || !anchorButton) return;

    const items = getMenuItems(menuKey);
    menuPopover.innerHTML = '';

    items.forEach((item) => {
        if (item.separator) {
            const separator = document.createElement('div');
            separator.className = 'menu-separator';
            menuPopover.appendChild(separator);
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-item';
        button.dataset.action = item.action;
        button.innerHTML = `
            <span>${item.label}</span>
            <span class="menu-item-shortcut">${item.shortcut || ''}</span>
        `;
        menuPopover.appendChild(button);
    });

    const rect = anchorButton.getBoundingClientRect();
    menuPopover.style.left = `${rect.left}px`;
    menuPopover.style.top = `${rect.bottom + 6}px`;
    menuPopover.hidden = false;
    activeMenuKey = menuKey;
}

async function runAppCommand(command) {
    if (window.appCommands?.run) {
        return await window.appCommands.run(command);
    }
    return false;
}

function toggleSidebarVisibility() {
    if (!sidebar) return;
    sidebar.classList.toggle('collapsed');
    updateSidebarToggleState();
}

function updateSidebarToggleState() {
    if (!sidebarToggleBtn) return;
    const isCollapsed = sidebar?.classList.contains('collapsed');
    sidebarToggleBtn.setAttribute('aria-pressed', String(Boolean(isCollapsed)));
    sidebarToggleBtn.classList.toggle('is-collapsed', Boolean(isCollapsed));
    sidebarToggleBtn.title = isCollapsed ? 'Show Sidebar' : 'Hide Sidebar';

    const icon = sidebarToggleBtn.querySelector('i');
    if (icon) {
        icon.className = 'fa-solid fa-panel-left';
    }
}

function setSettingsPanelOpen(isOpen) {
    if (!settingsPanel) return;
    const nextOpen = Boolean(isOpen);
    settingsPanel.classList.toggle('open', nextOpen);
    mainContent?.classList.toggle('settings-mode', nextOpen);
    settingsToggle?.setAttribute('aria-expanded', String(nextOpen));
    if (nextOpen) {
        loadUsageSummary().catch((error) => {
            console.error('Failed to refresh usage summary:', error);
        });
    } else {
        ensureChatInputReady();
        focusChatInput(false);
    }
}

function onSidebarResizeStart(event) {
    if (!sidebar || sidebar.classList.contains('collapsed')) return;
    isSidebarResizing = true;
    sidebar.classList.add('resizing');
    sidebarResizeStartX = event.clientX;
    sidebarResizeStartWidth = sidebar.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.preventDefault();
}

function onSidebarResizeMove(event) {
    if (!isSidebarResizing) return;
    const deltaX = event.clientX - sidebarResizeStartX;
    applySidebarWidth(sidebarResizeStartWidth + deltaX, false);
}

function onSidebarResizeEnd() {
    if (!isSidebarResizing) return;
    isSidebarResizing = false;
    sidebar?.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    if (sidebar && !sidebar.classList.contains('collapsed')) {
        applySidebarWidth(sidebar.getBoundingClientRect().width, true);
    }
}

async function handleMenuAction(action) {
    switch (action) {
        case 'newChat':
            await createNewSession();
            break;
        case 'clearHistory':
            clearHistoryBtn?.click();
            break;
        case 'closeApp':
            await window.windowControls?.close?.();
            break;
        case 'openSettings':
            setSettingsPanelOpen(true);
            break;
        case 'undo':
        case 'redo':
        case 'cut':
        case 'copy':
        case 'paste':
        case 'selectAll':
            await runAppCommand(action);
            break;
        case 'reload':
            await runAppCommand('reload');
            break;
        case 'toggleSidebar':
            toggleSidebarVisibility();
            break;
        case 'zoomIn':
            applyZoomLevel(zoomLevel + 0.1);
            break;
        case 'zoomOut':
            applyZoomLevel(zoomLevel - 0.1);
            break;
        case 'zoomReset':
            applyZoomLevel(1);
            break;
        case 'toggleFullscreen':
            if (window.windowControls?.toggleFullscreen) {
                isFullscreenMode = await window.windowControls.toggleFullscreen();
            }
            break;
        case 'toggleDevTools':
            await runAppCommand('toggleDevTools');
            break;
        case 'minimize':
            await window.windowControls?.minimize?.();
            break;
        case 'toggleMaximize': {
            const maximized = await window.windowControls?.toggleMaximize?.();
            setWindowMaximizeIcon(Boolean(maximized));
            break;
        }
        case 'about':
            alert('Bloom AI Chat\nVersion 1.0.1\n\nOffline-first AI desktop chat.');
            break;
        case 'openHelpCenter':
            window.open('https://ollama.com', '_blank');
            break;
        default:
            break;
    }
}

// Marked configuration with custom renderer
marked.setOptions({
    highlight: function (code, lang) {
        return code;
    },
    breaks: true,
    pedantic: false,
    gfm: true
});

// Custom renderer for code blocks with copy button
const renderer = new marked.Renderer();
renderer.code = function (code, lang) {
    let codeText = '';
    let language = lang || 'plaintext';

    // Marked v16 may pass a token object instead of raw string.
    if (typeof code === 'object' && code !== null) {
        codeText = String(code.text || '');
        language = code.lang || code.language || language || 'plaintext';
    } else {
        codeText = String(code || '');
    }

    const safeLanguage = String(language || 'plaintext').replace(/[^\w-]/g, '') || 'plaintext';
    const highlightedCode = highlightCode(codeText, safeLanguage);
    return `
        <div class="code-block-wrapper">
            <div class="code-header">
                <span class="code-language">${safeLanguage}</span>
            </div>
            <button class="copy-code-btn" onclick="copyCode(this, event)">
                <i class="fa-regular fa-copy"></i> Copy
            </button>
            <pre><code class="language-${safeLanguage}">${highlightedCode}</code></pre>
        </div>
    `;
};
marked.use({ renderer });

// Backend API Communication
async function checkBackend() {
    try {
        const response = await fetch(apiUrl('/health'));
        return response.ok;
    } catch {
        return false;
    }
}

async function waitBackendReady() {
    const maxRetries = 60;
    const retryInterval = 500;

    for (let i = 0; i < maxRetries; i++) {
        if (await checkBackend()) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
    return false;
}

function revealAppShell() {
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
        loadingScreen.style.display = 'none';
        appContainer.classList.add('loaded');
    }, 250);
}

function showBackendUnavailableState() {
    revealAppShell();
    welcomeMessage.style.display = 'flex';
    messageContainer.style.display = 'none';
    const subtitle = welcomeMessage.querySelector('.welcome-subtitle');
    if (subtitle) {
        subtitle.textContent = 'Bloom opened, but the local backend is offline right now.';
    }
    if (statusRuntime) {
        statusRuntime.textContent = 'Backend offline';
    }
    if (settingsRuntimeStatus) {
        settingsRuntimeStatus.textContent = 'Backend offline';
    }
}

function failOpenFromRendererError(errorLike) {
    const details = typeof errorLike === 'string'
        ? errorLike
        : errorLike?.message || String(errorLike || 'Unknown renderer error');
    console.error('Renderer fail-open triggered:', details);
    backendStatus.textContent = 'Bloom recovered from a startup error';
    showBackendUnavailableState();
}

window.addEventListener('error', (event) => {
    failOpenFromRendererError(event?.error || event?.message || 'Script error');
});

window.addEventListener('unhandledrejection', (event) => {
    failOpenFromRendererError(event?.reason || 'Unhandled promise rejection');
});

// Chat API Functions
async function sendMessage() {
    ensureChatInputReady();
    const message = chatInput.value.trim();
    if (!message || isGenerating) {
        focusChatInput();
        return;
    }

    // Hide welcome message, show chat container
    welcomeMessage.style.display = 'none';
    messageContainer.style.display = 'block';

    // Add user message to UI
    addMessageToUI('user', message);

    // Clear input
    chatInput.value = '';
    updateCharCount();
    chatInput.style.height = 'auto';

    // Add to current messages
    currentMessages.push({ role: 'user', content: message, timestamp: new Date().toISOString() });

    // Update session title if this is the first user message
    if (currentMessages.filter(m => m.role === 'user').length === 1) {
        updateSessionTitle(message);
    }

    if (isDirectAppControlRequest(message)) {
        showMessage(APP_CONTROL_BLOCK_RESPONSE, 'ai');
        currentMessages.push({ role: 'assistant', content: APP_CONTROL_BLOCK_RESPONSE, timestamp: new Date().toISOString() });
        try {
            await saveCurrentSession();
        } catch (saveError) {
            console.error('Failed to save session:', saveError);
        }
        return;
    }

    // Get AI response
    await getAIResponse(message);
}

async function getAIResponse(userMessage) {
    setGeneratingState(true);
    abortController = new AbortController();
    generationStartedAt = performance.now();
    generationCharCount = 0;
    if (statusSpeed) {
        statusSpeed.textContent = 'Starting...';
    }

    // Show typing indicator
    const typingId = showTypingIndicator();

    try {
        const endpoint = '/chat';
        const response = await fetch(apiUrl(endpoint), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userMessage,
                model: currentModel,
                history: currentMessages
                    .slice(-12)
                    .map(m => ({ role: normalizeRoleForBackend(m.role), content: m.content || '' })),
                temperature: settings.temperature,
                system_prompt: getEffectiveSystemPrompt(),
                session_id: currentSessionId
            }),
            signal: abortController.signal
        });

        if (!response.ok) {
            const details = await getResponseErrorDetails(response);
            throw new Error(`Server error ${response.status}${details ? ` - ${details}` : ''}`);
        }

        if (!response.body) {
            throw new Error('Empty response body from backend');
        }

        // Process streaming response (SSE with buffered parsing)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let fullResponse = '';
        let messageDiv = null;
        let messageTextElement = null;
        let sseBuffer = '';
        let streamDone = false;
        function ensureAssistantMessage() {
            if (!messageDiv) {
                removeTypingIndicator(typingId);
                messageDiv = addMessageToUI('ai', '', true);
                messageTextElement = messageDiv.querySelector('.message-text');
            }
            return { messageDiv, messageTextElement };
        }

        try {
            while (!streamDone) {
                const { done, value } = await reader.read();
                if (done) break;

                sseBuffer += decoder.decode(value, { stream: true });
                const events = sseBuffer.split('\n\n');
                sseBuffer = events.pop() || '';

                for (const event of events) {
                    const lines = event.split('\n');
                    for (const line of lines) {
                        if (!line.startsWith('data:')) continue;

                        const payload = line.slice(5).trim();
                        if (!payload) continue;

                        let data;
                        try {
                            data = JSON.parse(payload);
                        } catch (parseError) {
                            console.warn('Skipping malformed SSE chunk:', payload, parseError);
                            continue;
                        }

                        if (data.error) {
                            const ensured = ensureAssistantMessage();
                            fullResponse += `\n\n**Error:** ${data.error}`;
                            ensured.messageTextElement.innerHTML = renderAiMarkdown(fullResponse);
                            addMessageActions(ensured.messageDiv, fullResponse);
                            return;
                        }

                        if (data.done) {
                            streamDone = true;
                            break;
                        }

                        if (data.content) {
                            const ensured = ensureAssistantMessage();
                            fullResponse += data.content;
                            generationCharCount += data.content.length;
                            if (statusSpeed && generationStartedAt) {
                                const elapsedSeconds = Math.max(0.25, (performance.now() - generationStartedAt) / 1000);
                                const estimatedTokens = generationCharCount / 4;
                                statusSpeed.textContent = `${(estimatedTokens / elapsedSeconds).toFixed(1)} tok/s`;
                            }
                            ensured.messageTextElement.innerHTML = renderAiMarkdown(fullResponse);
                            scrollToBottom();
                        }
                    }
                }
            }

            // Best-effort parse of any trailing buffered event without delimiter.
            if (!streamDone && sseBuffer.trim().startsWith('data:')) {
                const payload = sseBuffer.trim().slice(5).trim();
                if (payload) {
                    try {
                        const data = JSON.parse(payload);
                        if (data.content) {
                            const ensured = ensureAssistantMessage();
                            fullResponse += data.content;
                            ensured.messageTextElement.innerHTML = renderAiMarkdown(fullResponse);
                        }
                    } catch {
                        // Ignore incomplete trailing data.
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                const ensured = ensureAssistantMessage();
                fullResponse += '\n\n*[Generation stopped by user]*';
                ensured.messageTextElement.innerHTML = renderAiMarkdown(fullResponse);
            } else {
                throw error;
            }
        }

        if (!fullResponse.trim()) {
            const ensured = ensureAssistantMessage();
            fullResponse = '*No response content returned.*';
            ensured.messageTextElement.innerHTML = renderAiMarkdown(fullResponse);
        }

        const normalizedFinal = normalizeAssistantOutput(fullResponse, userMessage);
        if (normalizedFinal !== fullResponse) {
            fullResponse = normalizedFinal;
            const ensured = ensureAssistantMessage();
            ensured.messageTextElement.innerHTML = renderAiMarkdown(fullResponse);
            scrollToBottom();
        }

        if (statusSpeed && generationStartedAt && fullResponse.trim()) {
            const elapsedSeconds = Math.max(0.25, (performance.now() - generationStartedAt) / 1000);
            const estimatedTokens = Math.max(1, fullResponse.length / 4);
            statusSpeed.textContent = `${(estimatedTokens / elapsedSeconds).toFixed(1)} tok/s`;
        }

        if (fullResponse.trim()) {
            currentMessages.push({
                role: 'assistant',
                content: fullResponse,
                timestamp: new Date().toISOString()
            });

            if (messageDiv) {
                addMessageActions(messageDiv, fullResponse);
            }
        }

        // Auto-save session (non-fatal if persistence fails)
        try {
            await saveCurrentSession();
        } catch (saveError) {
            console.error('Failed to save session:', saveError);
        }

    } catch (error) {
        console.error('Error getting AI response:', error);
        removeTypingIndicator(typingId);
        if (error.name !== 'AbortError') {
            const reason = error?.message ? `\n\nDetails: ${error.message}` : '';
            showMessage(`Error getting AI response.${reason}`, 'ai');
        }
    } finally {
        setGeneratingState(false);
        abortController = null;
        generationStartedAt = null;
        generationCharCount = 0;
        ensureChatInputReady();
    }
}

function toggleSettingsPanel() {
    const isOpen = settingsPanel?.classList.contains('open');
    setSettingsPanelOpen(!isOpen);
}

// Stop generation
function stopGeneration() {
    if (abortController) {
        abortController.abort();
    }
}

// Regenerate last response
async function regenerateResponse() {
    if (currentMessages.length < 2) return;

    // Remove last AI message
    const lastUserMessage = currentMessages[currentMessages.length - 2];
    currentMessages.pop();

    // Remove from UI
    const messages = messageContainer.querySelectorAll('.message');
    if (messages.length >= 2) {
        messages[messages.length - 1].remove();
    }

    // Regenerate
    await getAIResponse(lastUserMessage.content);
}

// UI Functions
function addMessageToUI(role, content, isStreaming = false) {
    const uiRole = String(role || '').toLowerCase() === 'user' ? 'user' : 'ai';
    const normalizedContent = String(content || '');
    const renderedContent = isStreaming
        ? ''
        : (uiRole === 'user'
            ? escapeHtml(normalizedContent).replace(/\n/g, '<br>')
            : renderAiMarkdown(normalizedContent));
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${uiRole === 'user' ? 'user-message' : 'ai-message'}`;
    messageDiv.dataset.timestamp = new Date().toISOString();

    const avatarIcon = uiRole === 'user' ? 'fa-user' : 'fa-spa';
    const authorName = uiRole === 'user' ? 'You' : 'Bloom AI';

    messageDiv.innerHTML = `
        <div class="message-avatar ${uiRole === 'user' ? 'user-avatar' : 'ai-avatar'}">
            <i class="fa-solid ${avatarIcon}"></i>
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${authorName}</span>
                <span class="message-time">${formatTime(new Date())}</span>
            </div>
            <div class="message-text">${renderedContent}</div>
        </div>
    `;

    messageContainer.appendChild(messageDiv);
    scrollToBottom();

    return messageDiv;
}

function addMessageActions(messageDiv, content) {
    const messageContent = messageDiv.querySelector('.message-content');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';

    actionsDiv.innerHTML = `
        <button class="message-action-btn" onclick="copyMessage(this, event)">
            <i class="fa-regular fa-copy"></i> Copy
        </button>
        <button class="message-action-btn" onclick="regenerateLast(this)">
            <i class="fa-solid fa-rotate-right"></i> Regenerate
        </button>
        <button class="message-action-btn" onclick="deleteMessage(this)">
            <i class="fa-solid fa-trash"></i> Delete
        </button>
    `;

    messageContent.appendChild(actionsDiv);
    scrollToBottom();
}

function withStableChatScroll(updateFn) {
    const previousScrollTop = chatArea.scrollTop;
    updateFn();
    chatArea.scrollTop = previousScrollTop;
}

function copyMessage(btn, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const messageDiv = btn.closest('.message');
    const text = messageDiv.querySelector('.message-text').innerText;
    navigator.clipboard.writeText(text).then(() => {
        const originalHtml = btn.innerHTML;
        withStableChatScroll(() => {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        });
        btn.blur();
        setTimeout(() => {
            withStableChatScroll(() => {
                btn.innerHTML = originalHtml;
            });
        }, 2000);
    });
}

function regenerateLast(btn) {
    regenerateResponse();
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderAiMarkdown(content) {
    const text = String(content || '');
    try {
        return marked.parse(text);
    } catch (error) {
        console.error('Markdown render failed, using plain text fallback:', error);
        return escapeHtml(text).replace(/\n/g, '<br>');
    }
}

function deleteMessage(btn) {
    const messageDiv = btn.closest('.message');
    const isUserMessage = messageDiv.classList.contains('user-message');

    // Remove from UI
    messageDiv.remove();

    // Remove from currentMessages (find the corresponding message)
    const messageTime = messageDiv.dataset.timestamp;
    const index = currentMessages.findIndex(m => m.timestamp === messageTime);
    if (index !== -1) {
        currentMessages.splice(index, 1);
    }

    // Save updated session
    saveCurrentSession();
}

function copyCode(btn, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    const codeBlock = btn.nextElementSibling.querySelector('code');
    const code = codeBlock.innerText;
    navigator.clipboard.writeText(code).then(() => {
        withStableChatScroll(() => {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        });
        btn.blur();
        setTimeout(() => {
            withStableChatScroll(() => {
                btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
            });
        }, 2000);
    });
}

// Expose functions globally
window.copyMessage = copyMessage;
window.regenerateLast = regenerateLast;
window.deleteMessage = deleteMessage;
window.copyCode = copyCode;

function showTypingIndicator() {
    const indicatorId = `typing-indicator-${Date.now()}`;
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message ai-message';
    typingDiv.id = indicatorId;

    typingDiv.innerHTML = `
        <div class="message-avatar ai-avatar">
            <i class="fa-solid fa-spa"></i>
        </div>
        <div class="message-content">
            <div class="thinking-card">
                <div class="thinking-title">
                    <i class="fa-solid fa-brain"></i>
                    <span>Bloom is thinking (${currentModel || 'model'})</span>
                </div>
                <div class="thinking-wave">
                    <span></span><span></span><span></span><span></span><span></span>
                </div>
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        </div>
    `;

    messageContainer.appendChild(typingDiv);
    scrollToBottom();

    return indicatorId;
}

function removeTypingIndicator(id) {
    const indicator = document.getElementById(id);
    if (indicator) indicator.remove();
}

function showMessage(text, role = 'ai') {
    const uiRole = String(role || '').toLowerCase() === 'user' ? 'user' : 'ai';
    const renderedContent = uiRole === 'user'
        ? escapeHtml(text).replace(/\n/g, '<br>')
        : renderAiMarkdown(text);
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${uiRole === 'user' ? 'user-message' : 'ai-message'}`;
    messageDiv.dataset.timestamp = new Date().toISOString();

    const avatarIcon = uiRole === 'user' ? 'fa-user' : 'fa-spa';
    const authorName = uiRole === 'user' ? 'You' : 'Bloom AI';

    messageDiv.innerHTML = `
        <div class="message-avatar ${uiRole === 'user' ? 'user-avatar' : 'ai-avatar'}">
            <i class="fa-solid ${avatarIcon}"></i>
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${authorName}</span>
                <span class="message-time">${formatTime(new Date())}</span>
            </div>
            <div class="message-text">${renderedContent}</div>
        </div>
    `;

    messageContainer.appendChild(messageDiv);
    scrollToBottom();
    return messageDiv;
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
    chatArea.scrollTo({
        top: chatArea.scrollHeight,
        behavior: 'smooth'
    });
}

function updateCharCount() {
    const length = chatInput.value.length;
    charCount.textContent = `${length}/4000`;
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
}

function focusChatInput(placeCursorAtEnd = true) {
    if (!chatInput) return;

    const focusNow = () => {
        chatInput.focus({ preventScroll: true });
        if (placeCursorAtEnd) {
            const end = chatInput.value.length;
            chatInput.setSelectionRange(end, end);
        }
    };

    // Two-phase focus makes it resilient to UI transitions/click races.
    requestAnimationFrame(focusNow);
    setTimeout(focusNow, 120);
}

function ensureChatInputReady() {
    if (!chatInput) return;
    if (chatInput.disabled) chatInput.disabled = false;
    if (chatInput.readOnly) chatInput.readOnly = false;
    if (chatInput.style.pointerEvents === 'none') {
        chatInput.style.pointerEvents = 'auto';
    }
    if (chatInput.tabIndex < 0) {
        chatInput.tabIndex = 0;
    }
}

function resetComposerState() {
    stopGeneration();
    setGeneratingState(false);
    abortController = null;

    // Remove stale typing cards if a previous request was interrupted.
    messageContainer.querySelectorAll('.thinking-card').forEach((card) => {
        card.closest('.message')?.remove();
    });
}

// Session Management
async function createNewSession() {
    resetComposerState();
    currentSessionId = null;
    currentMessages = [];
    messageContainer.innerHTML = '';
    welcomeMessage.style.display = 'flex';
    messageContainer.style.display = 'none';
    chatInput.value = '';
    updateCharCount();
    chatInput.style.height = 'auto';
    currentModelDisplay.textContent = currentModel || 'Select a model';
    ensureChatInputReady();
    focusChatInput(false);
}

async function loadSession(sessionId) {
    resetComposerState();
    const sessionResponse = await fetch(apiUrl(`/history/${sessionId}`));
    if (!sessionResponse.ok) {
        const details = await getResponseErrorDetails(sessionResponse);
        throw new Error(`Load session failed ${sessionResponse.status}${details ? ` - ${details}` : ''}`);
    }
    const session = await sessionResponse.json();

    if (!session) return;

    currentSessionId = sessionId;
    currentMessages = session.messages || [];
    currentModel = session.model || currentModel;

    // Update UI
    messageContainer.innerHTML = '';
    welcomeMessage.style.display = 'none';
    messageContainer.style.display = 'block';
    updateModelDisplay();

    // Load messages with actions
    for (const msg of currentMessages) {
        if (msg.role === 'user') {
            const msgDiv = addMessageToUI('user', msg.content);
        } else if (isAssistantRole(msg.role)) {
            const msgDiv = addMessageToUI('ai', msg.content);
            addMessageActions(msgDiv, msg.content);
        }
    }

    scrollToBottom();
    ensureChatInputReady();
    focusChatInput(false);
}

async function saveCurrentSession() {
    if (!currentSessionId) {
        // Create new session
        const response = await fetch(apiUrl('/history/save'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: null,
                model: currentModel,
                messages: currentMessages
            })
        });
        if (!response.ok) {
            const details = await getResponseErrorDetails(response);
            throw new Error(`Save failed ${response.status}${details ? ` - ${details}` : ''}`);
        }

        const result = await response.json();
        currentSessionId = result.sessionId;
    } else {
        // Update existing session in place
        let response = await fetch(apiUrl(`/history/${currentSessionId}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: null,
                model: currentModel,
                messages: currentMessages
            })
        });

        if (response.status === 404) {
            // If local storage was cleared externally, recreate once.
            const recreate = await fetch(apiUrl('/history/save'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: null,
                    model: currentModel,
                    messages: currentMessages
                })
            });
            if (!recreate.ok) {
                const details = await getResponseErrorDetails(recreate);
                throw new Error(`Save failed ${recreate.status}${details ? ` - ${details}` : ''}`);
            }
            const recreatedData = await recreate.json();
            if (recreatedData?.sessionId) {
                currentSessionId = recreatedData.sessionId;
            }
        } else if (!response.ok) {
            const details = await getResponseErrorDetails(response);
            throw new Error(`Save failed ${response.status}${details ? ` - ${details}` : ''}`);
        } else {
            const result = await response.json();
            if (result?.sessionId) {
                currentSessionId = result.sessionId;
            }
        }
    }

    await loadSessions();
}

async function updateSessionTitle(firstMessage) {
    const words = firstMessage.split(/\s+/).slice(0, 6).join(' ');
    const title = words + (words.split(' ').length >= 6 ? '...' : '');

    if (currentSessionId) {
        const messages = [...currentMessages];
        const titleSaveResponse = await fetch(apiUrl(`/history/${currentSessionId}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                model: currentModel,
                messages: messages
            })
        });
        if (titleSaveResponse.ok) {
            const saveData = await titleSaveResponse.json();
            if (saveData?.sessionId) {
                currentSessionId = saveData.sessionId;
            }
        }
    }

    await loadSessions();
}

async function loadSessions() {
    try {
        const response = await fetch(apiUrl('/history/load'));
        if (!response.ok) {
            const details = await getResponseErrorDetails(response);
            throw new Error(`Load sessions failed ${response.status}${details ? ` - ${details}` : ''}`);
        }
        const data = await response.json();
        chatHistory = data.sessions || [];
        renderSessions();
    } catch (error) {
        console.error('Failed to load sessions:', error);
        chatHistory = [];
        renderSessions();
    }
}

function renderSessions() {
    sessionsList.innerHTML = '';

    if (chatHistory.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'sessions-empty';
        emptyMsg.textContent = 'No past sessions';
        sessionsList.appendChild(emptyMsg);
        return;
    }

    chatHistory.forEach(session => {
        const sessionId = String(session.id || '');
        const safeTitle = String(session.title || 'Untitled chat').trim() || 'Untitled chat';
        const safeModel = String(session.model || 'unknown');
        const createdAt = session.createdAt ? new Date(session.createdAt) : new Date();
        const messageCount = Number.isFinite(Number(session.messageCount)) ? Number(session.messageCount) : 0;

        const sessionDiv = document.createElement('div');
        sessionDiv.className = `session-item ${currentSessionId === sessionId ? 'active' : ''}`;
        sessionDiv.dataset.sessionId = sessionId;
        sessionDiv.onclick = () => {
            loadSession(sessionId).catch((error) => {
                console.error('Failed to load session:', error);
                showMessage(`Could not load this session.\n\nDetails: ${error.message}`, 'ai');
            });
        };

        const iconDiv = document.createElement('div');
        iconDiv.className = 'session-icon';
        iconDiv.innerHTML = '<i class="fa-solid fa-message"></i>';

        const infoDiv = document.createElement('div');
        infoDiv.className = 'session-info';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'session-title';
        titleDiv.textContent = safeTitle;

        const metaDiv = document.createElement('div');
        metaDiv.className = 'session-meta';
        metaDiv.textContent = `${safeModel} - ${formatTime(createdAt)} - ${messageCount} msgs`;

        infoDiv.appendChild(titleDiv);
        infoDiv.appendChild(metaDiv);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'session-delete';
        deleteBtn.setAttribute('aria-label', `Delete session ${safeTitle}`);
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.addEventListener('click', (event) => {
            deleteSession(event, sessionId);
        });

        sessionDiv.appendChild(iconDiv);
        sessionDiv.appendChild(infoDiv);
        sessionDiv.appendChild(deleteBtn);

        sessionsList.appendChild(sessionDiv);
    });
}

function deleteSession(event, sessionId) {
    event.stopPropagation();
    if (confirm('Delete this session?')) {
        fetch(apiUrl(`/history/${sessionId}`), {
            method: 'DELETE'
        }).then(() => {
            loadSessions();
            if (currentSessionId === sessionId) {
                createNewSession();
            }
        });
    }
}

// Model Functions
async function loadModels() {
    try {
        const response = await fetch(apiUrl('/models'));
        const data = await response.json();
        availableModels = data.models || [];

        modelSelect.innerHTML = '';
        defaultModelSelect.innerHTML = '';

        if (availableModels.length === 0) {
            modelSelect.innerHTML = '<option disabled>No models found</option>';
            defaultModelSelect.innerHTML = '<option disabled>No models found</option>';
            currentModel = '';
            updateModelDisplay();
            return;
        }

        const groupedModels = new Map();
        availableModels.forEach((model) => {
            const meta = inferModelCategory(model);
            const group = groupedModels.get(meta.category) || [];
            group.push({ ...model, meta });
            groupedModels.set(meta.category, group);
        });

        const categoryOrder = ['Chat', 'Coding', 'Fast', 'Vision', 'Cloud'];
        categoryOrder.forEach((category) => {
            const models = groupedModels.get(category);
            if (!models?.length) return;

            const groupElement = document.createElement('optgroup');
            groupElement.label = category;

            const defaultGroupElement = document.createElement('optgroup');
            defaultGroupElement.label = category;

            models
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach((model) => {
                    const labelParts = [model.name, model.meta.speed];
                    if (model.meta.sizeText) {
                        labelParts.push(model.meta.sizeText);
                    }

                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = labelParts.join(' | ');
                    option.dataset.modelLabel = model.name;
                    groupElement.appendChild(option);

                    const defaultOption = document.createElement('option');
                    defaultOption.value = model.name;
                    defaultOption.textContent = labelParts.join(' | ');
                    defaultOption.dataset.modelLabel = model.name;
                    defaultGroupElement.appendChild(defaultOption);
                });

            modelSelect.appendChild(groupElement);
            defaultModelSelect.appendChild(defaultGroupElement);
        });

        // Check settings for default model
        const savedModel = settings.defaultModel || availableModels[0].name;
        if (availableModels.find(m => m.name === savedModel)) {
            modelSelect.value = savedModel;
            defaultModelSelect.value = savedModel;
            currentModel = savedModel;
        } else {
            currentModel = availableModels[0].name;
            modelSelect.value = currentModel;
            defaultModelSelect.value = currentModel;
        }
        updateModelDisplay();
    } catch (error) {
        console.error('Failed to load models:', error);
        modelSelect.innerHTML = '<option disabled>Error loading models</option>';
        defaultModelSelect.innerHTML = '<option disabled>Error loading models</option>';
    }
}

function updateModelDisplay() {
    if (!currentModel) {
        currentModelDisplay.textContent = 'Select a model';
    } else {
        const model = availableModels.find((entry) => entry.name === currentModel);
        const meta = inferModelCategory(model || { name: currentModel });
        currentModelDisplay.textContent = `${currentModel} | ${meta.category}`;
    }
    updateStatusBar();
}

// Settings Functions
async function loadSettings() {
    try {
        const response = await fetch(apiUrl('/settings'));
        const loaded = await response.json();
        settings = {
            ...settings,
            ...loaded
        };

        settings.theme = settings.theme === 'light' ? 'light' : 'dark';
        settings.systemPrompt = String(settings.systemPrompt || '');
        settings.temperature = Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.7;
        settings.skills = normalizeSkills(settings.skills);
        settings.monthlyTokenLimit = Math.max(1000, parseInt(String(settings.monthlyTokenLimit || '200000'), 10));
        settings.sidebarWidth = Math.max(220, Math.min(460, parseInt(String(settings.sidebarWidth || '300'), 10)));

        // Apply settings to UI
        applyThemeSelection(settings.theme);
        systemPromptInput.value = settings.systemPrompt;
        temperatureSlider.value = settings.temperature;
        updateTempValue();
        defaultModelSelect.value = settings.defaultModel || '';
        if (monthlyTokenLimitInput) {
            monthlyTokenLimitInput.value = String(settings.monthlyTokenLimit);
        }
        settings.developerMode = false;
        currentModel = settings.defaultModel || currentModel;
        updateModelDisplay();
        applySidebarWidth(settings.sidebarWidth, false);
        renderSkillsList();
        renderUsageSummary();
    } catch (error) {
        console.error('Failed to load settings:', error);
        applyThemeSelection(settings.theme);
        applySidebarWidth(settings.sidebarWidth, false);
        renderSkillsList();
        renderUsageSummary();
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function updateTempValue() {
    tempValue.textContent = temperatureSlider.value;
}

async function addSkillFromInputs() {
    const name = String(skillNameInput?.value || '').trim();
    const content = String(skillContentInput?.value || '').trim();

    if (!name || !content) {
        alert('Please add both a skill name and skill content.');
        return;
    }

    const nextSkills = normalizeSkills(settings.skills);
    nextSkills.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        content,
        enabled: true
    });

    settings.skills = nextSkills;
    renderSkillsList();
    await saveSettings();

    skillNameInput.value = '';
    skillContentInput.value = '';
}

function parseSkillPayload(fileName, content) {
    const safeName = String(fileName || 'Imported Skill').trim() || 'Imported Skill';
    const raw = String(content || '').trim();
    if (!raw) return null;

    if (fileName.toLowerCase().endsWith('.json')) {
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                const name = String(parsed.name || safeName).trim();
                const skillContent = String(parsed.content || parsed.prompt || '').trim();
                if (name && skillContent) {
                    return { name, content: skillContent };
                }
            }
        } catch {
            // fall through and use raw text
        }
    }

    return {
        name: safeName,
        content: raw
    };
}

async function uploadSkillFromFile() {
    const result = await window.fileAPI?.chooseSkillFile?.();
    if (!result) return;

    if (result.error) {
        alert(`Failed to read selected file.\n\n${result.error}`);
        return;
    }

    const parsed = parseSkillPayload(result.name, result.content);
    if (!parsed) {
        alert('Selected file is empty.');
        return;
    }

    const nextSkills = normalizeSkills(settings.skills);
    nextSkills.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: parsed.name,
        content: parsed.content,
        enabled: true
    });

    settings.skills = nextSkills;
    renderSkillsList();
    await saveSettings();
}

async function openLocalPath(targetPath) {
    const pathValue = String(targetPath || '').trim();
    if (!pathValue) return;

    const result = await window.shellAPI?.openPath?.(pathValue);
    if (!result?.success) {
        alert(`Could not open folder.\n\n${result?.error || 'Unknown error'}`);
    }
}

function applyPromptTemplate(prompt) {
    if (!chatInput) return;
    chatInput.value = String(prompt || '').trim();
    updateCharCount();
    ensureChatInputReady();
    focusChatInput();
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    applyZoomLevel(1);
    updateSidebarToggleState();
    setSettingsPanelOpen(false);

    if (sidebarResizeZone) {
        sidebarResizeZone.addEventListener('mousedown', onSidebarResizeStart);
    }
    document.addEventListener('mousemove', onSidebarResizeMove);
    document.addEventListener('mouseup', onSidebarResizeEnd);

    if (promptLibrary) {
        promptLibrary.addEventListener('click', (event) => {
            const card = event.target.closest('[data-prompt]');
            if (!card) return;
            applyPromptTemplate(card.dataset.prompt);
        });
    }
    if (window.windowControls?.isMaximized) {
        try {
            const isMaximized = await window.windowControls.isMaximized();
            setWindowMaximizeIcon(isMaximized);
            window.windowControls.onMaximizedChange((nextState) => {
                setWindowMaximizeIcon(nextState);
            });
        } catch (error) {
            console.warn('Window control initialization failed:', error);
        }
    }

    if (window.windowControls?.isFullscreen) {
        try {
            isFullscreenMode = await window.windowControls.isFullscreen();
            window.windowControls.onFullscreenChange((nextState) => {
                isFullscreenMode = nextState;
            });
        } catch (error) {
            console.warn('Fullscreen state initialization failed:', error);
        }
    }

    // Check backend status
    backendStatus.textContent = 'Checking backend...';

    if (await waitBackendReady()) {
        backendStatus.textContent = 'Backend ready!';
        await new Promise(resolve => setTimeout(resolve, 500));

        // Initialize app
        await loadModels();
        await loadSettings();
        await loadUsageSummary();
        await loadSessions();
        await refreshRuntimeStatus();
        if (runtimeStatusTimer) {
            clearInterval(runtimeStatusTimer);
        }
        runtimeStatusTimer = setInterval(() => {
            refreshRuntimeStatus().catch((error) => {
                console.warn('Runtime refresh failed:', error);
            });
        }, 15000);

        revealAppShell();
    } else {
        backendStatus.textContent = 'Backend failed to start';
        showBackendUnavailableState();
        alert('Bloom could not reach the backend server. The app shell is open so you can check setup, but AI chat will stay unavailable until the backend starts.');
    }

    // Initial session creation
    createNewSession();
});

// Input Handling
chatInput.addEventListener('input', updateCharCount);
inputWrapper?.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    const clickedInsideInput = event.target === chatInput || Boolean(event.target.closest('#chat-input'));
    ensureChatInputReady();
    focusChatInput(!clickedInsideInput);
});

chatInput.addEventListener('compositionstart', () => {
    isInputComposing = true;
});

chatInput.addEventListener('compositionend', () => {
    isInputComposing = false;
    updateCharCount();
});

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isInputComposing) {
        e.preventDefault();
        sendMessage();
    }
});

window.addEventListener('focus', () => {
    ensureChatInputReady();
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        ensureChatInputReady();
    }
});

sendBtn.addEventListener('click', sendMessage);

windowMenu?.addEventListener('click', (event) => {
    const target = event.target.closest('.window-menu-item[data-menu]');
    if (!target) return;

    const requestedMenu = target.dataset.menu;
    if (activeMenuKey === requestedMenu && !menuPopover?.hidden) {
        closeMenuPopover();
        return;
    }

    openMenuPopover(requestedMenu, target);
});

menuPopover?.addEventListener('click', async (event) => {
    const target = event.target.closest('.menu-item[data-action]');
    if (!target) return;
    const { action } = target.dataset;
    closeMenuPopover();
    await handleMenuAction(action);
});

windowMinimizeBtn?.addEventListener('click', async () => {
    if (window.windowControls?.minimize) {
        await window.windowControls.minimize();
    }
});

windowMaximizeBtn?.addEventListener('click', async () => {
    if (window.windowControls?.toggleMaximize) {
        const isMaximized = await window.windowControls.toggleMaximize();
        setWindowMaximizeIcon(isMaximized);
    }
});

windowCloseBtn?.addEventListener('click', async () => {
    if (window.windowControls?.close) {
        await window.windowControls.close();
    }
});

windowTopbar?.addEventListener('dblclick', async (event) => {
    if (event.target.closest('.window-controls') || event.target.closest('.window-menu')) {
        return;
    }
    if (window.windowControls?.toggleMaximize) {
        const isMaximized = await window.windowControls.toggleMaximize();
        setWindowMaximizeIcon(isMaximized);
    }
});

document.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape') {
        closeMenuPopover();
        setSettingsPanelOpen(false);
    }

    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    if (ctrlOrMeta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        await createNewSession();
        return;
    }

    if (ctrlOrMeta && event.key === ',') {
        event.preventDefault();
        setSettingsPanelOpen(true);
        return;
    }

    if (ctrlOrMeta && !event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        await runAppCommand('reload');
        return;
    }

    if (ctrlOrMeta && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        await runAppCommand('toggleDevTools');
        return;
    }

    if (ctrlOrMeta && event.key === '=') {
        event.preventDefault();
        applyZoomLevel(zoomLevel + 0.1);
        return;
    }

    if (ctrlOrMeta && event.key === '-') {
        event.preventDefault();
        applyZoomLevel(zoomLevel - 0.1);
        return;
    }

    if (ctrlOrMeta && event.key === '0') {
        event.preventDefault();
        applyZoomLevel(1);
        return;
    }

    if (event.key === 'F11') {
        event.preventDefault();
        if (window.windowControls?.toggleFullscreen) {
            isFullscreenMode = await window.windowControls.toggleFullscreen();
        }
    }
});

// Stop button
stopBtn.addEventListener('click', stopGeneration);

// New Chat Button
newChatBtn.addEventListener('click', createNewSession);

// Model Selection
modelSelect.addEventListener('change', async (e) => {
    currentModel = e.target.value;
    settings.defaultModel = currentModel;
    updateModelDisplay();
    await saveSettings();
});

// Settings Panel Toggle
settingsToggle.addEventListener('click', async () => {
    toggleSettingsPanel();
});

// Close settings panel when clicking outside
document.addEventListener('click', (e) => {
    if (!menuPopover?.contains(e.target) && !windowMenu?.contains(e.target)) {
        closeMenuPopover();
    }
});

// Theme Toggle
themeOptions.forEach(option => {
    option.addEventListener('click', () => {
        const theme = option.dataset.theme;
        applyThemeSelection(theme);
        settings.theme = theme;
        scheduleSettingsSave();
    });
});

// System Prompt
systemPromptInput.addEventListener('input', (e) => {
    settings.systemPrompt = e.target.value;
    scheduleSettingsSave();
});

// Temperature Slider
temperatureSlider.addEventListener('input', () => {
    updateTempValue();
    settings.temperature = parseFloat(temperatureSlider.value);
    scheduleSettingsSave();
});

// Default Model Select
defaultModelSelect.addEventListener('change', (e) => {
    settings.defaultModel = e.target.value;
    scheduleSettingsSave();
});

// Sidebar Toggle Button
sidebarToggleBtn?.addEventListener('click', () => {
    toggleSidebarVisibility();
});

settingsCloseBtn?.addEventListener('click', () => {
    setSettingsPanelOpen(false);
});



monthlyTokenLimitInput?.addEventListener('change', () => {
    const nextLimit = Math.max(1000, parseInt(String(monthlyTokenLimitInput.value || '200000'), 10));
    settings.monthlyTokenLimit = nextLimit;
    monthlyTokenLimitInput.value = String(nextLimit);
    renderUsageSummary();
    scheduleSettingsSave();
});

openModelsPathBtn?.addEventListener('click', async () => {
    await openLocalPath(settingsModelsPath?.textContent);
});

openSessionsPathBtn?.addEventListener('click', async () => {
    await openLocalPath(settingsSessionsPath?.textContent);
});

// Skills
addSkillBtn?.addEventListener('click', async () => {
    await addSkillFromInputs();
});

skillContentInput?.addEventListener('keydown', async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        await addSkillFromInputs();
    }
});

uploadSkillBtn?.addEventListener('click', async () => {
    await uploadSkillFromFile();
});

skillsList?.addEventListener('click', async (event) => {
    const item = event.target.closest('.skill-item');
    if (!item) return;

    if (event.target.closest('.skill-delete')) {
        const skillId = item.dataset.skillId;
        settings.skills = normalizeSkills(settings.skills).filter((skill) => skill.id !== skillId);
        renderSkillsList();
        await saveSettings();
    }
});

skillsList?.addEventListener('change', async (event) => {
    const checkbox = event.target.closest('.skill-checkbox');
    if (!checkbox) return;
    const item = checkbox.closest('.skill-item');
    if (!item) return;

    const skillId = item.dataset.skillId;
    settings.skills = normalizeSkills(settings.skills).map((skill) => {
        if (skill.id === skillId) {
            return {
                ...skill,
                enabled: checkbox.checked
            };
        }
        return skill;
    });
    await saveSettings();
});

// Clear History
clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Are you sure? This will delete all saved sessions.')) {
        const response = await fetch(apiUrl('/history/load'));
        const data = await response.json();

        for (const session of data.sessions) {
            await fetch(apiUrl(`/history/${session.id}`), {
                method: 'DELETE'
            });
        }

        loadSessions();
        createNewSession();
    }
});

// Pro feature buttons (show tooltip only)
addImageBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // Pro feature - just show tooltip
});

attachBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // Pro feature - just show tooltip
});

function scheduleSettingsSave() {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(() => {
        saveSettings();
    }, SETTINGS_SAVE_DEBOUNCE_MS);
}

// Save Settings Helper
async function saveSettings() {
    const payload = {
        ...settings,
        skills: normalizeSkills(settings.skills),
        monthlyTokenLimit: Math.max(1000, parseInt(String(settings.monthlyTokenLimit || '200000'), 10)),
        sidebarWidth: Math.max(220, Math.min(460, parseInt(String(settings.sidebarWidth || '300'), 10))),
    };

    try {
        await fetch(apiUrl('/settings'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error('Failed to save settings:', error);
    }
}

// Auto-scroll when new messages are added
const chatObserver = new MutationObserver(() => {
    const distanceFromBottom = chatArea.scrollHeight - (chatArea.scrollTop + chatArea.clientHeight);
    if (distanceFromBottom < 140) {
        scrollToBottom();
    }
});
chatObserver.observe(messageContainer, { childList: true, subtree: false });






