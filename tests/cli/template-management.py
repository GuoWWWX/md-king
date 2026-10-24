"""Run against a built CLI, using a private executable and APPDATA, never user templates.

python tests/cli/template-management.py --cli src-tauri/target/release/md-king-cli.exe
"""
import argparse
import base64
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
ET.register_namespace("w", W)
ET.register_namespace("r", R)


def template_fixture(path, label, size):
    with zipfile.ZipFile(ROOT / "src-tauri/resources/templates/default-report/reference.docx") as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    styles = ET.fromstring(parts["word/styles.xml"])
    normal = next(item for item in styles.findall(f"{{{W}}}style") if item.get(f"{{{W}}}styleId") == "Normal")
    properties = normal.find(f"{{{W}}}rPr")
    if properties is None:
        properties = ET.SubElement(normal, f"{{{W}}}rPr")
    for item in list(properties):
        if item.tag in (f"{{{W}}}sz", f"{{{W}}}szCs"):
            properties.remove(item)
    ET.SubElement(properties, f"{{{W}}}sz", {f"{{{W}}}val": str(size * 2)})
    parts["word/styles.xml"] = ET.tostring(styles)
    document = ET.fromstring(parts["word/document.xml"])
    section = document.find(f"{{{W}}}body/{{{W}}}sectPr")
    assert section is not None
    for item in list(section):
        if item.tag in (f"{{{W}}}headerReference", f"{{{W}}}footerReference"):
            section.remove(item)
    relationships = ET.fromstring(parts["word/_rels/document.xml.rels"])
    content_types = ET.fromstring(parts["[Content_Types].xml"])
    for kind in ("header", "footer"):
        name = f"{kind}-cli.xml"
        ET.SubElement(section, f"{{{W}}}{kind}Reference", {f"{{{W}}}type": "default", f"{{{R}}}id": f"cli-{kind}"})
        ET.SubElement(relationships, f"{{{REL}}}Relationship", {"Id": f"cli-{kind}", "Type": f"{R}/{kind}", "Target": name})
        ET.SubElement(content_types, f"{{{CT}}}Override", {"PartName": f"/word/{name}", "ContentType": f"application/vnd.openxmlformats-officedocument.wordprocessingml.{kind}+xml"})
        content = f"<w:r><w:t>{label}</w:t></w:r>"
        if kind == "footer":
            content += '<w:r><w:t> 第 </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>7</w:t></w:r></w:fldSimple><w:r><w:t> 页 共 </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>9</w:t></w:r></w:fldSimple><w:r><w:t> 页</w:t></w:r>'
        tag = "hdr" if kind == "header" else "ftr"
        parts[f"word/{name}"] = f'<w:{tag} xmlns:w="{W}"><w:p>{content}</w:p></w:{tag}>'.encode()
    parts["word/document.xml"] = ET.tostring(document)
    parts["word/_rels/document.xml.rels"] = ET.tostring(relationships)
    parts["[Content_Types].xml"] = ET.tostring(content_types)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="mdking-cli-templates-") as scratch:
        directory = Path(scratch)
        executable = directory / args.cli.name
        shutil.copy2(args.cli, executable)
        env = dict(os.environ, APPDATA=str(directory / "appdata"), MD_KING_TEMPLATES_DIR=str(ROOT / "src-tauri/resources/templates"))
        checks = []

        def run(*args, code=0, stdin=None, structured=True):
            result = subprocess.run([str(executable), *args], input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=directory, env=env, timeout=90)
            assert result.returncode == code, (args, result.returncode, result.stdout.decode("utf-8", "replace"), result.stderr.decode("utf-8", "replace"))
            return json.loads(result.stdout) if structured else result.stdout.decode("utf-8")

        for command in ([], ["convert"], ["templates"], *(["templates", name] for name in ("list", "inspect", "import", "replace"))):
            assert "示例" in run(*command, "--help", structured=False) or not command
        assert re.search(r"\b\d+\.\d+\.\d+\b", run("templates", "replace", "--version", structured=False))
        run("templates", "import", "missing.docx", code=2, structured=False)
        checks.append("all help levels, nested version, argument exit codes")

        first, second = directory / "原模板.docx", directory / "新模板.docx"
        template_fixture(first, "旧版页眉", 12)
        template_fixture(second, "新版页眉", 16)
        original_source = second.read_bytes()
        imported = run("templates", "import", str(first), "--name", "商务模板", "--default", "--json")
        template_id = imported["id"]
        data = directory / "appdata/md-king"
        listing = data / "templates.json"
        style_path = data / "template-styles.json"
        config_path = data / "config.json"
        config = json.loads(config_path.read_text("utf-8"))
        assert config["defaultTemplateId"] == template_id
        config["useBundledPandoc"] = False
        config["pandocPath"] = str(ROOT / "src-tauri/resources/pandoc/windows/pandoc.exe")
        config_path.write_text(json.dumps(config), encoding="utf-8")
        before = run("templates", "inspect", template_id, "--json")
        styles = json.loads(style_path.read_text("utf-8"))[template_id]
        assert styles["styles"]["normal"]["fontSize"] == 12
        assert styles["pageSettings"]["headerText"] == "旧版页眉"
        assert run("templates", "import", str(first), "--name", "商务模板", "--json", code=1)["errorCode"] == "TEMPLATE_ALREADY_EXISTS"
        checks.append("import, extracted styles, default template, duplicate rejection")

        templates = json.loads(listing.read_text("utf-8"))
        templates[0].update(description="保留说明", tags=["商务"], previewImagePath="keep.png")
        listing.write_text(json.dumps(templates), encoding="utf-8")
        replaced = run("templates", "replace", "商务模板", str(second), "--json")
        after = run("templates", "inspect", template_id, "--json")
        assert replaced["id"] == template_id and replaced["createdAt"] == imported["createdAt"]
        assert replaced["description"] == "保留说明" and replaced["tags"] == ["商务"] and replaced["previewImagePath"] == "keep.png"
        assert replaced["isDefault"] and config_path.read_text("utf-8") == json.dumps(config)
        assert before["templateSha256"] != after["templateSha256"] == hashlib.sha256(original_source).hexdigest()
        styles = json.loads(style_path.read_text("utf-8"))[template_id]
        assert styles["styles"]["normal"]["fontSize"] == 16
        assert styles["pageSettings"]["headerText"] == "新版页眉"
        assert styles["pageSettings"]["footerText"] == "新版页眉"
        assert styles["pageSettings"]["footerPageNumberFormat"] == "page-total"
        assert second.read_bytes() == original_source
        assert len(run("templates", "list", "--json")) == 4
        checks.append("replace by name preserves identity/metadata/default, refreshes DOCX/styles/fields")

        managed = Path(replaced["referenceDocxPath"])
        snapshots = {path: path.read_bytes() for path in (managed, listing, style_path, config_path)}
        invalid = directory / "invalid.docx"
        invalid.write_bytes(b"not a DOCX")
        assert run("templates", "replace", template_id, str(invalid), "--json", code=1)["errorCode"] == "TEMPLATE_REPLACE_FAILED"
        run("templates", "replace", "default-report", str(second), "--json", code=1)
        assert run("templates", "replace", "not-found", str(second), "--json", code=1)["errorCode"] == "TEMPLATE_NOT_FOUND"
        assert all(path.read_bytes() == content for path, content in snapshots.items())
        checks.append("invalid package, built-in protection and missing target preserve all old state")

        if os.name == "nt":
            listing.chmod(stat.S_IREAD)
            try:
                run("templates", "replace", template_id, str(first), "--json", code=1)
                assert managed.read_bytes() == snapshots[managed]
                assert all(json.loads(path.read_bytes()) == json.loads(content) for path, content in snapshots.items() if path.suffix == ".json")
            finally:
                listing.chmod(stat.S_IREAD | stat.S_IWRITE)
            checks.append("metadata write failure restores both DOCX and extracted styles")

        saved_styles = style_path.read_bytes()
        style_path.write_bytes(b"{broken-json")
        try:
            run("templates", "replace", template_id, str(first), "--json", code=1)
            assert style_path.read_bytes() == b"{broken-json"
            assert managed.read_bytes() == snapshots[managed]
            assert listing.read_bytes() == snapshots[listing]
        finally:
            style_path.write_bytes(saved_styles)
        checks.append("corrupt style configuration is reported without overwriting the file or DOCX")

        templates = json.loads(listing.read_text("utf-8"))
        templates.append(dict(templates[0], id="user-duplicate"))
        listing.write_text(json.dumps(templates), encoding="utf-8")
        assert run("templates", "replace", "商务模板", str(second), "--json", code=1)["errorCode"] == "TEMPLATE_NAME_AMBIGUOUS"
        run("templates", "replace", template_id, str(second), "--json")
        checks.append("ambiguous name rejected; explicit ID succeeds")

        output = directory / "out/report.docx"
        result = run("convert", "# 中文标题\n\n模板覆盖后的正文", "--text", "--template", template_id, "-o", str(output), "--json")
        assert result["ok"] and output.is_file()
        assert result["templateSha256"] == after["templateSha256"]
        with zipfile.ZipFile(output) as archive:
            assert "模板覆盖后的正文" in archive.read("word/document.xml").decode()
        checks.append("actual Pandoc conversion uses replaced template hash and preserves Chinese content")

        (directory / "literal.md").write_text("# 标题\n### 跳级", encoding="utf-8")
        explicit = run("convert", "literal.md", "--text", "--lint-only", "--json")
        path_input = run("convert", "literal.md", "--lint-only", "--json")
        assert not explicit["diagnostics"] and path_input["diagnostics"]
        assert run("convert", "-", "--lint-only", "--json", stdin="# 标题\n### 跳级".encode())["diagnostics"]
        assert run("convert", "-", "--lint-only", "--json", code=1, stdin=b"\xff")["errorCode"] == "STDIN_READ_FAILED"
        checks.append("explicit text bypasses existing file; UTF-8 stdin and invalid encoding")

        image = directory / "图片.png"
        image.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII="))
        piped_output = directory / "elsewhere/管道.docx"
        run("convert", "-", "-o", str(piped_output), "--template", template_id, "--json", stdin="# 管道中文\n\n![图片](图片.png)".encode())
        with zipfile.ZipFile(piped_output) as archive:
            assert "管道中文" in archive.read("word/document.xml").decode()
            assert image.read_bytes() in [archive.read(name) for name in archive.namelist() if name.startswith("word/media/")]
        checks.append("stdin conversion resolves relative image from cwd even with output in another directory")
        print(json.dumps({"ok": True, "checks": checks}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
