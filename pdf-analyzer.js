import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_EVIDENCE_PAGES = 12;

const TOPIC_GROUPS = [
  ["营业收入", "營業收入", "营业额", "營業額"],
  [
    "归母净利润",
    "歸母淨利潤",
    "归属于上市公司股东的净利润",
    "歸屬於母公司股東的淨利潤",
    "归属于母公司所有者的净利润",
    "歸屬於母公司所有者的淨利潤",
  ],
  ["资产总计", "資產總計", "资产总额", "資產總額"],
  ["负债合计", "負債合計", "负债总额", "負債總額"],
  [
    "经营活动现金流量净额",
    "經營活動現金流量淨額",
    "经营活动产生的现金流量净额",
    "經營活動產生的現金流量淨額",
  ],
  [
    "管理层",
    "管理層",
    "治理结构",
    "治理結構",
    "高级管理人员",
    "高級管理人員",
    "董事",
    "监事",
    "監事",
    "监事会",
    "監事會",
    "公司章程",
  ],
  [
    "审计意见",
    "審計意見",
    "核数师意见",
    "核數師意見",
    "Opinion",
    "opinion",
  ],
];

const TOPIC_MARKERS = [
  ["合并利润表", "合併利潤表", "ConsolidatedIncomeStatement", "主要会计数据", "主要會計數據"],
  ["合并利润表", "合併利潤表", "ConsolidatedIncomeStatement", "主要会计数据", "主要會計數據"],
  ["合并资产负债表", "合併資產負債表", "ConsolidatedBalanceSheet", "主要会计数据", "主要會計數據"],
  ["合并资产负债表", "合併資產負債表", "ConsolidatedBalanceSheet", "负债附注", "Liabilities負債"],
  ["合并现金流量表", "合併現金流量表", "ConsolidatedCashFlowStatement", "主要会计数据", "主要會計數據"],
  [
    "董事、监事和高级管理人员",
    "董事、監事和高級管理人員",
    "高级管理人员变动",
    "高級管理人員變動",
    "监事会的工作情况",
    "監事會的工作情況",
    "TheSupervisoryCommittee",
  ],
  ["一、审计意见", "一、審計意見", "I.AUDITOPINION", "审计报告", "審計報告", "獨立核數師報告", "IndependentAuditor"],
];

const STATEMENT_FAMILIES = [
  ["合并资产负债表", "合併資產負債表", "ConsolidatedBalanceSheet"],
  ["合并利润表", "合併利潤表", "ConsolidatedIncomeStatement"],
  ["合并现金流量表", "合併現金流量表", "ConsolidatedCashFlowStatement"],
];

const MANAGEMENT_EVENTS = ["变动", "變動", "离任", "離任", "退休", "退任", "任免", "辭任", "辞任"];
const LOW_PRIORITY_MARKERS = ["目录", "目錄", "五年摘要", "母公司资产负债表", "母公司利润表"];

function compact(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function countTerms(text, terms) {
  return terms.reduce((count, term) => count + Number(text.includes(term)), 0);
}

function requestedTerms(question) {
  const known = TOPIC_GROUPS.flat().filter((term) => question.includes(term));
  const chinese = question.match(/[\u4e00-\u9fff]{2,8}/g) ?? [];
  return [...new Set([...known, ...chinese])];
}

export function validatePdfFiles(files) {
  if (files.length < 1 || files.length > 2) {
    throw new Error("请选择 1—2 份 PDF 年报");
  }
  let total = 0;
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error(`${file.name}：仅支持 PDF 文件`);
    }
    if (!file.size || file.size > MAX_FILE_BYTES) {
      throw new Error(`${file.name}：文件为空或超过 60 MB`);
    }
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new Error("文件总大小不能超过 100 MB");
  }
}

export async function extractPdfFiles(files, onProgress = () => {}) {
  validatePdfFiles(files);
  const documents = [];
  const pages = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    } catch {
      throw new Error(`${file.name}：PDF 已加密、损坏或无法解析`);
    }

    documents.push({ name: file.name, pageCount: pdf.numPages });
    let searchablePages = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) searchablePages += 1;
      pages.push({ documentName: file.name, pageNumber, text });
      onProgress({
        fileIndex,
        fileCount: files.length,
        fileName: file.name,
        pageNumber,
        pageCount: pdf.numPages,
      });
    }
    if (!searchablePages) {
      throw new Error(`${file.name}：未检测到可检索文本层，请使用带文本层的 PDF`);
    }
  }

  return { documents, pages };
}

function scorePage(page, question, terms, requestedGroups, requestedYears) {
  const text = compact(page.text);
  let score = 0;
  score += terms.reduce((sum, term) => sum + (text.includes(term) ? 7 : 0), 0);
  score += requestedGroups.reduce(
    (sum, group) => sum + (includesAny(text, group.aliases) ? 12 : 0),
    0,
  );
  score += requestedYears.reduce(
    (sum, year) => sum + (text.includes(year) || page.documentName.includes(year) ? 7 : 0),
    0,
  );

  const statementCount = STATEMENT_FAMILIES.reduce(
    (sum, family) => sum + Number(includesAny(text, family)),
    0,
  );
  if (statementCount === 1) score += 24;
  if (statementCount > 1) score += 4;
  if (includesAny(text, LOW_PRIORITY_MARKERS)) score -= 18;
  if (text.includes("附注") && statementCount === 0) score -= 5;
  if (question.includes("管理") || question.includes("治理") || question.includes("董事")) {
    score += countTerms(text, MANAGEMENT_EVENTS) * 6;
  }
  return { score, text, statementCount };
}

export function selectEvidencePages(pages, question, limit = MAX_EVIDENCE_PAGES) {
  if (!question.trim() || limit <= 0) return [];

  const terms = requestedTerms(question);
  const requestedYears = [...new Set(question.match(/20\d{2}/g) ?? [])];
  const requestedGroups = TOPIC_GROUPS
    .map((aliases, index) => ({ aliases, index }))
    .filter(({ aliases }) => includesAny(question, aliases));

  let scored = pages
    .map((page, index) => ({
      page,
      index,
      ...scorePage(page, question, terms, requestedGroups, requestedYears),
    }))
    .filter((item) => item.page.text && item.score > 0);

  const allDocuments = [...new Set(pages.map((page) => page.documentName))];
  const matchingDocuments = requestedYears.length
    ? allDocuments.filter((name) => requestedYears.some((year) => name.includes(year)))
    : [];
  const eligibleDocuments = matchingDocuments.length ? matchingDocuments : allDocuments;
  scored = scored.filter((item) => eligibleDocuments.includes(item.page.documentName));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = [];
  const selectedKeys = new Set();
  const add = (item) => {
    const key = `${item.page.documentName}\u0000${item.page.pageNumber}`;
    if (!selectedKeys.has(key) && selected.length < limit) {
      selectedKeys.add(key);
      selected.push(item.page);
    }
  };

  for (const group of requestedGroups) {
    for (const documentName of eligibleDocuments) {
      const candidates = scored
        .filter(
          (item) =>
            item.page.documentName === documentName &&
            includesAny(item.text, group.aliases),
        )
        .sort((a, b) => {
          const markerDiff =
            countTerms(b.text, TOPIC_MARKERS[group.index]) -
            countTerms(a.text, TOPIC_MARKERS[group.index]);
          if (markerDiff) return markerDiff;
          if (group.index === 5) {
            const eventDiff =
              countTerms(b.text, MANAGEMENT_EVENTS) -
              countTerms(a.text, MANAGEMENT_EVENTS);
            if (eventDiff) return eventDiff;
          }
          if (a.statementCount !== b.statementCount) {
            return Number(b.statementCount === 1) - Number(a.statementCount === 1);
          }
          return b.score - a.score || a.index - b.index;
        });
      const pagesPerReport = group.index === 5 ? 2 : 1;
      candidates.slice(0, pagesPerReport).forEach(add);
    }
  }

  if (!selected.length || !requestedGroups.length) {
    for (const documentName of eligibleDocuments) {
      const best = scored.find((item) => item.page.documentName === documentName);
      if (best) add(best);
    }
    scored.forEach(add);
  }

  return selected
    .slice(0, limit)
    .sort(
      (a, b) =>
        a.documentName.localeCompare(b.documentName, "zh-CN") ||
        a.pageNumber - b.pageNumber,
    );
}
