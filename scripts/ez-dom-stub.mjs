/** Lets EZ-Tree's texture preload run under Node. Not used by the site. */
class FakeImage {
  constructor() {
    this.width = 4;
    this.height = 4;
    this.naturalWidth = 4;
    this.naturalHeight = 4;
    this.listeners = {};
    this.style = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener() {}
  setAttribute() {}
  set src(value) {
    this._src = value;
    queueMicrotask(() => {
      for (const fn of this.listeners.load || []) fn({ target: this });
    });
  }
  get src() {
    return this._src || '';
  }
}

function canvas() {
  return {
    width: 4,
    height: 4,
    style: {},
    getContext() {
      return {
        fillRect() {},
        clearRect() {},
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(64) }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray((w || 4) * (h || 4) * 4) }),
        putImageData() {},
      };
    },
    toDataURL: () => 'data:image/png;base64,',
  };
}

const documentStub = {
  createElementNS: () => new FakeImage(),
  createElement: (name) => (name === 'canvas' ? canvas() : new FakeImage()),
};

globalThis.document = documentStub;
globalThis.window = globalThis;
globalThis.HTMLImageElement = FakeImage;
globalThis.Image = FakeImage;
globalThis.self = globalThis;

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onloadend = null;
      this.onload = null;
    }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        const b64 = Buffer.from(buffer).toString('base64');
        this.result = `data:application/octet-stream;base64,${b64}`;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      });
    }
  };
}
