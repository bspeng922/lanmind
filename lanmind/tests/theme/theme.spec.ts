import { expect, test, type Page } from '@playwright/test';
import { contrastIssues } from './contrast';

const themes = ['titanium-light', 'navy-slate', 'aurora-purple', 'cyber-emerald', 'warm-amber'];
const open = async (page: Page, view: string, theme = 'titanium-light') => {
  await page.goto(`/tests/theme/index.html?view=${view}&theme=${theme}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
};

for (const theme of themes) {
  test(`${theme}: project files, search, folder dialog`, async ({page}, info) => {
    await open(page, 'files', theme);
    await expect(page.getByText('项目说明.md')).toBeVisible();
    const panel = page.locator('.project-files-panel');
    await expect(panel).toHaveCSS('background-color', theme === 'titanium-light' ? 'rgb(255, 255, 255)' : theme === 'navy-slate' ? 'rgb(15, 23, 42)' : theme === 'aurora-purple' ? 'rgb(19, 13, 36)' : theme === 'cyber-emerald' ? 'rgb(7, 35, 24)' : 'rgb(28, 25, 23)');
    await page.screenshot({path: info.outputPath('project-files.png')});
    if(theme === 'titanium-light') expect(await contrastIssues(page)).toEqual([]);
    await page.getByPlaceholder('搜索项目文件或目录...').fill('不存在的资料');
    await expect(page.getByText('没有找到匹配的文件或目录')).toBeVisible();
    await page.getByRole('button',{name:'新建目录',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'新建项目目录'});
    const submit = dialog.getByRole('button',{name:'创建目录',exact:true});
    await expect(submit).toBeDisabled();
    await dialog.getByPlaceholder('例如：raw, tmp, docs, reports...').fill('验收资料');
    await expect(submit).toBeEnabled();
    await page.screenshot({path: info.outputPath('create-folder.png')});
    await submit.click();
    await expect(dialog).not.toBeVisible();
    if(theme !== 'titanium-light') {
      await open(page,'chat',theme);
      await expect(page.locator('.chat-bubble-self')).toContainText('已收到');
      await expect(page.locator('.chat-bubble-self')).toHaveCSS('color','rgb(255, 255, 255)');
      await expect(page.locator('.lan-chat-modal')).toHaveCSS('background-color', theme === 'navy-slate' ? 'rgb(15, 23, 42)' : theme === 'aurora-purple' ? 'rgb(19, 13, 36)' : theme === 'cyber-emerald' ? 'rgb(7, 35, 24)' : 'rgb(28, 25, 23)');
      await page.screenshot({path: info.outputPath('chat-dark.png')});
    }
  });
}

test('light controls preserve default, hover, focus, contrast and nested theme', async ({page}, info) => {
  await open(page,'controls');
  const hover = page.getByTestId('hover-only');
  await expect(hover).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await hover.hover();
  await expect(hover).toHaveCSS('background-color','rgb(237, 242, 247)');
  await page.getByLabel('测试输入框').focus();
  await expect(page.getByLabel('测试输入框')).toHaveCSS('outline-style','solid');
  await expect(page.getByRole('button',{name:'主要操作',exact:true})).toHaveCSS('color','rgb(255, 255, 255)');
  const nested = page.getByTestId('nested-theme');
  await expect(nested).toHaveCSS('color','rgb(248, 250, 252)');
  await expect(nested.locator('.chat-bubble-self')).toHaveCSS('color','rgb(255, 255, 255)');
  await expect(nested.locator('.desktop-cal-cell')).toHaveCSS('border-right-color','rgba(255, 255, 255, 0.16)');
  const calendarCheckbox = page.getByRole('checkbox',{name:'日历任务完成状态'});
  await calendarCheckbox.check();
  await expect(calendarCheckbox).toHaveCSS('background-color','rgb(6, 95, 70)');
  await calendarCheckbox.uncheck();
  await expect(calendarCheckbox).toHaveCSS('background-color','rgba(255, 255, 255, 0.9)');
  await page.screenshot({path:info.outputPath('controls.png')});
  expect(await contrastIssues(page)).toEqual([]);
});

test('report switches between markdown content and source tasks', async ({page}) => {
  await open(page, 'report');
  await page.getByRole('button', {name: '生成工作汇报', exact: true}).click();

  const markdown = page.locator('.report-markdown');
  await expect(markdown.getByRole('heading', {name: '本周工作汇报'})).toBeVisible();
  await expect(markdown).toContainText('联调验证完成');

  await page.getByRole('tab', {name: '原始任务 (4)'}).click();
  await expect(page.getByTestId('report-source-tasks')).toContainText('整理项目资料');
  await expect(markdown).not.toBeVisible();

  await page.getByRole('tab', {name: '汇报内容'}).click();
  await expect(markdown).toBeVisible();
});

for(const view of ['markdown','excel','announcement','chat','task','project','settings','report','main','calendar-window','notification','quick-add','group','forward','receipts','chat-files','profile','sync','risk','llm','theme']) {
  test(`light ${view} renders without errors`, async ({page}, info) => {
    if(view === 'notification') await page.setViewportSize({width:420,height:210});
    if(view === 'quick-add') await page.setViewportSize({width:700,height:230});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await open(page,view);
    await page.waitForTimeout(600);
    if(view === 'markdown') {
      await expect(page.locator('.markdown-body')).toContainText('Theme-aware code');
      await expect(page.locator('.token.keyword').first()).toHaveCSS('color','rgb(109, 40, 217)');
    }
    if(view === 'excel') {
      await page.getByRole('cell',{name:'检查明亮主题',exact:true}).click();
      await expect(page.getByRole('cell',{name:'检查明亮主题',exact:true})).toHaveCSS('color','rgb(15, 23, 42)');
    }
    if(view === 'announcement') {
      await page.getByRole('button',{name:'发布公告',exact:true}).click();
      await page.getByPlaceholder('公告标题...').fill('主题验收通知');
      await page.getByPlaceholder('公告正文内容...').fill('公告表单与正文统一使用明亮配色。');
    }
    await page.screenshot({path:info.outputPath(`${view}.png`)});
    expect(await page.locator('#root').innerText()).not.toBe('');
    if(!['calendar-window','notification','quick-add'].includes(view)) expect(await contrastIssues(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('theme preference persists, follows OS and propagates between windows', async ({page, context}) => {
  await open(page,'controls');
  const other = await context.newPage();
  await other.goto('/tests/theme/index.html?view=controls');
  await page.getByRole('button',{name:'钛白明亮',exact:true}).click();
  await page.getByRole('option',{name:'深蓝星空',exact:true}).click();
  await expect(other.locator('html')).toHaveAttribute('data-theme','navy-slate');
  // Remove the one-time fixture seed before testing persistence on reload.
  await page.goto('/tests/theme/index.html?view=controls');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','navy-slate');
  await page.getByRole('button',{name:'深蓝星空',exact:true}).click();
  await page.getByRole('option',{name:'跟随系统',exact:true}).click();
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','titanium-light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','navy-slate');
  await page.reload();
  await expect(page.getByRole('button',{name:'跟随系统',exact:true})).toBeVisible();
});

test('token overrides change panel surfaces and chat bubble borders', async ({page}) => {
  await open(page,'files');
  await page.locator('html').evaluate(el=>el.style.setProperty('--bg-surface','#fff8ee'));
  await expect(page.locator('.project-files-panel')).toHaveCSS('background-color','rgb(255, 248, 238)');
  await open(page,'chat');
  await page.locator('html').evaluate(el=>el.style.setProperty('--component-chat-bubble-self-border-color','#a21caf'));
  await expect(page.locator('.chat-bubble-self')).toHaveCSS('border-top-color','rgb(162, 28, 175)');
});

for(const tab of ['theme','shortcuts','llm','mcp','about']) {
  test(`light settings/${tab}`, async ({page}, info) => {
    await open(page,`settings&tab=${tab}`);
    await page.waitForTimeout(500);
    await page.screenshot({path:info.outputPath(`settings-${tab}.png`)});
    expect(await contrastIssues(page)).toEqual([]);
  });
}

for(const view of ['kanban','calendar']) {
  test(`light task ${view}`, async ({page}, info) => {
    await page.goto(`/tests/theme/index.html?view=main&theme=titanium-light#${view}`);
    await page.waitForTimeout(700);
    await page.screenshot({path:info.outputPath(`${view}.png`)});
    expect(await contrastIssues(page)).toEqual([]);
  });
}

test('Word keeps original document colours while the preview shell follows the theme', async ({page}, info) => {
  await open(page,'word');
  const text = page.getByText('Original document red text', {exact:true});
  await expect(text).toBeVisible();
  await expect(text).toHaveCSS('color','rgb(192, 0, 0)');
  await page.screenshot({path: info.outputPath('word.png')});
  await page.locator('html').evaluate(el => el.setAttribute('data-theme','navy-slate'));
  await expect(text).toHaveCSS('color','rgb(192, 0, 0)');
});

test('failed file previews keep readable error and action states', async ({page}, info) => {
  await page.route('**/tests/theme/missing-file', route=>route.fulfill({status:404,body:'Not found'}));
  await open(page,'preview-error');
  await expect(page.getByRole('button',{name:'直接下载查看',exact:true})).toBeVisible();
  expect(await contrastIssues(page)).toEqual([]);
  await page.screenshot({path:info.outputPath('preview-error.png')});
});

test('calendar opacity and custom tone are independent of the outer application theme', async ({page}) => {
  await open(page,'calendar-window');
  await expect(page.locator('body')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(page.locator('.desktop-cal-container')).toHaveCSS('background-color','rgba(248, 250, 252, 0)');
  for(const opacity of [45,90]) {
    await page.evaluate(value=>window.dispatchEvent(new CustomEvent('lanmind-desktop-cal-opacity-change',{detail:value})),opacity);
    await expect(page.locator('.desktop-cal-container')).toHaveCSS('background-color',`rgba(248, 250, 252, ${opacity/100})`);
    await expect(page.locator('.desktop-cal-container')).toHaveCSS('opacity','1');
  }
  await page.evaluate(()=>{
    localStorage.setItem('lanmind_desktop_cal_theme_tone','custom');
    localStorage.setItem('lanmind_desktop_cal_custom_color','#1e1b4b');
    localStorage.setItem('lanmind_desktop_cal_opacity','45');
  });
  await page.reload();
  await expect(page.locator('.desktop-cal-container')).toHaveAttribute('data-theme','navy-slate');
  await expect(page.locator('.desktop-cal-container')).toHaveCSS('background-color','rgba(30, 27, 75, 0.45)');
  await expect(page.locator('.desktop-cal-header')).toHaveCSS('color','rgb(248, 250, 252)');
});
