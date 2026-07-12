import React, { useEffect, useState, useRef, useMemo } from 'react';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import hljs from 'highlight.js';


export default function GeminiPreview() {
  const [chatInfo, setChatInfo] = useState({ title: "Loading...", messages: [], platform: '' });
  const [isDarkMode, setIsDarkMode] = useState(true);
  const scrollContainerRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleWindowScroll = () => {
      if (window.scrollY > 300) {
        setShowScrollTop(true);
      } else {
        setShowScrollTop(false);
      }
    };
    
    window.addEventListener('scroll', handleWindowScroll);
    return () => window.removeEventListener('scroll', handleWindowScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['currentExportData', 'isDarkMode'], (result) => {
        if (result.currentExportData) {
          setChatInfo(result.currentExportData);
          document.title = result.currentExportData.title || "AI Chat Export";
        }
        if (result.isDarkMode !== undefined) {
          setIsDarkMode(result.isDarkMode);
        }
      });

      const handleStorageChange = (changes, namespace) => {
        if (namespace === 'local') {
          if (changes.currentExportData?.newValue) {
            setChatInfo(changes.currentExportData.newValue);
            document.title = changes.currentExportData.newValue.title || "AI Chat Export";
          }
          if (changes.isDarkMode?.newValue !== undefined) {
            setIsDarkMode(changes.isDarkMode.newValue);
          }
        }
      };

      chrome.storage.onChanged.addListener(handleStorageChange);
      return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }
  }, []);

  // Process HTML: sanitize then render all math markers to KaTeX HTML
  // This runs synchronously at render time — no DOM timing issues.
  const processHtml = (htmlString) => {
    if (!htmlString) return '';

    // Step 1: Sanitize, preserving our math marker attributes
    let sanitized = DOMPurify.sanitize(htmlString, { ADD_ATTR: ['data-tex'] });

    // Step 2: Parse the sanitized HTML and render math markers with KaTeX
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = sanitized;

    tempDiv.querySelectorAll('.math-tex').forEach(el => {
      const tex = el.getAttribute('data-tex');
      if (tex) {
        try {
          const isDisplay = el.classList.contains('math-display');
          el.innerHTML = katex.renderToString(tex, {
            throwOnError: false,
            displayMode: isDisplay,
            strict: false,
            trust: true,
          });
          el.classList.add('math-rendered');
        } catch (e) {
          console.warn('[KaTeX] renderToString failed for:', tex, e);
        }
      }
    });

    // Step 3: Syntax-highlight every code block. We highlight from the raw text
    // so it's consistent regardless of how the source platform marked it up.
    tempDiv.querySelectorAll('pre').forEach(pre => {
      let codeEl = pre.querySelector('code');
      if (!codeEl) {
        codeEl = document.createElement('code');
        codeEl.textContent = pre.textContent;
        pre.textContent = '';
        pre.appendChild(codeEl);
      }
      try {
        delete codeEl.dataset.highlighted;
        hljs.highlightElement(codeEl);
      } catch (e) {
        /* leave the code block un-highlighted on failure */
      }
    });

    return tempDiv.innerHTML;
  };

  const handleDownloadPDF = () => {
    window.print();
  };

  const isMini = typeof window !== 'undefined' && window.location.href.includes('mini=true');

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
    }
  }, [isDarkMode]);

  return (
    <div className={`flex flex-col min-h-screen print:block print:min-h-0 ${isDarkMode ? 'bg-[#F8F9FA]' : 'bg-gray-100'} print:bg-white`}>


      {/* Top Toolbar */}
      {!isMini && (
        <div className="sticky top-0 z-20 px-4 pt-4 pb-3 print:hidden">
          <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 rounded-2xl border border-slate-200/80 bg-gradient-to-r from-white via-slate-50 to-white px-4 py-3 shadow-[0_10px_40px_-26px_rgba(15,23,42,0.65)] backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center  text-white shadow-md shadow-slate-300/70">
                <img src="logo1.png" alt="Logo" className="w-10 h-10 rounded" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-slate-900">Export Preview</h2>
                <p className="text-xs font-medium text-slate-500">Review layout, then save a polished PDF</p>
              </div>
            </div>

            <button
              onClick={handleDownloadPDF}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5v-10m0 10l-4-4m4 4l4-4M4.5 16.5v1.125A2.625 2.625 0 007.125 20.25h9.75a2.625 2.625 0 002.625-2.625V16.5" />
              </svg>
              Save as PDF
            </button>
          </div>
        </div>
      )}

      <div className={`overflow-y-auto ${isMini ? 'p-0' : 'p-8'} flex-1 flex justify-center print:block print:h-auto print:p-0 print:overflow-visible ${isDarkMode ? 'print:bg-[#131314]' : 'print:bg-white'}`}>
        <table className="w-full border-collapse border-0">
          <thead className="hidden print:table-header-group">
            <tr><td className="border-0 p-0"><div className="pdf-vspace h-12"></div></td></tr>
          </thead>
          <tfoot className="hidden print:table-footer-group">
            <tr><td className="border-0 p-0"><div className="pdf-vspace h-12"></div></td></tr>
          </tfoot>
          <tbody className="border-0">
            <tr>
              <td className="border-0 p-0">
                <div className="flex justify-center w-full print:block">
                  <div 
                    className={`w-full max-w-[800px] mx-auto ${isMini ? 'p-6' : 'p-8 pb-20 shadow-2xl'} print:shadow-none print:px-0 print:py-0 print:max-w-none print:w-full transition-colors duration-200
                      ${isDarkMode 
                        ? 'bg-[#131314] text-[#e3e3e3] print:bg-[#131314] print:text-[#e3e3e3]' 
                        : 'bg-white text-gray-900 print:bg-white print:text-gray-900'
                      }`}
                  >
                    <header className={`mb-8 border-b pb-4 ${isDarkMode ? 'border-[#282a2c] print:border-[#282a2c]' : 'border-gray-200 print:border-gray-200'}`}>
                      <h1
                        className="text-2xl font-semibold tracking-tight pt-6"
                        style={{ fontFamily: '"Avenir Next", "SF Pro Display", "Segoe UI", sans-serif' }}
                      >
                        {chatInfo.title}
                      </h1>
                      <p className="text-sm text-gray-500 mt-2">Exported on {new Date().toLocaleDateString()}</p>
                    </header>

                    <div className="space-y-8">
                      {chatInfo.messages.map((msg, index) => (
                        <div
                          key={index}
                          className={`pdf-msg-row flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} mb-8`}
                        >
                          
                          {msg.role === 'model' && (
                            <div className="w-8 h-8 rounded-full flex-shrink-0 mr-4 mt-1 flex items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-800 print:border print:border-gray-300">
                              <img 
                                src="/logo1.png" 
                                alt="AI Avatar" 
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  // Fallback to extension URL if relative path fails in some contexts
                                  if (typeof chrome !== 'undefined' && chrome.runtime) {
                                    e.target.src = chrome.runtime.getURL('logo1.png');
                                  }
                                }}
                              />
                            </div>
                          )}

                          {/* Container that stacks images above the text bubble */}
                          <div className={`pdf-bubble flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} max-w-[85%] min-w-0`}>
                            
                            {/* Text Bubble */}
                            {msg.htmlContent && msg.htmlContent !== '' && (
                              <div 
                                className={`rounded-2xl px-5 py-4 w-full min-w-0 ${
                                  msg.role === 'user' 
                                    ? (isDarkMode 
                                        ? 'bg-[#1e1f20] text-[#e3e3e3] rounded-tr-sm print:bg-[#1e1f20]' 
                                        : 'bg-gray-100 text-gray-900 rounded-tr-sm print:bg-gray-100')
                                    : 'bg-transparent'              
                                }`}
                              >
                                <div 
                                  className="gemini-content text-[15px] min-w-0 break-words"
                                  dangerouslySetInnerHTML={{ __html: processHtml(msg.htmlContent) }}
                                />
                              </div>
                            )}
                          </div>

                        </div>
                      ))}
                    </div>
                    
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-8 right-8 w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center shadow-lg transition-all duration-300 z-50 print:hidden"
          aria-label="Scroll to top"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}
    </div>
  );
}
