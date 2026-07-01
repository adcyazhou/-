const ENDPOINT =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

const SYSTEM_PROMPT = `你是“年报鉴证台”，负责基于企业年度报告证据执行结构化分析。

规则：
1. 只能依据用户提供的证据页回答，不得根据常识补齐缺失数字。
2. 每个关键结论必须标注[文件名 P页码]。
3. 财务数值保留原始单位和口径；跨年比较同时给出变动额与变动率。
4. 区分管理人员离任、任免、治理结构调整与普通股份变动。
5. 证据不足时明确写“未在所选证据页中定位”，并列入待复核项。
6. 输出依次包含：结论摘要、财务指标表、管理层或治理变动、审计意见、计算说明、待复核项。
7. 不构成审计意见、信用评级或投资建议。`;

const RULES_SUMMARY = `证据规则：优先合并主报表，其次主要会计数据，再次附注；PDF页码按文件物理页码记录。
同一指标跨年比较必须使用相同口径；变动率=(本期-上期)/上期×100%。
不得把目录、五年摘要或母公司报表中的重复字段误当作合并主报表结论。`;

const MAX_PAGE_CHARS = 14_000;
const MAX_CONTEXT_CHARS = 90_000;

export function buildEvidenceContext(evidence) {
  let remaining = MAX_CONTEXT_CHARS;
  const sections = [];
  for (const page of evidence) {
    if (remaining <= 0) break;
    const header = `--- 来源：${page.documentName}；PDF页码：${page.pageNumber} ---`;
    const available = Math.max(0, remaining - header.length - 2);
    const text = page.text.slice(0, Math.min(MAX_PAGE_CHARS, available));
    sections.push(`${header}\n${text}`);
    remaining -= header.length + text.length + 2;
  }
  return sections.join("\n\n");
}

function detailMessage(data) {
  const value = data?.error?.message ?? data?.message ?? "";
  return typeof value === "string" ? value : "";
}

export function mapDashScopeError(status, data) {
  if (status === 401 || status === 403) {
    return new Error("API Key 无效、已失效或没有调用该模型的权限");
  }
  if (status === 429) {
    return new Error("调用过于频繁或百炼额度不足，请稍后再试");
  }
  if (status === 400) {
    return new Error(`请求参数无效：${detailMessage(data) || "请检查模型服务配置"}`);
  }
  return new Error(`模型服务调用失败（HTTP ${status}）`);
}

export async function requestAnalysis({ apiKey, question, evidence }) {
  if (!apiKey) throw new Error("请输入百炼 API Key");
  if (!question.trim()) throw new Error("请输入分析问题");
  if (!evidence.length) throw new Error("没有可发送给模型的证据页");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen3.7-plus",
        temperature: 0.1,
        max_tokens: 3000,
        enable_thinking: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `${RULES_SUMMARY}\n\n问题：${question.trim()}\n\n` +
              `可用年报证据：\n${buildEvidenceContext(evidence)}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`模型服务返回了无法解析的响应（HTTP ${response.status}）`);
    }
    if (!response.ok) throw mapDashScopeError(response.status, data);

    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("模型服务未返回可用的分析内容");
    }
    return { content, usage: data.usage ?? {} };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("模型调用超过 120 秒，请缩小问题范围后重试");
    }
    if (error instanceof TypeError) {
      throw new Error("无法连接百炼接口，请检查网络或浏览器跨域限制");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
