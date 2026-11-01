"""Exercise the built-in resume template through the real conversion CLI."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    exe = out / "md-king-cli.exe"
    shutil.copy2(args.cli, exe)
    shutil.copy2(ROOT / "src/lib/resume-photo-placeholder.png", out / "photo.png")
    source = (ROOT / "src/lib/resume-sample.ts").read_text(encoding="utf-8")
    sample = source.split("const chineseSample = `", 1)[1].split("`;", 1)[0]
    sample = sample.replace("个人照片.jpg", "photo.png")
    env = dict(os.environ, APPDATA=str(out / "appdata"), MD_KING_TEMPLATES_DIR=str(ROOT / "src-tauri/resources/templates"))

    def convert(name, markdown):
        md, docx = out / (name + ".md"), out / (name + ".docx")
        md.write_text(markdown, encoding="utf-8")
        result = subprocess.run([str(exe), "convert", str(md), "-o", str(docx), "--template", "resume", "--overwrite", "--json"], cwd=out, env=env, capture_output=True, timeout=120)
        assert result.returncode == 0, result.stdout.decode("utf-8", "replace") + result.stderr.decode("utf-8", "replace")
        report = json.loads(result.stdout)
        assert report["ok"] and not [d for d in report["diagnostics"] if d["severity"] == "error"], report
        with zipfile.ZipFile(docx) as archive:
            xml = ET.fromstring(archive.read("word/document.xml"))
        return report, xml

    report, root = convert("with-photo", sample)
    assert report["statistics"]["imageDetails"][0]["displayWidthCm"] == 2.5
    assert report["statistics"]["imageDetails"][0]["displayHeightCm"] == 3.5
    assert not any("自动编号" in warning for warning in report["warnings"])
    assert len(root.findall(".//" + W + "tbl//" + W + "br")) == 3
    assert not any("TOC" in (item.text or "") for item in root.iter(W + "instrText"))
    table = root.find(".//" + W + "tbl")
    assert table is not None
    assert all(border.get(W + "val") in ("nil", "none") for border in table.findall("./" + W + "tblPr/" + W + "tblBorders/*"))
    photo = next(cell for cell in table.iter(W + "tc") if cell.find(".//" + W + "drawing") is not None)
    paragraph = photo.find(W + "p")
    assert paragraph.find(W + "pPr/" + W + "spacing").get(W + "lineRule") == "atLeast"
    assert paragraph.find(W + "pPr/" + W + "jc").get(W + "val") == "right"
    extent = photo.find(".//" + WP + "extent")
    assert abs(int(extent.get("cx")) - 900000) <= 1 and abs(int(extent.get("cy")) - 1260000) <= 1

    without_photo = sample.replace("![](photo.png){width=2.5cm height=3.5cm}", "")
    report, root = convert("without-photo", without_photo)
    assert report["statistics"]["imageCount"] == 0 and not list(root.iter(W + "drawing"))
    print("PASS: resume DOCX has an unnumbered layout, line breaks, a full-size right-aligned photo, and works without a photo.")


if __name__ == "__main__":
    main()
