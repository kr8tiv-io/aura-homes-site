/** Floating labels, and the quiet check drawn after a form is accepted. */

function controlOf(field: Element): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  const control = field.querySelector('input, textarea, select');
  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
    return control;
  }
  return null;
}

function syncField(field: HTMLElement) {
  const control = controlOf(field);
  if (!control || control.classList.contains('join-hp')) return;
  field.classList.toggle('is-set', control.value.trim() !== '');
}

export function bindFields(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.field').forEach((field) => {
    if (field.dataset.fieldBound === 'yes') return;
    const control = controlOf(field);
    if (!control || control.classList.contains('join-hp')) return;
    field.dataset.fieldBound = 'yes';
    const sync = () => syncField(field);
    sync();
    control.addEventListener('input', sync);
    control.addEventListener('change', sync);
    control.addEventListener('animationstart', (event) => {
      if (event.animationName === 'field-autofill') field.classList.add('is-set');
    });
    const form = control.form;
    if (form && form.dataset.resetBound !== 'yes') {
      form.dataset.resetBound = 'yes';
      form.addEventListener('reset', () => {
        requestAnimationFrame(() => {
          form.querySelectorAll<HTMLElement>('.field').forEach(syncField);
        });
      });
    }
  });
}

export function clearSentMark(host: HTMLElement) {
  host.classList.remove('is-sent');
  host.querySelector(':scope > .sent-mark')?.remove();
}

export function showSentMark(host: HTMLElement) {
  let mark = host.querySelector(':scope > .sent-mark');
  if (!(mark instanceof HTMLElement)) {
    mark = document.createElement('span');
    mark.className = 'sent-mark';
    mark.setAttribute('aria-hidden', 'true');
    const short = document.createElement('span');
    short.className = 'sent-short';
    const long = document.createElement('span');
    long.className = 'sent-long';
    mark.append(short, long);
    host.append(mark);
  }
  host.classList.remove('is-sent');
  void host.offsetWidth;
  host.classList.add('is-sent');
}
