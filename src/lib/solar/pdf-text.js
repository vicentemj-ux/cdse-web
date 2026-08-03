function looksLikeReadableCfeText(text) {
  if (!text || text.length < 80) return false;
  const normalized = text.toLocaleUpperCase('es-MX');
  const expectedTokens = [
    /NO\.?\s*DE\s*SERVICIO/,
    /PERIODO\s+FACTURADO/,
    /CONSUMO\s+HIST[ÓO]RICO/,
    /ENERG[ÍI]A\s*\(KWH\)/,
  ];
  const hasIdentityAndPeriod = expectedTokens[0].test(normalized) && expectedTokens[1].test(normalized);
  const tokenCount = expectedTokens.filter((pattern) => pattern.test(normalized)).length;
  return hasIdentityAndPeriod || tokenCount >= 3;
}

function hasCorruptedTextLayer(text) {
  if (!text) return true;
  // Illustrator exports used by some CFE receipts expose custom glyphs as
  // literal (cid:NNN) tokens. The visible PDF looks correct, but parsing that
  // layer produces incomplete service numbers and history rows.
  const cidTokens = text.match(/\(cid:\d+\)/gi) ?? [];
  const replacementChars = (text.match(/[\uFFFD]/g) ?? []).length;
  return cidTokens.length >= 4 || replacementChars >= 2;
}

async function readPdfText(file) {
  const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = workerUrl;

  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await loadingTask.promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) =>
          'str' in item
            ? `${item.str}${item.hasEOL ? '\n' : ' '}`
            : '',
        )
        .filter(Boolean)
        .join(''),
    );
  }

  return { text: pages.join('\n'), document };
}

async function ocrPdf(pdfDocument, onProgress) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('spa', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
        onProgress?.(message.progress);
      }
    },
  });

  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      // CFE's illustrated PDFs often render the history table in very small
      // type. A higher raster scale keeps that table readable on mobile OCR.
      const viewport = page.getViewport({ scale: 2.8 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas.toDataURL('image/png'));
      pages.push(result.data.text);
      canvas.width = 1;
      canvas.height = 1;
    }
    return pages.join('\n');
  } finally {
    await worker.terminate();
  }
}

async function ocrImage(file, onProgress) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('spa', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
        onProgress?.(message.progress);
      }
    },
  });
  try {
    const result = await worker.recognize(file);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

/**
 * Reads a CFE PDF text layer and falls back to Spanish OCR when the PDF uses
 * a custom font without a usable ToUnicode map (common in illustrated CFE PDFs).
 */
export async function extractPdfText(file, { onProgress } = {}) {
  const { text, document } = await readPdfText(file);
  if (looksLikeReadableCfeText(text) && !hasCorruptedTextLayer(text)) return text;
  return ocrPdf(document, onProgress);
}

/**
 * Extracts a CFE receipt from either a PDF or a camera photo. Photos use the
 * same Spanish OCR fallback as scanned/illustrated PDFs, so the seller can
 * correct the result instead of starting over when a photo is blurry.
 */
export async function extractReceiptText(file, { onProgress } = {}) {
  if (file?.type?.startsWith('image/')) return ocrImage(file, onProgress);
  return extractPdfText(file, { onProgress });
}
