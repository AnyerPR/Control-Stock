const fs = require('fs');
const path = require('path');

function processHtmlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }
  let content = fs.readFileSync(filePath, 'utf8');

  // 1. Remove modulepreload links as they require servers and trigger CORS blocks
  console.log("Removing modulepreload link tags...");
  content = content.replace(/<link\s+rel="modulepreload"\s+[^>]*>/gi, '');

  // 2. Inject localStorage memory polyfill inside the HTML head as early as possible
  console.log("Injecting robust localStorage and secure-context polyfills...");
  const polyfillScript = `
  <script>
    (function() {
      // Polyfill storage APIs to prevent SecurityError under file:// protocol
      function createMemStore() {
        var store = {};
        return {
          getItem: function(key) { return store.hasOwnProperty(key) ? store[key] : null; },
          setItem: function(key, val) { store[key] = String(val); },
          removeItem: function(key) { delete store[key]; },
          clear: function() { store = {}; },
          key: function(i) { return Object.keys(store)[i] || null; },
          get length() { return Object.keys(store).length; }
        };
      }

      try {
        var test = window.localStorage;
        if (!test) throw new Error();
        test.setItem('__test__', '1');
        test.removeItem('__test__');
      } catch (e) {
        console.warn("localStorage is blocked or unavailable. Falling back to memory storage.");
        try {
          Object.defineProperty(window, 'localStorage', {
            value: createMemStore(),
            writable: true,
            configurable: true
          });
        } catch (err) {}
      }

      try {
        var testSession = window.sessionStorage;
        if (!testSession) throw new Error();
        testSession.setItem('__test__', '1');
        testSession.removeItem('__test__');
      } catch (e) {
        console.warn("sessionStorage is blocked or unavailable. Falling back to memory storage.");
        try {
          Object.defineProperty(window, 'sessionStorage', {
            value: createMemStore(),
            writable: true,
            configurable: true
          });
        } catch (err) {}
      }

      if (!window.isSecureContext) {
        try {
          Object.defineProperty(window, 'isSecureContext', {
            value: true,
            writable: true,
            configurable: true
          });
        } catch (e) {}
      }
    })();
  </script>
  `;

  // Inject right after <head> or at start of <head>
  if (content.includes('<head>')) {
    content = content.replace('<head>', '<head>' + polyfillScript);
  } else if (content.includes('<HEAD>')) {
    content = content.replace('<HEAD>', '<HEAD>' + polyfillScript);
  } else {
    content = polyfillScript + content;
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Processed ${filePath} successfully for file:// compatibility!`);
}

// Process both index_2.html and index_todo_en_uno.html in root and dist
const filesToProcess = [
  path.resolve(__dirname, 'index_2.html'),
  path.resolve(__dirname, 'index_todo_en_uno.html'),
  path.resolve(__dirname, 'dist', 'index_2.html'),
  path.resolve(__dirname, 'dist', 'index_todo_en_uno.html')
];

filesToProcess.forEach(processHtmlFile);


