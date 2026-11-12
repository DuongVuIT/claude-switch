# Claude Switch

Ứng dụng macOS quản lý hồ sơ **Claude desktop (bao gồm tab Code)** và tài khoản **Claude Code CLI**. Hai chế độ độc lập; trang mặc định là Claude desktop. Giao diện tiếng Việt; không có server trung gian hoặc telemetry của app.

## Chuyển tài khoản trong app Claude / tab Code

**Bản 1.2.0:** thêm **Chuyển & giữ session** cho hồ sơ đã đăng nhập. App sao lưu metadata rồi đưa các session Code local vào danh sách của tài khoản/organization đích, giữ nguyên ID transcript trong `~/.claude/projects`. Không ghi đè session đã có ở đích. Thiếu transcript hoặc ID xung đột sẽ chặn chuyển trước khi đóng Claude.

1. Mở trang **Claude desktop**, chọn tài khoản đã đăng nhập và bấm **Chuyển & giữ session**.
2. Chọn organization đích, dừng tác vụ đang chạy rồi bấm **Đóng Claude & chuyển**. App yêu cầu thoát bình thường, không force-kill.
3. Claude mở lại bằng tài khoản đích; vào tab Code và mở session cũ. Quyền công cụ sẽ được hỏi lại. Nếu thư mục dự án cũ đã mất, cần khôi phục đúng đường dẫn.

Hồ sơ mới chưa đăng nhập chưa thể nhận lịch sử. Chức năng thêm hồ sơ chỉ tạo kho trống; không tự đăng nhập hoặc lấy dữ liệu cloud.

Cookie, cấu hình OAuth được mã hóa sẵn bởi Claude, IndexedDB, dữ liệu Code, Cowork, cache, workspace state và mọi mục khác trong thư mục user-data được giữ nguyên bằng phép đổi tên thư mục trên cùng filesystem. App không giải mã cookie/token, không sửa cơ sở dữ liệu Chromium, không đổi binary hoặc chữ ký của Claude. macOS Keychain giữ nguyên tại chỗ; kho hồ sơ dùng được trên máy này, không phải gói xuất credential dùng trên máy khác.

App ghi journal trước khi chuyển thư mục. Nếu gián đoạn, chức năng **Khôi phục lần chuyển** đối chiếu inode/device để nhận diện hồ sơ đã cất/đã cài; không ghi đè một thư mục không khớp. Kho hồ sơ nằm trong `~/Library/Application Support/Claude Switch/desktop-profiles`. Đây là hồ sơ đang sử dụng luân phiên, **không phải snapshot backup độc lập**; nên vẫn dùng Time Machine hoặc backup riêng.

**Giới hạn:** chuyển đăng nhập áp dụng cho toàn bộ Claude desktop. Chỉ session Code local được đưa sang danh sách tài khoản mới; Chat, Cowork, lịch sử chỉ có trên cloud, subscription, lịch chạy, connector và quyền tổ chức không được chuyển. Metadata gốc được sao lưu; quyền công cụ và connector của tài khoản nguồn không được cấp cho tài khoản đích. Đây là tích hợp qua định dạng lưu trữ local, có thể cần cập nhật khi Claude đổi định dạng. Đã kiểm tra trên Claude 5.1231.2: chuyển 38 metadata Code sang hồ sơ đích, mở hội thoại “Video dài 8 phút” và nhận phản hồi SESSION_OK trong cùng session. Có 3 đường dẫn dự án không còn tồn tại; không bảo đảm tiếp tục các session đó trước khi khôi phục thư mục.

## Mở ứng dụng

Bản đóng gói cho Apple Silicon: `release/Claude Switch-darwin-arm64/Claude Switch.app`.

Mở trực tiếp hoặc kéo vào Applications. Claude Code phải được cài trên máy. App tìm CLI ở `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude` và PATH.

Chạy mã nguồn:

```sh
npm ci
npm run build:native
npm start
```

## Tải lại và đóng gói

Tải bản macOS Apple Silicon tại [GitHub Releases](https://github.com/DuongVuIT/claude-switch/releases). Giải nén ZIP và kéo **Claude Switch.app** vào Applications. Bản app chưa ký Developer ID/notarize; macOS có thể yêu cầu cho phép mở trong Privacy & Security.

Để tự build trên macOS, cài Node.js và Xcode Command Line Tools, chạy `npm ci`, `npm run build:native`, `npm test`, rồi `npm run package`. Kết quả nằm trong `release/Claude Switch-darwin-arm64/`.

Repo và file phát hành chỉ chứa ứng dụng, không chứa hồ sơ đăng nhập, token, hội thoại hay backup cá nhân. Dữ liệu đó vẫn ở máy đang dùng; tải app trên máy khác không tự khôi phục lịch sử.

## Cách dùng chế độ CLI

1. Tài khoản **Tài khoản trên máy** trỏ vào cấu hình Claude hiện có. App đọc lịch sử từ `~/.claude/projects` và metadata đã lưu; kiểm tra đăng nhập riêng bằng `claude auth status`.
2. Bấm **Thêm tài khoản**, đặt tên. Trước khi tạo profile đầu tiên, app tự sao lưu dữ liệu local nếu chưa có snapshot nào.
3. Bấm **Đăng nhập** trên thẻ tài khoản. App mở Terminal chạy `claude auth login` với `CLAUDE_CONFIG_DIR` riêng. Hoàn tất đăng nhập chính thức trong trình duyệt, sau đó bấm **Làm mới** trong app. Chọn đúng tài khoản trong luồng đăng nhập của Claude.
4. Bấm **Chọn** để đặt tài khoản cho các phiên mở tiếp theo.
5. Vào **Conversations**, tìm và mở hội thoại; chọn tài khoản rồi bấm **Tiếp tục trong Terminal**. App chạy CLI trong đúng `cwd` cũ với `--resume <session-id>`.
6. Với VS Code/Cursor, bấm **Sao chép lệnh cho terminal IDE**, dán vào terminal tích hợp của IDE. Lệnh chạy trong subshell nên không thay đổi biến môi trường của terminal cha. Đây là luồng cho terminal tích hợp; không đổi tài khoản của giao diện extension Claude đang chạy.
7. Trong **Kho dữ liệu**, tạo snapshot bổ sung và mở thư mục bản sao trong Finder.

**Dừng phiên đang chạy trước khi resume cùng một session bằng tài khoản khác.** Đổi lựa chọn trong app không thể thay tài khoản giữa chừng của một process Claude, một terminal đang chạy hoặc extension IDE. Không mở đồng thời nhiều process ghi vào cùng session.

## Dữ liệu nào được giữ?

| Thành phần | Cách xử lý |
| --- | --- |
| Sessions, transcript JSONL, subagents và auto memory trong `projects` | Profile mới liên kết tới toàn bộ thư mục gốc; không chuyển thành bản tóm tắt |
| `file-history`, `paste-cache`, `history.jsonl` | Dùng chung nguồn gốc qua symlink |
| `skills`, `rules`, `commands`, `agents`, `plugins`, `CLAUDE.md` | Kế thừa qua symlink khi có trên máy |
| `settings.json` | Profile mới sao chép và loại cấu hình ép tài khoản/provider (`ANTHROPIC_*`, OAuth env, `apiKeyHelper`, `forceLogin*`) |
| MCP cấp user | Sao chép định nghĩa `mcpServers` từ cấu hình global; secret trong định nghĩa, nếu có, chỉ ở backend/local file |
| Project configuration, source files và đính kèm ngoài thư mục Claude | Giữ ở vị trí cũ; dùng lại qua đúng thư mục dự án; không đưa toàn bộ repository vào backup |
| Tên, email, tổ chức, vai trò, gói, IDs và ngày tháng tài khoản có trong metadata | Hiển thị các trường nhận diện đã biết; cache được phân biệt với trạng thái đăng nhập thực |
| Token/mật khẩu | Claude Code quản lý; app không đọc Keychain, không hiển thị hoặc chuyển token qua renderer |

Không phải mọi tài khoản đều có đủ tất cả các trường metadata. Cache cũ có thể không phản ánh tài khoản đang đăng nhập. App không tự lấy usage/quota hoặc lịch sử chỉ có trên cloud qua API nội bộ không được tài liệu hóa.

Phiên mở qua app dùng `cleanupPeriodDays: 36500` bằng cờ `--settings`; profile mới cũng lưu giá trị này. App không sửa `settings.json` gốc. Các phiên mở ngoài app có thể vẫn áp dụng chính sách cleanup riêng của chúng. Hãy giữ snapshot định kỳ nếu cần lưu lâu dài.

## Snapshot và tính toàn vẹn

Mỗi snapshot chứa:

- Tất cả file thông thường và thư mục trong `~/.claude`.
- `~/.claude.json` dưới tên `global.claude.json`.
- Profile do app quản lý và `workspace.json`.
- `manifest.json` với kích thước và SHA-256 từng file, các symlink và cảnh báo.

Snapshot hoàn tất được đổi tên từ `.partial` sang tên chính thức. File thay đổi/biến mất trong quá trình sao lưu được báo cảnh báo; nên dừng Claude rồi sao lưu lại nếu cần một bản ổn định. Snapshot không thể bảo đảm nhất quán giao dịch khi một ứng dụng khác vẫn đang ghi dữ liệu.

Symlink được ghi nhận trong manifest, không đi theo liên kết ra ngoài cây dữ liệu. Socket, Keychain và dữ liệu chỉ có trên server không nằm trong snapshot. Snapshot **không phải bản chuyển tài khoản cloud** và không chuyển subscription, hạn mức, SSO, quyền workspace hoặc tệp chỉ có trên máy khác.

Dữ liệu ứng dụng mặc định ở `~/Library/Application Support/Claude Switch`. Thư mục app và backup có quyền `0700`; file do app tạo và snapshot là `0600`. **Snapshot không được mã hóa toàn bộ**, có thể chứa secret từ cấu hình gốc; không chia sẻ thư mục này công khai. App không sao chép credential từ profile gốc sang profile mới.

Để phục hồi thủ công: đóng các process Claude, mở snapshot trong Finder, đối chiếu manifest và khôi phục file cần thiết từ `claude/` về `~/.claude/`. `global.claude.json` tương ứng với `~/.claude.json`. Sao lưu trạng thái hiện tại trước khi ghi đè; các liên kết được tái tạo theo manifest nếu cần. Đăng nhập lại qua Claude nếu credential không còn. App chưa có nút phục hồi tự động.

## Kiểm thử và đóng gói

```sh
npm test
npm run test:ui
npm run build:native
npm run package
```

Core tests kiểm tra isolation, bảo toàn session/subagent, pagination, checksum/permissions và chống shell injection. Desktop tests kiểm tra đổi nguyên hồ sơ A/B, quit bị hủy, rollback khi rename lỗi, khôi phục journal sau crash và không lộ token. UI smoke test mở Electron với fixture trong thư mục tạm và bridge giả, kiểm tra chuyển desktop hai chiều cùng các luồng CLI. Fixture không sửa account, không đóng hoặc thay đổi dữ liệu Claude thật.

Không tự động đăng nhập hoặc gửi prompt có tính phí. Kiểm thử resume thật giữa hai tài khoản cần người dùng đăng nhập từng tài khoản. Bản `.app` cục bộ chưa được ký bằng Apple Developer ID/notarize để phân phối công khai.

Biến môi trường dùng cho development/testing: `CLAUDE_SWITCH_DATA_DIR`, `CLAUDE_SWITCH_SOURCE_DIR`, `CLAUDE_SWITCH_GLOBAL_CONFIG`, `CLAUDE_SWITCH_CLI`, `CLAUDE_SWITCH_DESKTOP_DIR`. `CLAUDE_SWITCH_TEST_DESKTOP=1` chỉ có tác dụng với bản không đóng gói để dùng bridge giả. Không đặt data dir bên trong source dir (sẽ gây backup đệ quy; app từ chối cấu hình này).

## Tài liệu nền tảng

- [Claude Code: nhiều tài khoản với CLAUDE_CONFIG_DIR](https://code.claude.com/docs/en/authentication#log-in-with-multiple-accounts)
- [Claude Code CLI: auth, resume và settings](https://code.claude.com/docs/en/cli-reference)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
