import assert from 'node:assert/strict';
import test from 'node:test';
import { ReportsService } from '../server/reports.service.js';

const service = Object.create(ReportsService.prototype) as ReportsService & {
  renderMarkdownToHtml(markdown: string): Promise<string>;
};

test('renders legacy single-line reference entries as separate paragraphs', async () => {
  const html = await service.renderMarkdownToHtml(`# 测试报告

正文第一行
正文第二行

## **四、参考资料**
〔1〕来源一。https://example.com/1
〔2〕来源二。https://example.com/2
【3】来源三。https://example.com/3
[4] 来源四。https://example.com/4
**来源可信度评估：**
以上来源已经交叉核验。

**信息缺口：**
1. 尚缺少内部统计数据。
2. 后续进展仍需跟踪。
`);

  assert.match(html, /<p>〔1〕来源一。<a href="https:\/\/example\.com\/1">/u);
  assert.match(html, /<p>〔2〕来源二。<a href="https:\/\/example\.com\/2">/u);
  assert.match(html, /<p>【3】来源三。<a href="https:\/\/example\.com\/3">/u);
  assert.match(html, /<p>\[4\] 来源四。<a href="https:\/\/example\.com\/4">/u);
  assert.match(html, /<p>正文第一行\n正文第二行<\/p>/u);
  assert.match(html, /<ol>[\s\S]*?<li>尚缺少内部统计数据。<\/li>[\s\S]*?<li>后续进展仍需跟踪。<\/li>[\s\S]*?<\/ol>/u);
});

test('does not rewrite reference-like lines outside the reference section or inside code fences', async () => {
  const html = await service.renderMarkdownToHtml(`# 测试报告

[1] 正文中的普通说明
[2] 仍属于同一正文段落

\`\`\`text
## 四、参考资料
〔1〕代码示例
〔2〕代码示例
\`\`\`
`);

  assert.match(html, /<p>\[1\] 正文中的普通说明\n\[2\] 仍属于同一正文段落<\/p>/u);
  assert.match(html, /<code class="language-text">## 四、参考资料\n〔1〕代码示例\n〔2〕代码示例\n<\/code>/u);
});
