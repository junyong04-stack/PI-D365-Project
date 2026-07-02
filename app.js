import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const tasksCol = collection(db, "tasks");

const STATUS_ORDER = ["완료", "진행중", "대기", "보류"];
const STATUS_COLOR = {
  완료: "var(--status-good)",
  진행중: "var(--series-blue)",
  대기: "var(--status-neutral)",
  보류: "var(--status-serious)",
};

let allTasks = [];
let filters = { category: "", department: "", status: "" };
let pendingTableRender = false;

const el = (sel) => document.querySelector(sel);

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : s;
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function clamp(v) {
  let n = Number(v);
  if (Number.isNaN(n)) n = 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function weightedAvg(tasks) {
  const totalWeight = tasks.reduce((s, t) => s + (Number(t.weight) || 0), 0);
  if (!totalWeight) return 0;
  const sum = tasks.reduce(
    (s, t) => s + (Number(t.weight) || 0) * (Number(t.progress) || 0),
    0
  );
  return sum / totalWeight;
}

// ---------- Firestore subscription ----------

onSnapshot(
  tasksCol,
  (snap) => {
    allTasks = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.priority ?? a.no ?? 0) - (b.priority ?? b.no ?? 0));
    el("#sync-status").textContent = `실시간 연결됨 · 마지막 갱신 ${new Date().toLocaleTimeString(
      "ko-KR"
    )}`;
    populateFilterOptions();
    renderHero();
    renderKPI();
    renderCategoryChart();
    renderStatusChart();
    renderTable();
  },
  (err) => {
    el("#sync-status").textContent =
      "연결 실패 — firebase-config.js 설정을 확인하세요";
    console.error(err);
  }
);

// ---------- filters ----------

function fillSelect(selector, values, placeholder) {
  const selectEl = el(selector);
  const current = selectEl.value;
  selectEl.innerHTML =
    `<option value="">${placeholder}</option>` +
    values
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
      .join("");
  selectEl.value = current;
}

function populateFilterOptions() {
  fillSelect("#filter-category", uniq(allTasks.map((t) => t.category)), "전체 대분류");
  fillSelect("#filter-department", uniq(allTasks.map((t) => t.department)), "전체 부서");
  fillSelect(
    "#filter-status",
    STATUS_ORDER.filter((s) => allTasks.some((t) => t.status === s)),
    "전체 상태"
  );
}

el("#filter-category").addEventListener("change", (e) => {
  filters.category = e.target.value;
  renderTable();
});
el("#filter-department").addEventListener("change", (e) => {
  filters.department = e.target.value;
  renderTable();
});
el("#filter-status").addEventListener("change", (e) => {
  filters.status = e.target.value;
  renderTable();
});

// ---------- hero / KPI ----------

function renderHero() {
  const avg = weightedAvg(allTasks);
  el("#hero-value").textContent = `${avg.toFixed(1)}%`;
  el("#hero-meter").style.width = `${Math.min(100, avg)}%`;
  const totalWeight = allTasks.reduce((s, t) => s + (Number(t.weight) || 0), 0);
  el("#hero-sub").textContent = `과제 ${allTasks.length}건 · 가중치 합계 ${totalWeight}`;
}

function renderKPI() {
  const tiles = [
    { label: "총 과제", value: allTasks.length, color: null },
    ...STATUS_ORDER.map((s) => ({
      label: s,
      value: allTasks.filter((t) => t.status === s).length,
      color: STATUS_COLOR[s],
    })),
  ];
  el("#kpi-row").innerHTML = tiles
    .map(
      (t) => `
      <div class="kpi-tile">
        <div class="label">${
          t.color ? `<span class="dot" style="background:${t.color}"></span>` : ""
        }${escapeHtml(t.label)}</div>
        <div class="value">${t.value}</div>
      </div>`
    )
    .join("");
}

// ---------- category chart ----------

function renderCategoryChart() {
  const cats = uniq(allTasks.map((t) => t.category));
  const withOrder = cats
    .map((name) => {
      const rows = allTasks.filter((t) => t.category === name);
      const minPriority = Math.min(...rows.map((t) => t.priority ?? t.no ?? 0));
      return { name, rows, minPriority };
    })
    .sort((a, b) => a.minPriority - b.minPriority);

  el("#category-chart").innerHTML = withOrder
    .map(({ name, rows }) => {
      const avg = weightedAvg(rows);
      return `
        <div class="cat-bar-row">
          <div class="cat-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="cat-track">
            <div class="grid-tick" style="left:25%"></div>
            <div class="grid-tick" style="left:50%"></div>
            <div class="grid-tick" style="left:75%"></div>
            <div class="cat-fill" style="width:${avg}%"></div>
          </div>
          <div class="cat-value">${avg.toFixed(0)}%</div>
        </div>`;
    })
    .join("");
}

// ---------- status distribution ----------

function renderStatusChart() {
  const total = allTasks.length || 1;
  el("#status-stack").innerHTML = STATUS_ORDER.map((s) => {
    const count = allTasks.filter((t) => t.status === s).length;
    if (!count) return "";
    const pct = (count / total) * 100;
    return `<div class="seg" style="width:${pct}%; background:${STATUS_COLOR[s]}" title="${s} ${count}건"></div>`;
  }).join("");

  el("#status-legend").innerHTML = STATUS_ORDER.map((s) => {
    const count = allTasks.filter((t) => t.status === s).length;
    return `<div class="item"><span class="swatch" style="background:${STATUS_COLOR[s]}"></span>${s} ${count}건</div>`;
  }).join("");
}

// ---------- table ----------

function filteredTasks() {
  return allTasks.filter(
    (t) =>
      (!filters.category || t.category === filters.category) &&
      (!filters.department || t.department === filters.department) &&
      (!filters.status || t.status === filters.status)
  );
}

function isEditingActive() {
  const activeEl = document.activeElement;
  return (
    activeEl &&
    activeEl.closest &&
    activeEl.closest("#task-tbody") &&
    ["TEXTAREA", "INPUT", "SELECT"].includes(activeEl.tagName)
  );
}

function rowHtml(t) {
  const progress = clamp(t.progress);
  return `
    <tr data-id="${escapeHtml(t.id)}">
      <td class="no-cell">${t.no}</td>
      <td><span class="cat-badge">${escapeHtml(t.category)}</span></td>
      <td class="title-cell">${escapeHtml(t.title)}</td>
      <td class="desc-cell">${escapeHtml(t.description)}</td>
      <td>${escapeHtml(t.department)}</td>
      <td><span class="importance-badge importance-${escapeHtml(t.importance)}">${escapeHtml(
    t.importance
  )}</span></td>
      <td>
        <select class="status-select" data-field="status">
          ${STATUS_ORDER.map(
            (s) => `<option value="${s}" ${t.status === s ? "selected" : ""}>${s}</option>`
          ).join("")}
        </select>
      </td>
      <td class="progress-cell">
        <div class="row">
          <input type="range" min="0" max="100" step="1" value="${progress}" data-field="progress-range" />
          <input type="number" min="0" max="100" step="1" value="${progress}" data-field="progress-number" />
        </div>
        <div class="mini-track"><div class="mini-fill" style="width:${progress}%"></div></div>
      </td>
      <td class="issue-cell"><textarea data-field="issue" placeholder="이슈 없음">${escapeHtml(
        t.issue
      )}</textarea></td>
      <td class="remark-cell"><textarea data-field="remark" placeholder="-">${escapeHtml(
        t.remark
      )}</textarea></td>
    </tr>`;
}

function renderTable() {
  if (isEditingActive()) {
    pendingTableRender = true;
    return;
  }
  const rows = filteredTasks();
  el("#task-tbody").innerHTML = rows.map(rowHtml).join("");
  rows.forEach(attachRowHandlers);
}

el("#task-tbody").addEventListener("focusout", () => {
  setTimeout(() => {
    if (pendingTableRender && !isEditingActive()) {
      pendingTableRender = false;
      renderTable();
    }
  }, 50);
});

function attachRowHandlers(t) {
  const tr = document.querySelector(`tr[data-id="${cssEscape(t.id)}"]`);
  if (!tr) return;

  const statusSel = tr.querySelector('[data-field="status"]');
  statusSel.addEventListener("change", () =>
    saveField(t.id, "status", statusSel.value, tr)
  );

  const range = tr.querySelector('[data-field="progress-range"]');
  const number = tr.querySelector('[data-field="progress-number"]');
  const miniFill = tr.querySelector(".mini-fill");

  const syncVisual = (val) => {
    range.value = val;
    number.value = val;
    miniFill.style.width = `${val}%`;
  };

  range.addEventListener("input", () => syncVisual(clamp(range.value)));
  range.addEventListener("change", () =>
    saveField(t.id, "progress", clamp(range.value), tr)
  );

  number.addEventListener("input", () => syncVisual(clamp(number.value)));
  number.addEventListener("change", () =>
    saveField(t.id, "progress", clamp(number.value), tr)
  );

  ["issue", "remark"].forEach((field) => {
    const ta = tr.querySelector(`[data-field="${field}"]`);
    ta.addEventListener("blur", () => saveField(t.id, field, ta.value, tr));
  });
}

async function saveField(id, field, value, tr) {
  try {
    await updateDoc(doc(db, "tasks", id), {
      [field]: value,
      updatedAt: serverTimestamp(),
    });
    if (tr) {
      tr.classList.add("save-flash");
      setTimeout(() => tr.classList.remove("save-flash"), 600);
    }
  } catch (err) {
    console.error(err);
    alert("저장에 실패했습니다. 네트워크 연결을 확인해주세요.");
  }
}
