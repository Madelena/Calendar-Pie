export type FontChoice = 'inter' | 'open-sans' | 'system' | 'custom';

const SYSTEM_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const FAMILIES = { inter: 'Inter Variable', 'open-sans': 'Open Sans Variable', custom: 'Calendar Pie Custom' };
const MAX_FONT_BYTES = 5 * 1024 * 1024;
const DATABASE = 'calendar-pie-fonts';
const STORE = 'fonts';
const STORAGE_ERROR = 'Your browser could not save or access the custom font. Allow site storage and try again.';
let registeredFont: FontFace | undefined;

interface StoredFont {
  name: string;
  bytes: ArrayBuffer;
}

export function fontStack(choice: FontChoice): string {
  return choice === 'system' ? SYSTEM_STACK : `"${FAMILIES[choice]}", ${SYSTEM_STACK}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const fail = () => {
      finished = true;
      clearTimeout(timeout);
      reject(new Error(STORAGE_ERROR));
    };
    const timeout = setTimeout(fail, 5000);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (finished) {
          request.result.close();
          return;
        }
        finished = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    } catch {
      fail();
    }
  });
}

async function storedFont(value?: StoredFont): Promise<StoredFont | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, value ? 'readwrite' : 'readonly');
      const objectStore = transaction.objectStore(STORE);
      const request = value ? objectStore.put(value, 'custom') : objectStore.get('custom');
      const timeout = setTimeout(() => {
        try { transaction.abort(); } catch { /* The transaction may have already finished. */ }
        reject(new Error(STORAGE_ERROR));
      }, 5000);
      transaction.oncomplete = () => {
        clearTimeout(timeout);
        resolve(value ?? request.result);
      };
      transaction.onabort = transaction.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(STORAGE_ERROR));
      };
    });
  } catch {
    throw new Error(STORAGE_ERROR);
  } finally {
    database.close();
  }
}

async function decodeFont(bytes: ArrayBuffer): Promise<FontFace> {
  try {
    return await new FontFace(FAMILIES.custom, bytes).load();
  } catch {
    throw new Error('This file could not be read as a font. Choose a valid TTF, OTF, WOFF, or WOFF2 file.');
  }
}

function registerFont(font: FontFace): void {
  document.fonts.add(font);
  if (registeredFont) document.fonts.delete(registeredFont);
  registeredFont = font;
}

export async function loadFont(choice: FontChoice): Promise<void> {
  if (choice === 'system') return;
  if (choice === 'custom' && !registeredFont) {
    const saved = await storedFont();
    if (!saved) throw new Error('Choose a custom font file first.');
    registerFont(await decodeFont(saved.bytes));
  }
  await document.fonts.load(`500 15px "${FAMILIES[choice]}"`);
}

export async function installCustomFont(file: File): Promise<void> {
  if (!/\.(ttf|otf|woff|woff2)$/i.test(file.name)) {
    throw new Error('Choose a TTF, OTF, WOFF, or WOFF2 font file.');
  }
  if (file.size === 0) throw new Error('This font file is empty. Choose another file.');
  if (file.size > MAX_FONT_BYTES) throw new Error('Choose a font file smaller than 5 MB.');
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new Error('This font file could not be opened. Choose it again.');
  }
  // Decode and commit before replacing the working face, so a failed import is harmless.
  const font = await decodeFont(bytes);
  await storedFont({ name: file.name, bytes });
  registerFont(font);
}

export async function customFontName(): Promise<string | undefined> {
  return (await storedFont())?.name;
}
