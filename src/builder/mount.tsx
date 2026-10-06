import { createRoot, type Root } from 'react-dom/client';
import OrderForm from './OrderForm';

type Host = HTMLElement & { __byo?: Root };

export function mountBuilder(el: HTMLElement) {
  const host = el as Host;
  el.hidden = false;
  if (!host.__byo) host.__byo = createRoot(el);
  host.__byo.render(<OrderForm />);
}
