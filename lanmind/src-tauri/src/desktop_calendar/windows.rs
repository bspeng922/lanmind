use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, GetShellWindow, GetWindow, SetWindowLongPtrW, SetWindowPos,
    GWLP_HWNDPARENT, GW_OWNER, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};

struct DesktopSearch {
    class_name: Vec<u16>,
    host: HWND,
}

unsafe extern "system" fn find_icon_host(hwnd: HWND, data: LPARAM) -> BOOL {
    let search = &mut *(data as *mut DesktopSearch);
    if !FindWindowExW(hwnd, null_mut(), search.class_name.as_ptr(), std::ptr::null()).is_null() {
        search.host = hwnd;
        return 0;
    }
    1
}

fn desktop_host(hwnd: HWND) -> HWND {
    let mut search = DesktopSearch {
        class_name: "SHELLDLL_DefView\0".encode_utf16().collect(),
        host: null_mut(),
    };
    unsafe {
        // Explorer moves its icon view from Progman into a raised WorkerW on Win+D,
        // then moves it back. GetShellWindow alone continues returning Progman.
        // Check the existing owner first so stable desktop state needs no enumeration.
        let owner = GetWindow(hwnd, GW_OWNER);
        if !owner.is_null()
            && !FindWindowExW(owner, null_mut(), search.class_name.as_ptr(), std::ptr::null()).is_null()
        {
            return owner;
        }
        let shell = GetShellWindow();
        if !shell.is_null()
            && !FindWindowExW(shell, null_mut(), search.class_name.as_ptr(), std::ptr::null()).is_null()
        {
            return shell;
        }
        EnumWindows(Some(find_icon_host), &mut search as *mut DesktopSearch as LPARAM);
        if search.host.is_null() { shell } else { search.host }
    }
}

fn bind_to_host(hwnd: HWND, host: HWND) -> Result<(), String> {
    if host.is_null() {
        // Explorer can be between desktop hosts. The next refresh will try again.
        return Ok(());
    }
    unsafe {
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, host as isize);
        if GetWindow(hwnd, GW_OWNER) != host {
            return Err("无法设置桌面日历窗口归属".into());
        }
        // Ownership puts the calendar immediately above the actual desktop host,
        // while bottom placement keeps ordinary application windows above it.
        // Keep the WebView2 host top-level: reparenting it breaks transparent DWM rendering.
        if SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE) == 0 {
            return Err("无法设置桌面日历窗口层级".into());
        }
    }
    Ok(())
}

pub(super) fn attach(hwnd: HWND) -> Result<(), String> {
    bind_to_host(hwnd, desktop_host(hwnd))
}

pub(super) fn refresh(hwnd: HWND) -> Result<(), String> {
    let host = desktop_host(hwnd);
    if !host.is_null() && unsafe { GetWindow(hwnd, GW_OWNER) } != host {
        bind_to_host(hwnd, host)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::time::Duration;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, DispatchMessageW, GetForegroundWindow, GetWindowLongPtrW,
        IsWindowVisible, PeekMessageW, TranslateMessage, GWL_STYLE, GW_HWNDPREV, MSG, PM_REMOVE,
        WS_CHILD, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP, WS_VISIBLE,
    };

    struct TestWindow(HWND);
    impl Drop for TestWindow {
        fn drop(&mut self) { unsafe { DestroyWindow(self.0); } }
    }

    fn toggle_desktop() {
        assert!(Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "(New-Object -ComObject Shell.Application).ToggleDesktop()"])
            .creation_flags(0x08000000)
            .status().unwrap().success());
    }

    struct DesktopRestore(usize);
    impl Drop for DesktopRestore {
        fn drop(&mut self) {
            if self.0 % 2 == 1 { toggle_desktop(); }
        }
    }

    fn is_above(hwnd: HWND, other: HWND) -> bool {
        unsafe {
            let mut current = GetWindow(hwnd, GW_HWNDPREV);
            while !current.is_null() {
                if current == other { return false; }
                current = GetWindow(current, GW_HWNDPREV);
            }
        }
        true
    }

    // An explicit native regression test: it toggles the real Explorer desktop,
    // restores it even on failure, and uses only a disposable window, never user data.
    #[test]
    #[ignore = "requires an interactive Windows desktop and temporarily toggles Show Desktop"]
    fn show_desktop_keeps_calendar_above_icon_host() {
        let class_name: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let title: Vec<u16> = "LanMind desktop calendar regression test\0".encode_utf16().collect();
        let window = TestWindow(unsafe {
            CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, class_name.as_ptr(), title.as_ptr(),
                WS_POPUP | WS_VISIBLE, 30, 30, 200, 100, null_mut(), null_mut(), null_mut(), std::ptr::null())
        });
        assert!(!window.0.is_null());
        attach(window.0).unwrap();
        let mut desktop = DesktopRestore(0);
        for _ in 0..4 {
            toggle_desktop();
            desktop.0 += 1;
            for _ in 0..20 {
                unsafe {
                    let mut message: MSG = std::mem::zeroed();
                    while PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) != 0 {
                        TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
                refresh(window.0).unwrap();
                std::thread::sleep(Duration::from_millis(50));
            }
            let host = desktop_host(window.0);
            assert!(!host.is_null());
            assert_eq!(unsafe { GetWindow(window.0, GW_OWNER) }, host);
            assert!(is_above(window.0, host), "calendar must remain above the actual icon host");
            assert_ne!(unsafe { GetForegroundWindow() }, window.0, "refresh must not steal focus");
            assert_ne!(unsafe { IsWindowVisible(window.0) }, 0);
            assert_eq!(unsafe { GetWindowLongPtrW(window.0, GWL_STYLE) } as u32 & WS_CHILD, 0,
                "calendar must retain its top-level composition surface");
        }
    }
}
