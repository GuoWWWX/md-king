"""Isolated DOCX layout regression; leaves outputs for optional Word pagination QA."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    executable = out / args.cli.name
    shutil.copy2(args.cli, executable)
    env = dict(os.environ, APPDATA=str(out / "appdata"), MD_KING_TEMPLATES_DIR=str(ROOT / "src-tauri/resources/templates"))

    def run(*args):
        result = subprocess.run([str(executable), *args, "--json"], env=env, cwd=out, capture_output=True, timeout=120)
        assert result.returncode == 0, result.stdout.decode("utf-8", "replace") + result.stderr.decode("utf-8", "replace")
        return json.loads(result.stdout)

    source = ROOT / "src-tauri/resources/templates/default-report/reference.docx"
    fixture = out / "reference.docx"
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(fixture, "w", zipfile.ZIP_DEFLATED) as target:
        for name in original.namelist():
            data = original.read(name)
            if name == "word/document.xml":
                data = data.replace(b"</w:sectPr>", b"<w:titlePg/></w:sectPr>")
            if name == "word/styles.xml":
                data = re.sub(
                    rb'<w:style\b[^>]*w:styleId="(?:Normal|Compact)"[^>]*>.*?</w:style>',
                    lambda match: re.sub(rb'<w:spacing\b[^>]*/>', b'<w:spacing w:before="120" w:after="240" w:beforeAutospacing="1" w:afterAutospacing="1"/>', match[0]),
                    data, flags=re.S,
                )
            target.writestr(name, data)
    imported = run("templates", "import", str(fixture), "--name", f"布局回归{time.time_ns()}")
    template_id = imported["id"]
    style_path = out / "appdata/md-king/template-styles.json"
    configs = json.loads(style_path.read_text("utf-8"))
    settings = configs[template_id].setdefault("pageSettings", {})
    settings.update(headerEnabled=True, headerText="正文页眉回归", footerEnabled=True, footerText="", footerPageNumberFormat="page-total", tocEnabled=True, tocDepth="2", pageNumberStartAt="body", footerStartPage=1)
    header = '---\ntitle: 布局回归\nlang: zh-CN\n---\n\n'
    page_break = '\n\n```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n\n'
    table = '| 项目 | 说明 | 金额 | 备注 |\n| --- | --- | --- | --- |\n| 测试 | 较长的描述 | 33,998,709.00 | 备注 |\n'
    cases = {
        "body": header + '# 正文一\n\n正文内容。' + page_break + '# 正文二\n\n末页内容。',
        "offset": header + '# 正文一\n\n正文内容。' + page_break + '# 正文二\n\n末页内容。',
        "document": header + '# 正文一\n\n正文内容。' + page_break + '# 正文二\n\n末页内容。',
        "mixed": header + '# 前文\n\n纵向内容。\n\n::: {.landscape}\n\n## 横向报价\n\n' + table + '\n:::\n\n## 后文\n\n恢复纵向。',
        "land-only": header + '::: {.landscape}\n\n# 横向正文\n\n' + table + '\n:::\n',
        "keep": header + '# 签署\n\n承诺末段。\n\n::: {.keep-together .with-previous}\n\n签字：________________\n\n日期：________________\n\n:::\n\n后续段落。',
    }
    results = []
    for name, markdown in cases.items():
        settings.update(pageNumberStartAt="document" if name == "document" else "body", footerStartPage=5 if name == "offset" else 1)
        style_path.write_text(json.dumps(configs, ensure_ascii=False), encoding="utf-8")
        md = out / f"{name}.md"
        md.write_text(markdown, encoding="utf-8")
        output = out / "documents" / f"{name}.docx"
        result = run("convert", str(md), "-o", str(output), "--template", template_id, "--overwrite", "--report", str(out / f"{name}-report.json"))
        assert not any("translations/" in warning or "translation defined" in warning for warning in result["warnings"]), result["warnings"]
        assert not any(item["severity"] == "error" for item in result["diagnostics"]), result["diagnostics"]
        with zipfile.ZipFile(output) as archive:
            xml = archive.read("word/document.xml").decode()
            document = ET.fromstring(xml)
            sections = document.findall(f".//{{{W}}}sectPr")
            assert all(section.find(f"{{{W}}}titlePg") is None for section in sections)
            assert "MDKING_LAYOUT" not in xml
            for cell in document.findall(f".//{{{W}}}tc"):
                assert cell.find(f"{{{W}}}tcPr/{{{W}}}vAlign").get(f"{{{W}}}val") == "center"
                for paragraph in cell.findall(f"{{{W}}}p"):
                    spacing = paragraph.find(f"{{{W}}}pPr/{{{W}}}spacing")
                    assert spacing is not None
                    assert all(spacing.get(f"{{{W}}}{key}") == "0" for key in ("before", "after", "beforeAutospacing", "afterAutospacing"))
            footer = archive.read("word/footer-mdking.xml").decode()
            assert ("NUMPAGES" in footer) == (name == "document")
            if name != "document":
                assert "PAGEREF _MDKingBodyEnd" in footer and '_MDKingBodyEnd' in xml
            orientations = [section.find(f"{{{W}}}pgSz").get(f"{{{W}}}orient", "portrait") for section in sections]
            if name == "mixed":
                assert orientations == ["portrait", "portrait", "portrait", "landscape", "portrait"], orientations
            if name == "land-only":
                assert orientations == ["portrait", "portrait", "landscape"], orientations
            if name == "keep":
                paragraphs = document.findall(f".//{{{W}}}p")
                bound = [p for p in paragraphs if ''.join(p.itertext()).startswith(("承诺末段", "签字", "日期"))]
                assert len(bound) == 3
                assert all(p.find(f"{{{W}}}pPr/{{{W}}}keepLines") is not None for p in bound)
        results.append({"case": name, "ok": True, "orientations": orientations, "warnings": result["warnings"]})
    (out / "evidence.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "cases": [item["case"] for item in results]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
