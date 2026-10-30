import { useEffect, useMemo, useState } from 'react';
import './styles.css';

const seedGroups = [
  { id: 'bos', name: '博思', domain: 'qhose.bosssoft.com.cn', color: '#F9AB00', live: true, saved: true, checked: false, tabs: [
    { title: '博思云平台', url: 'https://qhose.bosssoft.com.cn/portal' },
    { title: '待办中心', url: 'https://qhose.bosssoft.com.cn/workbench/todo' },
  ] },
  { id: 'github', name: 'GitHub', domain: 'github.com', color: '#D93025', live: true, saved: true, checked: false, tabs: [
    { title: 'TabMerge · Repository', url: 'https://github.com/BetterYoung/TabMerge' },
    { title: 'Pull requests · TabMerge', url: 'https://github.com/BetterYoung/TabMerge/pulls' },
    { title: 'Issues · TabMerge', url: 'https://github.com/BetterYoung/TabMerge/issues' },
    { title: 'Actions · TabMerge', url: 'https://github.com/BetterYoung/TabMerge/actions' },
    { title: 'Releases · TabMerge', url: 'https://github.com/BetterYoung/TabMerge/releases' },
  ] },
  { id: 'dingtalk', name: '钉钉', domain: 'docs.dingtalk.com', color: '#1A73E8', live: false, saved: true, checked: false, tabs: [
    { title: '项目协作', url: 'https://docs.dingtalk.com/doc/project' },
    { title: '知识库', url: 'https://docs.dingtalk.com/doc/wiki' },
  ] },
  { id: 'feishu', name: '飞书', domain: 'xcn4e0le81w4.feishu.cn', color: '#9AA0A6', live: true, saved: true, checked: false, tabs: [
    { title: '工作台', url: 'https://xcn4e0le81w4.feishu.cn/home' },
    { title: '项目文档', url: 'https://xcn4e0le81w4.feishu.cn/docs/project' },
    { title: '任务跟进', url: 'https://xcn4e0le81w4.feishu.cn/tasks' },
    { title: '数据看板', url: 'https://xcn4e0le81w4.feishu.cn/base/dashboard' },
    { title: '团队知识库', url: 'https://xcn4e0le81w4.feishu.cn/wiki/team' },
    { title: '会议纪要', url: 'https://xcn4e0le81w4.feishu.cn/minutes' },
    { title: '消息', url: 'https://xcn4e0le81w4.feishu.cn/messenger' },
  ] },
  { id: 'kimi', name: 'Kimi', domain: 'www.kimi.com', color: '#9334E6', live: false, saved: false, checked: false, tabs: [{ title: 'Kimi 智能助手', url: 'https://www.kimi.com/' }] },
  { id: 'x', name: 'X', domain: 'x.com', color: '#16181D', live: false, saved: false, checked: false, tabs: [{ title: '首页 / X', url: 'https://x.com/home' }] },
  { id: 'sealiai', name: '央智AI', domain: 'ykaitest.sealai.cc', color: '#14624A', live: false, saved: false, checked: false, tabs: [{ title: '央智AI工作台', url: 'https://ykaitest.sealai.cc/' }] },
  { id: 'zhongying', name: '中影AI', domain: 'zygf.sealai.cc', color: '#D93025', live: false, saved: false, checked: false, tabs: [{ title: '中影AI平台', url: 'https://zygf.sealai.cc/' }] },
];

export function App() {
  const [view, setView] = useState('popup');
  const [groups, setGroups] = useState(seedGroups);
  const [expanded, setExpanded] = useState('bos');
  const [notice, setNotice] = useState('');
  const [editingName, setEditingName] = useState('');
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    const handler = event => { setNotice(event.detail); window.setTimeout(() => setNotice(''), 2200); };
    window.addEventListener('prototype-notice', handler);
    return () => window.removeEventListener('prototype-notice', handler);
  }, []);

  const selected = useMemo(() => groups.filter(g => g.checked && g.saved).length, [groups]);
  const update = (id, change) => setGroups(list => list.map(g => g.id === id ? { ...g, ...change } : g));
  const updateTab = (id, index, key, value) => setGroups(list => list.map(g => g.id === id ? { ...g, tabs: g.tabs.map((tab, i) => i === index ? { ...tab, [key]: value } : tab) } : g));
  const toggleAll = checked => setGroups(list => list.map(g => ({ ...g, checked: g.saved ? checked : false })));
  const saveGroup = id => { update(id, { saved: true, tabs: groups.find(g => g.id === id).tabs.map(tab => ({ ...tab, isNew: false })) }); setNotice('分组内容已保存'); window.setTimeout(() => setNotice(''), 2200); };
  const startRename = group => { setEditingName(group.id); setNameDraft(group.name); };
  const commitRename = id => { update(id, { name: nameDraft.trim() || '未命名分组' }); setEditingName(''); setNotice('分组名称已保存'); window.setTimeout(() => setNotice(''), 2200); };
  const cancelRename = () => setEditingName('');
  const toggleSaved = id => setGroups(list => list.map(g => g.id === id ? { ...g, saved: !g.saved, checked: false } : g));
  const addTab = id => setGroups(list => list.map(g => g.id === id ? { ...g, tabs: [...g.tabs, { title: '', url: '', isNew: true }] } : g));
  const removeTab = (id, index) => setGroups(list => list.map(g => g.id === id ? { ...g, tabs: g.tabs.filter((_, i) => i !== index) } : g));
  const saveCurrentWindowGroups = () => {
    const count = groups.filter(g => g.live).length;
    setGroups(list => list.map(g => g.live ? { ...g, saved: true } : g));
    setNotice(count ? `已保存或更新 ${count} 个分组` : '当前窗口没有可保存的分组');
    window.setTimeout(() => setNotice(''), 2200);
  };

  return <main className="design-page">
    <header className="preview-head">
      <div><span className="eyebrow">TABMERGE · CONCEPT</span><h1>分组管理整合</h1><p>在同一条分组记录里查看状态、改名称、管理标签页并保存。</p></div>
      <div className="preview-switch" aria-label="切换设计稿预览">
        <button className={view === 'popup' ? 'active' : ''} onClick={() => setView('popup')}>扩展快捷页</button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>选项设置</button>
      </div>
    </header>

    {view === 'popup' ? <Popup groups={groups} expanded={expanded} setExpanded={setExpanded} update={update} updateTab={updateTab} selected={selected} toggleAll={toggleAll} saveGroup={saveGroup} toggleSaved={toggleSaved} addTab={addTab} removeTab={removeTab} notice={notice} editingName={editingName} nameDraft={nameDraft} setNameDraft={setNameDraft} startRename={startRename} commitRename={commitRename} cancelRename={cancelRename} />
      : <Settings groups={groups} expanded={expanded} setExpanded={setExpanded} update={update} updateTab={updateTab} saveGroup={saveGroup} toggleSaved={toggleSaved} addTab={addTab} removeTab={removeTab} notice={notice} editingName={editingName} nameDraft={nameDraft} setNameDraft={setNameDraft} startRename={startRename} commitRename={commitRename} cancelRename={cancelRename} />}
    <footer className="design-note"><span>设计说明</span>分组名、自动命名和保存状态共用同一条记录；已有标签可添加或移除。删除保存项只移除快照，不影响当前浏览器分组。</footer>
  </main>;
}
function StatePills({ group }) {
  return <span className="pills">{group.live && <span className="pill live">当前窗口</span>}{group.saved && <span className="pill saved">已保存</span>}</span>;
}

function GroupHeader({ group, settings, open, onToggle, onCheck, editingName, nameDraft, setNameDraft, startRename, commitRename, cancelRename }) {
  const editing = editingName === group.id;
  return <div className="group-head">
    {!settings && <input className="check" type="checkbox" aria-label={`选择${group.name}`} checked={group.checked} disabled={!group.saved} onChange={e => onCheck(e.target.checked)} />}
    <span className="color-bar" style={{ background: group.color }} />
    <div className={`group-main ${editing ? 'is-editing' : ''}`}>
      {editing ? <div className="inline-name-editor"><input autoFocus aria-label="分组名称" value={nameDraft} onChange={e => setNameDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commitRename(group.id); if (e.key === 'Escape') cancelRename(); }} /><button className="mini-primary" onClick={() => commitRename(group.id)}>保存</button><button className="mini-secondary" onClick={cancelRename}>取消</button></div> : <button className="group-summary" onClick={onToggle} aria-expanded={open}>
        <span className="group-name-line"><strong>{group.name}</strong><span className="domain">{group.domain}</span></span>
        <StatePills group={group} />
      </button>}
    </div>
    {!editing && <button className="rename-trigger" title={`修改${group.name}的分组名称`} onClick={() => startRename(group)}>改名</button>}
    <span className="tab-count">{group.tabs.length}</span>
    <button className="expand-label" aria-label={open ? '收起标签' : '展开标签'} aria-expanded={open} onClick={onToggle}>{open ? '收起' : '展开'}</button>
  </div>;
}

function GroupEditor({ group, updateTab, saveGroup, toggleSaved, addTab, removeTab, settings }) {
  return <div className="group-editor">
    <div className="tabs-label"><span>标签 <small>{group.tabs.length} 个</small></span><button className="button secondary add-tab" onClick={() => addTab(group.id)}>添加标签</button></div>
    <div className="tab-list">
      {group.tabs.map((tab, i) => <div className="tab-edit" key={`${group.id}-${i}`}>
        <span className="tab-index">{String(i + 1).padStart(2, '0')}</span>
        <div className="tab-inputs">{tab.isNew ? <><strong>新标签页</strong><input aria-label="新标签页网址" className="url-input" placeholder="输入要添加的网页地址（https://…）" value={tab.url} onChange={e => updateTab(group.id, i, 'url', e.target.value)} /></> : <><strong>{tab.title || '网页标题'}</strong><span className="url-input">{tab.url}</span></>}</div>
        <button className="remove-tab" aria-label={`移除标签：${tab.title || tab.url || '新标签页'}`} onClick={() => removeTab(group.id, i)}>移除</button>
      </div>)}
    </div>
    <div className="editor-foot">
      <span className="auto-name-note">此名称也用于域名 <code>{group.domain}</code></span>
      <div className="editor-actions">
        {group.saved && <button className="button danger" onClick={() => toggleSaved(group.id)}>删除保存项</button>}
        <button className="button primary" onClick={() => saveGroup(group.id)}>{group.saved ? '保存修改' : '保存到分组库'}</button>
      </div>
    </div>
  </div>;
}

function Popup({ groups, expanded, setExpanded, update, updateTab, selected, toggleAll, saveGroup, toggleSaved, addTab, removeTab, notice, editingName, nameDraft, setNameDraft, startRename, commitRename, cancelRename }) {
  const visibleGroups = groups.filter(g => g.live || g.saved);
  const savedCount = visibleGroups.filter(g => g.saved).length;
  return <section className="popup-window">
    <div className="popup-top"><strong className="brand">TabMerge</strong><span>23 个标签页</span><button className="settings-gear" aria-label="设置">设置</button></div>
    <div className="quick-actions"><button className="quick primary">自动分组</button><button>解散分组</button><button>收起分组</button><button>展开分组</button><button className="save-window" disabled={!groups.some(g => g.live)} onClick={saveCurrentWindowGroups}>保存当前窗口分组</button></div>
    <div className="list-toolbar"><label><input type="checkbox" checked={selected === savedCount && savedCount > 0} onChange={e => toggleAll(e.target.checked)} /> 全选</label><span>{visibleGroups.length} 个分组 · 已选 {selected}</span><button className="button primary restore-selected" disabled={!selected} onClick={() => selected && window.dispatchEvent(new CustomEvent('prototype-notice', { detail: `已恢复 ${selected} 个分组到当前窗口` }))}>恢复所选</button></div>
    <div className="popup-list">{visibleGroups.map(g => <article className={`group-card ${expanded === g.id ? 'expanded' : ''}`} key={g.id}>
      <GroupHeader group={g} open={expanded === g.id} onToggle={() => setExpanded(expanded === g.id ? '' : g.id)} onCheck={checked => update(g.id, { checked })} editingName={editingName} nameDraft={nameDraft} setNameDraft={setNameDraft} startRename={startRename} commitRename={commitRename} cancelRename={cancelRename} />
      {expanded === g.id && <GroupEditor group={g} update={update} updateTab={updateTab} saveGroup={saveGroup} toggleSaved={toggleSaved} addTab={addTab} removeTab={removeTab} />}
    </article>)}</div>
    <div className="popup-status">{notice || '勾选已保存分组，可批量恢复到当前窗口'}</div>
  </section>;
}

function Settings({ groups, expanded, setExpanded, update, updateTab, saveGroup, toggleSaved, addTab, removeTab, notice, editingName, nameDraft, setNameDraft, startRename, commitRename, cancelRename }) {
  return <section className="settings-window">
    <aside className="settings-rail"><div className="rail-brand"><b>TabMerge</b></div><nav><a className="nav-item">常规</a><a className="nav-item active">分组管理</a><a className="nav-item">快捷键</a><a className="nav-item">关于</a></nav><small>版本 1.1.0</small></aside>
    <div className="settings-content">
      <header className="settings-heading"><div><h2>分组管理</h2><p>名称规则和已保存分组合并管理。点击分组即可直接修改名称和标签。</p></div><button className="button primary" onClick={() => groups.filter(g => g.live).forEach(g => saveGroup(g.id))}>保存当前窗口分组</button></header>
      <div className="summary-strip"><div><strong>{groups.length}</strong><span>个分组名称</span></div><i></i><div><strong>{groups.filter(g => g.saved).length}</strong><span>个已保存分组</span></div><i></i><div><strong>{groups.filter(g => g.live).length}</strong><span>当前窗口中</span></div></div>
      <div className="settings-list">{groups.map(g => <article className={`group-card ${expanded === g.id ? 'expanded' : ''}`} key={g.id}>
        <GroupHeader group={g} settings open={expanded === g.id} onToggle={() => setExpanded(expanded === g.id ? '' : g.id)} editingName={editingName} nameDraft={nameDraft} setNameDraft={setNameDraft} startRename={startRename} commitRename={commitRename} cancelRename={cancelRename} />
        {expanded === g.id && <GroupEditor group={g} update={update} updateTab={updateTab} saveGroup={saveGroup} toggleSaved={toggleSaved} addTab={addTab} removeTab={removeTab} settings />}
      </article>)}</div>
      <div className="settings-status">{notice || '名称修改会用于后续自动分组；标签修改会在恢复此快照时生效。'}</div>
    </div>
  </section>;
}
