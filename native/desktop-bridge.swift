import AppKit
import Foundation

let bundleID = "com.anthropic.claudefordesktop"
func instances() -> [NSRunningApplication] { NSRunningApplication.runningApplications(withBundleIdentifier: bundleID) }
func emit(_ value: [String: Any], code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    exit(code)
}
let action = CommandLine.arguments.dropFirst().first ?? "status"
if action == "status" {
    emit(["installed": NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) != nil, "running": !instances().isEmpty, "pids": instances().map { $0.processIdentifier }])
}
if action == "quit" {
    for instance in instances() {
        if !instance.terminate() { emit(["error": "Claude từ chối yêu cầu thoát. Hoàn tất tác vụ và đóng Claude rồi thử lại."], code: 1) }
    }
    let deadline = Date().addingTimeInterval(25)
    while !instances().isEmpty && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.15)) }
    if !instances().isEmpty { emit(["error": "Claude chưa thoát hẳn. Xử lý hộp thoại trong Claude hoặc đợi tác vụ hoàn tất rồi thử lại. Chưa thay đổi dữ liệu."], code: 1) }
    emit(["stopped": true])
}
if action == "open" {
    let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
    guard let appURL = url else { emit(["error": "Không tìm thấy ứng dụng Claude chính thức."], code: 1) }
    let config = NSWorkspace.OpenConfiguration()
    config.activates = true
    NSWorkspace.shared.openApplication(at: appURL, configuration: config) { app, error in
        if let error = error { emit(["error": error.localizedDescription], code: 1) }
        emit(["opened": app != nil])
    }
    RunLoop.main.run()
}
emit(["error": "Unknown action"], code: 1)
