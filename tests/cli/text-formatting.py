"""Real CLI conversions of explicit text formats and editable signature fields."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SOURCE = '''# 格式与签署验证

[普通居中]{align="center"}

[***红色粗斜体***]{color="#D32F2F" .underline}

[外层[内层]{color="#2563EB"}末尾]{color="#D32F2F"}

[[红色网页](https://example.com)]{color="#D32F2F"}

> [引用蓝字]{color="#2563EB"}

普通 HTML 下划线：<u>张三</u>

| 项目 | 内容 |
| --- | --- |
| 表格 | [***表格红字***]{color="#D32F2F" .underline} |

::: {align="right"}
多段靠右一

多段靠右二
:::

::: {.signature align="right"}
| 字段 | 内容 | 备注 |
| --- | --- | --- |
| 投标人 | [中船凌久高科（武汉）有限公司]{.underline} | （盖章） |
| 法定代表人或授权代表 | ____ | （签字） |
| 日期 | ____ | |
| 提示 | [待补充]{color="#D32F2F"} | （核实） |
| 空白 | | |
:::
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--word", action="store_true")
    args = parser.parse_args()
    out = args.output.resolve(); out.mkdir(parents=True, exist_ok=True)
    exe = out / "md-king-cli.exe"; shutil.copy2(args.cli, exe)
    env = dict(os.environ, APPDATA=str(out / "appdata"), MD_KING_TEMPLATES_DIR=str(ROOT / "src-tauri/resources/templates"))
    def run(*command):
        result = subprocess.run([str(exe), *command, "--json"], cwd=out, env=env, capture_output=True, timeout=120)
        assert result.returncode == 0, result.stdout.decode("utf-8", "replace") + result.stderr.decode("utf-8", "replace")
        return json.loads(result.stdout)
    imported = run("templates", "import", str(ROOT / "src-tauri/resources/templates/default-report/reference.docx"), "--name", f"文字与签署回归{time.time_ns()}")
    style_path = out / "appdata/md-king/template-styles.json"
    configs = json.loads(style_path.read_text("utf-8")); config = configs[imported['id']]
    config.setdefault("pageSettings", {}).update(tocEnabled=False, footerEnabled=True, footerPageNumberFormat="page", pageNumberStartAt="body", footerStartPage=1)
    config["styles"]["normal"].update(fontSize=12, chineseFont="宋体", latinFont="Times New Roman")
    config["styles"].update({
        "table": dict(tableWidthPercent=100, tableLayout="auto", columnWidthMode="auto", cellPaddingX=5, cellPaddingY=4, borderColor="#D9D9D9", borderWidth=0.75),
        "table-header": dict(chineseFont="宋体", latinFont="Times New Roman", headerFontSize=10, headerAlign="center", headerVerticalAlign="middle", headerLineHeight="1.2"),
        "table-body": dict(chineseFont="宋体", latinFont="Times New Roman", bodyFontSize=10, bodyAlign="left", bodyVerticalAlign="middle", bodyLineHeight="1.2"),
    })
    config["styles"]["signature"] = dict(signatureInheritText=True, align="center", color="#000000", signatureLineWidth=4, signatureLineColor="#2563EB", signatureLineThickness=0.5, signatureValueColor="#008000", signatureLabelAlign="right", signatureValueAlign="left", signatureKeepTogether=True, signatureWithPrevious=True)
    style_path.write_text(json.dumps(configs, ensure_ascii=False), encoding="utf-8")
    md = out / "文字颜色对齐与签署块.md"; md.write_text(SOURCE, encoding="utf-8")
    output = out / "文字颜色对齐与签署块.docx"
    command = ["convert", str(md), "-o", str(output), "--template", imported['id'], "--overwrite"]
    if args.word: command += ["--update-fields", "word"]
    report = run(*command)
    if args.word: assert report["fieldUpdateStatus"] == "updated", report
    assert not any(d['severity'] == 'error' for d in report['diagnostics']), report['diagnostics']
    with zipfile.ZipFile(output) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    paragraphs = root.findall('.//' + W + 'p')
    def paragraph(text):
        return next(p for p in paragraphs if ''.join(t.text or '' for t in p.iter(W+'t')) == text)
    for value, align in [("普通居中", "center"), ("多段靠右一", "right"), ("多段靠右二", "right")]:
        assert paragraph(value).find(W+'pPr/'+W+'jc').get(W+'val') == align
    for p in paragraphs:
        for r in p.iter(W+'r'):
            content = ''.join(t.text or '' for t in r.iter(W+'t'))
            if content in ('红色粗斜体', '表格红字', '待补充', '外层', '末尾', '红色网页'):
                assert r.find(W+'rPr/'+W+'color').get(W+'val') == 'D32F2F', content
            if content in ('红色粗斜体', '表格红字'):
                assert r.find(W+'rPr/'+W+'b') is not None and r.find(W+'rPr/'+W+'i') is not None
                assert r.find(W+'rPr/'+W+'b').get(W+'val') not in ('0', 'false')
                assert r.find(W+'rPr/'+W+'u') is not None
            if content in ('引用蓝字', '内层'):
                assert r.find(W+'rPr/'+W+'color').get(W+'val') == '2563EB'
            if content == '张三': assert r.find(W+'rPr/'+W+'u') is not None
            style = r.find(W+'rPr/'+W+'rStyle')
            if style is not None and style.get(W+'val') == 'MDKingFmtinheritU':
                assert r.find(W+'rPr/'+W+'color').get(W+'val') == '008000'
    signature = [p for p in paragraphs if (p.find(W+'pPr/'+W+'pStyle') is not None and p.find(W+'pPr/'+W+'pStyle').get(W+'val', '').startswith('MDKingSignature'))]
    assert len(signature) == 5
    lines = [r for p in signature for r in p.findall(W+'r') if r.find(W+'rPr/'+W+'rStyle') is not None and r.find(W+'rPr/'+W+'rStyle').get(W+'val') == 'MDKingSignatureLine']
    assert len(lines) == 2 and all(r.find(W+'tab') is not None for r in lines)
    assert all(r.find(W+'rPr/'+W+'u').get(W+'color') == '2563EB' for r in lines)
    stops = [int(t.get(W+'pos')) for t in signature[1].findall(W+'pPr/'+W+'tabs/'+W+'tab')]
    assert abs(stops[2]-stops[1]-2268) <= 1, stops
    assert 'MDKING_LAYOUT' not in ET.tostring(root, encoding='unicode')
    (out/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ok':True,'wordUpdated':args.word,'signatureRows':len(signature),'nativeLines':len(lines),'lineWidthTwips':stops[2]-stops[1]}, ensure_ascii=False))


if __name__ == '__main__': main()
