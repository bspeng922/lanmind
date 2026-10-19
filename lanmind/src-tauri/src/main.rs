#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if lanmind_lib::try_ai_script_worker() { return; }
    lanmind_lib::run();
}
