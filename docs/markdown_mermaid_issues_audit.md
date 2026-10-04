# MD King - Markdown 与 Mermaid 渲染及交互缺陷全面审计报告

> **审计基准版本**：MD King v1.1.8  
> **审计日期**：2026年10月  
> **审计对象**：实时预览编辑器（Live Preview）、文档解析流水线、Mermaid 渲染服务与样式系统  
> **审计原则**：立足第一性原理（First Principles Thinking），以确凿代码事实与可重现测试用例为唯一准则。

---

## 目录

- [一、审计背景与核心结论](#一审计背景与核心结论)
- [二、行内样式与数学公式缺陷审计](#二行内样式与数学公式缺陷审计)
  - [缺陷 1.1：加粗与斜体内嵌数学公式失效，星号暴露](#缺陷-11加粗与斜体内嵌数学公式失效星号暴露)
  - [缺陷 1.2：中文与标点紧邻混排时单星号斜体失效](#缺陷-12中文与标点紧邻混排时单星号斜体失效)
  - [缺陷 1.3：宽松加粗（relaxed-strong）贪心匹配与跨结构误伤](#缺陷-13宽松加粗relaxed-strong贪心匹配与跨结构误伤)
  - [缺陷 1.4：超链接与双链目标被加粗侵入，双链显示名样式双端分裂](#缺陷-14超链接与双链目标被加粗侵入双链显示名样式双端分裂)
  - [缺陷 1.5：行内数学公式缺失首尾非空白校验导致货币符号误伤](#缺陷-15行内数学公式缺失首尾非空白校验导致货币符号误伤)
- [三、块级容器与多级列表缺陷审计](#三块级容器与多级列表缺陷审计)
  - [缺陷 2.1：Callout 标题行富文本与数学公式完全降级为纯文本](#缺陷-21callout-标题行富文本与数学公式完全降级为纯文本)
  - [缺陷 2.2：引用块与 Callout 内多级列表缩进丢失、样式不演进](#缺陷-22引用块与-callout-内多级列表缩进丢失样式不演进)
  - [缺陷 2.3：引用块内多行与单行块级数学公式彻底失效](#缺陷-23引用块内多行与单行块级数学公式彻底失效)
  - [缺陷 2.4：表格单元格内管道符公式与代码引发列裂解及转义污染](#缺陷-24表格单元格内管道符公式与代码引发列裂解及转义污染)
  - [缺陷 2.5：引用块内嵌套围栏代码块复制代码带引用前缀与围栏](#缺陷-25引用块内嵌套围栏代码块复制代码带引用前缀与围栏)
- [四、Mermaid 图表渲染、样式与交互缺陷审计](#四mermaid-图表渲染样式与交互缺陷审计)
  - [缺陷 3.1：子图（subgraph）顶部标题被内部子节点卡片遮挡覆盖](#缺陷-31子图subgraph顶部标题被内部子节点卡片遮挡覆盖)
  - [缺陷 3.2：引用块中书写 Mermaid 图表无法渲染（报 Parse Error）](#缺陷-32引用块中书写-mermaid-图表无法渲染报-parse-error)
  - [缺陷 3.3：深色模式下多类图表文字呈黑色/深灰色导致不可辨认](#缺陷-33深色模式下多类图表文字呈黑色深灰色导致不可辨认)
  - [缺陷 3.4：图内文本无法拖选复制、超链接不可点击、拖动闪退源码](#缺陷-34图内文本无法拖选复制超链接不可点击拖动闪退源码)
- [五、缺陷汇总矩阵与整改优先级](#五缺陷汇总矩阵与整改优先级)

---

## 一、审计背景与核心结论

本次专项审计针对用户反馈的核心痛点展开：
1. **行内样式嵌套失效**：如加粗包裹公式时星号暴露、中文标点无空格加粗/斜体失效、双链和超链接目标部分被格式化破坏等；
2. **引用块降级**：引用块未能遵循“透明纸”原则（即正文支持什么，引用块就必须支持什么），导致引用块内的公式失效、列表缩进丢失、Callout 标题公式加粗变纯文本、Mermaid 图表崩溃；
3. **Mermaid 图表缺陷**：子图标题被内部节点遮挡、深色模式大量黑字无法阅读、文字无法鼠标划选复制、图内链接无法点击。

经过 3 个专项审查子智能体对 `src/components/editor/cm/`、`src/lib/` 以及底层样式与解析引擎的全面代码走查与运行时验证，确认共存在 **14 项确凿缺陷**。本报告对每一项缺陷的代码位置、触发机理、测试用例和修复路径均进行了详细记录。

---

## 二、行内样式与数学公式缺陷审计

### 缺陷 1.1：加粗与斜体内嵌数学公式失效，星号暴露

#### 1. 确凿现象
在编辑器实时预览（Live Preview）中：
- 书写 `**$f(x)$**` 时，中间的公式渲染为 KaTeX，但**外层的两个 `**` 无法隐藏，加粗类 `mk-cm-strong` 未生效**；
- 书写 `**文本 $E=mc^2$ 文本**` 时，两端星号完全暴露，整段加粗失败；
- 同理，斜体内嵌公式 `*$f(x)$*`、删除线内嵌公式 `~~$f(x)$~~`、超链接内嵌公式 `[$f(x)$](url)` 均遭遇相同失效。但在 Word 预览与导出侧（走 `markdown-it`）可以正常显示。

#### 2. 代码位置
- `src/components/editor/cm/live-preview.ts` 第 823-825 行：
  ```typescript
  if (collector.mathRanges.some((math) => ref.from < math.to && ref.to > math.from)
    && (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough" || name === "InlineCode" || name === "Link")) return;
  ```
- `src/components/editor/cm/live-preview.ts` 第 297 行：
  ```typescript
  if (collector.mathRanges.some((math) => from < math.to && to > math.from)) continue;
  ```

#### 3. 根本原因剖析
- **区间几何相交判断错误**：
  `ref.from < math.to && ref.to > math.from` 判断的是**两个区间的交集非空（Overlap）**。
  原开发者意图是：防止公式内部的字符（例如 `$a * b * c$` 中的星号、`$P=[1,2]$` 中的方括号）被 Markdown 语法树误识别为外层的加粗或链接。
  但该相交条件同时包含了“外层语法节点完全包裹数学公式”（`ref.from <= math.from && ref.to >= math.to`）。因此，合法的加粗/斜体包裹公式被判定为相交，直接执行 `return`，完全跳过了加粗处理逻辑 `handleInlineWrapper`。
- **两级防御全部拦截**：
  即使 Lezer 语法树正确识别了 `StrongEmphasis`，在第 823 行被丢弃；备用的 `addRelaxedStrong` 又在第 297 行被相同的相交判断再次丢弃，造成 100% 误杀。

#### 4. 重现用例
```markdown
1. **$f(x)$**
2. **重要公式：$E=mc^2$ 必须牢记**
3. *$O(\log N)$*
4. ~~$x^2 + y^2 = 1$~~
5. [$f(x)$ 函数定义](https://example.com)
```

---

### 缺陷 1.2：中文与标点紧邻混排时单星号斜体失效

#### 1. 确凿现象
- 书写 `*实施单元：*集控`、`*注意！*请查看`、`*“重点”*内容` 时，在实时预览和 Word 预览中均无法解析为斜体，单星号直接暴露；
- 只有在前后手动敲入空格（如 `*实施单元：* 集控`）时才能勉强渲染。

#### 2. 代码位置
- 全局缺失：`src/lib/relaxed-emphasis.ts`
- 对比参考：`src/lib/relaxed-strong.ts`（仅实现了宽松加粗，未实现宽松斜体）

#### 3. 根本原因剖析
- **CommonMark 定界符规范限制**：
  根据 CommonMark 规范 §6.2，单星号 `*` 的右侧闭合定界符必须是 `right-flanking delimiter run`。若星号紧跟在 Unicode 标点（如全角冒号 `：`、感叹号 `！`、后引号 `”`）之后，则其后续字符**必须是空白或标点**。中文排版中紧跟的是汉字（既非空白亦非标点），CommonMark 解析器因此拒绝将其判定为闭合定界符。
- **代码库遗漏宽松斜体补丁**：
  项目针对 `**` 开发了 `relaxed-strong.ts` 来修补双星号加粗，但**完全遗漏了单星号斜体的宽松补丁**，导致紧贴标点的斜体彻底失效。

#### 4. 重现用例
```markdown
*实施单元：*集控
*警示！*禁止操作
*“权威发布”*请勿转载
```

---

### 缺陷 1.3：宽松加粗（relaxed-strong）贪心匹配与跨结构误伤

#### 1. 确凿现象
- 若文本中出现未成对的散落 `**`，或者 URL、行内公式内部含有 `**` 时，`findRelaxedStrongRanges` 会发生跨段落贪心配对，把不相关的文字误涂为加粗并隐藏星号；
- 例如：`前缀 ** 散落星号，然后是 **标准加粗**` 会把 `散落星号，然后是 ` 渲染为加粗。

#### 2. 代码位置
- `src/lib/relaxed-strong.ts` 第 66-105 行（`collectRelaxedStrongRanges`）

#### 3. 根本原因剖析
- `collectRelaxedStrongRanges` 采用纯文本线性扫描，仅简单地将第 $2n-1$ 个 `**` 视为起点，第 $2n$ 个视为终点。
- 它只避开了反引号代码（`inlineCodeRanges`），未结合 Markdown 语法树或上下文。一旦行内存在语法树已经闭合的标准加粗，或者存在孤立星号，其游标计算就会发生错位。

---

### 缺陷 1.4：超链接与双链目标被加粗侵入，双链显示名样式双端分裂

#### 1. 确凿现象
1. **链接 URL / 双链目标（Target）被加粗误侵入**：
   当链接地址中含有双星号时（例如 `[链接](https://example.com/api?q=**token**)` 或 `[[folder/**file.md**|显示名]]`），`addRelaxedStrong` 会直接对 URL 内部的 `**token**` 添加隐藏装饰，破坏链接地址的可读性与编辑；
2. **双链显示名 `[[target|label]]` 的加粗行为双端分裂**：
   当用户书写 `[[doc|**重要文档**]]` 时：
   - **Live Preview 编辑器**：界面直接显示纯文本 `**重要文档**`，星号不隐藏，**无法加粗**；
   - **Word 预览与导出**：显示为粗体 **重要文档**；
   - 造成编辑所见非所得。

#### 2. 代码位置
- `src/components/editor/cm/live-preview.ts` 第 290 行：
  ```typescript
  const relaxedStrongExcludedNodes = new Set(["StrongEmphasis", "InlineCode", "FencedCode", "CodeBlock"]);
  ```
  （未排除 `Link`、`URL`，亦未调用 `isInsideObsidianWikilink`）
- `src/components/editor/cm/widgets.ts` 第 659 行：
  ```typescript
  link.append(icon, document.createTextNode(this.label));
  ```

#### 3. 根本原因剖析
- `relaxedStrongExcludedNodes` 遗漏了链接与双链区间，导致宽松加粗误伤 URL 和目标路径；
- `MarkdownWikilinkWidget` 直接采用 `document.createTextNode(this.label)` 纯文本渲染，未经过行内标记渲染器解析。

---

### 缺陷 1.5：行内数学公式缺失首尾非空白校验导致货币符号误伤

#### 1. 确凿现象
书写日常句子 `这件衣服 $5，那件衣服 $10` 时，系统将 `5，那件衣服 ` 误判定为数学公式，两端被 KaTeX 渲染（并报错），中间正常正文被损毁。

#### 2. 代码位置
- `src/lib/markdown-math.ts` 第 55-62 行（`closingDollar` 函数）

#### 3. 根本原因剖析
CommonMark 与 KaTeX 规范硬性要求：
- 行内公式起始 `$` 的**后一个字符不能是 Unicode 空白字符或数字/换行**；
- 闭合 `$` 的**前一个字符不能是 Unicode 空白字符**。
当前 `findInlineMarkdownMath` 未做任何首尾字符校验，直接匹配下一个未转义的 `$`，导致跨句子的普通美元符号发生恶性串连。

---

## 三、块级容器与多级列表缺陷审计

### 缺陷 2.1：Callout 标题行富文本与数学公式完全降级为纯文本

#### 1. 确凿现象
在 Callout 标题行书写富文本或公式时（例如 `> [!note] 算法复杂度为 $O(\log N)$ 与 **重要参数**`）：
- 标题行中的数学公式 `$O(\log N)$` 变为纯字面文本，未渲染为 KaTeX；
- 标题行中的 `**重要参数**` 星号不隐藏，加粗样式丢失；
- 行内代码 `` `code` `` 反引号不隐藏。

#### 2. 代码位置
- `src/components/editor/cm/live-preview.ts` 第 604-620 行：
  ```typescript
  const markerFrom = firstContentStart + callout.markerStart;
  addWidget(collector, markerFrom, new MarkdownCalloutIconWidget(...), -1);
  hide(collector, markerFrom, firstLine.to); // 致命代码：把整行标题直接全部 hide 抹平！
  ```
- `src/components/editor/cm/widgets.ts` 第 708-711 行：
  ```typescript
  const title = document.createElement("span");
  title.className = "mk-cm-callout-title";
  title.textContent = this.title; // 致命代码：仅作为纯文本字符串插入 DOM
  ```

#### 3. 根本原因剖析
- `live-preview.ts` 在识别出 Callout 标记（如 `[!note]`）后，直接将从标记起点到行末的全部内容（`firstLine.to`）**一次性用 `hide` 装饰彻底遮蔽**；
- 随后将标题字符串原封不动传给 `MarkdownCalloutIconWidget`，而 Widget 的 DOM 构建只执行了 `title.textContent = this.title`；
- 整行标题既被底层遮盖跳过了所有语法树装饰，又在 Widget 内部降级为纯文本，导致公式、加粗、斜体、代码全部丢失。

---

### 缺陷 2.2：引用块与 Callout 内多级列表缩进丢失、样式不演进

#### 1. 确凿现象
在引用块（`> `）或 Callout 内部书写带有缩进的多级列表时：
- 第二级、第三级列表的缩进距离完全丢失，所有子列表被强制顶格对齐；
- 无序列表原本应当按照 `•` $\to$ `◦` $\to$ `▪` 逐级演进，在引用块内全部死锁在第一级的 `•`；
- 有序列表的多级样式（如 `1.` $\to$ `1)` $\to$ `a)`）同样失效。

#### 2. 代码位置
- `src/components/editor/cm/source-indent.ts` 第 23-47 行（`markdownSourceIndentLength`）
- `src/components/editor/cm/live-preview.ts` 第 18 行与列表处理逻辑

#### 3. 根本原因剖析
```typescript
// source-indent.ts:24-25
export function markdownSourceIndentLength(line: string): number {
  const match = line.match(/^ +/);
  return match ? match[0].length : 0;
}
```
- `markdownSourceIndentLength` 硬编码匹配**以空格开头的行首**（`^ +`）；
- 但在引用块和 Callout 中，列表行的开头是 `> `（例如 `> - 一级`，`> - 二级`）；
- `^ +` 正则匹配失败，计算出的缩进长度恒为 `0`；
- 结果导致 CodeMirror 的 `mk-cm-source-indent-*` 缩进类全部无法生成，BulletWidget 计算的 `depth` 恒为 `0`，多级列表在视觉上彻底扁平化。

---

### 缺陷 2.3：引用块内多行与单行块级数学公式彻底失效

#### 1. 确凿现象
在引用块中书写数学公式：
- 单行形式：`> $$E=mc^2$$`
- 多行独立块形式：
  ```markdown
  > $$
  > \frac{-b \pm \sqrt{b^2-4ac}}{2a}
  > $$
  ```
无论单行还是多行，公式完全无法被识别和渲染，直接作为带 `>` 的纯文本暴露。

#### 2. 代码位置
- `src/lib/markdown-math.ts` 第 167-175 行：
  ```typescript
  const trimmed = line.text.trim();
  if (trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) { ... }
  ```
- `src/lib/markdown-math.ts` 第 177-182 行（`displayDelimiter`）

#### 3. 根本原因剖析
- 行内公式解析器 `findInlineMarkdownMath` 显式避让 `$$`；
- 块级公式解析器 `findBlockMarkdownMath` 期望行首以 `$$` 开头；但在引用块中，`line.text` 的开头为 `> `，`trimmed` 结果为 `> $$...$$`，`startsWith("$$")` 判定为 `false`；
- 导致引用块内的公式陷入“行内不认、块级拒识”的盲区，彻底无法渲染。

---

### 缺陷 2.4：表格单元格内管道符公式与代码引发列裂解及转义污染

#### 1. 确凿现象
在表格单元格中书写含有管道符 `|` 的公式（如条件概率 `$P(A|B)$`）或代码（如 `` `a | b` ``）时：
- 表格解析器将公式内部的 `|` 误当作 Markdown 单元格分隔符，导致这一行被凭空切裂出多余的列，表格结构严重错乱变形；
- 当用户在表格工具中编辑并序列化写回时，公式内部的 `|` 被强制转义成 `\|`，不仅表格变形，连 KaTeX 公式语义也被彻底破坏。

#### 2. 代码位置
- `src/components/editor/cm/markdown-table.ts` 第 65-117 行（`splitTableRowCells`）
- `src/components/editor/cm/markdown-table.ts` 第 190-210 行（`serializeMarkdownTable`）

#### 3. 根本原因剖析
- `splitTableRowCells` 仅对双链 `[[...]]` 内的 `|` 做了避让，**完全未对行内代码反引号与数学公式 `$ ... $` 内部的 `|` 做避让**；
- 写回函数盲目对所有单元格内的非转义 `|` 执行 `replace(/\|/g, "\\|")`，污染了数学公式与代码文本。

---

### 缺陷 2.5：引用块内嵌套围栏代码块复制代码带引用前缀与围栏

#### 1. 确凿现象
在引用块内嵌套代码块：
```markdown
> ```typescript
> const a = 1;
> ```
```
点击右上角的“复制”按钮时，剪贴板中的内容变成了 `> const a = 1;` 甚至是 `> ```typescript\n> const a = 1;\n> ``` `，无法直接粘贴运行。

#### 2. 代码位置
- `src/components/editor/cm/live-preview.ts` 第 764-770 行（`CopyCodeWidget` 提取）

#### 3. 根本原因剖析
复制代码块内容时未对每一行执行引用前缀剥离（`line.replace(/^>\s?/, "")`），导致复制出的代码被污染。

---

## 四、Mermaid 图表渲染、样式与交互缺陷审计

### 缺陷 3.1：子图（subgraph）顶部标题被内部子节点卡片遮挡覆盖

#### 1. 确凿现象
在包含 `subgraph` 的 Mermaid 流程图中，顶部标题文字经常被其包含的第一排子卡片节点遮挡、压盖甚至完全盖住；在中文标题折行或存在嵌套子图时更为严重。

#### 2. 代码位置
- `src/lib/mermaid.ts` 第 23-34 行（`MERMAID_THEME_CSS`）
- `src/lib/mermaid.ts` 第 82-84 行（`flowchart.padding: 8`，`flowchart.subGraphTitleMargin: { top: 8, bottom: 16 }`）
- Mermaid 底层管线：`dagre` 布局计算与 SVG 组装（`measureDagreGraph`）

#### 3. 根本原因剖析（三层复合原因）
1. **Dagre 布局时忽略标题，后置 Margin 计算空间不足**：
   - Dagre 计算时完全不考虑标题高度，只根据子节点包围盒计算边界；
   - md-king 将 `flowchart.padding` 从官方默认的 15px 压缩为 8px，导致初始余量极小；
   - 后置处理为子图增加的高度与位移使得内部子节点距离子图顶边的预留空间仅有约 32px；而标题只要包含中文或稍微发生折行，高度立即达到 36~48px+，与子节点发生物理重合。
2. **嵌套子图（Compound Subgraph）负向位移碰撞**：
   - 内层子图高度增加时未像普通节点一样下移 Y 轴，内层子图顶边直接向上突进 12px，直接撞在外层子图标题文字上。
3. **SVG DOM 绘制层级（Stacking Order）倒置**：
   - Mermaid 生成 SVG 时，顺序为：`<g class="clusters">`（包含子图背景与标题） $\to$ `<g class="nodes">`（包含子节点卡片）。
   - 由于子节点卡片拥有不透明的背景颜色，且绘制在子图之后，根据 SVG 规范，子节点卡片**必然遮盖在子图标题文字正上方**。

---

### 缺陷 3.2：引用块中书写 Mermaid 图表无法渲染（报 Parse Error）

#### 1. 确凿现象
在引用块（`> `）或 Callout 内部书写 ```mermaid 代码块，完全无法渲染，显示红色的“图表渲染失败 / Parse error on line 1”。

#### 2. 代码位置
- `src/components/editor/cm/live-preview.ts` 第 1136-1147 行（`extractFenceBody`）

#### 3. 根本原因剖析
1. **闭合围栏正则未考虑引用前缀**：
   `const closing = /^\s*(```|~~~)/.test(last.text);` 遇到 `> ``` ` 时判定为 `false`，导致末尾的闭合围栏行被作为代码内容提取；
2. **未逐行剥离引用前缀 `>`**：
   提取出的 Mermaid 文本首行为 `> flowchart TD`。字符 `>` 是 Mermaid 语法的非法字符，Mermaid 语法解析器在第一行就直接崩溃抛错。

---

### 缺陷 3.3：深色模式下多类图表文字呈黑色/深灰色导致不可辨认

#### 1. 确凿现象
深色模式下，状态图、时序图中的分支条件/便签/参与者、ER 图的实体字段、类图的关系说明、思维导图等文本依然呈现深黑灰色（`#333333` / `#000000`），在深黑背景上完全看不清。

#### 2. 代码位置
- `src/lib/mermaid.ts` 第 51 行：`theme: "default" as const`（全局硬编码为白底浅色主题）
- `src/lib/mermaid.ts` 第 63-75 行：`themeCSS` 中的手动补充样式覆盖面极低
- `src/index.css` 第 3852-3855 行：`.dark .mk-cm-mermaid` 容器背景为深黑（`rgba(24, 24, 27, 0.6)`）

#### 3. 根本原因剖析
- 开发者为避免自定义颜色被改，全局锁死 `theme: "default"`，放弃了 Mermaid 自带的深色主题切换引擎；
- 图表自身背景透明，透出编辑器的深黑底色；
- 手动补丁仅修补了时序图消息文本，遗漏了状态图（全部为黑）、ER 图（全部为黑）、时序图便签与循环条件（全部为黑）、流程图子图标题等海量样式类名。

---

### 缺陷 3.4：图内文本无法拖选复制、超链接不可点击、拖动闪退源码

#### 1. 确凿现象
1. 鼠标无法在 Mermaid 图内划词选中文字并复制；
2. 只要在图表内拖动鼠标，图表就会闪退打回为原始 Markdown 代码；
3. 图表中定义的 `click` 交互超链接无法点击跳转。

#### 2. 代码位置
- `src/components/editor/cm/widgets.ts` 第 393-395 行：
  ```typescript
  ignoreEvent(): boolean {
    return false; // 致命代码：将事件全权交由 CodeMirror 处理
  }
  ```
- `src/components/editor/cm/live-preview.ts` 第 1118 行：
  ```typescript
  if (editable && selectionIntersectsRange(state, replaceFrom, replaceTo)) return false;
  ```
- `src/index.css`：缺少针对 Mermaid 容器的 `user-select: text` 样式声明。

#### 3. 根本原因剖析
- `MermaidWidget` 将 `ignoreEvent()` 覆写为 `false`，导致图表内所有的鼠标点击与拖拽全部被 CodeMirror 事件系统捕获，浏览器原生的文本选区与链接点击被阻止；
- 用户在图内拖拽时，CodeMirror 认为用户选中了图表所在区间，触发了第 1118 行的选区相交检查，直接将图表替换回源码；
- CSS 中未对 `.mk-cm-mermaid` 开启 `user-select: text` 与 `cursor: text`。

---

## 五、缺陷汇总矩阵与整改优先级

| 序号 | 缺陷模块 | 缺陷描述 | 严重级别 | 影响范围 |
| :---: | :--- | :--- | :---: | :--- |
| **1** | 行内样式 | `**$f(x)$**`、`*$f(x)$*` 加粗斜体包裹公式失效，星号暴露 | **P0 紧急** | 编辑器实时预览 |
| **2** | 块级容器 | Callout 标题行富文本与数学公式降级为纯文本字面量 | **P0 紧急** | 标注块标题渲染 |
| **3** | Mermaid | 子图（subgraph）顶部标题被内部节点卡片遮挡覆盖 | **P0 紧急** | 流程图、架构图 |
| **4** | Mermaid | 引用块与 Callout 内部书写 Mermaid 图表无法渲染崩溃 | **P0 紧急** | 引用块与图表嵌套 |
| **5** | Mermaid | 图内文本无法拖选复制、链接不可点、拖拽闪退源码 | **P0 紧急** | 图表阅读与交互 |
| **6** | 块级容器 | 引用块内多级列表缩进丢失、圆点/序号样式不演进 | **P1 高** | 引用块列表排版 |
| **7** | 块级容器 | 引用块内多行与单行 `$$` 块级数学公式彻底失效 | **P1 高** | 引用块公式排版 |
| **8** | Mermaid | 深色模式下状态图、ER图、时序图便签黑字隐形 | **P1 高** | 深色模式全图表 |
| **9** | 行内样式 | 中文标点紧邻单星号斜体失效（`*实施单元：*`） | **P1 高** | 中文斜体混排 |
| **10** | 表格系统 | 表格单元格内带管道符的公式（`$P(A\|B)$`）导致分列错乱与转义破坏 | **P1 高** | 表格与公式嵌套 |
| **11** | 行内样式 | URL 与双链目标被加粗侵入，双链显示名样式双端分裂 | **P2 中** | 链接与双链渲染 |
| **12** | 行内样式 | 行内数学公式无空白校验误伤货币符号（`$5 ... $10`） | **P2 中** | 日常文本与公式匹配 |
| **13** | 块级容器 | 引用块复制代码块内容附带 `>` 引用前缀与围栏 | **P2 中** | 代码块交互 |
| **14** | 行内样式 | 宽松加粗（relaxed-strong）贪心匹配导致跨结构误伤 | **P2 中** | 复杂行内排版 |

---
*本报告已完成全部技术定位与用例归档，待用户审阅确认后，将按照 P0 $\to$ P1 $\to$ P2 优先级展开系统级代码重构与统一优化。*
