use regex::{Captures, Regex};
use serde_json::Value;

fn number(config: &Value, key: &str, default: f64) -> f64 {
    config
        .get(key)
        .and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|s| s.parse::<f64>().ok()))
        })
        .filter(|v| v.is_finite())
        .unwrap_or(default)
}
fn text<'a>(config: &'a Value, key: &str, default: &'a str) -> &'a str {
    config
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(default)
}
fn color(config: &Value, key: &str, default: &str) -> String {
    let value = text(config, key, default).trim_start_matches('#');
    if value.len() == 6 && value.chars().all(|c| c.is_ascii_hexdigit()) {
        value.to_uppercase()
    } else {
        default.trim_start_matches('#').to_owned()
    }
}
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn wrap_signature_values(xml: &str, width_units: f64, start_tabs: usize) -> String {
    let runs = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).unwrap();
    let texts = Regex::new(r#"(?s)(<w:t\b[^>]*>)(.*?)</w:t>|<w:br\b[^>]*/>"#).unwrap();
    let chars = Regex::new(r#"&(?:#\d+|#x[0-9a-fA-F]+|\w+);|(?s:.)"#).unwrap();
    let properties = Regex::new(r#"(?s)<w:rPr>.*?</w:rPr>"#).unwrap();
    let underline_and_style = Regex::new(r#"<w:(?:u|rStyle)\b[^>]*/>"#).unwrap();
    let mut phase = false;
    let mut tabs = 0;
    let mut used = 0.0;
    runs.replace_all(xml, |run: &Captures| {
        let source = &run[0];
        let original_properties = properties.find(source).map_or("<w:rPr/>", |p| p.as_str());
        let indent_properties = underline_and_style
            .replace_all(original_properties, "")
            .replace(
                "<w:rPr>",
                r#"<w:rPr><w:rStyle w:val="MDKingSignatureValue"/><w:u w:val="none"/>"#,
            );
        if source.contains("MDKingSignatureRemark") || source.contains("MDKingSignatureLine") {
            phase = false;
        }
        let result = if phase {
            texts
                .replace_all(source, |text: &Captures| {
                    let Some(open) = text.get(1) else {
                        used = 0.0;
                        return text[0].to_owned();
                    };
                    let mut content = String::new();
                    let items: Vec<_> = chars.find_iter(&text[2]).collect();
                    for (index, item) in items.iter().enumerate() {
                        let unit = if item.as_str().chars().next().unwrap_or(' ') >= '\u{2e80}' {
                            1.0
                        } else {
                            0.55
                        };
                        let next_closes = items.get(index + 1).is_some_and(|next| {
                            "，。！？：；、）】》〉」』〕)]}".contains(next.as_str())
                        });
                        if (used + unit > width_units
                            || (next_closes && used + unit + 1.0 > width_units))
                            && used > 0.0
                        {
                            content.push_str("</w:t><w:br/></w:r><w:r>");
                            content.push_str(&indent_properties);
                            for _ in 0..start_tabs {
                                content.push_str("<w:tab/>");
                            }
                            content.push_str("</w:r><w:r>");
                            content.push_str(original_properties);
                            content.push_str(r#"<w:t xml:space="preserve">"#);
                            used = 0.0;
                        }
                        content.push_str(item.as_str());
                        used += unit;
                    }
                    format!("{}{content}</w:t>", open.as_str())
                })
                .into_owned()
        } else {
            source.to_owned()
        };
        if source.contains("<w:tab")
            && !source.contains("MDKingSignature")
            && !source.contains("MDKingFmt")
        {
            tabs += 1;
            phase = tabs == start_tabs;
            if phase {
                used = 0.0;
            }
        }
        result
    })
    .into_owned()
}
fn replace_properties(xml: &str, tag: &str, remove: &str, properties: &str) -> String {
    let pattern = Regex::new(&format!(r#"(?s)<w:{tag}>(.*?)</w:{tag}>|<w:{tag}\s*/>"#)).unwrap();
    let removable = Regex::new(&format!(
        r#"(?s)<w:(?:{remove})\b[^>]*/>|<w:(?:{remove})\b[^>]*>.*?</w:(?:{remove})>"#
    ))
    .unwrap();
    let new = |inner: &str| {
        format!(
            "<w:{tag}>{}{properties}</w:{tag}>",
            removable.replace_all(inner, "")
        )
    };
    if pattern.is_match(xml) {
        pattern
            .replace(xml, |c: &Captures| new(c.get(1).map_or("", |m| m.as_str())))
            .into_owned()
    } else {
        let end = xml.find('>').map_or(0, |i| i + 1);
        format!("{}{}{}", &xml[..end], new(""), &xml[end..])
    }
}

/// Named Pandoc styles keep explicit formatting identifiable across Office saves.
pub fn normalize(xml: &str, config: &Value, content_width: u32) -> String {
    if !["MDKingFmt", "MDKingAlign", "MDKingHeadingAlign", "MDKingSignature"]
        .iter()
        .any(|marker| xml.contains(marker))
    {
        return xml.to_owned();
    }
    let paragraph = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let pstyle = Regex::new(r#"<w:pStyle\b[^>]*w:val="MDKing(Align(left|center|right)|Signature(auto|left|center|right)W(\d+)(F?)(L?))""#).unwrap();
    let rstyle = Regex::new(r#"<w:rStyle\b[^>]*w:val="MDKing(Fmt(inherit|[0-9A-F]{6})(U?)|Signature(Label|Value|Remark|Line))""#).unwrap();
    let run = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).unwrap();
    let heading_align = Regex::new(r#"<w:r><w:rPr><w:rStyle w:val="MDKingHeadingAlign(left|center|right)"/></w:rPr></w:r>"#).unwrap();
    let mut output = paragraph.replace_all(xml, |p: &Captures| {
        if !p[0].contains("MDKing") { return p[0].to_owned(); }
        let mut value = p[0].to_owned();
        let mut wrap = None;
        let signature = pstyle.captures(&value).filter(|c| c.get(3).is_some()).map(|c| (c[3].to_owned(), c[4].parse::<f64>().unwrap_or(100.0), !c[5].is_empty(), !c[6].is_empty()));
        let align = pstyle.captures(&value).and_then(|c| c.get(2).map(|a| a.as_str().to_owned()))
            .or_else(|| heading_align.captures(&value).map(|c| c[1].to_owned()));
        if let Some(align) = align {
            value = replace_properties(&value, "pPr", "jc|ind", &format!(r#"<w:jc w:val="{align}"/><w:ind w:firstLine="0" w:firstLineChars="0" w:hanging="0" w:hangingChars="0"/>"#));
        }
        value = heading_align.replace_all(&value, "").into_owned();
        if let Some((align, label_units, first, last)) = signature.as_ref() {
            let leading_tab = Regex::new(r#"(?s)(</w:pPr>)<w:r\b[^>]*>(?:<w:rPr>.*?</w:rPr>)?<w:tab\s*/></w:r>"#).unwrap();
            value = leading_tab.replace(&value, "$1").into_owned();
            let font = number(config, "fontSize", 12.0).clamp(6.0, 72.0);
            // Leave room for Word's tracking and full-width punctuation before the value tab.
            let label_width = ((label_units / 100.0 + 1.0) * font * 20.0).min(content_width as f64 * 0.55);
            let line_width = (number(config, "signatureLineWidth", 4.0).clamp(1.0, 12.0) * 567.0).min((content_width as f64 - label_width - font * 80.0).max(567.0));
            let total = (label_width + line_width + font * 80.0).min(content_width as f64);
            let align = if align == "auto" { text(config, "align", "left") } else { align.as_str() };
            let left = match align { "right" => content_width as f64 - total, "center" => (content_width as f64 - total) / 2.0, _ => 0.0 }.max(0.0);
            let label_align = text(config, "signatureLabelAlign", "right");
            wrap = Some((line_width / 20.0 / font, if label_align == "left" { 1 } else { 2 }));
            let blank = value.contains("MDKingSignatureLine");
            let value_align = if blank { "left" } else { text(config, "signatureValueAlign", "left") };
            let value_pos = match value_align { "center" => label_width + line_width / 2.0, "right" => label_width + line_width - 20.0, _ => label_width };
            let mut tabs = String::new();
            if label_align != "left" {
                tabs.push_str(&format!(r#"<w:tab w:val="{label_align}" w:pos="{:.0}"/>"#, left + if label_align == "center" { (label_width - 80.0) / 2.0 } else { label_width - 80.0 }));
                value = value.replacen("</w:pPr>", "</w:pPr><w:r><w:tab/></w:r>", 1);
            }
            tabs.push_str(&format!(r#"<w:tab w:val="{value_align}" w:pos="{:.0}"/><w:tab w:val="left" w:pos="{:.0}"/><w:tab w:val="left" w:pos="{:.0}"/>"#, left + value_pos, left + label_width + line_width, left + label_width + line_width + 100.0));
            // The leading label tab is recreated each normalization pass.
            let spacing = number(config, "signatureRowSpacing", 8.0).clamp(0.0, 48.0);
            let before = if *first { number(config, "beforeSpacing", 6.0) } else { 0.0 } * 20.0;
            let after = if *last { number(config, "afterSpacing", 6.0) } else { spacing } * 20.0;
            let line = (font * number(config, "lineHeight", 1.5).clamp(1.0, 3.0) * 20.0).round();
            let properties = format!(r#"<w:jc w:val="left"/><w:ind w:left="{left:.0}" w:firstLine="0" w:firstLineChars="0" w:hanging="0" w:hangingChars="0"/><w:tabs>{tabs}</w:tabs><w:spacing w:before="{before:.0}" w:after="{after:.0}" w:line="{line:.0}" w:lineRule="atLeast"/><w:keepLines/>"#);
            value = replace_properties(&value, "pPr", "jc|ind|tabs|spacing|keepLines", &properties);
        }
        let mut role = if text(config, "signatureLabelAlign", "right") == "left" { "Label" } else { "BeforeLabel" };
        value = run.replace_all(&value, |r: &Captures| {
            let mut result = r[0].to_owned();
            let captured = rstyle.captures(&result);
            if signature.is_some() {
                if let Some(named_role) = captured.as_ref().and_then(|c| c.get(4)) {
                    role = match named_role.as_str() { "Value" => "Value", "Remark" => "Remark", "Line" => "Line", _ => "Label" };
                } else if captured.is_none() && result.contains("<w:tab") {
                    role = match role { "BeforeLabel" => "Label", "Label" => "Value", "Value" | "Line" => "Remark", _ => role };
                }
            }
            let mut props = String::new();
            if signature.is_some() {
                let font = (number(config, "fontSize", 12.0).clamp(6.0, 72.0) * 2.0).round();
                let base = color(config, "color", "000000");
                let chosen = match role { "Value" => color(config, "signatureValueColor", &base), "Remark" => color(config, "signatureRemarkColor", &base), _ => base };
                props.push_str(&format!(r#"<w:color w:val="{chosen}"/><w:rFonts w:eastAsia="{}" w:ascii="{}" w:hAnsi="{}"/><w:sz w:val="{font:.0}"/><w:szCs w:val="{font:.0}"/>"#, escape(text(config, "chineseFont", "宋体")), escape(text(config, "latinFont", "Times New Roman")), escape(text(config, "latinFont", "Times New Roman"))));
            }
            let Some(c) = captured else { return if props.is_empty() { result } else { replace_properties(&result, "rPr", "color|rFonts|sz|szCs", &props) }; };
            if let Some(role) = c.get(4) {
                let base_color = color(config, "color", "000000");
                let chosen = match role.as_str() { "Value" => color(config, "signatureValueColor", &base_color), "Remark" => color(config, "signatureRemarkColor", &base_color), "Line" => color(config, "signatureLineColor", "000000"), _ => base_color };
                let font = (number(config, "fontSize", 12.0).clamp(6.0, 72.0) * 2.0).round();
                props = format!(r#"<w:color w:val="{chosen}"/><w:rFonts w:eastAsia="{}" w:ascii="{}" w:hAnsi="{}"/><w:sz w:val="{font:.0}"/><w:szCs w:val="{font:.0}"/>"#, escape(text(config, "chineseFont", "宋体")), escape(text(config, "latinFont", "Times New Roman")), escape(text(config, "latinFont", "Times New Roman")));
                if role.as_str() == "Line" {
                    let style = if number(config, "signatureLineThickness", 0.5) >= 1.0 { "thick" } else { "single" };
                    props.push_str(&format!(r#"<w:u w:val="{style}" w:color="{chosen}"/>"#));
                    let content = Regex::new(r#"(?s)<w:t\b[^>]*>.*?</w:t>"#).unwrap();
                    result = content.replace_all(&result, "<w:tab/>").into_owned();
                }
            } else {
                if &c[2] != "inherit" {
                    props = Regex::new(r#"<w:color\b[^>]*/>"#).unwrap().replace_all(&props, "").into_owned();
                    props.push_str(&format!(r#"<w:color w:val="{}"/>"#, &c[2]));
                }
                if !c[3].is_empty() { props.push_str(r#"<w:u w:val="single"/>"#); }
            }
            let mut remove = Vec::new();
            if props.contains("<w:color") { remove.push("color"); }
            if props.contains("<w:u ") { remove.push("u"); }
            if props.contains("<w:rFonts") { remove.extend(["rFonts", "sz", "szCs"]); }
            if signature.is_some() && text(config, "fontWeight", "400").parse::<u32>().unwrap_or(400) >= 600 {
                props.push_str(r#"<w:b/><w:bCs/>"#); remove.extend(["b", "bCs"]);
            }
            replace_properties(&result, "rPr", &remove.join("|"), &props)
        }).into_owned();
        if let Some((units, tabs)) = wrap { value = wrap_signature_values(&value, units, tabs); }
        if let Some((_, _, first, last)) = signature {
            let keep = config.get("signatureKeepTogether").and_then(Value::as_bool).unwrap_or(true);
            if keep {
                if first {
                    let kind = if config.get("signatureWithPrevious").and_then(Value::as_bool).unwrap_or(false) { "KEEP_PREVIOUS" } else { "KEEP" };
                    value = format!("<w:p><w:r><w:t>MDKING_LAYOUT_{kind}_START</w:t></w:r></w:p>{value}");
                }
                if last { value.push_str("<w:p><w:r><w:t>MDKING_LAYOUT_KEEP_END</w:t></w:r></w:p>"); }
            }
        }
        value
    }).into_owned();
    output = super::docx_layout::normalize_keep_together(&output);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn heading_alignment_preserves_heading_style_and_fonts() {
        let xml = r#"<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:rStyle w:val="MDKingHeadingAligncenter"/></w:rPr></w:r><w:r><w:rPr><w:rFonts w:eastAsia="黑体"/><w:sz w:val="32"/><w:b/></w:rPr><w:t>标题</w:t></w:r></w:p>"#;
        let output = normalize(xml, &Value::Null, 8300);
        assert!(output.contains(r#"<w:pStyle w:val="Heading2"/>"#));
        assert!(output.contains(r#"<w:jc w:val="center"/>"#));
        assert!(output.contains(r#"<w:rFonts w:eastAsia="黑体"/><w:sz w:val="32"/><w:b/>"#));
        assert!(!output.contains("MDKingHeadingAlign"));
        assert_eq!(normalize(&output, &Value::Null, 8300), output);
    }

    #[test]
    fn wrapping_underlined_values_does_not_underline_the_indent() {
        let input = r#"<w:p><w:pPr><w:pStyle w:val="MDKingSignatureleftW100FL"/></w:pPr><w:r><w:rPr><w:rStyle w:val="MDKingSignatureLabel"/></w:rPr><w:t>签字：</w:t></w:r><w:r><w:tab/></w:r><w:r><w:rPr><w:rStyle w:val="MDKingFmtinheritU"/></w:rPr><w:t>甲乙丙丁戊己</w:t></w:r></w:p>"#;
        let config = json!({"signatureLineWidth":1});
        let output = normalize(input, &config, 8300);
        assert_eq!(output.matches("<w:br/>").count(), 2);
        assert_eq!(output.matches(r#"<w:u w:val="none"/>"#).count(), 2);
        assert_eq!(normalize(&output, &config, 8300), output);
    }

    #[test]
    fn explicit_formats_survive_normalization_without_changing_other_runs() {
        let xml = r#"<w:p><w:pPr><w:pStyle w:val="MDKingAlignright"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:rStyle w:val="MDKingFmtD32F2FU"/><w:b/><w:i/><w:color w:val="000000"/></w:rPr><w:t>颜色</w:t></w:r><w:r><w:t>普通</w:t></w:r></w:p>"#;
        let output = normalize(xml, &Value::Null, 8300);
        assert!(output.contains(r#"<w:jc w:val="right"/>"#));
        assert!(output.contains(r#"<w:color w:val="D32F2F"/>"#));
        assert!(output.contains("<w:b/><w:i/>"));
        assert!(output.contains(r#"<w:u w:val="single"/>"#));
        assert!(output.contains("<w:r><w:t>普通</w:t></w:r>"));
        assert_eq!(normalize(&output, &Value::Null, 8300), output);
    }

    #[test]
    fn signature_tabs_and_lines_are_idempotent_and_respect_style_settings() {
        let p = |suffix: &str, role: &str, value: &str| {
            format!(
                r#"<w:p><w:pPr><w:pStyle w:val="MDKingSignatureautoW600{suffix}"/></w:pPr><w:r><w:rPr><w:rStyle w:val="MDKingSignatureLabel"/></w:rPr><w:t>签字：</w:t></w:r><w:r><w:tab/></w:r><w:r><w:rPr><w:rStyle w:val="{role}"/></w:rPr><w:t>{value}</w:t></w:r></w:p>"#
            )
        };
        let input = p("F", "MDKingSignatureLine", "_") + &p("L", "MDKingFmtD32F2F", "待补充");
        let config = json!({"align":"right","signatureLineWidth":4,"signatureLineColor":"#2563EB","signatureLineThickness":1,"signatureValueAlign":"center"});
        let output = normalize(&input, &config, 8300);
        assert!(!output.contains("MDKING_LAYOUT"));
        assert!(output.contains(r#"<w:u w:val="thick" w:color="2563EB"/>"#));
        assert!(output.contains(r#"<w:color w:val="D32F2F"/>"#));
        assert!(output.contains(r#"<w:keepNext w:val="1"/>"#));
        assert!(output.contains(r#"<w:keepNext w:val="0"/>"#));
        assert_eq!(normalize(&output, &config, 8300), output);
    }
}
