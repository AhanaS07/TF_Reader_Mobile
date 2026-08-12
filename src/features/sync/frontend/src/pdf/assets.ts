import { Directory, File, Paths } from 'expo-file-system';
import {
  BOOK_FILE_URL,
  BOOK_ID,
  PDFJS_LIB_URL,
  PDFJS_STANDARD_FONTS,
  PDFJS_WORKER_URL,
  pdfjsFontUrl,
} from '../config';
import { buildViewerHtml } from './viewerHtml';

/**
 * Everything the reader needs lives in one folder on the device:
 *
 *   <documents>/reader/
 *     book-001.pdf         the book itself
 *     pdf.min.js           the pdf.js runtime, fetched once
 *     pdf.worker.min.js
 *     viewer.html          the page the WebView loads
 *
 * After a single Download the app never needs the network to read.
 */
const READER_DIR = 'reader';

function readerDirectory(): Directory {
  return new Directory(Paths.document, READER_DIR);
}

function ensureDirectory(): Directory {
  const directory = readerDirectory();
  if (!directory.exists) {
    directory.create({ intermediates: true });
  }
  return directory;
}

export interface CachedAssets {
  viewerUri: string;
  pdfUri: string;
  baseDirectoryUri: string;
}

function assetFiles() {
  const directory = readerDirectory();
  const fontDirectory = new Directory(directory, 'standard_fonts');
  return {
    directory,
    fontDirectory,
    pdf: new File(directory, `${BOOK_ID}.pdf`),
    lib: new File(directory, 'pdf.min.js'),
    worker: new File(directory, 'pdf.worker.min.js'),
    viewer: new File(directory, 'viewer.html'),
    fonts: PDFJS_STANDARD_FONTS.map((name) => ({
      name,
      file: new File(fontDirectory, name),
    })),
  };
}

/** True when a previous download left everything needed to read offline. */
export function isBookCached(): boolean {
  const files = assetFiles();
  return (
    files.pdf.exists &&
    files.lib.exists &&
    files.worker.exists &&
    files.viewer.exists &&
    files.fonts.every((font) => font.file.exists)
  );
}

export function cachedAssets(): CachedAssets | null {
  if (!isBookCached()) return null;
  const files = assetFiles();
  return {
    viewerUri: files.viewer.uri,
    pdfUri: files.pdf.uri,
    baseDirectoryUri: files.directory.uri,
  };
}

export function localPdfPath(): string {
  return assetFiles().pdf.uri;
}

/** The PDF bytes, base64 encoded, ready to hand to pdf.js inside the WebView. */
export async function readPdfBase64(): Promise<string> {
  return assetFiles().pdf.base64();
}

/**
 * Fetches to a sibling `.part` file and swaps it in only once the transfer has
 * finished.
 *
 * The obvious version - delete the destination, then download - makes Refresh
 * destructive: with the asset server down or the Wi-Fi gone, it removes the
 * offline copy of the book and then fails, leaving nothing behind. Staging
 * turns a failed refresh into a no-op, which is what a refresh should be.
 */
async function downloadTo(
  url: string,
  directory: Directory,
  filename: string,
): Promise<void> {
  const staging = new File(directory, `${filename}.part`);
  if (staging.exists) {
    staging.delete();
  }

  try {
    await File.downloadFileAsync(url, staging, { idempotent: true });
  } catch (error) {
    if (staging.exists) {
      staging.delete();
    }
    throw error;
  }

  const destination = new File(directory, filename);
  if (destination.exists) {
    destination.delete();
  }
  staging.move(destination);
}

export interface DownloadProgress {
  (step: string): void;
}

/**
 * Fetches the book and the viewer runtime, then writes viewer.html.
 *
 * Requires a network connection - this is the one online step in the whole app.
 */
export async function downloadBookAssets(onStep?: DownloadProgress): Promise<CachedAssets> {
  ensureDirectory();
  const files = assetFiles();

  onStep?.('Downloading the book');
  await downloadTo(BOOK_FILE_URL, files.directory, `${BOOK_ID}.pdf`);

  if (!files.lib.exists) {
    onStep?.('Downloading the viewer');
    await downloadTo(PDFJS_LIB_URL, files.directory, 'pdf.min.js');
  }
  if (!files.worker.exists) {
    onStep?.('Downloading the viewer');
    await downloadTo(PDFJS_WORKER_URL, files.directory, 'pdf.worker.min.js');
  }

  if (!files.fontDirectory.exists) {
    files.fontDirectory.create({ intermediates: true });
  }
  for (const font of files.fonts) {
    if (!font.file.exists) {
      onStep?.('Downloading fonts');
      await downloadTo(pdfjsFontUrl(font.name), files.fontDirectory, font.name);
    }
  }

  onStep?.('Preparing the reader');
  if (files.viewer.exists) {
    files.viewer.delete();
  }
  files.viewer.create();
  files.viewer.write(buildViewerHtml());

  return {
    viewerUri: files.viewer.uri,
    pdfUri: files.pdf.uri,
    baseDirectoryUri: files.directory.uri,
  };
}

/** Removes the cached book so Download can be exercised again. */
export function clearBookAssets(): void {
  const directory = readerDirectory();
  if (directory.exists) {
    directory.delete();
  }
}
