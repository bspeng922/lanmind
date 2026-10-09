//! Frozen desktop capture and region selection. Images stay in memory until the
//! user confirms; cancellation and every error path restore the chat window.
use base64::Engine;
use serde::Deserialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::{borrow::Cow, io::Cursor};
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;
use xcap::image::{self, ImageFormat, RgbaImage};

const WINDOW_LABEL: &str = "chat-screenshot";

#[derive(Default)]
pub struct ScreenshotRuntime {
    busy: AtomicBool,
    cancelled: AtomicBool,
    finishing: AtomicBool,
    clipboard: Mutex<Option<arboard::Clipboard>>,
    session: Mutex<Option<Session>>,
}

struct Session {
    image: RgbaImage,
    frame_url: String,
    ready: Option<oneshot::Sender<()>>,
    reply: Option<oneshot::Sender<Result<(), String>>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenshotAction {
    Copy,
    Save,
}

#[derive(Deserialize)]
pub struct ScreenshotRegion {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

fn png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(bytes.into_inner())
}

fn save_png(path: &std::path::Path, image: &RgbaImage) -> Result<(), String> {
    std::fs::write(path, png(image)?).map_err(|error| error.to_string())
}

fn copy_image(clipboard: &mut arboard::Clipboard, image: &RgbaImage) -> Result<(), String> {
    clipboard
        .set_image(arboard::ImageData {
            width: image.width() as usize,
            height: image.height() as usize,
            bytes: Cow::Borrowed(image.as_raw()),
        })
        .map_err(|error| error.to_string())
}

fn crop(image: &RgbaImage, region: &ScreenshotRegion) -> Result<RgbaImage, String> {
    if region.width == 0
        || region.height == 0
        || region.x >= image.width()
        || region.y >= image.height()
        || region.width > image.width() - region.x
        || region.height > image.height() - region.y
    {
        return Err("Invalid screenshot region".into());
    }
    Ok(
        image::imageops::crop_imm(image, region.x, region.y, region.width, region.height)
            .to_image(),
    )
}

pub fn cancel(app: &AppHandle) {
    if let Some(state) = app.try_state::<ScreenshotRuntime>() {
        state.cancelled.store(true, Ordering::Release);
        if let Ok(mut session) = state.session.lock() {
            if let Some(reply) = session.as_mut().and_then(|session| session.reply.take()) {
                let _ = reply.send(Ok(()));
            }
        }
    }
}

struct Cleanup {
    app: AppHandle,
    requester: WebviewWindow,
    hidden: bool,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        let state = self.app.state::<ScreenshotRuntime>();
        if let Ok(mut session) = state.session.lock() {
            session.take();
        }
        if let Some(window) = self.app.get_webview_window(WINDOW_LABEL) {
            let _ = window.destroy();
        }
        if self.hidden {
            let _ = self.requester.show();
        }
        let _ = self.requester.set_focus();
        state.busy.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn capture_chat_screenshot(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, ScreenshotRuntime>,
    hide_window: bool,
) -> Result<(), String> {
    if window.label() != "main" || crate::app_interface_locked(&app) {
        return Err("Screenshot requires the unlocked main window".into());
    }
    if state
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A screenshot is already in progress".into());
    }
    state.cancelled.store(false, Ordering::Release);
    state.finishing.store(false, Ordering::Release);
    let mut cleanup = Cleanup {
        app: app.clone(),
        requester: window.clone(),
        hidden: false,
    };
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "No screen is available".to_string())?;
    let position = *monitor.position();
    let size = *monitor.size();
    let scale = monitor.scale_factor();
    if hide_window && window.is_visible().map_err(|error| error.to_string())? {
        window.hide().map_err(|error| error.to_string())?;
        cleanup.hidden = true;
        // Allow the desktop compositor to repaint after hiding the main window.
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    let center_x = position.x as f64 + size.width as f64 / 2.0;
    let center_y = position.y as f64 + size.height as f64 / 2.0;
    // CoreGraphics locates displays in points; Windows/X11 use physical pixels.
    #[cfg(target_os = "macos")]
    let (center_x, center_y) = (center_x / scale, center_y / scale);
    let (image, frame) = tauri::async_runtime::spawn_blocking(move || {
        let monitor = xcap::Monitor::from_point(center_x as i32, center_y as i32)
            .map_err(|error| error.to_string())?;
        let image = monitor.capture_image().map_err(|error| error.to_string())?;
        let frame = png(&image)?;
        Ok::<_, String>((image, frame))
    })
    .await
    .map_err(|error| error.to_string())??;
    if state.cancelled.load(Ordering::Acquire) || crate::app_interface_locked(&app) {
        return Ok(());
    }

    let (reply, mut response) = oneshot::channel();
    let (ready, ready_response) = oneshot::channel();
    *state
        .session
        .lock()
        .map_err(|_| "Screenshot session is unavailable")? = Some(Session {
        image,
        frame_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(frame)
        ),
        ready: Some(ready),
        reply: Some(reply),
    });
    let overlay = WebviewWindowBuilder::new(
        &app,
        WINDOW_LABEL,
        WebviewUrl::App("screenshot.html".into()),
    )
    .title("LanMind")
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .inner_size(size.width as f64 / scale, size.height as f64 / scale)
    .build()
    .map_err(|error| error.to_string())?;
    overlay
        .set_position(position)
        .map_err(|error| error.to_string())?;
    overlay.set_size(size).map_err(|error| error.to_string())?;
    let cancel_app = app.clone();
    overlay.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
        ) {
            cancel(&cancel_app);
        }
    });
    if state.cancelled.load(Ordering::Acquire) {
        cancel(&app);
    }
    tokio::select! {
        result = &mut response => return result.map_err(|_| "Screenshot selection closed".to_string())?,
        result = tokio::time::timeout(std::time::Duration::from_secs(15), ready_response) => {
            result.map_err(|_| "Screenshot window failed to load".to_string())?
                .map_err(|_| "Screenshot selection closed".to_string())?;
        }
    }
    // Recover even if the selection renderer fails to load or stops responding.
    tokio::time::timeout(std::time::Duration::from_secs(300), response)
        .await
        .map_err(|_| "Screenshot selection timed out".to_string())?
        .map_err(|_| "Screenshot selection closed".to_string())?
}

fn require_overlay(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != WINDOW_LABEL || crate::app_interface_locked(window.app_handle()) {
        return Err("Screenshot selection is unavailable".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_screenshot_frame(
    window: WebviewWindow,
    state: State<'_, ScreenshotRuntime>,
) -> Result<String, String> {
    require_overlay(&window)?;
    state
        .session
        .lock()
        .map_err(|_| "Screenshot session is unavailable")?
        .as_ref()
        .map(|session| session.frame_url.clone())
        .ok_or_else(|| "Screenshot session closed".into())
}

#[tauri::command]
pub fn screenshot_ready(
    window: WebviewWindow,
    state: State<'_, ScreenshotRuntime>,
) -> Result<(), String> {
    require_overlay(&window)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    if let Some(ready) = state
        .session
        .lock()
        .map_err(|_| "Screenshot session is unavailable")?
        .as_mut()
        .and_then(|session| session.ready.take())
    {
        let _ = ready.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn finish_screenshot(
    window: WebviewWindow,
    state: State<'_, ScreenshotRuntime>,
    region: ScreenshotRegion,
    action: ScreenshotAction,
) -> Result<bool, String> {
    require_overlay(&window)?;
    if state.finishing.swap(true, Ordering::AcqRel) {
        return Err("Screenshot action is already in progress".into());
    }
    struct ActionGuard<'a>(&'a AtomicBool);
    impl Drop for ActionGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::Release);
        }
    }
    let _guard = ActionGuard(&state.finishing);
    let image = {
        let session = state
            .session
            .lock()
            .map_err(|_| "Screenshot session is unavailable")?;
        let session = session.as_ref().ok_or("Screenshot session closed")?;
        if session.reply.is_none() {
            return Err("Screenshot already completed".into());
        }
        crop(&session.image, &region)?
    };
    match action {
        ScreenshotAction::Copy => {
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let state = app.state::<ScreenshotRuntime>();
                let mut clipboard = state
                    .clipboard
                    .lock()
                    .map_err(|_| "Clipboard is unavailable")?;
                if clipboard.is_none() {
                    *clipboard =
                        Some(arboard::Clipboard::new().map_err(|error| error.to_string())?);
                }
                copy_image(clipboard.as_mut().unwrap(), &image)
            })
            .await
            .map_err(|error| error.to_string())??;
        }
        ScreenshotAction::Save => {
            let app = window.app_handle().clone();
            let dialog_window = window.clone();
            // Native dialogs must appear above the full-screen selection window.
            window
                .set_always_on_top(false)
                .map_err(|error| error.to_string())?;
            let result = tauri::async_runtime::spawn_blocking(move || {
                let filename = format!(
                    "Screenshot-{}.png",
                    chrono::Local::now().format("%Y%m%d-%H%M%S")
                );
                let destination = app
                    .dialog()
                    .file()
                    .set_parent(&dialog_window)
                    .set_title(crate::i18n::translate(
                        &crate::i18n::app_locale(&app),
                        "chat",
                        "screenshot.saveAs",
                        &[],
                    ))
                    .set_file_name(filename)
                    .add_filter("PNG", &["png"])
                    .blocking_save_file();
                let Some(destination) = destination else {
                    return Ok(false);
                };
                let mut path = destination.into_path().map_err(|error| error.to_string())?;
                if path.extension().is_none() {
                    path.set_extension("png");
                }
                save_png(&path, &image)?;
                Ok::<_, String>(true)
            })
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result);
            let _ = window.set_always_on_top(true);
            let _ = window.set_focus();
            if !result? {
                return Ok(false);
            }
        }
    }
    if let Some(reply) = state
        .session
        .lock()
        .map_err(|_| "Screenshot session is unavailable")?
        .as_mut()
        .and_then(|session| session.reply.take())
    {
        let _ = reply.send(Ok(()));
    }
    Ok(true)
}

#[tauri::command]
pub fn cancel_screenshot(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != WINDOW_LABEL && window.label() != "main" {
        return Err("Screenshot selection is unavailable".into());
    }
    cancel(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_png_with_original_pixels_and_reports_write_failures() {
        let image = RgbaImage::from_pixel(7, 5, image::Rgba([20, 40, 60, 255]));
        let path = std::env::temp_dir().join(format!(
            "lanmind-screenshot-test-{}.png",
            uuid::Uuid::new_v4()
        ));
        save_png(&path, &image).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        std::fs::remove_file(&path).unwrap();
        assert_eq!(image::load_from_memory(&bytes).unwrap().to_rgba8(), image);
        assert!(save_png(&path.join("missing-parent.png"), &image).is_err());
    }

    #[test]
    #[ignore = "requires the system image clipboard"]
    fn native_clipboard_roundtrip() {
        struct Restore {
            clipboard: arboard::Clipboard,
            image: Option<arboard::ImageData<'static>>,
            text: Option<String>,
        }
        impl Drop for Restore {
            fn drop(&mut self) {
                if let Some(image) = self.image.take() {
                    let _ = self.clipboard.set_image(image);
                } else if let Some(text) = self.text.take() {
                    let _ = self.clipboard.set_text(text);
                } else {
                    let _ = self.clipboard.clear();
                }
            }
        }
        let mut clipboard = arboard::Clipboard::new().unwrap();
        let image = clipboard.get_image().ok();
        let text = clipboard.get_text().ok();
        let mut restore = Restore {
            clipboard,
            image,
            text,
        };
        let source = RgbaImage::from_pixel(7, 5, image::Rgba([20, 40, 60, 255]));
        copy_image(&mut restore.clipboard, &source).unwrap();
        let pasted = restore.clipboard.get_image().unwrap();
        assert_eq!((pasted.width, pasted.height), (7, 5));
        assert_eq!(pasted.bytes.as_ref(), source.as_raw());
    }

    #[test]
    fn png_roundtrip_preserves_dimensions_and_pixels() {
        let image = RgbaImage::from_pixel(7, 5, image::Rgba([20, 40, 60, 255]));
        let bytes = png(&image).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(decoded, image);
    }

    #[test]
    #[ignore = "requires a graphical desktop and screen recording permission"]
    fn native_screen_capture() {
        let monitor = xcap::Monitor::all()
            .unwrap()
            .into_iter()
            .next()
            .expect("display");
        let captured = monitor.capture_image().unwrap();
        assert!(captured.width() > 0 && captured.height() > 0);
        let cropped = crop(
            &captured,
            &ScreenshotRegion {
                x: 0,
                y: 0,
                width: 16.min(captured.width()),
                height: 16.min(captured.height()),
            },
        )
        .unwrap();
        assert!(!png(&cropped).unwrap().is_empty());
    }

    #[test]
    fn crop_preserves_pixels_and_validates_edges() {
        let image = RgbaImage::from_fn(8, 6, |x, y| image::Rgba([x as u8, y as u8, 0, 255]));
        let cropped = crop(
            &image,
            &ScreenshotRegion {
                x: 3,
                y: 2,
                width: 5,
                height: 4,
            },
        )
        .unwrap();
        assert_eq!(cropped.dimensions(), (5, 4));
        assert_eq!(*cropped.get_pixel(0, 0), image::Rgba([3, 2, 0, 255]));
        assert_eq!(*cropped.get_pixel(4, 3), image::Rgba([7, 5, 0, 255]));
        for region in [
            ScreenshotRegion {
                x: 0,
                y: 0,
                width: 0,
                height: 1,
            },
            ScreenshotRegion {
                x: 8,
                y: 0,
                width: 1,
                height: 1,
            },
            ScreenshotRegion {
                x: 0,
                y: 6,
                width: 1,
                height: 1,
            },
            ScreenshotRegion {
                x: 1,
                y: 1,
                width: u32::MAX,
                height: 1,
            },
            ScreenshotRegion {
                x: 0,
                y: 0,
                width: 1,
                height: 7,
            },
        ] {
            assert!(crop(&image, &region).is_err());
        }
    }
}
