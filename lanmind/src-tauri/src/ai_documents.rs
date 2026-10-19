//! Bounded document extraction and real OOXML exports; no macros or external links execute.
use crate::ai_types::*;
use serde_json::Value;
use std::io::{Cursor, Read, Write};

pub fn extract(name: &str, bytes: &[u8]) -> AiResult<String> {
    if bytes.len() > 20_000_000 {
        return Err(AiError::new("FILE_LIMIT", "文档最多 20 MB"));
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let text = match ext.as_str() {
        "pdf" => pdf_extract::extract_text_from_mem(bytes).map_err(|_| {
            AiError::new("DOCUMENT_ERROR", "PDF 文本提取失败；扫描文件请先进行 OCR")
        })?,
        "docx" => {
            let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
                .map_err(|_| AiError::new("DOCUMENT_ERROR", "Word 文件格式无效"))?;
            let file = archive
                .by_name("word/document.xml")
                .map_err(|_| AiError::new("DOCUMENT_ERROR", "Word 正文不存在"))?;
            if file.size() > 10_000_000 {
                return Err(AiError::new("FILE_LIMIT", "解压后的文档过大"));
            }
            let mut xml = String::new();
            file.take(10_000_001).read_to_string(&mut xml)?;
            let mut reader = quick_xml::Reader::from_str(&xml);
            let mut result = String::new();
            loop {
                match reader.read_event() {
                    Ok(quick_xml::events::Event::Text(t)) => result.push_str(
                        &t.unescape()
                            .map_err(|_| AiError::new("DOCUMENT_ERROR", "Word 文本编码无效"))?,
                    ),
                    Ok(quick_xml::events::Event::End(e))
                        if matches!(e.name().as_ref(), b"w:p" | b"w:tr") =>
                    {
                        result.push('\n')
                    }
                    Ok(quick_xml::events::Event::Eof) => break,
                    Err(_) => return Err(AiError::new("DOCUMENT_ERROR", "Word XML 无效")),
                    _ => {}
                }
            }
            result
        }
        "xlsx" | "xls" | "ods" => {
            // Reject compressed zip bombs before invoking the workbook parser.
            if let Ok(mut zip) = zip::ZipArchive::new(Cursor::new(bytes)) {
                let mut total = 0u64;
                for n in 0..zip.len() {
                    let entry = zip
                        .by_index(n)
                        .map_err(|_| AiError::new("DOCUMENT_ERROR", "工作簿无效"))?;
                    total = total.saturating_add(entry.size());
                    if total > 50_000_000 {
                        return Err(AiError::new("FILE_LIMIT", "解压后的工作簿过大"));
                    }
                }
            }
            use calamine::Reader;
            let mut workbook = calamine::open_workbook_auto_from_rs(Cursor::new(bytes))
                .map_err(|_| AiError::new("DOCUMENT_ERROR", "无法读取工作簿"))?;
            let mut result = String::new();
            for sheet in workbook.sheet_names().to_owned().iter().take(20) {
                result.push_str(&format!("\n## {sheet}\n"));
                if let Ok(range) = workbook.worksheet_range(sheet) {
                    for row in range.rows().take(10000) {
                        result.push_str(
                            &row.iter()
                                .take(100)
                                .map(ToString::to_string)
                                .collect::<Vec<_>>()
                                .join("\t"),
                        );
                        result.push('\n');
                        if result.len() > 2_000_000 {
                            break;
                        }
                    }
                }
                if result.len() > 2_000_000 {
                    break;
                }
            }
            result
        }
        "txt" | "md" | "csv" | "tsv" | "json" | "jsonl" | "xml" | "html" | "css" | "js" | "jsx"
        | "ts" | "tsx" | "py" | "rs" | "toml" | "yaml" | "yml" | "log" | "sql" | "sh" | "ps1" => {
            String::from_utf8(bytes.to_vec())
                .map_err(|_| AiError::new("DOCUMENT_ERROR", "文本必须使用 UTF-8 编码"))?
        }
        _ => {
            return Err(AiError::new(
                "UNSUPPORTED_DOCUMENT",
                "支持 UTF-8 文本、PDF、DOCX 和电子表格",
            ))
        }
    };
    if text.len() > 2_000_000 {
        return Err(AiError::new("FILE_LIMIT", "文档文本过长，请拆分后读取"));
    }
    Ok(text)
}
fn xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn archive(entries: Vec<(&str, String)>) -> AiResult<Vec<u8>> {
    let mut output = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, content) in entries {
        output
            .start_file(name, zip::write::SimpleFileOptions::default())
            .map_err(|e| AiError::new("DOCUMENT_ERROR", e.to_string()))?;
        output.write_all(content.as_bytes())?;
    }
    Ok(output
        .finish()
        .map_err(|e| AiError::new("DOCUMENT_ERROR", e.to_string()))?
        .into_inner())
}
pub fn export(format: &str, content: &str, rows: Option<&Value>) -> AiResult<Vec<u8>> {
    if content.len() > 2_000_000 {
        return Err(AiError::new("FILE_LIMIT", "导出内容过大"));
    }
    match format {
        "txt" | "md" | "csv" | "json" => Ok(content.as_bytes().to_vec()),
        "docx" => {
            let paragraphs = content
                .lines()
                .map(|line| {
                    format!(
                        "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                        xml(line)
                    )
                })
                .collect::<String>();
            archive(vec![("[Content_Types].xml","<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>".into()),("_rels/.rels","<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>".into()),("word/document.xml",format!("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{paragraphs}<w:sectPr/></w:body></w:document>"))])
        }
        "xlsx" => {
            let rows = rows
                .and_then(Value::as_array)
                .ok_or_else(|| AiError::new("INVALID_ARGUMENTS", "XLSX 导出需要二维 rows 数组"))?;
            if rows.len() > 10000
                || rows
                    .iter()
                    .any(|r| r.as_array().is_none_or(|a| a.len() > 100))
            {
                return Err(AiError::new("FILE_LIMIT", "工作表最多 10000 行、100 列"));
            }
            let data = rows
                .iter()
                .map(|row| {
                    format!(
                        "<row>{}</row>",
                        row.as_array()
                            .unwrap()
                            .iter()
                            .map(|cell| format!(
                                "<c t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
                                xml(&cell
                                    .as_str()
                                    .map(str::to_string)
                                    .unwrap_or_else(|| cell.to_string()))
                            ))
                            .collect::<String>()
                    )
                })
                .collect::<String>();
            archive(vec![("[Content_Types].xml","<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>".into()),("_rels/.rels","<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>".into()),("xl/workbook.xml","<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>".into()),("xl/_rels/workbook.xml.rels","<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>".into()),("xl/worksheets/sheet1.xml",format!("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>{data}</sheetData></worksheet>"))])
        }
        _ => Err(AiError::new(
            "UNSUPPORTED_DOCUMENT",
            "支持导出 txt、md、csv、json、docx 和 xlsx",
        )),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn real_office_documents_round_trip() {
        let word = export("docx", "你好 <世界>\n第二行", None).unwrap();
        assert!(extract("test.docx", &word).unwrap().contains("你好 <世界>"));
        let rows = serde_json::json!([["姓名", "值"], ["中文", "=danger()"]]);
        let sheet = export("xlsx", "", Some(&rows)).unwrap();
        let text = extract("test.xlsx", &sheet).unwrap();
        assert!(text.contains("=danger()"));
        assert!(text.contains("中文"));
    }
}
