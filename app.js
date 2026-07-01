import {
  extractPdfFiles,
  selectEvidencePages,
  validatePdfFiles,
} from "./pdf-analyzer.js";
import { requestAnalysis } from "./dashscope-client.js";

const form = document.querySelector("#analysis-form");
const apiKeyInput = document.querySelector("#api-key");
const fileInput = document.querySelector("#pdf-files");
const questionInput = document.querySelector("#question");
const analyzeButton = document.querySelector("#analyze-button");
const formMessage = document.querySelector("#form-message");
const fileList = document.querySelector("#file-list");
const resultPanel = document.querySelector("#result-panel");
const answer = document.querySelector("#answer");
const usageBadge = document.querySelector("#usage-badge");
const evidenceList = document.querySelector("#evidence-list");
const progressItems = [...document.querySelectorAll("#progress-steps li")];

let running = false;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderFiles(files) {
  fileList.replaceChildren();
  if (!files.length) {
    const empty = document.createElement("p");
    empty.textContent = "尚未选择文件";
    fileList.append(empty);
    return;
  }
  files.forEach((file) => {
    const row = document.createElement("div");
    row.className = "file-item";
    const name = document.createElement("span");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.textContent = formatBytes(file.size);
    row.append(name, size);
    fileList.append(row);
  });
}

function resetProgress() {
  progressItems.forEach((item) => {
    item.classList.remove("is-active", "is-done");
  });
}

function setProgress(step) {
  const order = ["parse", "retrieve", "model"];
  const current = order.indexOf(step);
  progressItems.forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle("is-active", index === current);
    item.classList.toggle("is-done", index < current);
  });
}

function finishProgress() {
  progressItems.forEach((item) => {
    item.classList.remove("is-active");
    item.classList.add("is-done");
  });
}

function renderEvidence(evidence) {
  evidenceList.replaceChildren();
  evidence.forEach((page) => {
    const card = document.createElement("article");
    card.className = "evidence-card";
    const name = document.createElement("strong");
    name.textContent = page.documentName;
    const pageNumber = document.createElement("span");
    pageNumber.textContent = `PDF P${page.pageNumber}`;
    const preview = document.createElement("p");
    const compact = page.text.replace(/\s+/g, " ").trim();
    preview.textContent = compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
    card.append(name, pageNumber, preview);
    evidenceList.append(card);
  });
}

function renderResult(result, evidence, pageCount) {
  answer.textContent = result.content;
  renderEvidence(evidence);
  const promptTokens = result.usage?.prompt_tokens ?? "—";
  const completionTokens = result.usage?.completion_tokens ?? "—";
  usageBadge.textContent =
    `${pageCount} 页 · ${evidence.length} 个证据页 · ` +
    `${promptTokens}/${completionTokens} tokens`;
  resultPanel.hidden = false;
  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

fileInput.addEventListener("change", () => {
  renderFiles([...fileInput.files]);
  resultPanel.hidden = true;
  formMessage.textContent = "";
  resetProgress();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (running) return;

  let apiKey = apiKeyInput.value.trim();
  const question = questionInput.value.trim();
  const files = [...fileInput.files];
  formMessage.textContent = "";
  resultPanel.hidden = true;
  resetProgress();

  try {
    if (!apiKey) throw new Error("请输入百炼 API Key");
    if (!question) throw new Error("请输入分析问题");
    validatePdfFiles(files);

    running = true;
    analyzeButton.disabled = true;
    analyzeButton.textContent = "正在解析年报…";
    setProgress("parse");

    let lastReportedPage = 0;
    const extracted = await extractPdfFiles(files, (progress) => {
      if (
        progress.pageNumber === progress.pageCount ||
        progress.pageNumber - lastReportedPage >= 5
      ) {
        lastReportedPage = progress.pageNumber;
        formMessage.textContent =
          `正在解析 ${progress.fileName}：${progress.pageNumber}/${progress.pageCount} 页`;
      }
    });

    analyzeButton.textContent = "正在筛选证据…";
    setProgress("retrieve");
    const evidence = selectEvidencePages(extracted.pages, question, 12);
    if (!evidence.length) {
      throw new Error("未找到与问题相关的证据页，请缩小问题范围或更换 PDF");
    }

    formMessage.textContent =
      `已从 ${extracted.pages.length} 页中选择 ${evidence.length} 个证据页`;
    analyzeButton.textContent = "正在调用 qwen3.7-plus…";
    setProgress("model");
    const result = await requestAnalysis({ apiKey, question, evidence });

    renderResult(result, evidence, extracted.pages.length);
    finishProgress();
    formMessage.textContent = "分析完成。请根据证据页回到原 PDF 复核。";
  } catch (error) {
    formMessage.textContent = error instanceof Error ? error.message : "分析失败，请重试";
    resetProgress();
  } finally {
    apiKey = "";
    running = false;
    analyzeButton.disabled = false;
    analyzeButton.textContent = "开始证据化分析";
  }
});

renderFiles([]);
