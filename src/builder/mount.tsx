import { createRoot, type Root } from 'react-dom/client';
import BuilderJourney from './BuilderJourney';
import '../styles/builder.css';

type Host = HTMLElement & { __byo?: Root };

export function mountBuilder(el: HTMLElement) {
  const host = el as Host;
  el.hidden = false;
  if (!host.__byo) host.__byo = createRoot(el);
  host.__byo.render(<BuilderJourney />);
}
