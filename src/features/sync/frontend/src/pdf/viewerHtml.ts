/**
 * The pdf.js viewer that runs inside the WebView.
 *
 * It is written to the device filesystem next to the cached pdf.js runtime, so
 * once Download has run the whole reader works with no network at all.
 *
 * Messages out (to React Native):
 *   { type: 'ready',     pageCount }
 *   { type: 'page',      page }            - the page currently in view
 *   { type: 'selection', page, startOffset, endOffset, preview } | { type:'selection', empty:true }
 *   { type: 'error',     message }
 *
 * Messages in (from React Native, via injectJavaScript):
 *   window.applyHighlights([{ id, page, startOffset, endOffset, color }])
 *   window.goToPage(n)
 *
 * Offsets are character indices into the page's concatenated text content. That
 * is all a PDF locator needs, which is why the selected text itself is never
 * stored - see the Day 1 schema.
 */
export function buildViewerHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  * { -webkit-tap-highlight-color: transparent; }
  html, body {
    margin: 0; padding: 0; background: #eceff3;
    -webkit-text-size-adjust: 100%;
  }
  #viewer { padding: 12px 0 40px; }
  .page {
    position: relative;
    margin: 0 auto 14px;
    background: #fff;
    box-shadow: 0 1px 6px rgba(0,0,0,0.18);
    overflow: hidden;
  }
  .page canvas { display: block; width: 100%; height: 100%; }

  /* Text layer: invisible text sitting exactly on top of the rendered page.
     This is what makes the PDF selectable. */
  .textLayer {
    position: absolute; inset: 0;
    overflow: hidden;
    line-height: 1;
    opacity: 1;
    -webkit-user-select: text;
    user-select: text;
    forced-color-adjust: none;
    transform-origin: 0 0;
    z-index: 2;
  }
  .textLayer span, .textLayer br {
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
    color: transparent;
  }
  .textLayer ::selection { background: rgba(0, 106, 255, 0.35); }

  /* Highlights are drawn as rectangles underneath the text layer, so painting
     them never disturbs the character offsets we just measured. */
  .hlLayer { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
  .hlRect { position: absolute; border-radius: 2px; mix-blend-mode: multiply; }

  #status {
    font: 14px -apple-system, Roboto, sans-serif;
    color: #556;
    text-align: center;
    padding: 32px 16px;
  }
</style>
<script src="./pdf.min.js"></script>
<script src="./pdf.worker.min.js"></script>
</head>
<body>
<div id="status">Rendering...</div>
<div id="viewer"></div>

<script>
(function () {
  var send = function (payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  };

  window.onerror = function (message) {
    send({ type: 'error', message: String(message) });
  };

  if (!window.pdfjsLib) {
    document.getElementById('status').textContent = 'pdf.js failed to load.';
    send({ type: 'error', message: 'pdf.js not loaded' });
    return;
  }

  // pdf.worker.min.js was loaded above and registered globalThis.pdfjsWorker,
  // so pdf.js runs the worker code on the main thread. That avoids constructing
  // a Worker from a file:// page, which WebViews block.
  pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';

  var pages = [];        // { pageNumber, container, textLayer, hlLayer, spans, viewport }
  var currentPage = 1;
  var pendingHighlights = [];

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    };
  }

  // ------------------------------------------------------------- rendering

  function renderPage(pdf, pageNumber, width) {
    return pdf.getPage(pageNumber).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = width / base.width;
      var viewport = page.getViewport({ scale: scale });
      var ratio = Math.min(window.devicePixelRatio || 1, 2);

      var container = document.createElement('div');
      container.className = 'page';
      container.dataset.page = String(pageNumber);
      container.style.width = viewport.width + 'px';
      container.style.height = viewport.height + 'px';
      container.style.setProperty('--scale-factor', String(scale));

      var canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);

      var hlLayer = document.createElement('div');
      hlLayer.className = 'hlLayer';

      var textLayer = document.createElement('div');
      textLayer.className = 'textLayer';

      container.appendChild(canvas);
      container.appendChild(hlLayer);
      container.appendChild(textLayer);
      document.getElementById('viewer').appendChild(container);

      var context = canvas.getContext('2d');
      context.scale(ratio, ratio);

      return page.render({ canvasContext: context, viewport: viewport }).promise
        .then(function () { return page.getTextContent(); })
        .then(function (textContent) {
          var textDivs = [];
          var task = pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayer,
            viewport: viewport,
            textDivs: textDivs,
          });
          return task.promise.then(function () {
            return { textContent: textContent, textDivs: textDivs };
          });
        })
        .then(function (result) {
          // Tag every span with where its text starts in the page's full text.
          // These offsets are exactly what a PDF locator stores.
          var spans = [];
          var offset = 0;
          var items = result.textContent.items;
          for (var i = 0; i < result.textDivs.length; i++) {
            var div = result.textDivs[i];
            var length = (items[i] && items[i].str ? items[i].str.length : 0);
            div.dataset.start = String(offset);
            div.dataset.end = String(offset + length);
            spans.push({ node: div, start: offset, end: offset + length });
            offset += length;
            if (items[i] && items[i].hasEOL) offset += 1;
          }

          pages.push({
            pageNumber: pageNumber,
            container: container,
            textLayer: textLayer,
            hlLayer: hlLayer,
            spans: spans,
            length: offset,
          });
        });
    });
  }

  // ------------------------------------------------------------- selection

  function findSpan(node) {
    var element = node && node.nodeType === 3 ? node.parentNode : node;
    while (element && element !== document.body) {
      if (element.dataset && element.dataset.start !== undefined) return element;
      element = element.parentNode;
    }
    return null;
  }

  function pageOf(element) {
    var node = element;
    while (node && node !== document.body) {
      if (node.classList && node.classList.contains('page')) {
        return parseInt(node.dataset.page, 10);
      }
      node = node.parentNode;
    }
    return null;
  }

  var reportSelection = debounce(function () {
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      send({ type: 'selection', empty: true });
      return;
    }

    var range = selection.getRangeAt(0);
    var startSpan = findSpan(range.startContainer);
    var endSpan = findSpan(range.endContainer);
    if (!startSpan || !endSpan) {
      send({ type: 'selection', empty: true });
      return;
    }

    var page = pageOf(startSpan);
    if (page === null || page !== pageOf(endSpan)) {
      // Cross-page selections are out of scope for the prototype.
      send({ type: 'selection', empty: true });
      return;
    }

    var start = parseInt(startSpan.dataset.start, 10) + range.startOffset;
    var end = parseInt(endSpan.dataset.start, 10) + range.endOffset;
    if (end < start) { var swap = start; start = end; end = swap; }
    if (end === start) { send({ type: 'selection', empty: true }); return; }

    var text = selection.toString();
    send({
      type: 'selection',
      page: page,
      startOffset: start,
      endOffset: end,
      // Preview only, for the button label. Never persisted - see the schema.
      preview: text.length > 60 ? text.slice(0, 60) + '\\u2026' : text,
    });
  }, 180);

  document.addEventListener('selectionchange', reportSelection);

  // ------------------------------------------------------------ highlights

  function rangeFor(page, startOffset, endOffset) {
    var startSpan = null, endSpan = null;
    var startWithin = 0, endWithin = 0;

    for (var i = 0; i < page.spans.length; i++) {
      var span = page.spans[i];
      if (!startSpan && startOffset < span.end) {
        startSpan = span;
        startWithin = Math.max(0, startOffset - span.start);
      }
      if (endOffset <= span.end) {
        endSpan = span;
        endWithin = Math.max(0, Math.min(endOffset - span.start, span.end - span.start));
        break;
      }
    }
    if (!startSpan) return null;
    if (!endSpan) {
      endSpan = page.spans[page.spans.length - 1];
      endWithin = endSpan ? endSpan.end - endSpan.start : 0;
    }

    var startNode = startSpan.node.firstChild || startSpan.node;
    var endNode = endSpan.node.firstChild || endSpan.node;
    if (!startNode || !endNode) return null;

    var range = document.createRange();
    try {
      range.setStart(startNode, Math.min(startWithin, (startNode.textContent || '').length));
      range.setEnd(endNode, Math.min(endWithin, (endNode.textContent || '').length));
    } catch (e) {
      return null;
    }
    return range;
  }

  window.applyHighlights = function (items) {
    pendingHighlights = items || [];
    if (pages.length === 0) return;

    for (var p = 0; p < pages.length; p++) pages[p].hlLayer.innerHTML = '';

    for (var i = 0; i < pendingHighlights.length; i++) {
      var item = pendingHighlights[i];
      var page = null;
      for (var j = 0; j < pages.length; j++) {
        if (pages[j].pageNumber === item.page) { page = pages[j]; break; }
      }
      if (!page) continue;

      var range = rangeFor(page, item.startOffset, item.endOffset);
      if (!range) continue;

      var pageBox = page.container.getBoundingClientRect();
      var rects = range.getClientRects();
      for (var r = 0; r < rects.length; r++) {
        var rect = rects[r];
        if (rect.width <= 0 || rect.height <= 0) continue;
        var mark = document.createElement('div');
        mark.className = 'hlRect';
        mark.style.left = (rect.left - pageBox.left) + 'px';
        mark.style.top = (rect.top - pageBox.top) + 'px';
        mark.style.width = rect.width + 'px';
        mark.style.height = rect.height + 'px';
        mark.style.background = item.color || 'yellow';
        page.hlLayer.appendChild(mark);
      }
    }
  };

  window.goToPage = function (pageNumber) {
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].pageNumber === pageNumber) {
        pages[i].container.scrollIntoView({ block: 'start' });
        return;
      }
    }
  };

  // ---------------------------------------------------------- page tracking

  var reportPage = debounce(function () {
    var middle = window.innerHeight / 2;
    var best = null, bestDistance = Infinity;
    for (var i = 0; i < pages.length; i++) {
      var box = pages[i].container.getBoundingClientRect();
      var distance = Math.abs((box.top + box.height / 2) - middle);
      if (box.bottom > 0 && box.top < window.innerHeight && distance < bestDistance) {
        bestDistance = distance;
        best = pages[i].pageNumber;
      }
    }
    if (best !== null && best !== currentPage) {
      currentPage = best;
      send({ type: 'page', page: best });
    }
  }, 200);

  window.addEventListener('scroll', reportPage, { passive: true });

  // ----------------------------------------------------------------- start

  var data;
  try {
    data = base64ToBytes(window.__PDF_BASE64__ || '');
  } catch (e) {
    send({ type: 'error', message: 'Could not decode the PDF: ' + e.message });
    return;
  }

  var document_ = null;
  var renderedWidth = 0;

  function availableWidth() {
    return Math.min(document.documentElement.clientWidth - 16, 820);
  }

  function renderAll(pdf, width, announce) {
    document.getElementById('viewer').innerHTML = '';
    pages = [];
    renderedWidth = width;

    var chain = Promise.resolve();
    for (var n = 1; n <= pdf.numPages; n++) {
      (function (pageNumber) {
        chain = chain.then(function () { return renderPage(pdf, pageNumber, width); });
      })(n);
    }
    return chain.then(function () {
      document.getElementById('status').style.display = 'none';
      pages.sort(function (a, b) { return a.pageNumber - b.pageNumber; });
      if (announce) send({ type: 'ready', pageCount: pdf.numPages });
      if (pendingHighlights.length) window.applyHighlights(pendingHighlights);
    });
  }

  // Rotating the device changes the page width, so everything is laid out again
  // and the reader is returned to the page it was on.
  var handleResize = debounce(function () {
    var width = availableWidth();
    if (!document_ || Math.abs(width - renderedWidth) < 8) return;
    var restoreTo = currentPage;
    renderAll(document_, width, false).then(function () {
      window.goToPage(restoreTo);
    });
  }, 350);

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);

  pdfjsLib.getDocument({
    data: data,
    // The PDF uses the base-14 fonts, so pdf.js needs the Liberation Sans data.
    // It was cached next to this file during Download, so this stays offline.
    standardFontDataUrl: './standard_fonts/',
  }).promise.then(function (pdf) {
    document_ = pdf;
    return renderAll(pdf, availableWidth(), true);
  }).catch(function (error) {
    document.getElementById('status').textContent = 'Could not open the PDF.';
    send({ type: 'error', message: String(error && error.message ? error.message : error) });
  });
})();
</script>
</body>
</html>`;
}
