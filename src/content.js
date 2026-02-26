// Guard against duplicate content script injection
if (window.__scrambleContentLoaded) {
  // Already loaded — skip re-initialization
} else {
window.__scrambleContentLoaded = true;

const browserAPI = (typeof browser !== 'undefined' ? browser : chrome);

// Cached settings
let cachedShortcuts = [];
let cachedShowSuccessNotification = true;
let cachedOutputMode = 'replace'; // 'replace' | 'popup'

// Load settings from storage
function loadSettings() {
  browserAPI.storage.sync.get({ customPrompts: [], showSuccessNotification: true, outputMode: 'replace' }, (items) => {
    cachedShortcuts = (items.customPrompts || []).filter(p => p.shortcut);
    cachedShowSuccessNotification = items.showSuccessNotification !== false;
    cachedOutputMode = items.outputMode || 'replace';
  });
}
loadSettings();

// Update cache when settings change
browserAPI.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.customPrompts) {
      cachedShortcuts = (changes.customPrompts.newValue || []).filter(p => p.shortcut);
    }
    if (changes.showSuccessNotification) {
      cachedShowSuccessNotification = changes.showSuccessNotification.newValue !== false;
    }
    if (changes.outputMode) {
      cachedOutputMode = changes.outputMode.newValue || 'replace';
    }
  }
});

// Unique placeholder inserted synchronously during the trusted keydown event.
// This marks the replacement position before the async API call begins.
// Private-Use-Area chars avoid autocorrect; visible chars aid debugging.
const SCRAMBLE_PLACEHOLDER = '\u27E6SCRMBL\u27E7';

// Keyboard shortcut listener
document.addEventListener('keydown', (e) => {
  // Ignore modifier-only presses
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

  for (const prompt of cachedShortcuts) {
    const s = prompt.shortcut;
    if (
      s.key === e.key &&
      s.ctrlKey === e.ctrlKey &&
      s.altKey === e.altKey &&
      s.shiftKey === e.shiftKey &&
      s.metaKey === e.metaKey
    ) {
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      if (!selectedText) return;

      e.preventDefault();
      e.stopPropagation();

      const activeElement = document.activeElement;
      const isInputField = activeElement && (
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement.tagName === 'INPUT' && activeElement.type === 'text')
      );

      // In popup mode: no DOM changes at all — just fetch and display.
      // In replace mode: insert a placeholder synchronously during this trusted
      // user event so complex editors (Teams, Slack) accept it.
      let usedPlaceholder = false;
      let savedRange = null;
      const savedSelStart = activeElement?.selectionStart;
      const savedSelEnd = activeElement?.selectionEnd;

      if (cachedOutputMode === 'replace' && !isInputField) {
        usedPlaceholder = document.execCommand('insertText', false, SCRAMBLE_PLACEHOLDER);
      }
      if (!usedPlaceholder && cachedOutputMode === 'replace') {
        savedRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
      }

      enhanceSelectedText(prompt.id, selectedText)
        .then(async enhancedText => {
          try {
            if (cachedOutputMode === 'popup') {
              showEnhancedTextPopup(enhancedText);
            } else if (usedPlaceholder) {
              await swapPlaceholder(activeElement, enhancedText);
              if (cachedShowSuccessNotification) showSuccessNotification('Text enhanced successfully');
            } else {
              await replaceSelectedText(enhancedText, {
                savedRange,
                savedActiveElement: activeElement,
                savedSelStart,
                savedSelEnd,
              });
              if (cachedShowSuccessNotification) showSuccessNotification('Text enhanced successfully');
            }
          } catch (err) {
            console.error('[SCRAMBLE] Replacement error:', err);
          }
        })
        .catch(error => {
          if (usedPlaceholder) {
            // swapPlaceholder uses extension APIs which also fail when the context
            // is invalidated — use the simpler DOM-only restore instead.
            restorePlaceholderSync(activeElement, selectedText);
          }
          console.error('[SCRAMBLE] Enhancement error:', error);
          if (error.message?.includes('Extension context invalidated')) {
            showErrorNotification('Scramble was updated — please reload the page to continue using it.');
          } else {
            showErrorNotification(error.message);
          }
        });
      return;
    }
  }
}, true);

// Find placeholder in the editor DOM, select it with a fresh range,
// replace via execCommand, then verify. If React reverted the change,
// fall back to OS-level insertion via chrome.debugger.
async function swapPlaceholder(editorElement, newText) {
  const root = editorElement?.isConnected ? editorElement : document.body;

  function findPlaceholderNode() {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.includes(SCRAMBLE_PLACEHOLDER)) return node;
    }
    return null;
  }

  const node = findPlaceholderNode();
  if (!node) {
    console.warn('[SCRAMBLE] Placeholder not found in DOM');
    return;
  }

  // Build a fresh, valid range directly on the known text node
  const idx = node.nodeValue.indexOf(SCRAMBLE_PLACEHOLDER);
  const range = document.createRange();
  range.setStart(node, idx);
  range.setEnd(node, idx + SCRAMBLE_PLACEHOLDER.length);

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  // Attempt 1: execCommand — fires trusted beforeinput/input events
  document.execCommand('insertText', false, newText);

  // Wait one frame for React/editor to reconcile
  await new Promise(r => requestAnimationFrame(r));

  // Verify: if placeholder is still present, execCommand was reverted by the editor
  if (findPlaceholderNode()) {
    // Re-select the placeholder for the debugger
    const staleNode = findPlaceholderNode();
    const staleIdx = staleNode.nodeValue.indexOf(SCRAMBLE_PLACEHOLDER);
    const staleRange = document.createRange();
    staleRange.setStart(staleNode, staleIdx);
    staleRange.setEnd(staleNode, staleIdx + SCRAMBLE_PLACEHOLDER.length);
    sel.removeAllRanges();
    sel.addRange(staleRange);

    // Attempt 2: OS-level insertion via chrome.debugger (bypasses isTrusted checks)
    const result = await browserAPI.runtime.sendMessage({
      action: 'insertTextViaDebugger',
      text: newText,
    });

    if (!result?.success) {
      // Attempt 3: brute-force direct DOM manipulation as last resort
      staleRange.deleteContents();
      staleRange.insertNode(document.createTextNode(newText));
      sel.collapseToEnd();
    }
  }
}

// Synchronous placeholder restore that uses no extension APIs.
// Safe to call even when the extension context has been invalidated.
function restorePlaceholderSync(editorElement, originalText) {
  const root = editorElement?.isConnected ? editorElement : document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue.includes(SCRAMBLE_PLACEHOLDER)) break;
  }
  if (!node) return;

  const idx = node.nodeValue.indexOf(SCRAMBLE_PLACEHOLDER);
  const range = document.createRange();
  range.setStart(node, idx);
  range.setEnd(node, idx + SCRAMBLE_PLACEHOLDER.length);

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  if (!document.execCommand('insertText', false, originalText)) {
    range.deleteContents();
    range.insertNode(document.createTextNode(originalText));
    sel.collapseToEnd();
  }
}

// Listen for messages from the background script
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[SCRAMBLE] Received message:', request);

  // Add support for ping message
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return;
  }

  if (request.action === 'enhanceText') {
    // Save selection state before async call (used only in replace mode)
    const selection = window.getSelection();
    const savedRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    const savedActiveElement = document.activeElement;
    const savedSelStart = savedActiveElement?.selectionStart;
    const savedSelEnd = savedActiveElement?.selectionEnd;

    enhanceSelectedText(request.promptId, request.selectedText)
      .then(async enhancedText => {
        if (cachedOutputMode === 'popup') {
          showEnhancedTextPopup(enhancedText);
        } else {
          await replaceSelectedText(enhancedText, { savedRange, savedActiveElement, savedSelStart, savedSelEnd });
          if (cachedShowSuccessNotification) showSuccessNotification('Text enhanced successfully');
        }
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error enhancing text:', error);
        showErrorNotification(error.message);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Indicates that the response is asynchronous
  }
});

// Function to enhance selected text
async function enhanceSelectedText(promptId, selectedText) {
  console.log('[SCRAMBLE] Selected text:', promptId, selectedText);
  try {
    const response = await browserAPI.runtime.sendMessage({
      action: 'enhanceText',
      promptId: promptId,
      selectedText: selectedText,
    });
    console.log('[SCRAMBLE] Response:', response);

    if (response.success) {
      return response.enhancedText;
    } else {
      throw new Error(response.error || 'Unknown error occurred');
    }
  } catch (error) {
    console.error('Error in enhanceSelectedText:', error);
    throw error;
  }
}

// Walk up the DOM to find the nearest contentEditable ancestor
function findContentEditable(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== document.body) {
    if (el.isContentEditable) return el;
    el = el.parentElement;
  }
  return null;
}

// Function to replace the selected text with enhanced text
async function replaceSelectedText(enhancedText, saved = {}) {
  const { savedRange, savedActiveElement, savedSelStart, savedSelEnd } = saved;

  // Case 1: plain input / textarea
  if (savedActiveElement && (savedActiveElement.tagName === 'TEXTAREA' || (savedActiveElement.tagName === 'INPUT' && savedActiveElement.type === 'text'))) {
    const start = savedSelStart ?? savedActiveElement.selectionStart;
    const end = savedSelEnd ?? savedActiveElement.selectionEnd;

    savedActiveElement.focus();
    savedActiveElement.setSelectionRange(start, end);

    // execCommand fires proper input events that React/Vue/Angular pick up
    if (!document.execCommand('insertText', false, enhancedText)) {
      savedActiveElement.value = savedActiveElement.value.substring(0, start) + enhancedText + savedActiveElement.value.substring(end);
      savedActiveElement.dispatchEvent(new Event('input', { bubbles: true }));
      savedActiveElement.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }

  // Case 2: contentEditable (Teams, Slack, Notion, Google Docs, etc.)
  if (savedRange) {
    try {
      // Find the actual contentEditable element. savedActiveElement might be a
      // wrapper div; walking up the range container is more reliable.
      const rangeContainer = savedRange.commonAncestorContainer;
      const editor = findContentEditable(rangeContainer)
                  || (savedActiveElement?.isConnected ? savedActiveElement : null);

      if (!editor) return;

      // Focus the editor
      editor.focus({ preventScroll: true });

      // Wait one animation frame so the editor's own focus handler fires and
      // settles before we override the selection. Without this, Teams and other
      // React editors reset the cursor after focus, clobbering addRange().
      await new Promise(resolve => requestAnimationFrame(resolve));

      // Restore the saved selection
      const selection = window.getSelection();
      selection.removeAllRanges();
      try {
        selection.addRange(savedRange);
      } catch (e) {
        console.warn('[SCRAMBLE] Saved range is no longer valid (DOM changed during API call):', e);
        return;
      }

      // Attempt 1: execCommand — fires beforeinput + input, works for most editors
      if (document.execCommand('insertText', false, enhancedText)) return;

      // Attempt 2: synthetic ClipboardEvent paste — works in editors that have
      // a paste handler and don't enforce isTrusted (e.g. some React editors)
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', enhancedText);
        const pasted = editor.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }));
        if (pasted) return;
      } catch (_) {}

      // Attempt 3: direct range manipulation — works for simple contentEditable
      // but may be overwritten by React-managed editors on next render
      const currentSel = window.getSelection();
      if (currentSel.rangeCount > 0) {
        const r = currentSel.getRangeAt(0);
        r.deleteContents();
        r.insertNode(document.createTextNode(enhancedText));
        currentSel.collapseToEnd();
      }
    } catch (e) {
      console.error('[SCRAMBLE] replaceSelectedText error:', e);
    }
    return;
  }

  // Case 3: no saved range — try live selection
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(enhancedText));
    selection.removeAllRanges();
  }
}

// Popup shown in 'popup' output mode — shadow DOM prevents page CSS leaking in
function showEnhancedTextPopup(enhancedText) {
  const existing = document.getElementById('__scramble_popup_host__');
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = '__scramble_popup_host__';
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
      .card {
        position: fixed; top: 16px; right: 16px;
        z-index: 2147483647;
        background: #fff; color: #111;
        border-radius: 10px;
        padding: 14px;
        width: 300px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.10);
        display: flex; flex-direction: column; gap: 10px;
      }
      .header {
        display: flex; justify-content: space-between; align-items: center;
      }
      .title { font-size: 12px; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
      .close {
        background: none; border: none; cursor: pointer;
        font-size: 16px; color: #aaa; line-height: 1; padding: 0 2px;
      }
      .close:hover { color: #333; }
      .text-box {
        background: #f6f8fa;
        border: 1px solid #e1e4e8;
        border-radius: 6px;
        padding: 10px;
        font-size: 13px; line-height: 1.6; color: #24292f;
        white-space: pre-wrap; word-break: break-word;
        max-height: 200px; overflow-y: auto;
        user-select: text;
      }
      .copy-btn {
        background: #2DD4BF; color: #fff; border: none;
        border-radius: 6px; padding: 8px 0;
        font-size: 13px; font-weight: 600;
        cursor: pointer; width: 100%;
        transition: background 0.15s;
      }
      .copy-btn:hover { background: #14b8a6; }
      .copy-btn.copied { background: #22c55e; }
    </style>
    <div class="card">
      <div class="header">
        <span class="title">Enhanced text</span>
        <button class="close" title="Close">✕</button>
      </div>
      <div class="text-box"></div>
      <button class="copy-btn">Copy to clipboard</button>
    </div>
  `;

  shadow.querySelector('.text-box').textContent = enhancedText;

  const dismissTimer = setTimeout(() => host.remove(), 5000);

  const closePopup = () => { clearTimeout(dismissTimer); host.remove(); };

  shadow.querySelector('.close').addEventListener('click', closePopup);

  const copyBtn = shadow.querySelector('.copy-btn');
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(enhancedText);
    copyBtn.textContent = 'Copied!';
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.textContent = 'Copy to clipboard';
      copyBtn.classList.remove('copied');
    }, 2000);
  });

  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { closePopup(); document.removeEventListener('keydown', onEsc); }
  });

  document.body.appendChild(host);
}

// Function to show success notification
function showSuccessNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: #22c55e;
    color: white;
    padding: 10px;
    border-radius: 5px;
    z-index: 9999;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Function to show error notification
function showErrorNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = `Error: ${message}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background-color: #ff4444;
    color: white;
    padding: 10px;
    border-radius: 5px;
    z-index: 9999;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

} // end duplicate guard
