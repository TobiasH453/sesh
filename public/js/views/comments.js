import { h, ago, link, replace, toast } from '../h.js';
import { api } from '../api.js';
import { icon } from '../icons.js';

export function openComments(video, onCount) {
  const list = h('div.sheet-body');
  const title = h('span.label', 'Comments');
  const input = h('input.input', { placeholder: 'Add a comment', maxlength: 300, enterkeyhint: 'send' });
  const sendBtn = h('button.btn.primary', { type: 'submit' }, 'Send');
  let comments = [];

  function close() {
    backdrop.remove();
    sheet.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', close);
  }
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  window.addEventListener('popstate', close);

  function row(c) {
    return h('div.comment',
      h('div.body',
        h('div.who', link(`/u/${c.author.handle}`, { onClick: close }, c.author.handle), h('span', ago(c.created_at))),
        c.body,
      ),
      c.canDelete && h('button.del', {
        async onClick() {
          await api.del(`/api/comments/${c.id}`);
          comments = comments.filter((x) => x !== c);
          draw();
        },
      }, 'del'),
    );
  }

  function draw() {
    title.textContent = `Comments ${comments.length}`;
    onCount(comments.length);
    replace(list, comments.length ? comments.map(row) : h('div.empty', 'No comments yet. Be first.'));
    list.scrollTop = list.scrollHeight;
  }

  const form = h('form.sheet-foot', {
    async onSubmit(e) {
      e.preventDefault();
      const body = input.value.trim();
      if (!body) return;
      sendBtn.disabled = true;
      try {
        const { comment } = await api.post(`/api/videos/${video.id}/comments`, { body });
        comments.push(comment);
        input.value = '';
        draw();
      } catch (err) {
        toast(err.message);
      } finally {
        sendBtn.disabled = false;
      }
    },
  }, input, sendBtn);

  const backdrop = h('div.sheet-backdrop', { onClick: close });
  const sheet = h('div.sheet', { role: 'dialog', 'aria-label': 'Comments' },
    h('div.sheet-head', title, h('div.spacer'), h('button.icon-btn', { onClick: close, 'aria-label': 'Close' }, icon('close'))),
    list,
    form,
  );
  document.body.append(backdrop, sheet);
  replace(list, h('div.empty', 'Loading'));

  api.get(`/api/videos/${video.id}/comments`).then((r) => {
    comments = r.comments;
    draw();
  }).catch((err) => replace(list, h('div.empty', err.message)));
}
