// Pull in the `Window.webxdc` global augmentation — @webxdc/types' main entry
// only exports the interface, the global lives in a side file nothing imports.
/// <reference types="@webxdc/types/global" />

// y-webxdc ships no type definitions; declare the minimal surface we use.
// The package's only export is the default `WebxdcProvider` class
// (the README's named import is wrong for the published 1.2.0 build).
declare module 'y-webxdc' {
  import type { Doc } from 'yjs';

  export default class WebxdcProvider {
    constructor(opts: {
      webxdc: typeof window.webxdc;
      ydoc: Doc;
      getEditInfo: () => { document: string; summary: string; startinfo: string };
      autosaveInterval: number;
    });
    on(event: 'sync', handler: (e: { hasQueued: boolean }) => void): void;
  }
}
