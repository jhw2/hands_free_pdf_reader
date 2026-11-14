export type SavedSong = {
  id: string;
  fileName: string;
  blob: Blob;
  youtubeUrl: string;
  bpm: number;
  beatsPerMeasure: number;
  offset: number;
  updatedAt: number;
};

let database: Promise<IDBDatabase> | undefined;
const openLibrary = () => database ??= new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("score-sync-cache", 2);
  request.onupgradeneeded = () => {
    for (const name of ["session", "songs"]) {
      if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    }
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => { request.result.close(); database = undefined; };
    resolve(request.result);
  };
  request.onerror = () => { database = undefined; reject(request.error); };
  request.onblocked = () => { database = undefined; reject(new Error("다른 탭을 닫은 뒤 다시 시도해 주세요.")); };
});

const completed = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error ?? new Error("저장을 완료하지 못했어요."));
});

export async function readLibrary() {
  const db = await openLibrary();
  const transaction = db.transaction(["songs", "session"], "readwrite");
  const done = completed(transaction);
  const songs = transaction.objectStore("songs");
  const session = transaction.objectStore("session");
  const all = songs.getAll();
  const active = session.get("active-song");
  const migrated = session.get("library-migrated");
  const previous = session.get("last-pdf");
  let imported: SavedSong | undefined;
  previous.onsuccess = () => {
    if (migrated.result || all.result.length || !previous.result?.blob) return;
    let metadata: Partial<SavedSong> = {};
    try { metadata = JSON.parse(localStorage.getItem("score-sync:last-session") ?? "{}") ?? {}; } catch { /* Preserve the PDF even if old settings are unreadable. */ }
    imported = {
      id: "legacy-score", blob: previous.result.blob,
      fileName: previous.result.fileName || "저장된 악보.pdf",
      youtubeUrl: typeof metadata.youtubeUrl === "string" ? metadata.youtubeUrl : "",
      bpm: typeof metadata.bpm === "number" && metadata.bpm >= 30 && metadata.bpm <= 300 ? metadata.bpm : 120,
      beatsPerMeasure: typeof metadata.beatsPerMeasure === "number" && metadata.beatsPerMeasure >= 2 && metadata.beatsPerMeasure <= 12 ? metadata.beatsPerMeasure : 4,
      offset: typeof metadata.offset === "number" && metadata.offset >= 0 ? metadata.offset : 0,
      updatedAt: Date.now(),
    };
    songs.put(imported, imported.id);
    session.put(imported.id, "active-song");
  };
  session.put(true, "library-migrated");
  await done;
  return { songs: imported ? [imported] : (all.result as SavedSong[]).sort((a, b) => b.updatedAt - a.updatedAt), activeId: imported?.id ?? active.result as string | undefined };
}

export async function saveSong(song: SavedSong, activate = false) {
  const db = await openLibrary();
  const transaction = db.transaction(["songs", "session"], "readwrite");
  const done = completed(transaction);
  transaction.objectStore("songs").put(song, song.id);
  if (activate) transaction.objectStore("session").put(song.id, "active-song");
  await done;
}

export async function activateSong(id: string) {
  const db = await openLibrary();
  const transaction = db.transaction("session", "readwrite");
  const done = completed(transaction);
  transaction.objectStore("session").put(id, "active-song");
  await done;
}

export async function deleteSong(id: string) {
  const db = await openLibrary();
  const transaction = db.transaction(["songs", "session"], "readwrite");
  const done = completed(transaction);
  transaction.objectStore("songs").delete(id);
  const session = transaction.objectStore("session");
  const active = session.get("active-song");
  active.onsuccess = () => { if (active.result === id) session.delete("active-song"); };
  await done;
}
