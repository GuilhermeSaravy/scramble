const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

// --- Dark Mode ---

function initDarkMode() {
  browserAPI.storage.sync.get({ darkMode: 'system' }, ({ darkMode }) => {
    applyDarkMode(darkMode);
    updateDarkModeIcon(darkMode);
  });
}

function applyDarkMode(mode) {
  const html = document.documentElement;
  if (mode === 'dark') {
    html.classList.add('dark');
  } else if (mode === 'light') {
    html.classList.remove('dark');
  } else {
    // system
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }
}

function updateDarkModeIcon(mode) {
  const icon = document.getElementById('darkModeIcon');
  if (!icon) return;
  if (mode === 'dark') icon.textContent = '🌙';
  else if (mode === 'light') icon.textContent = '☀️';
  else icon.textContent = '💻';
}

function cycleDarkMode() {
  browserAPI.storage.sync.get({ darkMode: 'system' }, ({ darkMode }) => {
    const next = darkMode === 'system' ? 'light' : darkMode === 'light' ? 'dark' : 'system';
    browserAPI.storage.sync.set({ darkMode: next });
    applyDarkMode(next);
    updateDarkModeIcon(next);
  });
}

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  browserAPI.storage.sync.get({ darkMode: 'system' }, ({ darkMode }) => {
    if (darkMode === 'system') applyDarkMode('system');
  });
});

// --- Tab Switching ---

function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tabName) {
  // Toggle content
  document.getElementById('tab-settings').classList.toggle('hidden', tabName !== 'settings');
  document.getElementById('tab-history').classList.toggle('hidden', tabName !== 'history');

  // Toggle button styles
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('border-teal-500', isActive);
    btn.classList.toggle('text-teal-600', isActive);
    btn.classList.toggle('dark:text-teal-400', isActive);
    btn.classList.toggle('border-transparent', !isActive);
    btn.classList.toggle('text-gray-500', !isActive);
    btn.classList.toggle('dark:text-gray-400', !isActive);
  });

  if (tabName === 'history') loadHistory();
}

// --- History ---

function formatRelativeTime(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function loadHistory() {
  browserAPI.storage.local.get({ history: [] }, ({ history }) => {
    const container = document.getElementById('history-container');
    const emptyState = document.getElementById('history-empty');

    // Clear previous entries (keep empty state element)
    container.querySelectorAll('.history-entry').forEach(el => el.remove());

    if (!history.length) {
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    // Render in reverse chronological order
    const entries = [...history].reverse();
    for (const entry of entries) {
      const card = document.createElement('div');
      card.className = 'history-entry rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden';

      const { oldTokens, oldChanged, newTokens, newChanged } = computeWordDiff(entry.original, entry.enhanced);
      const oldHtml = renderTokens(oldTokens, oldChanged, 'diff-del');
      const newHtml = renderTokens(newTokens, newChanged, 'diff-add');

      card.innerHTML = `
        <div class="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">${escapeHtml(entry.promptTitle)}</span>
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500 dark:text-gray-400">${formatRelativeTime(entry.timestamp)}</span>
            <button class="delete-entry text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors px-1" data-id="${escapeHtml(entry.id)}" title="Delete entry">✕</button>
          </div>
        </div>
        <div class="px-4 py-2 bg-red-50 dark:bg-red-950/30 border-b border-gray-200 dark:border-gray-700">
          <span class="text-red-700 dark:text-red-400 font-mono text-sm select-all"><span class="select-none text-red-400 dark:text-red-600 mr-2">−</span>${oldHtml}</span>
        </div>
        <div class="px-4 py-2 bg-green-50 dark:bg-green-950/30">
          <span class="text-green-700 dark:text-green-400 font-mono text-sm select-all"><span class="select-none text-green-400 dark:text-green-600 mr-2">+</span>${newHtml}</span>
        </div>
      `;

      card.querySelector('.delete-entry').addEventListener('click', () => {
        deleteHistoryEntry(entry.id, card);
      });

      container.appendChild(card);
    }
  });
}

function deleteHistoryEntry(id, cardElement) {
  browserAPI.storage.local.get({ history: [] }, ({ history }) => {
    const updated = history.filter(e => e.id !== id);
    browserAPI.storage.local.set({ history: updated }, () => {
      cardElement.remove();
      if (!document.querySelector('.history-entry')) {
        document.getElementById('history-empty').classList.remove('hidden');
      }
    });
  });
}

function clearHistory() {
  if (!confirm('Are you sure you want to clear all enhancement history?')) return;
  browserAPI.storage.local.set({ history: [] }, () => {
    loadHistory();
  });
}

function exportHistory(format) {
  browserAPI.storage.local.get({ history: [] }, ({ history }) => {
    if (!history.length) {
      alert('No history to export.');
      return;
    }

    let content, mimeType, filename;

    if (format === 'json') {
      content = JSON.stringify(history, null, 2);
      mimeType = 'application/json';
      filename = 'scramble-history.json';
    } else {
      const rows = [['id', 'timestamp', 'date', 'promptId', 'promptTitle', 'original', 'enhanced']];
      for (const e of history) {
        rows.push([
          e.id,
          e.timestamp,
          new Date(e.timestamp).toISOString(),
          e.promptId,
          e.promptTitle,
          e.original,
          e.enhanced,
        ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`));
      }
      content = rows.map(r => r.join(',')).join('\r\n');
      mimeType = 'text/csv';
      filename = 'scramble-history.csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function tokenize(text) {
  return text.match(/\S+|\s+/g) || [];
}

function computeWordDiff(oldText, newText) {
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  const m = oldTokens.length, n = newTokens.length;

  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldTokens[i - 1] === newTokens[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const oldChanged = new Array(m).fill(true);
  const newChanged = new Array(n).fill(true);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1] === newTokens[j - 1]) {
      oldChanged[i - 1] = false;
      newChanged[j - 1] = false;
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return { oldTokens, oldChanged, newTokens, newChanged };
}

function renderTokens(tokens, changed, cls) {
  return tokens.map((token, i) => {
    const esc = escapeHtml(token);
    return (changed[i] && token.trim())
      ? `<mark class="${cls}">${esc}</mark>`
      : esc;
  }).join('');
}

// --- Saves options to browserAPI.storage ---

async function saveOptions() {
  try {
    const options = {
      llmProvider: document.getElementById('llmProvider').value,
      apiKey: document.getElementById('apiKey').value,
      llmModel: document.getElementById('llmModel').value,
      customEndpoint: document.getElementById('customEndpoint').value,
      customPrompts: getCustomPrompts(),
      showSuccessNotification: document.getElementById('showSuccessNotification').checked,
      outputMode: document.querySelector('input[name="outputMode"]:checked')?.value || 'replace',
    };

    await new Promise((resolve, reject) => {
      browserAPI.storage.sync.set(options, () => {
        if (browserAPI.runtime.lastError) {
          reject(browserAPI.runtime.lastError);
        } else {
          resolve();
        }
      });
    });

    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    status.style.color = '#4CAF50';
    setTimeout(() => {
      status.textContent = '';
    }, 750);
  } catch (error) {
    console.error('Error saving options:', error);
    const status = document.getElementById('status');
    status.textContent = 'Error saving options.';
    status.style.color = '#f44336';
  }
}

function getCustomPrompts() {
  try {
    const promptContainers = document.querySelectorAll('.prompt-container');
    return Array.from(promptContainers).map(container => {
      const shortcutData = container.dataset.shortcut;
      return {
        id: snakeCase(container.querySelector('.prompt-title').value || ''),
        title: container.querySelector('.prompt-title').value || '',
        prompt: container.querySelector('.prompt-text').value || '',
        shortcut: shortcutData ? JSON.parse(shortcutData) : null
      };
    }).filter(prompt => prompt.title && prompt.prompt);
  } catch (error) {
    console.error('Error getting custom prompts:', error);
    return [];
  }
}

function formatShortcut(shortcut) {
  if (!shortcut) return '';
  const parts = [];
  if (shortcut.ctrlKey) parts.push('Ctrl');
  if (shortcut.altKey) parts.push('Alt');
  if (shortcut.shiftKey) parts.push('Shift');
  if (shortcut.metaKey) parts.push('Meta');
  // Display the key nicely
  let key = shortcut.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

function recordShortcut(container) {
  const display = container.querySelector('.shortcut-display');
  const recordBtn = container.querySelector('.record-shortcut');
  display.value = 'Press a key combo...';
  display.style.borderColor = '#2DD4BF';
  recordBtn.textContent = 'Recording...';
  recordBtn.classList.replace('bg-teal-500', 'bg-yellow-500');

  function onKeyDown(e) {
    e.preventDefault();
    e.stopPropagation();
    // Ignore modifier-only presses
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const shortcut = {
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      key: e.key
    };
    container.dataset.shortcut = JSON.stringify(shortcut);
    display.value = formatShortcut(shortcut);
    display.style.borderColor = '';
    recordBtn.textContent = 'Record';
    recordBtn.classList.replace('bg-yellow-500', 'bg-teal-500');
    document.removeEventListener('keydown', onKeyDown, true);
  }

  document.addEventListener('keydown', onKeyDown, true);
}

function snakeCase(str) {
  return str.toLowerCase().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function restoreOptions() {
  try {
    const defaults = {
      llmProvider: 'openai',
      apiKey: '',
      llmModel: 'gpt-3.5-turbo',
      customEndpoint: '',
      customPrompts: [],
      showSuccessNotification: true,
      outputMode: 'replace',
    };

    const items = await new Promise(resolve => {
      browserAPI.storage.sync.get(defaults, resolve);
    });

    const elementIds = ['llmProvider', 'apiKey', 'llmModel', 'customEndpoint'];

    elementIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.value = items[id] || defaults[id];
      } else {
        console.warn(`Element with id '${id}' not found`);
      }
    });

    // Restore notification setting
    const notifCheckbox = document.getElementById('showSuccessNotification');
    if (notifCheckbox) {
      notifCheckbox.checked = items.showSuccessNotification !== false;
    }

    // Restore output mode
    const outputModeEl = document.querySelector(`input[name="outputMode"][value="${items.outputMode || 'replace'}"]`);
    if (outputModeEl) outputModeEl.checked = true;

    // Clear existing prompts before restoring
    const promptsContainer = document.getElementById('prompts-container');
    while (promptsContainer.firstChild) {
      promptsContainer.removeChild(promptsContainer.firstChild);
    }

    // Restore custom prompts
    items.customPrompts.forEach(prompt => {
      addPromptToUI(prompt.title, prompt.prompt, prompt.id, prompt.shortcut);
    });

    updateUIForProvider(items.llmProvider);
  } catch (error) {
    console.error('Error restoring options:', error);
    showErrorMessage('Error restoring options. Please try reloading the page.');
  }
}

function updateUIForProvider(provider) {
  try {
    const labels = document.querySelectorAll('label span');
    const apiKeySpan = Array.from(labels).find(span => span.textContent.includes('API Key'));
    const modelSpan = Array.from(labels).find(span => span.textContent.includes('Model'));
    const endpointSpan = Array.from(labels).find(span => span.textContent.includes('Endpoint'));

    const apiKeyInput = document.getElementById('apiKey');
    const apiKeyHelp = document.getElementById('apiKeyHelp');
    const llmModelInput = document.getElementById('llmModel');
    const modelHelp = document.getElementById('modelHelp');
    const customEndpointInput = document.getElementById('customEndpoint');
    const customEndpointContainer = customEndpointInput.parentElement;
    const endpointHelp = document.getElementById('endpointHelp');
    const fetchModelsButton = document.getElementById('fetchModels');
    const availableModelsSelect = document.getElementById('availableModels');

    if (!apiKeySpan || !modelSpan || !endpointSpan) {
      console.warn('Could not find required UI labels');
      return;
    }

    // Reset visibility
    customEndpointContainer.style.display = 'block';
    apiKeyInput.parentElement.style.display = 'block';
    if (availableModelsSelect) {
      availableModelsSelect.classList.add('hidden');
      availableModelsSelect.innerHTML = '<option value="">Select a model...</option>';
    }

    // Show/hide fetch models button based on provider capability
    const canFetchModels = ['openai', 'lmstudio', 'ollama', 'openrouter', 'groq'].includes(provider);
    if (fetchModelsButton) {
      fetchModelsButton.style.display = canFetchModels ? 'block' : 'none';
    }

    switch (provider) {
      case 'openai':
        apiKeySpan.textContent = 'OpenAI API Key:';
        apiKeyInput.placeholder = 'sk-...';
        if (apiKeyHelp) apiKeyHelp.textContent = 'Get your API key from https://platform.openai.com/api-keys';
        llmModelInput.placeholder = 'gpt-3.5-turbo, gpt-4, gpt-4-turbo, etc.';
        if (modelHelp) modelHelp.textContent = 'Common models: gpt-3.5-turbo, gpt-4, gpt-4-turbo';
        customEndpointInput.placeholder = 'https://api.openai.com/v1/chat/completions (default)';
        if (endpointHelp) endpointHelp.textContent = 'Leave empty to use default OpenAI endpoint';
        break;

      case 'anthropic':
        apiKeySpan.textContent = 'Anthropic API Key:';
        apiKeyInput.placeholder = 'sk-ant-...';
        if (apiKeyHelp) apiKeyHelp.textContent = 'Get your API key from https://console.anthropic.com/';
        llmModelInput.placeholder = 'claude-3-haiku-20240307, claude-3-sonnet-20240229, etc.';
        if (modelHelp) modelHelp.textContent = 'Common models: claude-3-haiku-20240307, claude-3-sonnet-20240229';
        customEndpointInput.placeholder = 'https://api.anthropic.com/v1/complete (default)';
        if (endpointHelp) endpointHelp.textContent = 'Leave empty to use default Anthropic endpoint';
        break;

      case 'ollama':
        apiKeySpan.textContent = 'API Key (Optional):';
        apiKeyInput.placeholder = 'Leave empty for local Ollama';
        if (apiKeyHelp) apiKeyHelp.textContent = 'Ollama typically runs without API keys. Only needed for remote instances.';
        llmModelInput.placeholder = 'llama2, llama3, mistral, codellama, etc.';
        if (modelHelp) modelHelp.textContent = 'Use "ollama list" to see available models on your system';
        customEndpointInput.placeholder = 'http://localhost:11434/api/generate (default)';
        if (endpointHelp) endpointHelp.textContent = 'Default: http://localhost:11434/api/generate. Make sure Ollama is running.';
        break;

      case 'lmstudio':
        apiKeySpan.textContent = 'API Key (Optional):';
        apiKeyInput.placeholder = 'Leave empty for local LM Studio';
        if (apiKeyHelp) apiKeyHelp.textContent = 'LM Studio typically runs without API keys for local use.';
        llmModelInput.placeholder = 'Model name as shown in LM Studio';
        if (modelHelp) modelHelp.textContent = 'Use the exact model name from your LM Studio models list';
        customEndpointInput.placeholder = 'http://localhost:1234/v1/chat/completions (default)';
        if (endpointHelp) endpointHelp.textContent = 'Default: http://localhost:1234/v1/chat/completions. Ensure LM Studio server is running.';
        break;

      case 'groq':
        apiKeySpan.textContent = 'Groq API Key:';
        apiKeyInput.placeholder = 'gsk_...';
        if (apiKeyHelp) apiKeyHelp.textContent = 'Get your API key from https://console.groq.com/keys';
        llmModelInput.placeholder = 'llama3-8b-8192, llama3-70b-8192, mixtral-8x7b-32768, etc.';
        if (modelHelp) modelHelp.textContent = 'Common models: llama3-8b-8192, llama3-70b-8192, mixtral-8x7b-32768';
        customEndpointInput.placeholder = 'https://api.groq.com/v1/chat/completions (default)';
        if (endpointHelp) endpointHelp.textContent = 'Leave empty to use default Groq endpoint';
        break;

      case 'openrouter':
        apiKeySpan.textContent = 'OpenRouter API Key:';
        apiKeyInput.placeholder = 'sk-or-...';
        if (apiKeyHelp) apiKeyHelp.textContent = 'Get your API key from https://openrouter.ai/keys';
        llmModelInput.placeholder = 'openai/gpt-3.5-turbo, anthropic/claude-3-haiku, etc.';
        if (modelHelp) modelHelp.textContent = 'Format: provider/model-name (e.g., openai/gpt-4, anthropic/claude-3-sonnet)';
        customEndpointInput.placeholder = 'https://openrouter.ai/api/v1/chat/completions (default)';
        if (endpointHelp) endpointHelp.textContent = 'Leave empty to use default OpenRouter endpoint';
        break;

      default:
        console.warn(`Unknown provider: ${provider}`);
        break;
    }
  } catch (error) {
    console.error('Error updating UI for provider:', error);
    showErrorMessage('Error updating provider settings.');
  }
}

async function fetchAvailableModels() {
  const provider = document.getElementById('llmProvider').value;
  const apiKey = document.getElementById('apiKey').value;
  const customEndpoint = document.getElementById('customEndpoint').value;
  const fetchButton = document.getElementById('fetchModels');
  const fetchText = document.getElementById('fetchModelsText');
  const fetchSpinner = document.getElementById('fetchModelsSpinner');
  const availableModelsSelect = document.getElementById('availableModels');

  // Show loading state
  fetchButton.disabled = true;
  if (fetchText) fetchText.classList.add('hidden');
  if (fetchSpinner) fetchSpinner.classList.remove('hidden');

  try {
    let endpoint, headers = {};

    switch (provider) {
      case 'openai':
        endpoint = customEndpoint ? customEndpoint.replace('/chat/completions', '/models') : 'https://api.openai.com/v1/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;

      case 'lmstudio':
        const baseUrl = customEndpoint ? customEndpoint.split('/v1')[0] : 'http://localhost:1234';
        endpoint = `${baseUrl}/v1/models`;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;

      case 'ollama':
        const ollamaBaseUrl = customEndpoint ? customEndpoint.split('/api')[0] : 'http://localhost:11434';
        endpoint = `${ollamaBaseUrl}/api/tags`;
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;

      case 'openrouter':
        endpoint = 'https://openrouter.ai/api/v1/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;

      case 'groq':
        endpoint = customEndpoint ? customEndpoint.replace('/chat/completions', '/models') : 'https://api.groq.com/openai/v1/models';
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        break;

      default:
        throw new Error(`Model fetching not supported for ${provider}`);
    }

    const response = await fetch(endpoint, { headers });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    let models = [];

    // Parse models based on provider format
    switch (provider) {
      case 'ollama':
        models = data.models ? data.models.map(m => ({ id: m.name, name: m.name })) : [];
        break;
      case 'openrouter':
        models = data.data ? data.data.map(m => ({ id: m.id, name: m.name || m.id })) : [];
        break;
      default: // OpenAI, LM Studio, Groq
        models = data.data ? data.data.map(m => ({ id: m.id, name: m.id })) : [];
        break;
    }

    // Populate dropdown
    availableModelsSelect.innerHTML = '<option value="">Select a model...</option>';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name;
      availableModelsSelect.appendChild(option);
    });

    availableModelsSelect.classList.remove('hidden');
    showSuccessMessage(`Found ${models.length} models`);

  } catch (error) {
    console.error('Error fetching models:', error);
    showErrorMessage(`Failed to fetch models: ${error.message}`);
  } finally {
    // Reset loading state
    fetchButton.disabled = false;
    if (fetchText) fetchText.classList.remove('hidden');
    if (fetchSpinner) fetchSpinner.classList.add('hidden');
  }
}

function addPromptToUI(title = '', prompt = '', id = '', shortcut = null) {
  try {
    const promptsContainer = document.getElementById('prompts-container');
    const template = document.getElementById('prompt-template');

    if (!promptsContainer || !template) {
      throw new Error('Required elements not found');
    }

    const promptElement = template.content.cloneNode(true);

    const titleInput = promptElement.querySelector('.prompt-title');
    const textInput = promptElement.querySelector('.prompt-text');

    if (titleInput && textInput) {
      titleInput.value = title;
      textInput.value = prompt;
    }

    // Add a hidden input for the ID
    const idInput = document.createElement('input');
    idInput.type = 'hidden';
    idInput.className = 'prompt-id';
    idInput.value = id || snakeCase(title);

    const container = promptElement.querySelector('.prompt-container');
    if (container) {
      container.appendChild(idInput);

      // Set up shortcut
      if (shortcut) {
        container.dataset.shortcut = JSON.stringify(shortcut);
        const shortcutDisplay = container.querySelector('.shortcut-display');
        if (shortcutDisplay) shortcutDisplay.value = formatShortcut(shortcut);
      }

      const recordBtn = container.querySelector('.record-shortcut');
      if (recordBtn) {
        recordBtn.addEventListener('click', () => recordShortcut(container));
      }

      const clearBtn = container.querySelector('.clear-shortcut');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          delete container.dataset.shortcut;
          const display = container.querySelector('.shortcut-display');
          if (display) display.value = '';
        });
      }

      const deleteButton = container.querySelector('.delete-prompt');
      if (deleteButton) {
        deleteButton.addEventListener('click', function() {
          container.remove();
          saveOptions(); // Auto-save when removing a prompt
        });
      }
    }

    promptsContainer.appendChild(promptElement);
  } catch (error) {
    console.error('Error adding prompt to UI:', error);
    showErrorMessage('Error adding new prompt.');
  }
}

function showErrorMessage(message) {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = message;
    status.style.color = '#f44336';
    setTimeout(() => {
      status.textContent = '';
    }, 3000);
  }
}

function showSuccessMessage(message) {
  const status = document.getElementById('status');
  if (status) {
    status.textContent = message;
    status.style.color = '#4CAF50';
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  }
}

// Initialize event listeners
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded event fired');
  initDarkMode();
  initTabs();
  restoreOptions();

  const saveButton = document.getElementById('save');
  const providerSelect = document.getElementById('llmProvider');
  const addPromptButton = document.getElementById('add-prompt');
  const fetchModelsButton = document.getElementById('fetchModels');
  const availableModelsSelect = document.getElementById('availableModels');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const clearHistoryButton = document.getElementById('clearHistory');

  if (saveButton) {
    saveButton.addEventListener('click', saveOptions);
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', (e) => updateUIForProvider(e.target.value));
  }

  if (addPromptButton) {
    addPromptButton.addEventListener('click', () => addPromptToUI());
  }

  if (fetchModelsButton) {
    fetchModelsButton.addEventListener('click', fetchAvailableModels);
  }

  if (availableModelsSelect) {
    availableModelsSelect.addEventListener('change', (e) => {
      if (e.target.value) {
        document.getElementById('llmModel').value = e.target.value;
      }
    });
  }

  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', cycleDarkMode);
  }

  if (clearHistoryButton) {
    clearHistoryButton.addEventListener('click', clearHistory);
  }

  const exportJsonButton = document.getElementById('exportHistoryJson');
  if (exportJsonButton) {
    exportJsonButton.addEventListener('click', () => exportHistory('json'));
  }

  const exportCsvButton = document.getElementById('exportHistoryCsv');
  if (exportCsvButton) {
    exportCsvButton.addEventListener('click', () => exportHistory('csv'));
  }
});

// Autosave function for custom prompts
async function saveCustomPrompts(customPrompts) {
  try {
    await new Promise((resolve, reject) => {
      browserAPI.storage.sync.set({ customPrompts }, () => {
        if (browserAPI.runtime.lastError) {
          reject(browserAPI.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
    console.log('Custom prompts saved');
  } catch (error) {
    console.error('Error saving custom prompts:', error);
    showErrorMessage('Error saving custom prompts.');
  }
}