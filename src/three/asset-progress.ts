/*
  Byte progress for the passage loader.

  Three.js loads GLB, KTX2, and HDR through XMLHttpRequest. The meadow
  atlas uses fetch. While a session is open, those responses report
  loaded and total bytes (Content-Length or a lengthComputable progress
  event). The ratio is loaded/total across the session. It does not
  advance on a timer. Unknown lengths reserve a small remainder so the
  line cannot finish while a body is still open.
*/

const ASSET = /\/(?:models|hdri|textures|decoders)\/.+\.(?:glb|ktx2|hdr|bin|json|jpg|jpeg|png|webp|wasm|js)(?:\?|$)/i;

type Track = {
  loaded: number;
  total: number;
  done: boolean;
  known: boolean;
};

type Session = {
  tracks: Set<Track>;
  listeners: Set<(ratio: number) => void>;
  closed: boolean;
};

type TaggedXhr = XMLHttpRequest & { __auraUrl?: string; __auraMethod?: string };

const sessions = new Set<Session>();
let installed = false;

function publish(session: Session) {
  const value = session.closed ? 1 : ratioOf(session);
  for (const listener of session.listeners) listener(value);
}

function ratioOf(session: Session): number {
  const tracks = [...session.tracks];
  if (!tracks.length) return 0;
  if (tracks.every((track) => track.done)) return 1;
  let loaded = 0;
  let total = 0;
  for (const track of tracks) {
    const piece = track.known && track.total > 0
      ? track.total
      : track.done
        ? Math.max(track.loaded, 1)
        : Math.max(track.loaded, 64 * 1024);
    loaded += Math.min(track.loaded, piece);
    total += piece;
  }
  if (total <= 0) return 0;
  return Math.min(0.98, loaded / total);
}

function attach(): Track {
  const track: Track = { loaded: 0, total: 0, done: false, known: false };
  for (const session of sessions) {
    if (!session.closed) session.tracks.add(track);
  }
  return track;
}

function touch(track: Track) {
  for (const session of sessions) {
    if (session.tracks.has(track)) publish(session);
  }
}

function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (this: TaggedXhr, method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    this.__auraUrl = String(url);
    this.__auraMethod = String(method);
    return xhrOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };
  XMLHttpRequest.prototype.send = function (this: TaggedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = this.__auraUrl || '';
    const method = (this.__auraMethod || 'GET').toUpperCase();
    if (method !== 'HEAD' && ASSET.test(url) && sessions.size > 0) {
      const track = attach();
      this.addEventListener('progress', (event) => {
        const progress = event as ProgressEvent;
        track.loaded = progress.loaded;
        if (progress.lengthComputable && progress.total > 0) {
          track.total = progress.total;
          track.known = true;
        }
        touch(track);
      });
      this.addEventListener('loadend', () => {
        track.done = true;
        if (!track.known) track.total = Math.max(track.loaded, 1);
        if (track.loaded <= 0) track.loaded = track.total || 1;
        touch(track);
      });
    }
    return xhrSend.call(this, body);
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'HEAD' || !ASSET.test(url) || sessions.size === 0) return nativeFetch(input, init);
    const track = attach();
    const response = await nativeFetch(input, init);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > 0) {
      track.total = declared;
      track.known = true;
    }
    if (!response.body) {
      track.done = true;
      track.loaded = Math.max(track.total, 1);
      track.total = track.loaded;
      touch(track);
      return response;
    }
    const reader = response.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const step = await reader.read();
          if (step.done) {
            track.done = true;
            if (!track.known) track.total = Math.max(track.loaded, 1);
            if (track.loaded <= 0) track.loaded = track.total || 1;
            controller.close();
          } else if (step.value) {
            track.loaded += step.value.byteLength;
            controller.enqueue(step.value);
          }
        } catch (error) {
          track.done = true;
          controller.error(error);
        }
        touch(track);
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export type LoadSession = {
  subscribe: (listener: (ratio: number) => void) => () => void;
  close: () => void;
};

/** Count asset bytes that start while this session is open. */
export function openLoadSession(): LoadSession {
  install();
  const session: Session = { tracks: new Set(), listeners: new Set(), closed: false };
  sessions.add(session);
  return {
    subscribe(listener) {
      session.listeners.add(listener);
      listener(ratioOf(session));
      return () => session.listeners.delete(listener);
    },
    close() {
      if (session.closed) return;
      session.closed = true;
      publish(session);
      sessions.delete(session);
    },
  };
}
