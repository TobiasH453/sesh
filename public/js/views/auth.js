import { h } from '../h.js';
import { api } from '../api.js';

export function AuthView({ onDone }) {
  let mode = 'login';
  const handle = h('input.input', { name: 'handle', autocomplete: 'username', autocapitalize: 'off', spellcheck: false, placeholder: 'yourname' });
  const password = h('input.input', { name: 'password', type: 'password', autocomplete: 'current-password', placeholder: '••••' });
  const code = h('input.input', { name: 'code', autocomplete: 'off', autocapitalize: 'off', placeholder: 'ask whoever sent you here' });
  const codeField = h('label.field.hidden', h('span.label', 'Invite code'), code);
  const error = h('div.error');
  const submit = h('button.btn.primary.block', { type: 'submit' }, 'Log in');
  const tabs = {
    login: h('button.on', { type: 'button', onClick: () => setMode('login') }, 'Log in'),
    join: h('button', { type: 'button', onClick: () => setMode('join') }, 'Join'),
  };

  function setMode(m) {
    mode = m;
    tabs.login.classList.toggle('on', m === 'login');
    tabs.join.classList.toggle('on', m === 'join');
    codeField.classList.toggle('hidden', m !== 'join');
    password.autocomplete = m === 'join' ? 'new-password' : 'current-password';
    submit.textContent = m === 'join' ? 'Create account' : 'Log in';
    error.textContent = '';
  }

  const form = h('form.stack', {
    async onSubmit(e) {
      e.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        const body = { handle: handle.value.trim(), password: password.value };
        if (mode === 'join') body.code = code.value;
        const { user } = await api.post(mode === 'join' ? '/api/signup' : '/api/login', body);
        onDone(user);
      } catch (err) {
        error.textContent = err.message;
        submit.disabled = false;
      }
    },
  },
    h('div.seg', tabs.login, tabs.join),
    h('label.field', h('span.label', 'Handle'), handle),
    h('label.field', h('span.label', 'Password'), password),
    codeField,
    error,
    submit,
  );

  const el = h('div.page', h('div.auth', h('div.auth-box',
    h('div.wordmark', h('span.mark'), 'sesh'),
    h('p.dim', { style: 'margin:0 0 32px' }, 'Clips and random video calls with the crew. Invite only.'),
    form,
  )));

  return { el, mounted: () => handle.focus() };
}
