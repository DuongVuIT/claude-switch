const api = window.claudeSwitch;
const $ = selector => document.querySelector(selector);
const content = $('#content');
let data, view = 'desktop', query = '', project = '', busy = false, preview = null, previewOffset = 0, desktopMode = null;
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 4a6 6 0 0 1 2 4v2"/>',
  message: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 9h9M7 13h6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  refresh: '<path d="M20 7V3m0 4h-4M4 17v4m0-4h4M20 7a9 9 0 0 0-16 1m0 9a9 9 0 0 0 16-1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m6 9 3 3-3 3m6 0h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  switch: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
};
function icon(name, extra = '') { return `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`; }
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon); }); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function date(value) { return new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function relative(value) {
  const days = Math.floor((Date.now() - new Date(value)) / 86400000);
  if (days < 1) return 'Hôm nay';
  if (days === 1) return 'Hôm qua';
  if (days < 7) return `${days} ngày trước`;
  return date(value);
}
function size(bytes) { return bytes > 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`; }
function active() { return data.profiles.find(p => p.id === data.activeId) || data.profiles[0]; }
function label(p) { return p.metadata.displayName || p.name; }
function status(p) { return ({ connected: 'Đã đăng nhập', 'signed-out': 'Cần đăng nhập', unknown: 'Chưa xác minh', missing: 'Chưa có CLI' })[p.auth?.state] || 'Chưa xác minh'; }
function showToast(text, error = false) { const el = $('#toast'); el.textContent = text; el.classList.toggle('is-error', error); el.hidden = false; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => el.hidden = true, error ? 9000 : 5500); }
function fail(error) {
  const message = error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    let alert = dialog.querySelector('.dialog-error');
    if (!alert) { alert = document.createElement('p'); alert.className = 'dialog-error error-text'; alert.setAttribute('role', 'alert'); dialog.prepend(alert); }
    alert.textContent = message;
    alert.scrollIntoView({ block: 'nearest' });
  } else showToast(message, true);
}
async function run(fn) { if (busy) return; busy = true; document.body.classList.add('busy'); try { await fn(); } catch (e) { fail(e); } finally { busy = false; document.body.classList.remove('busy'); } }
function heading(eyebrow, title, text, action = '') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${text}</p></div>${action}</div>`; }
function addButton() { return `<button class="button primary" data-action="add">${icon('plus')} Thêm tài khoản</button>`; }
function statCard(label, number, note, symbol) { return `<div class="stat-card"><div class="stat-top"><span>${label}</span>${icon(symbol)}</div><div class="stat-number">${number}</div><div class="stat-note">${note}</div></div>`; }
function accountCard(p, index = 0) {
  const isActive = p.id === data.activeId;
  const connected = p.auth?.state === 'connected';
  const email = p.auth?.email || p.metadata.emailAddress;
  const plan = p.auth?.subscriptionType || p.metadata.seatTier || p.metadata.billingType || 'Chưa có dữ liệu gói';
  return `<article class="account-card ${isActive ? 'selected' : ''}"><div class="account-top"><div class="avatar color-${index % 3}">${esc(label(p).slice(0, 1).toUpperCase())}</div><div class="account-identity"><h3>${esc(p.name)}</h3><p title="${esc(email || '')}">${esc(email || 'Đăng nhập để kết nối tài khoản')}</p></div>${isActive ? '<span class="badge active-badge">Đang chọn</span>' : ''}</div><div class="account-meta"><span class="plan-badge">${esc(plan)}</span><span class="connection ${connected ? 'connected' : ''}"><b class="status-dot"></b>${status(p)}</span></div><div class="account-footer"><button class="text-button" data-action="details" data-id="${p.id}">Thông tin ${icon('chevron')}</button><div>${!connected ? `<button class="button small secondary" data-action="login" data-id="${p.id}">${icon('external')} Đăng nhập</button>` : ''}${!isActive ? `<button class="button small ${connected ? 'primary' : 'secondary'}" data-action="activate" data-id="${p.id}">${icon('switch')} Chọn</button>` : `<span class="account-ready">${icon('check')} Đã chọn</span>`}</div></div></article>`;
}
function empty(iconName, title, text, action = '') { return `<div class="empty-state">${icon(iconName)}<h3>${title}</h3><p>${text}</p>${action}</div>`; }
function sessionRows(sessions) {
  if (!sessions.length) return empty('message', query || project ? 'Không tìm thấy hội thoại' : 'Một khởi đầu mới', query || project ? 'Thử từ khóa hoặc dự án khác.' : 'Các session Claude Code trên máy sẽ xuất hiện ở đây.', !query && !project ? '<button class="button secondary" data-action="new-session">Mở Claude Code</button>' : '');
  return sessions.map(s => `<button class="session-row" data-action="preview" data-key="${esc(s.key)}"><span class="session-symbol">${icon('message')}</span><span class="session-info"><strong>${esc(s.title)}</strong><span>${esc(s.project)}<b>·</b>${s.messages} tin nhắn${s.malformed ? '<b>·</b> Có dòng chưa đọc được' : ''}</span></span><span class="session-date">${relative(s.updatedAt)}</span><span class="session-arrow">${icon('arrow')}</span></button>`).join('');
}
function overview() {
  const p = active();
  const projects = new Set(data.sessions.map(s => s.cwd).filter(Boolean));
  return heading('A LITTLE LESS FRICTION', 'Công việc tiếp nối. Ngữ cảnh vẹn nguyên.', 'Một nơi cho các tài khoản Claude Code và mọi cuộc hội thoại trên máy.', addButton()) +
  `<section class="hero"><div class="hero-copy"><span class="hero-tag"><b class="status-dot"></b> ONE WORKSPACE. EVERY ACCOUNT.</span><h2>Đổi tài khoản,<br>không đổi mạch suy nghĩ.</h2><p>Chọn tài khoản bạn cần. Mở lại cuộc hội thoại đang dở.<br>Mọi ngữ cảnh local vẫn ở cùng bạn.</p><button class="button hero-button" data-action="new-session">Mở Claude Code ${icon('arrow')}</button><span class="hero-account">Với ${esc(p.name)}</span></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="orbit-node node-one">${icon('users')}</div><div class="orbit-node node-two">${icon('message')}</div><div class="orbit-node node-three">${icon('folder')}</div><div class="art-center">${icon('switch')}</div><div class="art-caption">SAME CONTEXT<br><strong>New possibilities.</strong></div><span class="art-star star-one">+</span><span class="art-star star-two">+</span></div></section>` +
  `<section class="stats-grid" aria-label="Thống kê workspace">${statCard('Tài khoản', data.profiles.length.toString().padStart(2, '0'), `${data.profiles.filter(p => p.auth?.state === 'connected').length} đang đăng nhập`, 'users')}${statCard('Conversations', data.sessions.length, 'Đọc trực tiếp từ dữ liệu local', 'message')}${statCard('Dự án', projects.size, 'Giữ đúng thư mục làm việc', 'folder')}${statCard('Bản sao lưu', data.backups.length.toString().padStart(2, '0'), data.backups.length ? `Gần nhất ${relative(data.backups[0].createdAt)}` : 'Tạo bản đầu tiên trong Kho dữ liệu', 'shield')}</section>` +
  `<section><div class="section-heading"><h2>Tài khoản của bạn <span>${data.profiles.length}</span></h2><button class="text-button" data-action="view" data-view="accounts">Quản lý tài khoản ${icon('arrow')}</button></div><div class="account-grid">${data.profiles.slice(0, 2).map(accountCard).join('')}${data.profiles.length === 1 ? '<button class="add-account-card" data-action="add"><span class="add-circle">'+icon('plus')+'</span><strong>Thêm một góc làm việc</strong><span>Kết nối tài khoản cá nhân hoặc công việc</span></button>' : ''}</div></section>` +
  `<section class="recent-section"><div class="section-heading"><h2>Tiếp tục từ nơi bạn dừng lại</h2><button class="text-button" data-action="view" data-view="conversations">Tất cả conversations ${icon('arrow')}</button></div><div class="session-list">${sessionRows(data.sessions.slice(0, 5))}</div></section>`;
}
function accountsView() {
  return heading('YOUR CONNECTED ACCOUNTS', 'Một workspace. Nhiều tài khoản.', 'Chọn tài khoản để mở phiên tiếp theo. Các Terminal đang chạy giữ nguyên tài khoản của chúng.', addButton()) +
    `<div class="info-banner">${icon('layers')}<div><strong>Đăng nhập riêng, lịch sử dùng chung.</strong><p>Mỗi tài khoản có cấu hình đăng nhập riêng. Session và các tài nguyên local được giữ ở thư mục gốc.</p></div></div><div class="account-grid all-accounts">${data.profiles.map(accountCard).join('')}</div><div class="quiet-note">${icon('info')} Tài khoản hiện có dùng cấu hình gốc của máy. Tài khoản mới được đăng nhập qua Claude Code trong Terminal.</div>`;
}
function filteredSessions() { const q = query.toLocaleLowerCase(); return data.sessions.filter(s => (!project || s.cwd === project) && `${s.title} ${s.project} ${s.cwd} ${s.id}`.toLocaleLowerCase().includes(q)); }
function conversationsView() {
  const projects = [...new Set(data.sessions.map(s => s.cwd).filter(Boolean))];
  return heading('PICK UP WHERE YOU LEFT OFF', 'Mọi cuộc hội thoại, một nơi.', 'Xem lịch sử, chọn tài khoản và tiếp tục đúng session trong Claude Code.', '<button class="button primary" data-action="new-session">'+icon('plus')+' Phiên mới</button>') +
  `<div class="conversation-toolbar"><label class="search-box">${icon('search')}<input id="session-search" aria-label="Tìm hội thoại" placeholder="Tìm hội thoại, dự án hoặc session ID…" value="${esc(query)}"><kbd>⌘ K</kbd></label><select id="project-filter" aria-label="Lọc theo dự án"><option value="">Tất cả dự án</option>${projects.map(p => `<option value="${esc(p)}" ${p === project ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div><div class="list-caption"><span id="results-count">${filteredSessions().length} conversations</span><span>Mới cập nhật trước</span></div><div class="session-list" id="filtered-sessions">${sessionRows(filteredSessions())}</div>${data.warnings.length ? `<div class="quiet-note">${icon('info')} ${data.warnings.length} file có cảnh báo khi đọc. Dữ liệu gốc được giữ nguyên; xem Kho dữ liệu để biết chi tiết.</div>` : ''}`;
}
function vaultView() {
  const inv = data.inventory;
  return heading('LOCAL BY DESIGN', 'Ngữ cảnh của bạn, được giữ gìn.', 'Kiểm kê dữ liệu thực tế và tạo bản sao lưu có checksum cho từng file.', '<button class="button primary" data-action="backup">'+icon('download')+' Tạo bản sao lưu</button>') +
  `<div class="vault-intro"><span class="vault-icon">${icon('shield')}</span><div><h2>Dữ liệu nằm trên máy của bạn.</h2><p>App không gửi lịch sử hoặc thông tin tài khoản lên máy chủ riêng. Claude Code quản lý đăng nhập và kết nối Anthropic.</p><code>${esc(inv.sourceDir)}</code></div><span class="badge active-badge">LOCAL STORAGE</span></div><div class="vault-grid">${inv.groups.map(g => `<article class="data-card"><div class="data-card-top">${icon('folder')}<span class="badge neutral">${g.found.length} / ${g.items.length} mục có trên máy</span></div><h3>${g.label}</h3><p>${g.detail}</p><div class="file-tags">${g.found.length ? g.found.map(f => `<code>${esc(f)}</code>`).join('') : '<span>Chưa tìm thấy dữ liệu</span>'}</div></article>`).join('')}</div><div class="info-banner amber">${icon('info')}<div><strong>Phạm vi “toàn bộ dữ liệu”</strong><p>Sao lưu mọi file thông thường trong thư mục Claude, cấu hình global và các profile của app. Keychain, dữ liệu chỉ có trên cloud và nội dung bên ngoài qua symlink không được sao chép; liên kết được ghi trong manifest. File dự án vẫn ở đường dẫn gốc. Không chuyển gói thuê bao, hạn mức hay quyền tổ chức giữa tài khoản.</p></div></div><section><div class="section-heading"><h2>Bản sao lưu <span>${data.backups.length}</span></h2><span class="muted">SHA-256 · Quyền truy cập riêng cho user</span></div><div class="backup-list">${data.backups.length ? data.backups.map(b => `<div class="backup-row"><span class="session-symbol">${icon('database')}</span><div><strong>${date(b.createdAt)} · ${new Date(b.createdAt).toLocaleTimeString('vi-VN')}</strong><p>${b.files.toLocaleString('vi-VN')} file · ${size(b.bytes)} · ${b.links} symlink được ghi nhận${b.warnings.length ? ` · ${b.warnings.length} cảnh báo` : ''}</p></div><button class="button small secondary" data-action="reveal-backup" data-id="${b.id}">Mở bản sao ${icon('external')}</button></div>${b.warnings.length ? `<details class="backup-warnings"><summary>Xem cảnh báo của bản sao</summary><pre>${esc(b.warnings.join('\n'))}</pre></details>` : ''}`).join('') : empty('shield', 'Chưa có bản sao lưu', 'Tạo bản sao trước khi đổi cấu hình. Snapshot giữ cả file gốc và manifest để đối chiếu.')}</div></section><details class="inventory-details"><summary>Tất cả mục dữ liệu phát hiện được (${inv.entries.length})</summary><div class="file-tags">${inv.entries.map(x => `<code>${esc(x)}</code>`).join('')}</div><p>Cấu hình global: ${inv.globalConfigPresent ? 'Có trên máy' : 'Không có'}</p></details>${data.warnings.length ? `<details class="inventory-details"><summary>Cảnh báo khi đọc session (${data.warnings.length})</summary><pre>${esc(data.warnings.join('\n'))}</pre></details>` : ''}<div class="quiet-note">${icon('lock')} Bản sao có thể chứa dữ liệu nhạy cảm từ cấu hình. Thư mục được giới hạn quyền user; không mã hóa toàn bộ snapshot.</div>`;
}
function desktopView() {
  const d = data.desktop;
  const current = d.profiles.find(p => p.active);
  return heading('CLAUDE APP · MACOS', 'Đổi tài khoản, mang theo session Code.', 'Chuẩn bị danh sách hội thoại local cho tài khoản đích trước khi mở lại Claude.', `<button class="button primary" data-action="desktop-add">${icon('plus')} Thêm tài khoản desktop</button>`) +
    `<section class="desktop-hero"><span class="vault-icon">${icon('switch')}</span><div><div class="eyebrow">ĐANG DÙNG TRONG CLAUDE DESKTOP</div><h2>${esc(current?.name || 'Claude hiện tại')}</h2><p>${d.app.running ? 'Claude đang mở' : 'Claude đang đóng'} · ${current?.sessionCount || 0} session Code local${current?.accountId ? ' · Đã có thông tin tài khoản' : ' · Chưa có metadata tài khoản'}</p></div><button class="button primary" data-action="desktop-open" data-id="${esc(d.activeId)}">${icon('external')} Mở Claude</button></section>` +
    (d.recoveryRequired ? `<div class="info-banner amber"><div><strong>Có lần chuyển hồ sơ bị gián đoạn.</strong><p>App giữ nguyên các thư mục và nhật ký chuyển. Khôi phục trước khi tiếp tục.</p><button class="button secondary" data-action="desktop-recover">Khôi phục lần chuyển</button></div></div>` : '') +
    `<div class="section-heading"><h2>Tài khoản desktop <span>${d.profiles.length}</span></h2><span class="muted">Độc lập với tài khoản CLI</span></div><div class="account-grid">${d.profiles.map((p,i) => `<article class="account-card ${p.active ? 'selected' : ''}"><div class="account-top"><div class="avatar color-${i%3}">${esc(p.name.slice(0,1).toUpperCase())}</div><div class="account-identity"><h3>${esc(p.name)}</h3><p>${p.accountId ? `Account ${esc(p.accountId.slice(0,8))}…` : 'Đăng nhập trong Claude sau khi mở'}</p></div>${p.active ? '<span class="badge active-badge">Trong Claude</span>' : ''}</div><div class="account-meta"><span class="plan-badge">${p.sessionCount} sessions Code local</span><span class="connection connected">${icon('shield')} ${p.hasData ? 'Hồ sơ được giữ nguyên' : 'Chưa có dữ liệu'}</span></div><div class="account-footer"><div><button class="text-button" data-action="desktop-rename" data-id="${p.id}">Đổi tên</button><button class="text-button" data-action="desktop-folder" data-id="${p.id}">Thư mục ${icon('folder')}</button></div><button class="button small ${p.active ? 'secondary' : 'primary'}" data-action="${p.active ? 'desktop-open' : 'desktop-switch'}" data-id="${p.id}" ${d.recoveryRequired || (p.switchBlockReason && !p.orgIds.length) ? 'disabled' : ''}>${icon(p.active ? 'external' : 'switch')} ${p.active ? 'Mở Claude' : p.orgIds.length ? 'Chuyển & giữ session' : 'Dùng tài khoản này'}</button></div>${p.switchBlockReason ? `<p class="profile-block-reason">${p.orgIds.length ? 'Sẽ kiểm tra transcript và chuẩn bị session cho organization đích. Không sao chép đăng nhập hoặc quyền công cụ của tài khoản nguồn.' : esc(p.switchBlockReason)}</p>` : ''}</article>`).join('')}</div>` +
    `<section class="desktop-explanation"><h2>Đổi đăng nhập, giữ liên kết hội thoại.</h2><div class="desktop-steps"><div><span>01</span><strong>Lưu hồ sơ đang dùng</strong><p>Claude thoát bình thường. Cookie, cấu hình, session và dữ liệu local được giữ trong nguyên thư mục.</p></div><div><span>02</span><strong>Đổi sang tài khoản đã chọn</strong><p>Khôi phục đúng thư mục hồ sơ. Claude mở lại bằng phiên đăng nhập đã lưu trên máy.</p></div><div><span>03</span><strong>Tiếp tục trong tab Code</strong><p>Mở lại session đã chuyển trong tab Code. Transcript gốc được giữ nguyên; quyền công cụ được hỏi lại.</p></div></div></section>` +
    `<div class="info-banner amber">${icon('info')}<div><strong>Mang theo session Code local, giữ riêng đăng nhập.</strong><p>App bổ sung metadata của session Code vào đúng account và organization đích, giữ liên kết tới transcript gốc. Đây là tích hợp với dữ liệu local của phiên bản Claude đang cài, không phải API chuyển tài khoản chính thức. Chat/Cowork/cloud và quyền tổ chức không chuyển. Dừng tác vụ trước khi đổi.</p></div></div>` +
    `<section class="recent-section"><div class="section-heading"><h2>Session Code trong hồ sơ hiện tại</h2><span class="muted">${current?.sessionCount || 0} metadata local · Không phải toàn bộ lịch sử cloud</span></div><div class="session-list">${current?.sessions.length ? current.sessions.slice(0,12).map(s => `<div class="session-row desktop-session"><span class="session-symbol">${icon('message')}</span><span class="session-info"><strong>${esc(s.title)}</strong><span>${esc(s.cwd || 'Không có đường dẫn local')}${s.isArchived ? '<b>·</b> Đã lưu trữ' : ''}</span></span><button class="button small secondary" data-action="desktop-open" data-id="${current.id}">Mở Claude ${icon('external')}</button></div>`).join('') : empty('message', 'Chưa có session Code local', 'Đăng nhập và mở tab Code trong Claude. Bấm Làm mới để đọc metadata mới.')}</div></section><div class="quiet-note">${icon('lock')} Hồ sơ lưu ở máy này, không giải mã hoặc hiển thị token. Keychain vẫn do macOS và ứng dụng Claude chính thức quản lý. Đăng nhập đã bị thu hồi vẫn cần xác thực lại.</div>`;
}
function openDesktopDialog(mode, id) {
  desktopMode = { mode, id };
  const p = data.desktop.profiles.find(p => p.id === id);
  $('#details-dialog .dialog-error')?.remove();
  const isSwitch = mode === 'switch';
  $('#details-content').innerHTML = `<div class="modal-heading"><span class="eyebrow">CLAUDE DESKTOP</span><button class="icon-button" data-action="close-details" aria-label="Đóng">${icon('close')}</button></div><h2 id="details-title">${isSwitch ? `Chuyển sang ${esc(p.name)}?` : mode === 'rename' ? 'Đặt tên dễ nhận ra' : 'Thêm tài khoản Claude desktop'}</h2><p>${isSwitch ? 'Claude sẽ thoát, sao lưu metadata và bổ sung session local vào organization đích, rồi mở lại. Transcript gốc vẫn dùng chung. Session có sẵn ở đích không bị ghi đè. Dừng tác vụ đang chạy trước khi chuyển.' : mode === 'rename' ? 'Tên này chỉ dùng trong Claude Switch.' : 'Tạo hồ sơ trống. Sau đó bấm “Dùng tài khoản này” và đăng nhập trong ứng dụng Claude chính thức. Hồ sơ hiện tại vẫn được giữ nguyên.'}</p>${isSwitch && p.orgIds.length ? `<label for="desktop-target-org">Organization đích</label><select id="desktop-target-org">${p.orgIds.map(org => `<option value="${esc(org)}">${esc(org)}</option>`).join('')}</select><div class="info-note">Chỉ chuyển session Code local. Quyền công cụ sẽ được hỏi lại. Chat/Cowork/cloud, connector và lịch chạy tự động không chuyển.</div>` : ''}${!isSwitch ? `<label for="desktop-profile-name">Tên tài khoản desktop</label><input id="desktop-profile-name" maxlength="60" value="${esc(p?.name || '')}" placeholder="Cá nhân, Công việc…">` : ''}<div class="modal-actions"><button class="button secondary" data-action="close-details">Hủy</button><button class="button primary" data-action="desktop-confirm">${isSwitch ? 'Đóng Claude & chuyển' : mode === 'rename' ? 'Lưu tên' : 'Tạo hồ sơ'}</button></div>`;
  $('#details-dialog').showModal();
  $('#desktop-profile-name')?.focus();
}
function render() {
  if (!data) return;
  const names = { desktop: 'Claude desktop', overview: 'Tổng quan CLI', accounts: 'Tài khoản CLI', conversations: 'Sessions CLI', vault: 'Kho dữ liệu CLI' };
  $('#breadcrumb').textContent = names[view];
  $('#nav-accounts').textContent = data.profiles.length;
  $('#nav-sessions').textContent = data.sessions.length;
  document.querySelectorAll('.nav-item').forEach(el => { el.classList.toggle('active', el.dataset.view === view); el.setAttribute('aria-current', el.dataset.view === view ? 'page' : 'false'); });
  content.innerHTML = ({ desktop: desktopView, overview, accounts: accountsView, conversations: conversationsView, vault: vaultView })[view]();
}
async function load() {
  $('#refresh').classList.add('spinning');
  try { data = await api.load(); render(); $('#last-synced').textContent = `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`; }
  catch (e) { if (!data) content.innerHTML = empty('info', 'Chưa đọc được workspace', esc(e.message), '<button class="button primary" data-action="reload">Thử lại</button>'); throw e; }
  finally { $('#refresh').classList.remove('spinning'); }
}
function navigate(next) { view = next; render(); content.scrollTop = 0; }
async function showPreview(key) {
  preview = data.sessions.find(s => s.key === key);
  previewOffset = 0;
  $('#session-dialog .dialog-error')?.remove();
  const dialog = $('#session-dialog');
  $('#session-content').innerHTML = `<div class="modal-heading"><span class="eyebrow">CONVERSATION</span><button class="icon-button" data-action="close-preview" aria-label="Đóng">${icon('close')}</button></div><h2 id="preview-title">${esc(preview.title)}</h2><div class="preview-meta"><span>${icon('folder')} ${esc(preview.cwd || 'Chưa có đường dẫn dự án')}</span><code>${esc(preview.id)}</code></div><div class="resume-bar"><label for="resume-account">Tiếp tục bằng</label><select id="resume-account">${data.profiles.map(p => `<option value="${p.id}" ${p.id === data.activeId ? 'selected' : ''}>${esc(p.name)} · ${status(p)}</option>`).join('')}</select><button class="button primary" data-action="resume">${icon('terminal')} Tiếp tục trong Terminal</button></div><button class="text-button" data-action="copy-command">${icon('terminal')} Sao chép lệnh cho terminal IDE</button><div class="preview-disclaimer">Bản xem trước hiển thị tin nhắn và tên công cụ. Claude Code resume từ file JSONL gốc, bao gồm dữ liệu công cụ và ngữ cảnh đã lưu. Dừng phiên đang chạy trước khi resume cùng session bằng tài khoản khác.</div><div class="transcript" id="transcript"><div class="spinner"></div></div><button class="button secondary load-more" id="load-more" data-action="more" hidden>Xem thêm tin nhắn</button>`;
  dialog.showModal();
  await loadMessages(true);
}
async function loadMessages(reset = false) {
  const result = await api.transcript(preview.key, previewOffset);
  const html = result.messages.map(m => `<article class="chat-message ${m.role}"><div class="message-author"><span>${m.role === 'user' ? 'Bạn' : 'Claude'}</span>${m.timestamp ? `<time>${new Date(m.timestamp).toLocaleString('vi-VN')}</time>` : ''}</div>${m.text ? `<pre>${esc(m.text)}</pre>` : ''}${m.tools.length ? `<div class="tool-tags">${m.tools.map(t => `<span>${icon('terminal')} ${esc(t)}</span>`).join('')}</div>` : ''}</article>`).join('');
  if (reset) $('#transcript').innerHTML = html || '<p class="muted">Session này chưa có tin nhắn văn bản.</p>';
  else $('#transcript').insertAdjacentHTML('beforeend', html);
  previewOffset += result.messages.length;
  $('#load-more').hidden = !result.hasMore;
}
function showDetails(id) {
  const p = data.profiles.find(p => p.id === id);
  const entries = { 'Tên trong ứng dụng': p.name, 'Trạng thái xác minh': status(p), 'Email đăng nhập': p.auth?.email || 'Chưa xác minh', 'Phương thức đăng nhập': p.auth?.authMethod || 'Chưa có', 'Thư mục cấu hình': p.configDir, ...p.metadata };
  $('#details-content').innerHTML = `<div class="modal-heading"><span class="eyebrow">ACCOUNT DETAILS</span><button class="icon-button" data-action="close-details" aria-label="Đóng">${icon('close')}</button></div><h2 id="details-title">${esc(p.name)}</h2><p>Thông tin dưới đây lấy từ Claude Code. Metadata cache có thể thuộc lần đăng nhập trước; trạng thái xác minh được kiểm tra riêng.</p><dl class="account-details">${Object.entries(entries).map(([k,v]) => `<div><dt>${esc(k)}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd></div>`).join('')}</dl><div class="info-note">${icon('lock')}<span>Token và mật khẩu không hiển thị. Đăng nhập do Claude Code và macOS quản lý.</span></div>`;
  $('#details-dialog').showModal();
}
document.addEventListener('click', event => {
  const nav = event.target.closest('.nav-item');
  if (nav) return navigate(nav.dataset.view);
  const close = event.target.closest('.close-dialog');
  if (close) return $('#account-dialog').close();
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'add') { $('#account-error').textContent = ''; $('#account-form').reset(); $('#account-dialog').showModal(); return; }
  if (action === 'view') return navigate(button.dataset.view);
  if (action === 'details') return showDetails(button.dataset.id);
  if (action === 'close-preview') return $('#session-dialog').close();
  if (action === 'close-details') return $('#details-dialog').close();
  if (action === 'desktop-add') return openDesktopDialog('create');
  if (action === 'desktop-rename') return openDesktopDialog('rename', button.dataset.id);
  if (action === 'desktop-switch') return openDesktopDialog('switch', button.dataset.id);
  run(async () => {
    if (action === 'desktop-open') { const result = await api.desktopSwitch(button.dataset.id); data.desktop = result.desktop; render(); showToast(result.warning || 'Đã yêu cầu mở Claude với hồ sơ hiện tại.'); }
    if (action === 'desktop-folder') await api.desktopReveal(button.dataset.id);
    if (action === 'desktop-recover') { data.desktop = await api.desktopRecover(); render(); showToast('Đã khôi phục trạng thái hồ sơ.'); }
    if (action === 'desktop-confirm') {
      const { mode, id } = desktopMode;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = mode === 'switch' ? 'Đang đóng Claude & chuyển…' : 'Đang lưu…';
      try {
        let notice;
        if (mode === 'create') { const result = await api.desktopCreate($('#desktop-profile-name').value); data.desktop = result.desktop; notice = 'Đã tạo hồ sơ. Bấm Dùng tài khoản này để mở Claude và đăng nhập.'; }
        if (mode === 'rename') { data.desktop = await api.desktopRename(id, $('#desktop-profile-name').value); notice = 'Đã đổi tên hồ sơ.'; }
        if (mode === 'switch') { const result = await api.desktopSwitch(id, { carryHistory: !!$('#desktop-target-org'), orgId: $('#desktop-target-org')?.value }); data.desktop = result.desktop; notice = result.warning || (result.transfer ? `Đã chuẩn bị ${result.transfer.total} session và mở lại Claude.${result.transfer.warnings.length ? ` Có ${result.transfer.warnings.length} cảnh báo đường dẫn dự án.` : ''}` : 'Đã mở lại Claude. Đăng nhập nếu đây là hồ sơ mới.'); }
        $('#details-dialog').close(); render(); showToast(notice);
      } catch (e) { try { data.desktop = await api.desktopLoad(); render(); } catch {} throw e; }
      finally { button.disabled = false; button.textContent = original; }
    }
    if (action === 'reload') await load();
    if (action === 'activate') { await api.activate(button.dataset.id); data.activeId = button.dataset.id; render(); showToast(`Đã chọn ${active().name} cho phiên mở tiếp theo.`); }
    if (action === 'login') { await api.launch({ profileId: button.dataset.id, login: true }); showToast('Đã mở Terminal. Hoàn tất đăng nhập rồi bấm Làm mới trong app.'); }
    if (action === 'new-session') { const result = await api.launch({ profileId: data.activeId }); if (!result.canceled) showToast('Đã mở Claude Code trong Terminal.'); }
    if (action === 'preview') await showPreview(button.dataset.key);
    if (action === 'more') await loadMessages();
    if (action === 'copy-command') {
      await api.copyCommand({ profileId: $('#resume-account').value, sessionKey: preview.key });
      button.textContent = 'Đã chép — dán vào terminal IDE';
    }
    if (action === 'resume') {
      const profileId = $('#resume-account').value;
      const result = await api.launch({ profileId, sessionKey: preview.key });
      if (!result.canceled) { await api.activate(profileId); data.activeId = profileId; render(); showToast('Đã mở lệnh resume trong Terminal. Kiểm tra Claude để tiếp tục hội thoại.'); }
    }
    if (action === 'backup') {
      showToast('Đang sao lưu dữ liệu local…');
      button.disabled = true;
      button.textContent = 'Đang sao lưu…';
      try { const backup = await api.backup(); data.backups.unshift(backup); render(); showToast(`Đã sao lưu ${backup.files} file (${size(backup.bytes)}).${backup.warnings.length ? ` Có ${backup.warnings.length} cảnh báo; xem chi tiết trong Kho dữ liệu.` : ''}`); }
      finally { if (button.isConnected) { button.disabled = false; button.innerHTML = `${icon('download')} Tạo bản sao lưu`; } }
    }
    if (action === 'reveal-backup') await api.revealBackup(button.dataset.id);
  });
});
document.addEventListener('input', event => {
  if (event.target.id !== 'session-search') return;
  query = event.target.value;
  $('#filtered-sessions').innerHTML = sessionRows(filteredSessions());
  $('#results-count').textContent = `${filteredSessions().length} conversations`;
});
document.addEventListener('change', event => {
  if (event.target.id !== 'project-filter') return;
  project = event.target.value;
  $('#filtered-sessions').innerHTML = sessionRows(filteredSessions());
  $('#results-count').textContent = `${filteredSessions().length} conversations`;
});
$('#account-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const button = $('#create-account'); button.disabled = true; button.textContent = 'Đang tạo…';
    try { const result = await api.createProfile($('#account-name').value); data = result.snapshot; $('#account-dialog').close(); navigate('accounts'); showToast('Đã tạo profile. Bấm Đăng nhập để kết nối tài khoản Claude.'); }
    catch (e) { $('#account-error').textContent = e.message; }
    finally { button.disabled = false; button.innerHTML = `Tạo tài khoản ${icon('arrow')}`; }
  });
});
$('#refresh').addEventListener('click', () => run(load));
$('#open-data').addEventListener('click', () => run(() => api.revealData()));
$('.brand').addEventListener('click', e => { e.preventDefault(); navigate('overview'); });
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'k' && data && !document.querySelector('dialog[open]')) { event.preventDefault(); navigate('conversations'); $('#session-search').focus(); } });
api.onBackupProgress(({ files, bytes }) => { if ($('#account-dialog').open && $('#create-account').disabled) $('#create-account').textContent = `Đang sao lưu ${files} file…`;  $('#toast').textContent = `Đang sao lưu · ${files.toLocaleString('vi-VN')} file · ${size(bytes)}`; $('#toast').hidden = false; clearTimeout(showToast.timer); });
hydrateIcons();
run(load);
