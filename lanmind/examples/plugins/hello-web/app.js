/* global LanMind */
(() => {
  const element = id => document.getElementById(id);
  const text = {
    'zh-CN': { title: '网页插件示例', draftLabel: '草稿 / 新建标题', save: '保存草稿', tasks: '读取任务', createTask: '创建个人任务', wiki: '读取文档', createWiki: '创建文档', saved: '已保存', empty: '请先输入标题', failed: '操作失败' },
    'en-US': { title: 'Web Plugin Example', draftLabel: 'Draft / new item title', save: 'Save draft', tasks: 'Read tasks', createTask: 'Create personal task', wiki: 'Read documents', createWiki: 'Create document', saved: 'Saved', empty: 'Enter a title first', failed: 'Operation failed' },
  };
  let labels = text['zh-CN'];
  async function run(action) {
    const buttons = [...document.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; }); element('status').textContent = '';
    try { const result = await action(); if (result !== undefined) element('output').textContent = JSON.stringify(result, null, 2); }
    catch (error) { element('status').textContent = `${labels.failed}: ${error.code || error.message}`; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  const title = () => { const value = element('draft').value.trim(); if (!value) throw new Error(labels.empty); return value; };
  async function appearance(context) {
    labels = text[context.locale] || text['zh-CN']; for (const id of ['title', 'draftLabel', 'save', 'tasks', 'createTask', 'wiki', 'createWiki']) element(id).textContent = labels[id];
    element('scope').textContent = `${context.workspaceName} · ${context.userId}`;
  }
  window.addEventListener('lanmind:context', event => { void appearance(event.detail); });
  element('save').onclick = () => run(async () => { await LanMind.storage.set('draft', element('draft').value); element('status').textContent = labels.saved; });
  element('tasks').onclick = () => run(() => LanMind.tasks.list({ limit: 20 }));
  element('createTask').onclick = () => run(() => LanMind.tasks.create({ title: title() }));
  element('wiki').onclick = () => run(() => LanMind.wiki.list({ limit: 20 }));
  element('createWiki').onclick = () => run(() => LanMind.wiki.create({ title: title(), content: '' }));
  void run(async () => { await appearance(await LanMind.context.get()); element('draft').value = await LanMind.storage.get('draft') || ''; });
})();
