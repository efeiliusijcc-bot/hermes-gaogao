import { Injectable } from '@nestjs/common';

const TOPICS = [
  '技术层级会谈', '技术会谈', '核问题', '黎巴嫩停火', '停火', '会谈', '谈判',
  '磋商', '路线图', '协议', '制裁', '冲突', '选举', '政策',
];

const EVENT_TYPES: Array<[RegExp, string]> = [
  [/会谈|谈判|磋商|对话/, '外交谈判'],
  [/停火|冲突|战争|袭击/, '安全事件'],
  [/选举|投票/, '政治事件'],
  [/制裁|关税|贸易/, '经济政策事件'],
];

@Injectable()
export class RuleQueryAnalysisService {
  extractTopics(text: string): string[] {
    const result = new Set(TOPICS.filter((topic) => text.includes(topic)));
    for (const clause of text.split(/[，。；、,;：:]+|启动|聚焦|围绕|关注|涉及|讨论|就/g)) {
      const value = clause.trim();
      if (value.length >= 2 && value.length <= 24 && /问题|停火|会谈|谈判|协议|制裁|冲突|合作|选举|政策|路线图/.test(value)) {
        result.add(value);
      }
    }
    return [...result].sort((a, b) => b.length - a.length).slice(0, 8);
  }

  detectEventType(text: string): string | undefined {
    return EVENT_TYPES.find(([pattern]) => pattern.test(text))?.[1];
  }
}
