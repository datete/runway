/**
 * 把 Runway / 上游返回的英文错误翻译成中文。
 * 只在写入 DB / 返回给前端的路径使用,内部正则判断仍使用原始英文串。
 *
 * Runway 常见格式: "REASON | MESSAGE | CATEGORY"
 *   例: "SAFETY.INPUT.IMAGE | Content did not pass content moderation. | VIOLENCE"
 *       "INTERNAL | Failure to pass the risk control system"
 */

const CATEGORY_MAP: Record<string, string> = {
  VIOLENCE: '暴力',
  GORE: '血腥',
  SEXUALLY_EXPLICIT: '色情',
  SEXUAL: '色情',
  NUDITY: '裸露',
  HATE: '仇恨言论',
  HARASSMENT: '骚扰',
  SELF_HARM: '自残',
  CSAM: '未成年违规',
  CHILD: '未成年违规',
  MINOR: '未成年违规',
  DANGEROUS: '危险行为',
  ILLEGAL: '违法内容',
  PROHIBITED: '违禁内容',
  PUBLIC_FIGURES: '公众人物',
  PUBLIC_FIGURE: '公众人物',
  CELEBRITY: '公众人物',
  COPYRIGHT: '版权',
  IP: '版权/知识产权',
  BRAND: '品牌/商标',
  TRADEMARK: '品牌/商标',
  PRIVACY: '隐私',
  PII: '隐私信息',
  POLITICAL: '政治敏感',
  WEAPONS: '武器',
  DRUGS: '毒品',
  TERRORISM: '恐怖主义',
  DEEPFAKE: '深度伪造',
};

const REASON_PREFIX_MAP: Array<[RegExp, string]> = [
  [/^SAFETY\.INPUT\.IMAGE/i, '输入图片未通过内容审核'],
  [/^SAFETY\.INPUT\.TEXT/i,  '输入文本未通过内容审核'],
  [/^SAFETY\.INPUT\.PROMPT/i,'提示词未通过内容审核'],
  [/^SAFETY\.INPUT/i,        '输入内容未通过审核'],
  [/^SAFETY\.OUTPUT\.IMAGE/i,'生成图像未通过内容审核'],
  [/^SAFETY\.OUTPUT\.VIDEO/i,'生成视频未通过内容审核'],
  [/^SAFETY\.OUTPUT/i,       '生成内容未通过审核'],
  [/^SAFETY/i,               '未通过内容审核'],
];

const WHOLE_MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/risk control/i,                              '账号风控未通过 (可能 IP/账号/频率异常)'],
  [/rate[\s_-]*limit/i,                          '请求频率超限'],
  [/quota|insufficient|balance|credit/i,         '账号额度/积分不足'],
  [/unauthori[sz]ed|invalid token|token expired|auth/i, '账号认证失效'],
  [/timeout|timed out/i,                         '请求超时'],
  [/network|ECONNRESET|fetch failed|socket/i,    '网络错误'],
  [/image url|not accessible|download.*image|cannot access/i, '图片地址无法访问'],
  [/invalid image|unsupported.*(format|type|extension)/i, '图片格式无效或不支持'],
  [/image too (large|big)|size.*exceed/i,        '图片过大'],
  [/prompt too long/i,                           '提示词过长'],
  [/prohibited/i,                                '内容违禁'],
  [/moderation/i,                                '内容审核未通过'],
  [/no (available|valid) account/i,              '暂无可用账号'],
  [/server error|internal error|500/i,           '服务端内部错误'],
  [/bad request|400/i,                           '请求参数错误'],
  [/404|not found/i,                             '资源不存在'],
];

/**
 * 翻译 Runway 风格的错误消息。
 * - 命中 REASON (如 SAFETY.INPUT.IMAGE) + CATEGORY (如 VIOLENCE) → "输入图片未通过内容审核 (暴力)"
 * - 命中 WHOLE 模式 → 对应中文
 * - 其他 → 原样返回
 */
export function translateRunwayError(raw?: string | null): string {
  if (!raw) return '系统任务失败';
  const s = String(raw).trim();
  if (!s) return '系统任务失败';

  const parts = s.split('|').map(p => p.trim()).filter(Boolean);
  const reason = parts[0] || '';
  const lastPart = (parts[parts.length - 1] || '').toUpperCase();

  // 1) REASON 前缀匹配
  for (const [re, zh] of REASON_PREFIX_MAP) {
    if (re.test(reason)) {
      const cat = CATEGORY_MAP[lastPart];
      return cat && lastPart !== reason.toUpperCase() ? `${zh} (${cat})` : zh;
    }
  }

  // 2) 整串关键字匹配
  for (const [re, zh] of WHOLE_MESSAGE_PATTERNS) {
    if (re.test(s)) {
      // 如果同时带 CATEGORY,追加
      const cat = CATEGORY_MAP[lastPart];
      return cat ? `${zh} (${cat})` : zh;
    }
  }

  // 3) 单独的 CATEGORY(兜底)
  if (lastPart && CATEGORY_MAP[lastPart]) {
    return `内容违规: ${CATEGORY_MAP[lastPart]}`;
  }

  return s;
}
