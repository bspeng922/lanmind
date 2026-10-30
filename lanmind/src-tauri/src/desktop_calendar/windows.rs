use std::ptr::null_mut;
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, GetShellWindow, GetWindow, GetWindowLongPtrW, SetWindowLongPtrW,
    SetWindowPos, GWLP_HWNDPARENT, GWL_EXSTYLE, GW_HWNDPREV, GW_OWNER, HWND_BOTTOM,
    HWND_NOTOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, WS_EX_TOPMOST,
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
    }
    place_on_bottom(hwnd)
}

fn place_on_bottom(hwnd: HWND) -> Result<(), String> {
    // Keep the calendar above its desktop owner and below application windows,
    // without moving Explorer's own windows or activating the calendar.
    let insert_after = unsafe {
        let owner = GetWindow(hwnd, GW_OWNER);
        if owner.is_null() {
            HWND_BOTTOM
        } else {
            let previous = GetWindow(owner, GW_HWNDPREV);
            if previous == hwnd && GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST == 0 {
                return Ok(());
            }
            // Inserting after a topmost window would make the calendar topmost.
            if previous.is_null() || previous == hwnd
                || GetWindowLongPtrW(previous, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0
            {
                HWND_NOTOPMOST
            } else {
                previous
            }
        }
    };
    if unsafe {
        SetWindowPos(hwnd, insert_after, 0, 0, 0, 0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER)
    } == 0 {
        return Err("无法设置桌面日历窗口层级".into());
    }
    Ok(())
}

pub(super) fn attach(hwnd: HWND) -> Result<(), String> {
    bind_to_host(hwnd, desktop_host(hwnd))
}

pub(super) fn detach(hwnd: HWND) -> Result<(), String> {
    // An owned window can raise its owner when activated. Detach before allowing
    // editing or resizing so focusing the calendar cannot raise Explorer's desktop
    // over other programs. This changes ownership, never the WebView2 parent.
    unsafe {
        SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
        if !GetWindow(hwnd, GW_OWNER).is_null() {
            return Err("无法解除桌面日历窗口归属".into());
        }
    }
    Ok(())
}

pub(super) fn refresh(hwnd: HWND) -> Result<(), String> {
    let host = desktop_host(hwnd);
    if !host.is_null() && unsafe { GetWindow(hwnd, GW_OWNER) } != host {
        return bind_to_host(hwnd, host);
    }
    // Activation and shell transitions can change z-order without changing owner.
    place_on_bottom(hwnd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    use std::time::Duration;
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetForegroundWindow,
        IsWindowVisible, PeekMessageW, RegisterClassW, TranslateMessage, WindowFromPoint,
        GWL_STYLE, HWND_TOP, HWND_TOPMOST, MSG, PM_REMOVE, WNDCLASSW,
        WS_CHILD, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP, WS_VISIBLE,
    };

    struct TestWindow(HWND);
    impl Drop for TestWindow {
        fn drop(&mut self) { unsafe { DestroyWindow(self.0); } }
    }

    fn test_window() -> TestWindow {
        // WindowFromPoint deliberately skips STATIC text controls.
        let class_name: Vec<u16> = "BUTTON\0".encode_utf16().collect();
        let title: Vec<u16> = "LanMind calendar input regression test\0".encode_utf16().collect();
        let window = TestWindow(unsafe {
            CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, class_name.as_ptr(), title.as_ptr(),
                WS_POPUP | WS_VISIBLE, 30, 30, 200, 100, null_mut(), null_mut(), null_mut(), std::ptr::null())
        });
        assert!(!window.0.is_null());
        window
    }

    fn raise_without_focus(window: &TestWindow) {
        // Stay above unrelated foreground apps during this isolated native test.
        assert_ne!(unsafe {
            SetWindowPos(window.0, HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER)
        }, 0);
    }

    fn assert_click_target(window: &TestWindow) {
        let point = POINT { x: 60, y: 60 };
        // Native z-order changes can precede the desktop's hit-test update.
        for _ in 0..50 {
            unsafe {
                let mut message: MSG = std::mem::zeroed();
                while PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
                if WindowFromPoint(point) == window.0 { return; }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(unsafe { WindowFromPoint(point) }, window.0,
            "the top visible application must receive the click");
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

    #[test]
    #[ignore = "requires an interactive Windows desktop and briefly displays disposable windows"]
    fn refresh_restores_application_click_target_without_owner_change() {
        let foreground = unsafe { GetForegroundWindow() };
        let host = test_window();
        // Give the disposable owner the same icon-view child as Explorer. The
        // refresh can then discover its desktop host without touching Explorer.
        let icon_class: Vec<u16> = "SHELLDLL_DefView\0".encode_utf16().collect();
        let mut class: WNDCLASSW = unsafe { std::mem::zeroed() };
        class.lpszClassName = icon_class.as_ptr();
        class.lpfnWndProc = Some(DefWindowProcW);
        assert_ne!(unsafe { RegisterClassW(&class) }, 0);
        let icons = TestWindow(unsafe {
            CreateWindowExW(0, icon_class.as_ptr(), std::ptr::null(), WS_CHILD,
                0, 0, 1, 1, host.0, null_mut(), null_mut(), std::ptr::null())
        });
        assert!(!icons.0.is_null());
        let calendar = test_window();
        bind_to_host(calendar.0, host.0).unwrap();
        attach(calendar.0).unwrap();
        let owner = unsafe { GetWindow(calendar.0, GW_OWNER) };
        assert!(!owner.is_null());
        let application = test_window();
        raise_without_focus(&application);
        assert_click_target(&application);

        // Reproduce a z-order change that the previous owner-only refresh missed.
        raise_without_focus(&calendar);
        assert_click_target(&calendar);
        assert_eq!(unsafe { GetWindow(calendar.0, GW_OWNER) }, owner);
        refresh(calendar.0).unwrap();

        assert_click_target(&application);
        assert!(is_above(calendar.0, owner), "calendar must remain visible above the desktop");
        assert_eq!(unsafe { GetWindowLongPtrW(calendar.0, GWL_EXSTYLE) } as u32 & WS_EX_TOPMOST, 0);
        assert_eq!(unsafe { GetForegroundWindow() }, foreground, "refresh must not steal focus");
    }

    #[test]
    #[ignore = "requires an interactive Windows desktop and briefly displays disposable windows"]
    fn editing_detaches_owner_and_locking_restores_application_click_target() {
        let foreground = unsafe { GetForegroundWindow() };
        // Use a disposable owner so this test never raises Explorer itself.
        let host = test_window();
        let calendar = test_window();
        bind_to_host(calendar.0, host.0).unwrap();
        let application = test_window();
        raise_without_focus(&application);

        detach(calendar.0).unwrap();
        assert!(unsafe { GetWindow(calendar.0, GW_OWNER) }.is_null());
        assert_ne!(unsafe {
            SetWindowPos(calendar.0, HWND_TOP, 0, 0, 0, 0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE)
        }, 0);
        assert!(is_above(application.0, host.0), "editing must not raise the desktop owner");
        assert_eq!(unsafe { GetWindowLongPtrW(calendar.0, GWL_STYLE) } as u32 & WS_CHILD, 0);

        bind_to_host(calendar.0, host.0).unwrap();
        assert_eq!(unsafe { GetWindow(calendar.0, GW_OWNER) }, host.0);
        assert_click_target(&application);
        assert!(is_above(application.0, host.0), "locking must preserve the owner's z-order");
        assert_eq!(unsafe { GetForegroundWindow() }, foreground);
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
