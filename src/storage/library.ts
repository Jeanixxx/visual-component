/**
 * Biblioteca local: solo se guardan los análisis marcados con estrella.
 * Usa IndexedDB del navegador. Nada sale del dispositivo.
 *
 * Si el navegador no permite IndexedDB (modo privado, datos bloqueados),
 * las operaciones lanzan un error que la interfaz muestra al usuario.
 */
import type { Analysis } from "../model/schema";

const DB_NAME = "amper";
const DB_VERSION = 1;
const STORE = "analyses";

export class LibraryError extends Error {}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new LibraryError("Este navegador no permite guardar datos localmente."));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      reject(new LibraryError("No se pudo abrir el almacenamiento local."));
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new LibraryError("No se pudo abrir el almacenamiento local."));
    req.onblocked = () => reject(new LibraryError("El almacenamiento local está ocupado en otra pestaña."));
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T | undefined;
    const req = run(store);
    if (req) {
      req.onsuccess = () => {
        result = req.result as T;
      };
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(new LibraryError("No se pudo guardar en el almacenamiento local."));
    };
    tx.onabort = () => {
      db.close();
      reject(new LibraryError("La operación se canceló en el almacenamiento local."));
    };
  });
}

export async function listSaved(): Promise<Analysis[]> {
  const db = await openDb();
  return new Promise<Analysis[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      db.close();
      resolve((req.result as Analysis[]).filter((a) => a.starred));
    };
    req.onerror = () => {
      db.close();
      reject(new LibraryError("No se pudo leer el almacenamiento local."));
    };
  });
}

/** Guarda o actualiza un análisis con estrella. */
export async function saveStarred(analysis: Analysis): Promise<void> {
  await transact("readwrite", (store) => store.put({ ...analysis, starred: true }));
}

export async function removeSaved(id: string): Promise<void> {
  await transact("readwrite", (store) => store.delete(id));
}
