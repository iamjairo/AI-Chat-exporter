import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';

const LANG_EXT = {
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh',
  yaml: 'yml', yml: 'yml', json: 'json', toml: 'toml', ini: 'ini', conf: 'conf',
  js: 'js', javascript: 'js', ts: 'ts', typescript: 'ts', jsx: 'jsx', tsx: 'tsx',
  python: 'py', py: 'py', go: 'go', rust: 'rs', rs: 'rs',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', cs: 'cs', java: 'java', php: 'php', rb: 'rb',
  html: 'html', css: 'css', scss: 'scss', sql: 'sql', xml: 'xml', md: 'md', markdown: 'md',
  dockerfile: 'Dockerfile',
};

// Pull every fenced code block out of the captured messages so they can be
// saved as individual script files.
function extractCodeBlocks(messages) {
  const out = [];
  const fence = /```([\w+.#-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  for (const m of messages || []) {
    if (!m.markdown) continue;
    let match;
    while ((match = fence.exec(m.markdown)) !== null) {
      const lang = (match[1] || '').toLowerCase();
      const code = match[2].replace(/\s+$/, '') + '\n';
      if (code.trim()) out.push({ lang, code });
    }
  }
  return out;
}

function scriptFileName(block, index) {
  // Prefer a filename the script writes to (cat > path, tee path), else shebang.
  const hint = block.code.match(/(?:cat|tee)\s+>{0,2}\s*['"]?([\w./-]+\.[\w]+)/);
  if (hint) return hint[1].split('/').pop();
  const n = String(index + 1).padStart(2, '0');
  if (block.lang === 'dockerfile' || /^\s*FROM\s+\S/m.test(block.code)) return `Dockerfile-${n}`;
  const ext = LANG_EXT[block.lang] || (block.lang && /^[a-z0-9]+$/.test(block.lang) ? block.lang : 'txt');
  return `script-${n}.${ext}`;
}

function b64ToUint8(b64) {
  const bin = atob(b64 || '');
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

const PLATFORM_LABELS = {
  gemini: 'Gemini',
  chatgpt: 'ChatGPT',
  deepseek: 'DeepSeek',
  claude: 'Claude',
  lechat: 'Le Chat',
  qwen: 'Qwen',
};

export default function PopupPanel() {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [chatData, setChatData] = useState({ title: '', messages: [], platform: '' });
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState('idle');
  const [mdStatus, setMdStatus] = useState('idle');
  const [zipStatus, setZipStatus] = useState('idle');
  const [attStatus, setAttStatus] = useState('idle');
  const platformLabel = PLATFORM_LABELS[chatData.platform] || 'AI Chat';

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {

        chrome.storage.local.get(['currentExportData', 'isDarkMode'], (result) => {
        if (result.currentExportData) {
          setChatData(result.currentExportData);
        }
        if (result.isDarkMode !== undefined) {
          setIsDarkMode(result.isDarkMode);
        }
      });

      const handleStorageChange = (changes, namespace) => {
        if (namespace === 'local') {
          if (changes.currentExportData?.newValue) {
            setChatData(changes.currentExportData.newValue);
          }
          if (changes.isDarkMode?.newValue !== undefined) {
            setIsDarkMode(changes.isDarkMode.newValue);
          }
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);

      return () => {
        chrome.storage.onChanged.removeListener(handleStorageChange);
      };
    }
  }, []);

  const toggleTheme = () => {
    const newVal = !isDarkMode;
    setIsDarkMode(newVal);
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ isDarkMode: newVal });
    }
  };

  const handleClose = () => {
    window.parent.postMessage({ action: 'CLOSE_POPUP' }, '*');
  };

  const handleGeneratePDF = async () => {
    setIsGenerating(true);
    setStatus('generating');

    try {
      // Tell background worker to open the preview page
      chrome.runtime.sendMessage({ action: 'OPEN_PREVIEW' });
      
      setStatus('done');

      setTimeout(() => {
        setStatus('idle');
        handleClose(); // Close the floating widget
      }, 1000);
    } catch (err) {
      console.error('Failed to open preview:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    } finally {
      setIsGenerating(false);
    }
  };

  const buttonLabel = {
    idle: 'Preview & Export PDF',
    generating: 'Opening...',
    done: '✓ Opened!',
    error: '✕ Failed, try again',
  }[status];

  // Build a Markdown document from the captured messages. The ChatGPT API path
  // keeps each message's raw markdown; other paths fall back to stripped HTML.
  const buildMarkdown = () => {
    const lines = [`# ${chatData.title || 'AI Chat Export'}`, ''];
    for (const m of chatData.messages || []) {
      lines.push(m.role === 'user' ? '## 🧑 You' : '## 🤖 Assistant', '');
      const body = m.markdown || (m.htmlContent ? m.htmlContent.replace(/<[^>]+>/g, '') : '');
      lines.push(body, '');
    }
    return lines.join('\n');
  };

  const downloadMarkdown = () => {
    if (!chatData.messages || !chatData.messages.length) {
      setMdStatus('error');
      setTimeout(() => setMdStatus('idle'), 2000);
      return;
    }
    try {
      const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const safe =
        (chatData.title || 'ai-chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 80) || 'ai-chat';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setMdStatus('done');
      setTimeout(() => setMdStatus('idle'), 1500);
    } catch (e) {
      console.error('Markdown download failed', e);
      setMdStatus('error');
      setTimeout(() => setMdStatus('idle'), 2500);
    }
  };

  const mdLabel = { idle: 'Download Markdown', done: '✓ Saved .md', error: '✕ Failed' }[mdStatus];

  // Extract every code block in the chat and save them as a .zip of script files.
  const downloadScripts = async () => {
    const blocks = extractCodeBlocks(chatData.messages);
    if (!blocks.length) {
      setZipStatus('empty');
      setTimeout(() => setZipStatus('idle'), 2200);
      return;
    }
    try {
      setZipStatus('working');
      const zip = new JSZip();
      const used = {};
      blocks.forEach((b, i) => {
        let name = scriptFileName(b, i);
        if (used[name]) {
          const dot = name.lastIndexOf('.');
          name = dot > 0 ? `${name.slice(0, dot)}-${used[name]}${name.slice(dot)}` : `${name}-${used[name]}`;
        }
        used[scriptFileName(b, i)] = (used[scriptFileName(b, i)] || 0) + 1;
        zip.file(name, b.code);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const safe =
        (chatData.title || 'ai-chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'ai-chat';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}-scripts.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setZipStatus('done');
      setTimeout(() => setZipStatus('idle'), 1800);
    } catch (e) {
      console.error('Scripts zip failed', e);
      setZipStatus('error');
      setTimeout(() => setZipStatus('idle'), 2500);
    }
  };

  const scriptCount = extractCodeBlocks(chatData.messages).length;
  const zipLabel = {
    idle: `Download Scripts (${scriptCount})`,
    working: 'Zipping…',
    done: '✓ Saved .zip',
    empty: 'No code blocks found',
    error: '✕ Failed',
  }[zipStatus];

  // Download the files the user uploaded in the chat (fetched at export time).
  const attachmentCount = (chatData.attachments || []).length;
  const downloadAttachments = async () => {
    const atts = chatData.attachments || [];
    if (!atts.length) {
      setAttStatus('empty');
      setTimeout(() => setAttStatus('idle'), 2200);
      return;
    }
    try {
      setAttStatus('working');
      const zip = new JSZip();
      const used = {};
      atts.forEach((a) => {
        let name = a.name || 'file';
        if (used[name]) {
          const dot = name.lastIndexOf('.');
          name = dot > 0 ? `${name.slice(0, dot)}-${used[name]}${name.slice(dot)}` : `${name}-${used[name]}`;
        }
        used[a.name || 'file'] = (used[a.name || 'file'] || 0) + 1;
        zip.file(name, b64ToUint8(a.base64));
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const safe =
        (chatData.title || 'ai-chat').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'ai-chat';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}-files.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setAttStatus('done');
      setTimeout(() => setAttStatus('idle'), 1800);
    } catch (e) {
      console.error('Attachments zip failed', e);
      setAttStatus('error');
      setTimeout(() => setAttStatus('idle'), 2500);
    }
  };

  const attLabel = {
    idle: `Download Files (${attachmentCount})`,
    working: 'Zipping…',
    done: '✓ Saved .zip',
    empty: 'No files found',
    error: '✕ Failed',
  }[attStatus];

  return (
    <div className="w-[360px] mx-auto bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden font-['Inter',system-ui,sans-serif]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <img src="logo1.png" alt="Logo" className="w-4 h-4 rounded" />
          <span className="text-base font-bold text-blue-600">AI Exporter</span>
          {chatData.platform && (
            <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{platformLabel}</span>
          )}
        </div>
        <button onClick={handleClose} className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Preview */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Preview</span>
          <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md">A4 Document</span>
        </div>

        {/* Document */}
        <div className={`rounded-xl p-4 flex justify-center transition-colors ${isDarkMode ? 'bg-slate-900' : 'bg-slate-50'}`}>
          <div 
            className={`w-48 rounded-lg shadow-md border overflow-hidden relative transition-colors ${isDarkMode ? 'bg-[#131314] border-gray-800' : 'bg-white border-slate-200'}`}
            style={{ height: '272px' }}
          >
            
            <iframe 
              src={chrome.runtime?.getURL('index.html?mini=true#/preview') || ''} 
              style={{ 
                position: 'absolute',
                top: 0,
                left: 0,
                width: '794px', 
                height: '1123px', 
                transform: 'scale(0.2418)', 
                transformOrigin: 'top left', 
                pointerEvents: 'none', 
                border: 'none',
                maxWidth: 'none',
                maxHeight: 'none'
              }}
              title="PDF Preview"
            />

            <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t ${isDarkMode ? 'from-[#131314] to-transparent' : 'from-white to-transparent'}`} />
          </div>
        </div>
      </div>

      <div className="px-5 pt-2 pb-4">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Export Settings</span>
        <div className="mt-3 bg-slate-50 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
              </div>
              <span className="text-sm font-medium text-slate-700">Dark Mode</span>
            </div>
            <button
              onClick={toggleTheme}
              className={`w-11 h-6 rounded-full transition-colors relative ${isDarkMode ? 'bg-blue-500' : 'bg-slate-300'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${isDarkMode ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="px-5 pb-4">
        <button
          onClick={handleGeneratePDF}
          disabled={isGenerating}
          className={`w-full font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] text-sm
            ${status === 'done'
              ? 'bg-green-500 hover:bg-green-600 text-white shadow-green-500/25'
              : status === 'error'
                ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/25'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/25'
            }
            ${isGenerating ? 'opacity-75 cursor-not-allowed' : ''}
          `}
        >
          {status === 'generating' ? (
            <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          )}
          {buttonLabel}
        </button>

        {/* Download as Markdown */}
        <button
          onClick={downloadMarkdown}
          className={`w-full mt-2 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 border transition-all active:scale-[0.98] text-sm
            ${mdStatus === 'done'
              ? 'border-green-300 text-green-700 bg-green-50'
              : mdStatus === 'error'
                ? 'border-red-300 text-red-700 bg-red-50'
                : 'border-slate-300 text-slate-700 bg-white hover:bg-slate-50'
            }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15V3" /><path d="M6 11l6 6 6-6" /><path d="M4 21h16" />
          </svg>
          {mdLabel}
        </button>

        {/* Download code blocks as a .zip of script files */}
        {scriptCount > 0 && (
          <button
            onClick={downloadScripts}
            disabled={zipStatus === 'working'}
            className={`w-full mt-2 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 border transition-all active:scale-[0.98] text-sm
              ${zipStatus === 'done'
                ? 'border-green-300 text-green-700 bg-green-50'
                : zipStatus === 'error' || zipStatus === 'empty'
                  ? 'border-red-300 text-red-700 bg-red-50'
                  : 'border-slate-300 text-slate-700 bg-white hover:bg-slate-50'
              }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
              <path d="M12 3v4M12 9v2M12 13v2" />
            </svg>
            {zipLabel}
          </button>
        )}

        {/* Download the user's uploaded files/attachments */}
        {attachmentCount > 0 && (
          <button
            onClick={downloadAttachments}
            disabled={attStatus === 'working'}
            className={`w-full mt-2 font-semibold py-3 rounded-xl flex items-center justify-center gap-2 border transition-all active:scale-[0.98] text-sm
              ${attStatus === 'done'
                ? 'border-green-300 text-green-700 bg-green-50'
                : attStatus === 'error' || attStatus === 'empty'
                  ? 'border-red-300 text-red-700 bg-red-50'
                  : 'border-slate-300 text-slate-700 bg-white hover:bg-slate-50'
              }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            {attLabel}
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
        <span className="text-[10px] text-slate-400 font-medium tracking-wide">S LAB EDITION 1.1</span>
        <a
          href="https://github.com/iamjairo/AI-Chat-exporter"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-slate-400 font-semibold hover:text-slate-600 uppercase tracking-wider"
        >
          Help
        </a>
      </div>
    </div>
  );
}
