// @webxdc/vite-plugins ships no type definitions; declare the one plugin
// vite.config.ts uses. It returns a standard Vite plugin.
declare module '@webxdc/vite-plugins' {
  export function mockWebxdc(): import('vite').PluginOption;
}
