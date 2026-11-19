/*
  One download per film poster. The video poster and the passage still
  share the blob, so a cache-busted reload does not fetch the file twice.
*/
const pending = new Map<string, Promise<string>>();
const ready = new Map<string, string>();

type PosterWindow = Window & { __auraPosters?: Map<string, Promise<string>> };

/** A page may start this fetch from an inline script, before the bundle runs. */
function seededPoster(src: string): Promise<string> | null {
  if (typeof window === 'undefined') return null;
  return (window as PosterWindow).__auraPosters?.get(src) ?? null;
}

export function readyPoster(src: string): string | null {
  return ready.get(src) ?? null;
}

function holdMatchingImages(src: string) {
  if (typeof document === 'undefined') return;
  const vh = window.innerHeight || 1;
  for (const img of document.querySelectorAll('img')) {
    if (img.getAttribute('src') !== src) continue;
    if (img.complete && img.naturalWidth > 0) continue;
    const box = img.getBoundingClientRect();
    if (box.top < vh && box.bottom > 0) continue;
    img.dataset.posterSrc = src;
    img.removeAttribute('src');
  }
}

function paintMatchingImages(src: string, blobUrl: string) {
  if (typeof document === 'undefined') return;
  for (const img of document.querySelectorAll('img')) {
    if (img.dataset.posterSrc !== src) continue;
    img.src = blobUrl;
  }
}

function restoreMatchingImages(src: string) {
  if (typeof document === 'undefined') return;
  for (const img of document.querySelectorAll('img')) {
    if (img.dataset.posterSrc !== src || img.getAttribute('src')) continue;
    img.src = src;
  }
}

const AVIF_KEY = 'aura-avif';

export function avifBlocked(): boolean {
  try {
    return sessionStorage.getItem(AVIF_KEY) === '0';
  } catch {
    return false;
  }
}

function rememberAvif(ok: boolean) {
  try {
    sessionStorage.setItem(AVIF_KEY, ok ? '1' : '0');
  } catch {
    /* private windows still finish this visit */
  }
}

function webpSibling(src: string): string {
  return src.replace(/\.avif$/i, '.webp');
}

/** The URL to fetch. Cached "no AVIF" uses the WebP that stayed on disk. */
export function posterRequestUrl(src: string): string {
  if (src.endsWith('.avif') && avifBlocked()) return webpSibling(src);
  return src;
}

let detecting = false;
function detectAvif() {
  if (detecting || typeof document === 'undefined') return;
  try {
    if (sessionStorage.getItem(AVIF_KEY) !== null) return;
  } catch {
    return;
  }
  detecting = true;
  const img = new Image();
  img.onload = () => rememberAvif(img.naturalWidth > 0);
  img.onerror = () => rememberAvif(false);
  img.src = 'data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACAAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAobWRhdBIACgc4AAaQENBpMhMZQmMEw88880EgAJBBGex24O9g=';
}

function fetchPoster(src: string): Promise<Blob> {
  detectAvif();
  const url = posterRequestUrl(src);
  const pull = (target: string) =>
    fetch(target, { credentials: 'same-origin', priority: 'high' } as RequestInit).then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.blob();
    });
  return pull(url).catch((error: unknown) => {
    if (!url.endsWith('.avif')) throw error;
    rememberAvif(false);
    return pull(webpSibling(url));
  });
}

export function posterBlob(src: string): Promise<string> {
  const have = ready.get(src);
  if (have) {
    paintMatchingImages(src, have);
    return Promise.resolve(have);
  }
  const existing = pending.get(src);
  if (existing) return existing;
  holdMatchingImages(src);
  const seeded = seededPoster(src);
  if (seeded) {
    const task = seeded.then((url) => {
      ready.set(src, url);
      pending.delete(src);
      paintMatchingImages(src, url);
      return url;
    });
    pending.set(src, task);
    task.catch(() => {
      if (pending.get(src) === task) {
        pending.delete(src);
        restoreMatchingImages(src);
      }
    });
    return task;
  }
  const task = fetchPoster(src)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      ready.set(src, url);
      pending.delete(src);
      paintMatchingImages(src, url);
      return url;
    });
  pending.set(src, task);
  task.catch(() => {
    if (pending.get(src) === task) {
      pending.delete(src);
      restoreMatchingImages(src);
    }
  });
  return task;
}
