export const cliExamples = [
  {
    title: "单文件转换",
    command: "md-king convert ./input.md -o ./output.docx --template report --json",
  },
  {
    title: "批量转换",
    command: "md-king batch ./docs --out ./dist --template official --json",
  },
  {
    title: "查看模板",
    command: "md-king templates list --json",
  },
  {
    title: "查看状态",
    command: "md-king status --json",
  },
];
