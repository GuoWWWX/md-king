export const cliExamples = [
  {
    title: "单文件转换",
    command: "md-king-cli convert ./input.md -o ./output.docx --template default-report --json",
  },
  {
    title: "覆盖输出",
    command: "md-king-cli convert ./input.md -o ./output.docx --template default-report --overwrite",
  },
  {
    title: "查看模板",
    command: "md-king-cli templates list --json",
  },
  {
    title: "按模板名称转换",
    command: "md-king-cli convert ./input.md -o ./output.docx --template 我的自定义模板 --json",
  },
];
