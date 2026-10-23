import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { MERMAID_THEMES } from '../../src/lib/mermaid-config.js';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');

const flow = `flowchart LR
    subgraph Stateful["有状态架构（请求绑定单机，难以自由扩缩容）"]
        UserA["用户 A"] --> Server1["应用节点 1 (本地内存保存 UserA Session)"]
        UserB["用户 B"] --> Server2["应用节点 2 (本地内存保存 UserB Session)"]
        UserA -.->|"网关转发到节点 2"| Server2
        Server2 -.->|"找不到 Session，报错退出"| UserA
    end
    subgraph Stateless["无状态架构（状态统一外置，计算节点随时增减）"]
        UserAll["任意用户请求"] --> SLB["负载均衡器 Nginx"]
        SLB --> AppCluster["无状态应用集群 (节点 1 .. N 完全对等)"]
        AppCluster --> ExtSession["分布式会话中心 (Redis / JWT 令牌)"]
        AppCluster --> ExtStorage["持久化存储层 (MySQL / 对象存储)"]
    end`;
const sequence = `sequenceDiagram
    autonumber
    actor User as 用户客户端
    participant GW as API 网关
    participant OrderSvc as 订单接入服务
    participant MQ as RocketMQ / Kafka
    participant DBWorker as 异步落库消费者
    participant DB as MySQL 数据库
    User->>GW: 提交抢购/下单请求 (瞬时洪峰)
    GW->>OrderSvc: 限流放行并路由转发
    OrderSvc->>OrderSvc: 校验参数 + Redis Lua 原子预扣库存并生成预留流水
    OrderSvc->>MQ: 发送可靠消息 (事务消息或本地消息表确保不丢)
    OrderSvc-->>User: 确认消息入队后立即返回“排队处理中”及请求流水号
    Note over MQ,DBWorker: 消息暂存在 Broker 磁盘中，将瞬时脉冲拉平
    loop 按数据库安全处理能力匀速拉取
        DBWorker->>MQ: 批量拉取待落库消息
        DBWorker->>DB: 开启本地事务：插入订单 + 条件扣减物理库存 + 更新流水状态
        DB-->>DBWorker: 事务提交成功
        DBWorker->>MQ: 提交消费确认 (ACK)
    end
    User->>OrderSvc: 客户端根据请求流水号轮询最终下单结果`;

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:1420';
const shared = Buffer.from(await readFile('src/lib/mermaid-config.js')).toString('base64');
// Exercise the actual Rust export page, including Office text normalization.
const rust = await readFile('src-tauri/src/core/mermaid.rs', 'utf8');
const template = rust.match(/r#"(<!doctype html>[\s\S]*?)"#/)[1];
function exportPage(source, theme, svg) {
  const values = { source_json: JSON.stringify(source), script_url: `${base}/src-tauri/resources/mermaid/mermaid.min.js`,
    renderer_config: shared, themes_json: JSON.stringify({ light: theme, dark: theme, diagrams: {} }),
    html_labels: String(!svg), node_spacing: '50', rank_spacing: '60' };
  return template.replaceAll('{{', '{').replaceAll('}}', '}')
    .replace(/\{(source_json|script_url|renderer_config|themes_json|html_labels|node_spacing|rank_spacing)\}/g, (_, name) => values[name]);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  await mkdir('.codex/mermaid-label-overflow', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 2400, height: 1600 } });
  let html = '<!doctype html><body></body>';
  await page.route('**/label-overflow-test', route => route.fulfill({ contentType: 'text/html', body: html }));
  let count = 0;
  for (const mode of ['light', 'dark', 'export-png', 'export-svg']) {
    for (const { id: theme } of MERMAID_THEMES) {
      for (const [name, source] of Object.entries({ flow, sequence })) {
        html = mode.startsWith('export') ? exportPage(source, theme, mode === 'export-svg') : '<!doctype html><body></body>';
        await page.goto(`${base}/label-overflow-test`);
        if (mode.startsWith('export')) {
          await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state));
          assert.equal(await page.locator('body').getAttribute('data-state'), 'ready', await page.locator('body').getAttribute('data-error'));
          if (mode === 'export-svg') {
            await page.evaluate(() => {
              const bytes = Uint8Array.from(atob(document.body.dataset.svgBase64), char => char.charCodeAt(0));
              document.querySelector('#diagram').innerHTML = new TextDecoder().decode(bytes);
            });
          }
        } else {
          await page.evaluate(async ({ source, theme, mode }) => {
            const { renderMermaid } = await import('/src/lib/mermaid.ts');
            document.body.style.background = mode === 'dark' ? '#202124' : '#fff';
            document.body.innerHTML = (await renderMermaid(source, mode === 'dark', { light: theme, dark: theme, diagrams: {} })).svg;
          }, { source, theme, mode });
        }
        const result = await page.evaluate(async () => {
          const root = document.querySelector('svg'); root.style.maxWidth = 'none';
          const box = element => element.getBoundingClientRect().toJSON();
          const geometry = () => [...root.querySelectorAll('g.edgeLabel,rect.note')].map(box);
          const before = geometry();
          const { layoutMermaidLabels, contrastRatio } = await import('/src/lib/mermaid-config.js');
          layoutMermaidLabels(root);
          return { before, after: geometry(),
            labels: [...root.querySelectorAll('g.edgeLabel')].map(element => ({ text: element.textContent, box: box(element) })),
            nodes: [...root.querySelectorAll('.node')].map(box),
            notes: [...root.querySelectorAll('g[data-et="note"]')].map(group => {
              const rect = group.querySelector('rect.note');
              return { box: box(rect), text: [...group.querySelectorAll('.noteText')].map(box),
                contrast: [...group.querySelectorAll('.noteText tspan')].map(text => contrastRatio(
                  getComputedStyle(text).fill.match(/[\d.]+/g).map(Number), getComputedStyle(rect).fill.match(/[\d.]+/g).map(Number))) };
            }) };
        });
        const context = `${mode}/${theme}/${name}`;
        assert.deepEqual(result.after, result.before, `${context}: repeated export must not move labels again`);
        if (name === 'flow') {
          assert.equal(result.labels.length, 2, context);
          assert.equal(result.nodes.length, 9, context);
          for (const label of result.labels) {
            for (const obstacle of [...result.nodes, ...result.labels.filter(other => other !== label).map(other => other.box)]) {
              const a = label.box, b = obstacle;
              assert.ok(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1
                || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, `${context}: ${label.text} overlaps a node or label`);
            }
          }
        } else {
          assert.equal(result.notes.length, 1, context);
          for (const note of result.notes) {
            for (const text of note.text) {
              assert.ok(text.left >= note.box.left + 6 && text.right <= note.box.right - 6
                && text.top >= note.box.top + 6 && text.bottom <= note.box.bottom - 6, `${context}: note text exceeds its background`);
            }
            assert.ok(note.contrast.every(ratio => ratio >= 4.5), `${context}: unreadable note text`);
          }
        }
        if ((theme === 'neutral' && name === 'flow' && mode === 'light')
          || (theme === 'redux-dark-color' && name === 'sequence' && mode === 'dark')) {
          await page.locator('svg').screenshot({ path: `.codex/mermaid-label-overflow/${name}-${mode}.png` });
        }
        count++;
      }
    }
  }
  console.log(`PASS: ${count} cases: both exact samples, all 11 themes, light/dark preview and actual Word PNG/SVG export pages.`);
} finally { await browser.close(); }
