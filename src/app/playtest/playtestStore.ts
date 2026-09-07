import type { PlaytestSessionFile } from '@core/playtest/types';

const DB_NAME = 'music-director-playtest';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

export interface StoredPlaytestSession extends PlaytestSessionFile {
  storedAt: string;
  id?: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('storedAt', 'storedAt', { unique: false });
        store.createIndex('endReason', 'session.endReason', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      void run(store).then(resolve, reject);
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function savePlaytestSession(
  session: PlaytestSessionFile,
): Promise<number> {
  const record: StoredPlaytestSession = {
    ...session,
    storedAt: new Date().toISOString(),
  };
  return withStore('readwrite', (store) =>
    new Promise<number>((resolve, reject) => {
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error ?? new Error('indexedDB add failed'));
    }),
  );
}

export async function countPlaytestSessions(): Promise<number> {
  return withStore('readonly', (store) =>
    new Promise<number>((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB count failed'));
    }),
  );
}

export async function listPlaytestSessions(): Promise<StoredPlaytestSession[]> {
  return withStore('readonly', (store) =>
    new Promise<StoredPlaytestSession[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as StoredPlaytestSession[]);
      request.onerror = () => reject(request.error ?? new Error('indexedDB getAll failed'));
    }),
  );
}

export async function clearPlaytestSessions(): Promise<void> {
  return withStore('readwrite', (store) =>
    new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(request.error ?? new Error('indexedDB clear failed'));
    }),
  );
}

export interface PlaytestExportBundle {
  exportedAt: string;
  buildVersion: string;
  buildSeq: number;
  count: number;
  sessions: StoredPlaytestSession[];
}

export function createPlaytestExportBundle(
  sessions: StoredPlaytestSession[],
  buildVersion: string,
  buildSeq: number,
): PlaytestExportBundle {
  return {
    exportedAt: new Date().toISOString(),
    buildVersion,
    buildSeq,
    count: sessions.length,
    sessions,
  };
}

export function downloadPlaytestSessionsExport(
  sessions: StoredPlaytestSession[],
  fileName = 'playtest-export.json',
  meta?: { buildVersion: string; buildSeq: number },
): void {
  const payload = meta
    ? createPlaytestExportBundle(sessions, meta.buildVersion, meta.buildSeq)
    : {
        exportedAt: new Date().toISOString(),
        count: sessions.length,
        sessions,
      };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function attachSurveyToSession(
  draft: Omit<PlaytestSessionFile, 'survey' | 'context'>,
  survey: PlaytestSessionFile['survey'],
  context: PlaytestSessionFile['context'],
): PlaytestSessionFile {
  return {
    ...draft,
    survey,
    context,
  };
}
