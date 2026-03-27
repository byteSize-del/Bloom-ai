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
const clearHistoryBtn = document.getElementById('clear-history-btn');
const charCount = document.getElementById('char-count');
const addImageBtn = document.getElementById('add-image-btn');
const attachBtn = document.getElementById('attach-btn');

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
    defaultModel: 'llama3'
};
let isGenerating = false;
let abortController = null;

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
    const language = lang || 'plaintext';
    const escapedCode = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
        <div class="code-block-wrapper">
            <button class="copy-code-btn" onclick="copyCode(this)">
                <i class="fa-regular fa-copy"></i> Copy
            </button>
            <pre><code class="language-${language}">${escapedCode}</code></pre>
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
    const message = chatInput.value.trim();
    if (!message || isGenerating) return;

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
                history: currentMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
                temperature: settings.temperature,
                system_prompt: settings.systemPrompt
            }),
            signal: abortController.signal
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        // Remove typing indicator
        removeTypingIndicator(typingId);

        // Process streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let fullResponse = '';
        const messageDiv = addMessageToUI('ai', '', true);
        const messageTextElement = messageDiv.querySelector('.message-text');

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));

                        if (data.error) {
                            fullResponse += `\n\n**Error:** ${data.error}`;
                            messageTextElement.innerHTML = marked.parse(fullResponse);
                            addMessageActions(messageDiv, fullResponse);
                            return;
                        }

                        if (data.done) {
                            break;
                        }

                        if (data.content) {
                            fullResponse += data.content;
                            messageTextElement.innerHTML = marked.parse(fullResponse);
                            scrollToBottom();
                        }
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                fullResponse += '\n\n*[Generation stopped by user]*';
                messageTextElement.innerHTML = marked.parse(fullResponse);
            } else {
                throw error;
            }
        }

        // Add AI response to messages
        currentMessages.push({
            role: 'ai',
            content: fullResponse,
            timestamp: new Date().toISOString()
        });

        // Add message actions (copy, regenerate, delete)
        addMessageActions(messageDiv, fullResponse);

        // Auto-save session
        await saveCurrentSession();

    } catch (error) {
        console.error('Error getting AI response:', error);
        removeTypingIndicator(typingId);
        if (error.name !== 'AbortError') {
            showMessage('Error getting AI response. Is the backend server running?', 'ai');
        }
    } finally {
        isGenerating = false;
        abortController = null;
        sendBtn.disabled = false;
        stopBtn.classList.remove('active');
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
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role === 'user' ? 'user-message' : 'ai-message'}`;
    messageDiv.dataset.timestamp = new Date().toISOString();

    const avatarIcon = role === 'user' ? 'fa-user' : 'fa-spa';
    const authorName = role === 'user' ? 'You' : 'Bloom AI';

    messageDiv.innerHTML = `
        <div class="message-avatar ${role === 'user' ? 'user-avatar' : 'ai-avatar'}">
            <i class="fa-solid ${avatarIcon}"></i>
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${authorName}</span>
                <span class="message-time">${formatTime(new Date())}</span>
            </div>
            <div class="message-text">${content}</div>
        </div>
    `;

    if (isStreaming) {
        messageDiv.querySelector('.message-text').innerHTML = '';
    }

    messageContainer.appendChild(messageDiv);
    scrollToBottom();

    return messageDiv;
}

function addMessageActions(messageDiv, content) {
    const messageContent = messageDiv.querySelector('.message-content');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';

    actionsDiv.innerHTML = `
        <button class="message-action-btn" onclick="copyMessage(this)">
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

function copyMessage(btn) {
    const messageDiv = btn.closest('.message');
    const text = messageDiv.querySelector('.message-text').innerText;
    navigator.clipboard.writeText(text).then(() => {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => {
            btn.innerHTML = originalHtml;
        }, 2000);
    });
}

function regenerateLast(btn) {
    regenerateResponse();
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

function copyCode(btn) {
    const codeBlock = btn.nextElementSibling.querySelector('code');
    const code = codeBlock.innerText;
    navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => {
            btn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
        }, 2000);
    });
}

// Expose functions globally
window.copyMessage = copyMessage;
window.regenerateLast = regenerateLast;
window.deleteMessage = deleteMessage;
window.copyCode = copyCode;

function showTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message ai-message';
    typingDiv.id = 'typing-indicator';

    typingDiv.innerHTML = `
        <div class="message-avatar ai-avatar">
            <i class="fa-solid fa-spa"></i>
        </div>
        <div class="message-content">
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;

    messageContainer.appendChild(typingDiv);
    scrollToBottom();

    return typingDiv.id;
}

function removeTypingIndicator(id) {
    const indicator = document.getElementById(id);
    if (indicator) indicator.remove();
}

function showMessage(text, role = 'ai') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role === 'user' ? 'user-message' : 'ai-message'}`;

    const avatarIcon = role === 'user' ? 'fa-user' : 'fa-spa';
    const authorName = role === 'user' ? 'You' : 'Bloom AI';

    messageDiv.innerHTML = `
        <div class="message-avatar ${role === 'user' ? 'user-avatar' : 'ai-avatar'}">
            <i class="fa-solid ${avatarIcon}"></i>
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-author">${authorName}</span>
                <span class="message-time">${formatTime(new Date())}</span>
            </div>
            <div class="message-text">${marked.parse(text)}</div>
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

// Session Management
async function createNewSession() {
    currentSessionId = null;
    currentMessages = [];
    messageContainer.innerHTML = '';
    welcomeMessage.style.display = 'flex';
    messageContainer.style.display = 'none';
    updateSessionTitle('');
    currentModelDisplay.textContent = currentModel || 'Select a model';
}

async function loadSession(sessionId) {
    const session = await fetch(`http://127.0.0.1:8000/history/${sessionId}`)
        .then(r => r.json());

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
        } else if (msg.role === 'ai') {
            const msgDiv = addMessageToUI('ai', msg.content);
            addMessageActions(msgDiv, msg.content);
        }
    }

    scrollToBottom();
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

        const result = await response.json();
        currentSessionId = result.sessionId;
    } else {
        // Update existing session
        await fetch(`http://127.0.0.1:8000/history/${currentSessionId}`, {
            method: 'DELETE'
        }).catch(() => { });

        await fetch('http://127.0.0.1:8000/history/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: null,
                model: currentModel,
                messages: currentMessages
            })
        });
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

        await fetch('http://127.0.0.1:8000/history/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                model: currentModel,
                messages: messages
            })
        });
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
        sessionDiv.onclick = () => loadSession(session.id);

        sessionDiv.innerHTML = `
            <div class="session-icon">
                <i class="fa-solid fa-message"></i>
            </div>
            <div class="session-info">
                <div class="session-title">${session.title}</div>
                <div class="session-meta">${session.model} • ${formatTime(new Date(session.createdAt))} • ${session.messageCount} msgs</div>
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

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

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
    scrollToBottom();
});
chatObserver.observe(messageContainer, { childList: true, subtree: true });
