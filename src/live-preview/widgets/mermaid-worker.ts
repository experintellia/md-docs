import { PeleError, render } from 'pele';

// Diagrams come from other chat members, and Pele can bound their size but not
// their running time: https://pele.run/security says to render in a worker the
// app can terminate. widgets/mermaid.ts does.
//
// ponytail: the whole of Pele, not `pele/lazy`: a classic worker is one file,
// and a module worker, which could load diagram types on demand, needs Safari
// 15 where the build targets 14. It still loads only with the first diagram.
self.addEventListener('message', ({ data: source }: MessageEvent<string>) => {
  try {
    // The links of a diagram are off, since a tap opens its source; images
    // too, which could fetch from the network when shown.
    self.postMessage({ svg: render(source, { links: false, images: false }).svg });
  } catch (error) {
    // A PeleError's message can quote the diagram: the widget shows it as
    // text, never as markup.
    self.postMessage({ error: error instanceof PeleError ? error.message : 'Could not draw this diagram' });
  }
});
