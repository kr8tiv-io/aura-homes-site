/// <reference types="astro/client" />

import type Lenis from 'lenis';

declare global {
  interface Window {
    __lenis?: Lenis;
    __ScrollTrigger?: {
      getAll(): Array<{
        start: number;
        end: number;
        progress: number;
        trigger: Element | null;
        pin: Element | boolean | null;
      }>;
      refresh(safe?: boolean): void;
    };
  }
}

export {};
