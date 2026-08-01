declare module 'gif.js' {
  interface GIFOptions {
    workers?: number;
    quality?: number;
    width?: number;
    height?: number;
    workerScript?: string;
    repeat?: number;
  }
  interface AddFrameOptions {
    delay?: number;
    copy?: boolean;
  }
  export default class GIF {
    constructor(options?: GIFOptions);
    addFrame(source: CanvasRenderingContext2D | CanvasImageSource, options?: AddFrameOptions): void;
    on(event: 'finished', cb: (blob: Blob) => void): void;
    on(event: 'progress', cb: (progress: number) => void): void;
    render(): void;
  }
}

declare module 'gif.js/dist/gif.worker.js?url' {
  const url: string;
  export default url;
}
