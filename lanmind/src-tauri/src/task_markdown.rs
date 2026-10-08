use pulldown_cmark::{Event, Options, Parser};

pub fn reset_checklist(markdown: &str) -> String {
    let markers = Parser::new_ext(markdown, Options::ENABLE_TASKLISTS)
        .into_offset_iter()
        .filter_map(|(event, range)| matches!(event, Event::TaskListMarker(true)).then_some(range))
        .collect::<Vec<_>>();
    let mut result = markdown.to_string();
    for range in markers.into_iter().rev() { result.replace_range(range, "[ ]"); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resets_only_real_markdown_checklist_markers() {
        let markdown = "正文\n\n![图片](lanmind-attachment:image)\n\n- [x] 检查\n- [ ] 保留\n\n```md\n- [x] 示例\n```";
        assert_eq!(reset_checklist(markdown), markdown.replacen("- [x] 检查", "- [ ] 检查", 1));
    }
}
