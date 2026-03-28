/**
 * Bloom AI Chat - Renderer Process Script
 * Premium offline AI chat with advanced features
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
const developerModeToggle = document.getElementById('developer-mode-toggle');
const agenticCloudToggle = document.getElementById('agentic-cloud-toggle');
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
    developerMode: true,
    agenticCloudMode: true
};
let isGenerating = false;
let abortController = null;
let zoomLevel = 1;
let activeMenuKey = null;
let isFullscreenMode = false;
let isInputComposing = false;

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

    if (cloud && settings.agenticCloudMode) {
        parts.push(
            'When useful, act agentically: propose a short plan, execute step-by-step reasoning internally, return actionable implementation details, and provide final verified output.'
        );
    }

    return parts.join('\n\n').trim();
}

function parseDesktopCommand(rawMessage) {
    const text = String(rawMessage || '').trim().toLowerCase();
    if (!text) return null;

    const patterns = [
        { appId: 'notepad', label: 'Notepad', regex: /^(open|launch|start)\s+(notepad|note[\s-]?pad)$/ },
        { appId: 'calculator', label: 'Calculator', regex: /^(open|launch|start)\s+(calculator|calc)$/ },
        { appId: 'explorer', label: 'File Explorer', regex: /^(open|launch|start)\s+(file\s+explorer|explorer)$/ },
        { appId: 'cmd', label: 'Command Prompt', regex: /^(open|launch|start)\s+(cmd|command\s+prompt|terminal)$/ },
        { appId: 'powershell', label: 'PowerShell', regex: /^(open|launch|start)\s+(powershell|power\s+shell)$/ },
        { appId: 'vscode', label: 'VS Code', regex: /^(open|launch|start)\s+(vscode|vs\s*code|visual\s+studio\s+code)$/ }
    ];

    for (const pattern of patterns) {
        if (pattern.regex.test(text)) {
            return { appId: pattern.appId, label: pattern.label };
        }
    }

    return null;
}

async function executeDesktopCommand(commandInfo) {
    try {
        const result = await window.systemAPI?.openApp?.(commandInfo.appId);
        if (result?.success) {
            const content = `Opened **${commandInfo.label}** successfully.`;
            showMessage(content, 'ai');
            currentMessages.push({
                role: 'assistant',
                content,
                timestamp: new Date().toISOString()
            });
        } else {
            const content = `I tried to open **${commandInfo.label}**, but it failed.\n\nDetails: ${result?.error || 'Unknown error'}`;
            showMessage(content, 'ai');
            currentMessages.push({
                role: 'assistant',
                content,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        const content = `I tried to open **${commandInfo.label}**, but it failed.\n\nDetails: ${error.message || String(error)}`;
        showMessage(content, 'ai');
        currentMessages.push({
            role: 'assistant',
            content,
            timestamp: new Date().toISOString()
        });
    }

    try {
        await saveCurrentSession();
    } catch (saveError) {
        console.error('Failed to save session:', saveError);
    }
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
        await window.appCommands.run(command);
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
            sidebar?.classList.toggle('collapsed');
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
    const escapedCode = codeText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
        <div class="code-block-wrapper">
            <button class="copy-code-btn" onclick="copyCode(this, event)">
                <i class="fa-regular fa-copy"></i> Copy
            </button>
            <pre><code class="language-${safeLanguage}">${escapedCode}</code></pre>
        </div>
    `;
};
marked.use({ renderer });

// Backend API Communication
async function checkBackend() {
    try {
        const response = await fetch('http://127.0.0.1:8000/health');
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

    // Execute supported desktop commands directly
    const desktopCommand = parseDesktopCommand(message);
    if (desktopCommand) {
        await executeDesktopCommand(desktopCommand);
        return;
    }

    // Get AI response
    await getAIResponse(message);
}

async function getAIResponse(userMessage) {
    isGenerating = true;
    abortController = new AbortController();

    // Update button states
    sendBtn.disabled = true;
    stopBtn.classList.add('active');

    // Show typing indicator
    const typingId = showTypingIndicator();

    try {
        const response = await fetch('http://127.0.0.1:8000/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: userMessage,
                model: currentModel,
                history: currentMessages
                    .slice(-12)
                    .map(m => ({ role: normalizeRoleForBackend(m.role), content: m.content || '' })),
                temperature: settings.temperature,
                system_prompt: getEffectiveSystemPrompt()
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
                            ensured.messageTextElement.innerHTML = marked.parse(fullResponse);
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
                            ensured.messageTextElement.innerHTML = marked.parse(fullResponse);
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
                            ensured.messageTextElement.innerHTML = marked.parse(fullResponse);
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
                ensured.messageTextElement.innerHTML = marked.parse(fullResponse);
            } else {
                throw error;
            }
        }

        if (!fullResponse.trim()) {
            const ensured = ensureAssistantMessage();
            fullResponse = '*No response content returned.*';
            ensured.messageTextElement.innerHTML = marked.parse(fullResponse);
        }

        // Add AI response to messages
        currentMessages.push({
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date().toISOString()
        });

        // Add message actions (copy, regenerate, delete)
        if (messageDiv) {
            addMessageActions(messageDiv, fullResponse);
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
        isGenerating = false;
        abortController = null;
        sendBtn.disabled = false;
        stopBtn.classList.remove('active');
        ensureChatInputReady();
    }
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
    isGenerating = false;
    abortController = null;
    sendBtn.disabled = false;
    stopBtn.classList.remove('active');

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
    updateSessionTitle('');
    currentModelDisplay.textContent = currentModel || 'Select a model';
    ensureChatInputReady();
    focusChatInput(false);
}

async function loadSession(sessionId) {
    resetComposerState();
    const sessionResponse = await fetch(`http://127.0.0.1:8000/history/${sessionId}`);
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
        const response = await fetch('http://127.0.0.1:8000/history/save', {
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
        // Update existing session
        await fetch(`http://127.0.0.1:8000/history/${currentSessionId}`, {
            method: 'DELETE'
        }).catch(() => { });

        const response = await fetch('http://127.0.0.1:8000/history/save', {
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
        if (result?.sessionId) {
            currentSessionId = result.sessionId;
        }
    }

    loadSessions();
}

async function updateSessionTitle(firstMessage) {
    const words = firstMessage.split(/\s+/).slice(0, 6).join(' ');
    const title = words + (words.split(' ').length >= 6 ? '...' : '');

    if (currentSessionId) {
        const messages = [...currentMessages];
        await fetch(`http://127.0.0.1:8000/history/${currentSessionId}`, {
            method: 'DELETE'
        }).catch(() => { });

        const titleSaveResponse = await fetch('http://127.0.0.1:8000/history/save', {
            method: 'POST',
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

    loadSessions();
}

async function loadSessions() {
    const response = await fetch('http://127.0.0.1:8000/history/load');
    const data = await response.json();
    chatHistory = data.sessions || [];

    renderSessions();
}

function renderSessions() {
    sessionsList.innerHTML = '';

    if (chatHistory.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.style.padding = '10px';
        emptyMsg.style.textAlign = 'center';
        emptyMsg.style.color = '#58585e';
        emptyMsg.style.fontSize = '12px';
        emptyMsg.textContent = 'No past sessions';
        sessionsList.appendChild(emptyMsg);
        return;
    }

    chatHistory.forEach(session => {
        const sessionDiv = document.createElement('div');
        sessionDiv.className = `session-item ${currentSessionId === session.id ? 'active' : ''}`;
        sessionDiv.dataset.sessionId = session.id;
        sessionDiv.onclick = () => {
            loadSession(session.id).catch((error) => {
                console.error('Failed to load session:', error);
                showMessage(`Could not load this session.\n\nDetails: ${error.message}`, 'ai');
            });
        };

        sessionDiv.innerHTML = `
            <div class="session-icon">
                <i class="fa-solid fa-message"></i>
            </div>
            <div class="session-info">
                <div class="session-title">${session.title}</div>
                <div class="session-meta">${session.model} - ${formatTime(new Date(session.createdAt))} - ${session.messageCount} msgs</div>
            </div>
            <div class="session-delete" onclick="deleteSession(event, '${session.id}')">
                <i class="fa-solid fa-trash"></i>
            </div>
        `;

        sessionsList.appendChild(sessionDiv);
    });
}

function deleteSession(event, sessionId) {
    event.stopPropagation();
    if (confirm('Delete this session?')) {
        fetch(`http://127.0.0.1:8000/history/${sessionId}`, {
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
        const response = await fetch('http://127.0.0.1:8000/models');
        const data = await response.json();
        availableModels = data.models || [];

        modelSelect.innerHTML = '';
        defaultModelSelect.innerHTML = '';

        if (availableModels.length === 0) {
            modelSelect.innerHTML = '<option disabled>No models found</option>';
            return;
        }

        availableModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = model.name;
            modelSelect.appendChild(option);

            const defaultOption = document.createElement('option');
            defaultOption.value = model.name;
            defaultOption.textContent = model.name;
            defaultModelSelect.appendChild(defaultOption);
        });

        // Check settings for default model
        const savedModel = settings.defaultModel || availableModels[0].name;
        if (availableModels.find(m => m.name === savedModel)) {
            modelSelect.value = savedModel;
            currentModel = savedModel;
        } else {
            currentModel = availableModels[0].name;
        }
        updateModelDisplay();
    } catch (error) {
        console.error('Failed to load models:', error);
        modelSelect.innerHTML = '<option disabled>Error loading models</option>';
    }
}

function updateModelDisplay() {
    currentModelDisplay.textContent = currentModel || 'Select a model';
}

// Settings Functions
async function loadSettings() {
    try {
        const response = await fetch('http://127.0.0.1:8000/settings');
        settings = await response.json();

        // Apply settings to UI
        applyTheme(settings.theme || 'dark');
        systemPromptInput.value = settings.systemPrompt || '';
        temperatureSlider.value = settings.temperature || 0.7;
        updateTempValue();
        defaultModelSelect.value = settings.defaultModel || '';
        developerModeToggle.checked = settings.developerMode !== false;
        agenticCloudToggle.checked = settings.agenticCloudMode !== false;
        currentModel = settings.defaultModel || currentModel;
        updateModelDisplay();
    } catch (error) {
        console.error('Failed to load settings:', error);
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function updateTempValue() {
    tempValue.textContent = temperatureSlider.value;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    applyZoomLevel(1);

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
        await loadSessions();

        // Show app, hide loader
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
            loadingScreen.style.display = 'none';
            appContainer.classList.add('loaded');
        }, 500);
    } else {
        backendStatus.textContent = 'Backend failed to start';
        alert('Failed to start backend server. Please make sure Ollama is running on port 11434.');
    }

    // Initial session creation
    createNewSession();
});

// Input Handling
chatInput.addEventListener('input', updateCharCount);
inputWrapper?.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    ensureChatInputReady();
    focusChatInput();
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
    }

    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    if (ctrlOrMeta && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        await createNewSession();
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

    // Save settings
    await fetch('http://127.0.0.1:8000/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    });
});

// Settings Panel Toggle
settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
});

// Close settings panel when clicking outside
document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && !settingsToggle.contains(e.target)) {
        settingsPanel.classList.remove('open');
    }

    if (!menuPopover?.contains(e.target) && !windowMenu?.contains(e.target)) {
        closeMenuPopover();
    }
});

// Theme Toggle
themeOptions.forEach(option => {
    option.addEventListener('click', () => {
        themeOptions.forEach(o => o.classList.remove('active'));
        option.classList.add('active');
        const theme = option.dataset.theme;
        applyTheme(theme);
        settings.theme = theme;
        saveSettings();
    });
});

// System Prompt
systemPromptInput.addEventListener('input', (e) => {
    settings.systemPrompt = e.target.value;
    saveSettings();
});

// Temperature Slider
temperatureSlider.addEventListener('input', () => {
    updateTempValue();
    settings.temperature = parseFloat(temperatureSlider.value);
    saveSettings();
});

// Default Model Select
defaultModelSelect.addEventListener('change', async (e) => {
    settings.defaultModel = e.target.value;
    saveSettings();
});

developerModeToggle?.addEventListener('change', () => {
    settings.developerMode = developerModeToggle.checked;
    saveSettings();
});

agenticCloudToggle?.addEventListener('change', () => {
    settings.agenticCloudMode = agenticCloudToggle.checked;
    saveSettings();
});

// Clear History
clearHistoryBtn.addEventListener('click', async () => {
    if (confirm('Are you sure? This will delete all saved sessions.')) {
        const response = await fetch('http://127.0.0.1:8000/history/load');
        const data = await response.json();

        for (const session of data.sessions) {
            await fetch(`http://127.0.0.1:8000/history/${session.id}`, {
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

// Save Settings Helper
async function saveSettings() {
    await fetch('http://127.0.0.1:8000/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    });
}

// Expose deleteSession globally for onclick handler
window.deleteSession = deleteSession;

// Smooth animations on scroll
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'translateY(0)';
        }
    });
}, { threshold: 0.1 });

// Auto-scroll when new messages are added
const chatObserver = new MutationObserver(() => {
    const distanceFromBottom = chatArea.scrollHeight - (chatArea.scrollTop + chatArea.clientHeight);
    if (distanceFromBottom < 140) {
        scrollToBottom();
    }
});
chatObserver.observe(messageContainer, { childList: true, subtree: false });
