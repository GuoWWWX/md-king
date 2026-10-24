use regex::Regex;
use std::collections::HashSet;

pub const BODY_END_BOOKMARK: &str = "_MDKingBodyEnd";

pub fn ensure_body_end_bookmark(xml: &str) -> String {
    if xml.contains(&format!("w:name=\"{BODY_END_BOOKMARK}\"")) {
        return xml.to_string();
    }
    let paragraph = Regex::new(r#"(?s)<w:p\b[^>]*/>|<w:p\b[^>]*>.*?</w:p>"#).unwrap();
    let Some(last) = paragraph.find_iter(xml).last() else { return xml.to_string(); };
    let ids = Regex::new(r#"<w:bookmark(?:Start|End)\b[^>]*w:id="(\d+)""#).unwrap();
    let id = ids.captures_iter(xml).filter_map(|value| value[1].parse::<u64>().ok()).max().unwrap_or(0) + 1;
    let marker = format!(r#"<w:bookmarkStart w:id="{id}" w:name="{BODY_END_BOOKMARK}"/><w:bookmarkEnd w:id="{id}"/>"#);
    let mut output = xml.to_string();
    if last.as_str().ends_with("/>") {
        output.replace_range(last.range(), &format!("{}>{marker}</w:p>", last.as_str().trim_end_matches("/>")));
    } else {
        output.insert_str(last.end() - "</w:p>".len(), &marker);
    }
    output
}

/// Apply explicit Markdown keep-together blocks without guessing from business text.
pub fn normalize_keep_together(xml: &str) -> String {
    if !xml.contains("MDKING_LAYOUT_KEEP") {
        return xml.to_string();
    }
    let paragraph = Regex::new(r#"(?s)<w:p\b[^>]*>.*?</w:p>"#).unwrap();
    let paragraphs = paragraph.find_iter(xml).collect::<Vec<_>>();
    let marker = |value: &str| {
        if value.contains(">MDKING_LAYOUT_KEEP_PREVIOUS_START</w:t>") { 2 }
        else if value.contains(">MDKING_LAYOUT_KEEP_START</w:t>") { 1 }
        else if value.contains(">MDKING_LAYOUT_KEEP_END</w:t>") { -1 }
        else if value.contains(">MDKING_LAYOUT_KEEP_PREVIOUS_END</w:t>") { -1 }
        else { 0 }
    };
    let mut stack = Vec::new();
    let mut removed = HashSet::new();
    let mut kept = HashSet::new();
    let mut keep_next = HashSet::new();
    let rows = Regex::new(r#"(?s)<w:tr\b[^>]*>.*?</w:tr>"#).unwrap();
    for (index, item) in paragraphs.iter().enumerate() {
        match marker(item.as_str()) {
            kind @ (1 | 2) => stack.push((index, kind == 2)),
            -1 => if let Some((start, with_previous)) = stack.pop() {
                removed.extend([start, index]);
                let mut content = (start + 1..index).filter(|i| marker(paragraphs[*i].as_str()) == 0).collect::<Vec<_>>();
                if with_previous {
                    if let Some(previous) = (0..start).rev().find(|i| marker(paragraphs[*i].as_str()) == 0) {
                        let row = rows.find_iter(&xml[..paragraphs[start].start()]).last()
                            .filter(|row| row.start() <= paragraphs[previous].start() && row.end() >= paragraphs[previous].end());
                        let from = row.map(|row| paragraphs.iter().position(|p| p.start() >= row.start()).unwrap_or(previous)).unwrap_or(previous);
                        content.splice(0..0, from..=previous);
                    }
                }
                kept.extend(content.iter().copied());
                keep_next.extend(content.iter().take(content.len().saturating_sub(1)).copied());
            },
            _ => {}
        }
    }
    let properties = Regex::new(r#"(?s)<w:pPr\b[^>]*/>|<w:pPr\b[^>]*>.*?</w:pPr>"#).unwrap();
    let old_flow = Regex::new(r#"<w:(?:keepNext|keepLines)\b[^>]*/>"#).unwrap();
    let mut output = xml.to_string();
    for (index, item) in paragraphs.iter().enumerate().rev() {
        if removed.contains(&index) {
            output.replace_range(item.range(), "");
        } else if kept.contains(&index) {
            let flow = format!(r#"<w:keepLines/><w:keepNext w:val="{}"/>"#, if keep_next.contains(&index) { 1 } else { 0 });
            let value = if let Some(properties) = properties.find(item.as_str()) {
                let existing = old_flow.replace_all(properties.as_str(), "");
                let replacement = if existing.ends_with("/>") {
                    format!("{}>{flow}</w:pPr>", existing.trim_end_matches("/>"))
                } else {
                    existing.replace("</w:pPr>", &format!("{flow}</w:pPr>"))
                };
                item.as_str().replacen(properties.as_str(), &replacement, 1)
            } else {
                item.as_str().replacen('>', &format!("><w:pPr>{flow}</w:pPr>"), 1)
            };
            output.replace_range(item.range(), &value);
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(text: &str) -> String { format!("<w:p><w:r><w:t>{text}</w:t></w:r></w:p>") }

    #[test]
    fn total_page_bookmark_uses_a_unique_id_at_the_end_of_body() {
        let xml = format!("<w:body><w:bookmarkStart w:id=\"9\" w:name=\"other\"/>{}<w:sectPr/></w:body>", p("末页"));
        let result = ensure_body_end_bookmark(&xml);
        assert!(result.contains("w:id=\"10\" w:name=\"_MDKingBodyEnd\""));
        assert!(result.contains("<w:bookmarkEnd w:id=\"10\"/></w:p><w:sectPr/>"));
        assert_eq!(result, ensure_body_end_bookmark(&result));
    }

    #[test]
    fn keeps_explicit_group_and_leaves_following_content_independent() {
        let xml = [p("前文"), p("MDKING_LAYOUT_KEEP_START"), p("授权承诺"), p("签字"), p("日期"), p("MDKING_LAYOUT_KEEP_END"), p("后文")].concat();
        let result = normalize_keep_together(&xml);
        assert!(!result.contains("MDKING_LAYOUT"));
        assert_eq!(result.matches("<w:keepLines/>").count(), 3);
        assert_eq!(result.matches("w:keepNext w:val=\"1\"").count(), 2);
        assert_eq!(result.matches("w:keepNext w:val=\"0\"").count(), 1);
        assert!(result.starts_with(&p("前文")) && result.ends_with(&p("后文")));
        assert_eq!(result, normalize_keep_together(&result));
    }

    #[test]
    fn nested_groups_keep_outer_continuity_and_do_not_delete_page_breaks() {
        let xml = [p("MDKING_LAYOUT_KEEP_START"), p("甲"), p("MDKING_LAYOUT_KEEP_START"), p("乙"), p("MDKING_LAYOUT_KEEP_END"), "<w:p><w:pPr/><w:r><w:br w:type=\"page\"/></w:r></w:p>".to_string(), p("MDKING_LAYOUT_KEEP_END")].concat();
        let result = normalize_keep_together(&xml);
        assert!(!result.contains("MDKING_LAYOUT"));
        assert_eq!(result.matches("w:keepNext w:val=\"1\"").count(), 2);
        assert!(result.contains("<w:br w:type=\"page\"/>"));
    }

    #[test]
    fn binds_only_last_table_row_to_signature_block() {
        let xml = format!("<w:tbl><w:tr><w:tc>{}</w:tc></w:tr><w:tr><w:tc>{}</w:tc><w:tc>{}</w:tc></w:tr></w:tbl>{}{}{}{}", p("早先行"), p("末行甲"), p("末行乙"), p("MDKING_LAYOUT_KEEP_PREVIOUS_START"), p("签字"), p("日期"), p("MDKING_LAYOUT_KEEP_PREVIOUS_END"));
        let result = normalize_keep_together(&xml);
        assert_eq!(result.matches("<w:keepLines/>").count(), 4);
        assert_eq!(result.matches("w:keepNext w:val=\"1\"").count(), 3);
        assert!(result.starts_with(&format!("<w:tbl><w:tr><w:tc>{}", p("早先行"))));
    }
}
