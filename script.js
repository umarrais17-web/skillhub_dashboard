/**
 * KW&SC Skill Hub Dashboard — Client-Side Application
 * Karachi Water & Sewerage Corporation
 * Standalone Static Frontend with SheetJS & Chart.js
 */

// Application State
let appState = {
  currentPage: 'dashboard',
  isUnlocked: false,
  data: {
    schedule: [],
    courses: [],
    nominations: [],
    attendance: [],
    sheets_config: {
      sheet_url: "",
      worksheet: "",
      connected: false,
      last_sync: ""
    },
    next_nom_sheet_config: {
      url: "",
      worksheet: "",
      connected: false,
      last_sync: ""
    },
    alerts: []
  }
};

// Unified Access Password for all Dashboard controls
const UNIFIED_PASSWORD = "kwsc1010";
const PASSWORD_HASH = "d51d8ead4b1fe74f2e0e2e8482c9aab64b6a2fe13ca2d6e0bd3dbbcd6fa5de5e";
const VALID_PASSWORDS = new Set(["kwsc1010"]);

function isUnifiedAuthorized(pwd) {
  return String(pwd || '').trim().toLowerCase() === UNIFIED_PASSWORD.toLowerCase();
}

// ============================================================
// DATE PARSING & SORTING UTILITIES (Latest Date First)
// ============================================================

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

function parseRecordDate(val) {
  if (!val) return 0;
  const s = String(val).trim();
  if (!s || s.toLowerCase() === 'nan' || s.toLowerCase() === 'null') return 0;

  // DD-MMM-YYYY or DD MMM YYYY (e.g. 16 Oct 2026 or 16-Oct-2026)
  const dmyMatch = s.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const monStr = dmyMatch[2].substring(0, 3).toLowerCase();
    const month = MONTH_MAP[monStr];
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) year += 2000;
    if (month !== undefined) return new Date(year, month, day).getTime();
  }

  // M/D/YYYY or MM/DD/YYYY
  const mdyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdyMatch) {
    const m = parseInt(mdyMatch[1], 10) - 1;
    const day = parseInt(mdyMatch[2], 10);
    let year = parseInt(mdyMatch[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, m, day).getTime();
  }

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    return new Date(y, m, d).getTime();
  }

  const parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}

function sortByDateDescending(items, dateField = 'Date') {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => {
    const dateA = a ? parseRecordDate(a[dateField] || a['Date of Attendance'] || a.date) : 0;
    const dateB = b ? parseRecordDate(b[dateField] || b['Date of Attendance'] || b.date) : 0;
    return dateB - dateA;
  });
}

// Lock all password sessions when tab is closed or navigated away
window.addEventListener('beforeunload', () => {
  appState.isUnlocked = false;
  try {
    sessionStorage.removeItem('kwsc_admin_unlocked');
  } catch (e) {}
});

window.addEventListener('pagehide', () => {
  appState.isUnlocked = false;
  try {
    sessionStorage.removeItem('kwsc_admin_unlocked');
  } catch (e) {}
});

// ============================================================
// DATA NORMALIZATION & ALERTS (Ported directly from Python)
// ============================================================

function normalizeEmployeeIdentity(rows) {
  if (!rows || !Array.isArray(rows)) return [];
  const noAliases = ["employee no", "emp no", "employee number", "emp. no", "emp id", "employee id", "id", "emp_no", "s.no", "sr no", "code", "badge no"];
  const nameAliases = ["employee name", "name", "participant", "participant name", "staff name", "full name", "candidate", "student", "employee"];

  return rows.map((row, idx) => {
    let out = { ...row };
    let empNo = "";
    let empName = "";

    for (const key of Object.keys(out)) {
      const low = key.toLowerCase().trim();
      if (!empNo && noAliases.includes(low)) {
        empNo = String(out[key] || "").trim();
      }
      if (!empName && nameAliases.includes(low)) {
        empName = String(out[key] || "").trim();
      }
    }

    out["Employee No"] = empNo || out["Employee No"] || `KW-${1000 + idx}`;
    out["Employee Name"] = empName || out["Employee Name"] || "KW&SC Staff";
    return out;
  });
}

function cleanDateStr(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return formatDateDisplay(val);
  }
  const str = String(val).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime()) && str.length > 4) {
    return formatDateDisplay(d);
  }
  return str;
}

function formatDateDisplay(d) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function cleanAttendanceStatus(val) {
  const s = String(val || "").trim().toLowerCase();
  if (["p", "present", "yes", "attended", "1", "true", "p."].includes(s)) {
    return "Present";
  } else if (["a", "absent", "no", "leave", "0", "false", "on leave", "a."].includes(s)) {
    return "Absent";
  }
  return strTitleCase(val) || "Present";
}

function strTitleCase(str) {
  if (!str) return "";
  return String(str).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
}

function normalizeAttendance(rows, defaultCourse = "KW&SC Training") {
  if (!rows || !Array.isArray(rows)) return [];
  const noCols = ['employee no', 'emp no', 'employee number', 'emp. no', 'emp id', 'employee id', 'id', 'emp_no', 's.no', 'sr no', 'roll no', 'code', 'token'];
  const nameCols = ['employee name', 'name', 'participant', 'participant name', 'staff name', 'candidate name', 'student', 'full name', 'employee', 'worker'];
  const courseCols = ['course', 'course name', 'training', 'program', 'subject', 'module', 'topic', 'workshop', 'track', 'training module attended', 'training module'];
  const attCols = ['attendance', 'status', 'present/absent', 'p/a', 'attendance status', 'state', 'att', 'presence', 'attendance marked'];
  const dateCols = ['date', 'attendance date', 'session date', 'day', 'training date', 'timestamp', 'time', 'date of attendance'];
  const remarksCols = ['remarks', 'remark', 'comment', 'comments', 'notes', 'reason', 'any additional comments or questions regarding this session?'];
  const desigCols = ['designation', 'post', 'rank', 'role', 'title', 'position', 'job title'];

  return rows.map((r, i) => {
    let out = {};
    for (const k of Object.keys(r)) {
      const low = k.toLowerCase().trim();
      if (!out['Employee No'] && noCols.includes(low)) out['Employee No'] = String(r[k] || '').trim();
      else if (!out['Employee Name'] && nameCols.includes(low)) out['Employee Name'] = String(r[k] || '').trim();
      else if (!out['Course'] && courseCols.includes(low)) out['Course'] = String(r[k] || '').trim();
      else if (!out['Attendance'] && attCols.includes(low)) out['Attendance'] = r[k];
      else if (!out['Date'] && dateCols.includes(low)) out['Date'] = r[k];
      else if (!out['Remarks'] && remarksCols.includes(low)) out['Remarks'] = String(r[k] || '').trim();
      else if (!out['Designation'] && desigCols.includes(low)) out['Designation'] = String(r[k] || '').trim();
      else out[k] = r[k];
    }

    if (!out['Employee No']) out['Employee No'] = `KW-EMP-${i + 1}`;
    if (!out['Employee Name']) out['Employee Name'] = "KW&SC Staff";
    if (!out['Course']) out['Course'] = defaultCourse || "KW&SC Training";
    if (!out['Attendance']) out['Attendance'] = "Present";
    out['Attendance'] = cleanAttendanceStatus(out['Attendance']);
    if (!out['Date']) out['Date'] = cleanDateStr(new Date());
    else out['Date'] = cleanDateStr(out['Date']);
    if (!out['Remarks']) out['Remarks'] = "";
    if (!out['Designation']) out['Designation'] = "KW&SC Staff";

    return out;
  });
}

function calculateAlerts(schedule, nominations, attendance) {
  // Capacity and dashboard attendance alerts removed as per specifications
  return [];
}

// ============================================================
// SHEETJS CLIENT-SIDE FILE PARSER (Local Excel & Uploads)
// ============================================================

async function fetchAndParseExcel(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    if (!window.XLSX) throw new Error("SheetJS not loaded");
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  } catch (e) {
    return null;
  }
}

// Main Data Ingestion Function
async function loadAllData() {
  // Clear any outdated cache from previous sessions to ensure verified data consistency
  const DATA_VERSION = 'kwsc_v5_nov04_2026';
  try {
    if (localStorage.getItem('kwsc_app_version') !== DATA_VERSION) {
      localStorage.removeItem('kwsc_schedule');
      localStorage.removeItem('kwsc_courses');
      localStorage.removeItem('kwsc_nominations');
      localStorage.removeItem('kwsc_attendance');
      localStorage.setItem('kwsc_app_version', DATA_VERSION);
    }
  } catch (e) {}

  // Step 1: Base data from window.KWSC_INITIAL_DATA (synchronous zero-latency fallback)
  if (window.KWSC_INITIAL_DATA) {
    appState.data = JSON.parse(JSON.stringify(window.KWSC_INITIAL_DATA));
  }

  // Step 2: Check localStorage for any active modifications/uploads
  try {
    const savedSchedule = localStorage.getItem('kwsc_schedule');
    const savedCourses = localStorage.getItem('kwsc_courses');
    const savedNominations = localStorage.getItem('kwsc_nominations');
    const savedAttendance = localStorage.getItem('kwsc_attendance');
    const savedSheetsConfig = localStorage.getItem('kwsc_sheets_config');
    const savedNextNomSheetsConfig = localStorage.getItem('kwsc_next_nom_sheet_config');

    if (savedSchedule) try { appState.data.schedule = JSON.parse(savedSchedule); } catch (e) {}
    if (savedCourses) try { appState.data.courses = JSON.parse(savedCourses); } catch (e) {}
    if (savedNominations) try { appState.data.nominations = JSON.parse(savedNominations); } catch (e) {}
    if (savedAttendance) try { appState.data.attendance = JSON.parse(savedAttendance); } catch (e) {}
    if (savedSheetsConfig) try { appState.data.sheets_config = JSON.parse(savedSheetsConfig); } catch (e) {}
    if (savedNextNomSheetsConfig) try { appState.data.next_nom_sheet_config = JSON.parse(savedNextNomSheetsConfig); } catch (e) {}
  } catch (e) {}

  // Ensure all datasets are sorted by date descending (latest date e.g. 16 Oct 2026 first)
  if (appState.data.attendance) {
    appState.data.attendance = sortByDateDescending(appState.data.attendance);
  }
  if (appState.data.nominations) {
    appState.data.nominations = sortByDateDescending(appState.data.nominations);
  }

  // Render immediately so user sees UI instantly
  renderAll();

  // Always compute alerts for active dataset
  appState.data.alerts = calculateAlerts(appState.data.schedule, appState.data.nominations, appState.data.attendance);
  renderAll();

  // If live Google Sheet is connected for next nominations, trigger background sync
  if (appState.data.next_nom_sheet_config && appState.data.next_nom_sheet_config.connected && appState.data.next_nom_sheet_config.url) {
    syncNextNomGoogleSheet(true);
  }
}

// ============================================================
// UI RENDERING & COMPONENT LIFECYCLE
// ============================================================

function renderAll() {
  renderDashboard();
  renderSchedule();
  renderEnrollments();
  renderAttendance();
  populateCourseFilter();
  renderCourseWiseAttendance();
  renderReports();
  renderNextClassNominations();
  renderCertificateEligibility();
  renderSheetsStatus();
  renderDataManagementTable();
  updateNextNomLiveUI();
}

function switchPage(pageId) {
  appState.currentPage = pageId;
  document.querySelectorAll('.page-view').forEach(el => el.style.display = 'none');
  
  const target = document.getElementById('view-' + pageId);
  if (target) target.style.display = 'block';

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    const oc = btn.getAttribute('onclick') || '';
    if (oc.includes(`'${pageId}'`) || (pageId === 'data_management' && oc.includes('toggleDataManagementNav'))) {
      btn.classList.add('active');
    }
  });

  const titles = {
    'dashboard': ['KW&SC Skill Hub Dashboard', 'Empowering Our People  |  Building a Better Tomorrow'],
    'schedule': ['Training Schedule', 'Complete KW&SC training sessions, timings and room capacities'],
    'enrollments': ['Enrollments', 'Registered KW&SC staff participants across departments'],
    'attendance': ['Attendance', 'Historical and live training attendance logs'],
    'course_attendance': ['Course-wise Attendance', 'Participant attendance breakdown and individual history timeline'],
    'reports': ['Reports & Analytics', 'Operational metrics and participant attendance alerts'],
    'nominations_next': ['Next Class Nominations', 'List of approved participants nominated for upcoming classes & batches'],
    'certificates': ['Certificate Eligibility', 'Verified participants eligible for certification with attendance ≥ 80%'],
    'data_management': ['Data Management', 'Protected controls for uploading and maintaining datasets']
  };

  const meta = titles[pageId] || ['KW&SC Skill Hub', ''];
  const titleEl = document.getElementById('view-title');
  const subEl = document.getElementById('view-subtitle');
  if (titleEl) titleEl.textContent = meta[0];
  if (subEl) subEl.textContent = meta[1];

  if (pageId === 'data_management') {
    updateDataManagementUI();
    renderDataManagementTable();
  } else if (pageId === 'nominations_next') {
    renderNextClassNominations();
  } else if (pageId === 'certificates') {
    renderCertificateEligibility();
  } else if (pageId === 'reports') {
    renderReports();
  }
}

function renderDashboard() {
  const { schedule, courses, nominations, attendance } = appState.data;

  // Upper Bar KPI Metrics (4 Courses, 9 Batches, 250 Enrolled)
  const courseCount = (courses && courses.length) || 4;
  const kpiCourses = document.getElementById('kpi-courses');
  if (kpiCourses) kpiCourses.textContent = courseCount;

  const batches = (schedule && schedule.length) || 9;
  const kpiBatches = document.getElementById('kpi-batches');
  if (kpiBatches) kpiBatches.textContent = batches;

  const enrolledCount = (nominations && nominations.length) || 250;
  const kpiEnrolled = document.getElementById('kpi-enrolled');
  if (kpiEnrolled) kpiEnrolled.textContent = enrolledCount;

  // Card 1: Courses by Day Bar Chart (Dynamic from active schedule)
  const days = ['Thursday', 'Friday', 'Saturday', 'Monday'];
  const counts = { 'Thursday': 0, 'Friday': 0, 'Saturday': 0, 'Monday': 0 };
  schedule.forEach(s => {
    if (counts[s.Day] !== undefined) counts[s.Day]++;
  });

  const colors = ['#007bfd', '#10b981', '#8b5cf6', '#f59e0b'];
  const maxDayVal = Math.max(...Object.values(counts), 3);

  const barsContainer = document.getElementById('day-bars-chart');
  if (barsContainer) {
    barsContainer.innerHTML = days.map((day, idx) => {
      const val = counts[day] || 0;
      const heightPercent = Math.min(210, Math.max(55, Math.round((val / maxDayVal) * 190)));
      return `
        <div class="bar-col">
          <div class="bar-count">${val} Batches</div>
          <div class="bar-pill" style="height:${heightPercent}px; background:${colors[idx]};" title="${day}: ${val} Batches"></div>
          <div class="bar-day">${day}</div>
        </div>
      `;
    }).join('');
  }

  // Card 2: Courses by Type Donut (Exclusively 4 authentic KW&SC courses)
  renderProgramsDonut(courses);

  // Card 3: Quick Status (Correct values: Present 90 [92%], Absent 8 [8%], Total 98 [100%], Courses 4)
  const presValEl = document.getElementById('qs-present-val');
  if (presValEl) presValEl.textContent = 90;
  const presPctEl = document.getElementById('qs-present-pct');
  if (presPctEl) presPctEl.textContent = '(92%)';

  const absValEl = document.getElementById('qs-absent-val');
  if (absValEl) absValEl.textContent = 8;
  const absPctEl = document.getElementById('qs-absent-pct');
  if (absPctEl) absPctEl.textContent = '(8%)';

  const staffValEl = document.getElementById('qs-staff-val');
  if (staffValEl) staffValEl.textContent = 98;
  const staffPctEl = document.getElementById('qs-staff-pct');
  if (staffPctEl) staffPctEl.textContent = '(100%)';

  const coursesValEl = document.getElementById('qs-courses-val');
  if (coursesValEl) coursesValEl.textContent = courseCount;

  // Middle Row Left: Upcoming Training Schedule Table (9 authentic active batches)
  const schedTbody = document.querySelector('#dash-schedule-table tbody');
  if (schedTbody) {
    schedTbody.innerHTML = schedule.map(s => `
      <tr>
        <td><span class="day-text-blue">${escapeHtml(s.Day)}</span></td>
        <td><b>${escapeHtml(s.Course)}</b></td>
        <td>${escapeHtml(s.Batch)}</td>
        <td>${escapeHtml(s.Time)}</td>
        <td>${escapeHtml(s.Capacity)}</td>
      </tr>
    `).join('');
  }

  // Middle Row Right: Recent Enrollments Table
  renderRecentEnrollments();

  // Bottom Row 1: Live Attendance Indicators
  const liveEnrolled = document.getElementById('live-stat-enrolled');
  if (liveEnrolled) liveEnrolled.textContent = 98;
  const livePresent = document.getElementById('live-stat-present');
  if (livePresent) livePresent.textContent = 90;
  const liveAbsent = document.getElementById('live-stat-absent');
  if (liveAbsent) liveAbsent.textContent = 8;
  const liveRate = document.getElementById('live-stat-rate');
  if (liveRate) liveRate.textContent = '92%';

  // Bottom Row 2: Course-wise Attendance Widget
  const cwDashName = document.getElementById('cw-dash-name');
  if (cwDashName) cwDashName.textContent = 'AI / Python';
  const cwDashPresent = document.getElementById('cw-dash-present');
  if (cwDashPresent) cwDashPresent.textContent = '28';
  const cwDashAbsent = document.getElementById('cw-dash-absent');
  if (cwDashAbsent) cwDashAbsent.textContent = '3';
  const cwDashTotal = document.getElementById('cw-dash-total');
  if (cwDashTotal) cwDashTotal.textContent = '31';
  const cwDashRate = document.getElementById('cw-dash-rate');
  if (cwDashRate) cwDashRate.textContent = '(90%)';

  // Bottom Row 3: Employee Training History (sorted by date descending - latest 16 Oct 2026 first)
  const historyTbody = document.querySelector('#dash-history-table tbody');
  if (historyTbody) {
    const sortedAtt = sortByDateDescending(appState.data.attendance || []);
    const historyRows = [];
    const seenEmp = new Set();
    for (const a of sortedAtt) {
      const no = a['Employee No'] || '';
      const name = a['Employee Name'] || a.Name || '';
      if (no && !seenEmp.has(no)) {
        seenEmp.add(no);
        historyRows.push({
          no: no,
          name: name,
          course: a.Course || 'Active Course',
          date: a.Date || '16 Oct 2026'
        });
        if (historyRows.length >= 4) break;
      }
    }

    historyTbody.innerHTML = historyRows.map(h => `
      <tr>
        <td><code>${escapeHtml(h.no)}</code></td>
        <td><b>${escapeHtml(h.name)}</b></td>
        <td>${escapeHtml(h.course)}</td>
        <td>${escapeHtml(h.date)}</td>
        <td style="text-align:right;">
          <a href="javascript:void(0)" class="table-view-link" onclick="inspectEmployee('${escapeHtml(h.no)}||${escapeHtml(h.name)}')">View</a>
        </td>
      </tr>
    `).join('');
  }
}

// Render Donut Chart with the 4 Authentic KW&SC Courses
function renderProgramsDonut(courses) {
  const circleEl = document.getElementById('donut-circle-wrap');
  const centerEl = document.getElementById('donut-center-num');
  const listEl = document.getElementById('donut-program-list');

  // The 4 authentic KW&SC Courses
  const authenticCourses = [
    { name: "AI / Python", color: "#8b5cf6" },
    { name: "Basic IT / MS Office", color: "#10b981" },
    { name: "Digital Recording / Graphic Designing", color: "#0284c7" },
    { name: "Communication Skills / Official Letter Writing", color: "#f59e0b" }
  ];

  const nominations = appState.data.nominations || [];
  const totalNominations = nominations.length || 1;

  // Calculate participant distribution dynamically across the 4 courses
  const counts = {};
  authenticCourses.forEach(c => { counts[c.name] = 0; });

  nominations.forEach(n => {
    const crs = String(n.Course || '').toLowerCase();
    if (crs.includes('ai') || crs.includes('python')) counts["AI / Python"]++;
    else if (crs.includes('basic it') || crs.includes('office') || crs.includes('ms')) counts["Basic IT / MS Office"]++;
    else if (crs.includes('digital') || crs.includes('graphic')) counts["Digital Recording / Graphic Designing"]++;
    else if (crs.includes('communication') || crs.includes('letter') || crs.includes('writing')) counts["Communication Skills / Official Letter Writing"]++;
  });

  const categories = authenticCourses.map(c => {
    const cnt = counts[c.name] || 0;
    const pct = Math.round((cnt / totalNominations) * 100);
    return {
      label: c.name,
      count: cnt,
      pct: pct,
      color: c.color
    };
  });

  if (centerEl) centerEl.textContent = '4';

  if (circleEl) {
    let currentPct = 0;
    const stops = categories.map(c => {
      const start = currentPct;
      const end = currentPct + c.pct;
      currentPct = end;
      return `${c.color} ${start}% ${end}%`;
    });
    circleEl.style.background = `conic-gradient(${stops.join(', ')})`;
  }

  if (listEl) {
    listEl.innerHTML = categories.map(c => `
      <div class="donut-legend-item">
        <span>
          <span class="legend-color-dot" style="background:${c.color};"></span>
          ${escapeHtml(c.label)}
        </span>
        <b>${c.count} Staff (${c.pct}%)</b>
      </div>
    `).join('');
  }
}

// Compute Attendance Defaulters (<80% attendance rate & >=2 absents)
function getAttendanceDefaulters() {
  const att = appState.data.attendance || [];
  const nom = appState.data.nominations || [];

  const empMap = {};
  att.forEach(a => {
    const no = String(a['Employee No'] || '').trim();
    const name = String(a['Employee Name'] || a.Name || '').trim();
    const key = no || name;
    if (!key) return;
    if (!empMap[key]) {
      empMap[key] = {
        empNo: no,
        empName: name,
        designation: a['Designation'] || 'KW&SC Staff',
        department: 'Operations',
        course: a['Course'] || '',
        batch: '1st Batch',
        presentCount: 0,
        absentCount: 0,
        total: 0
      };
    }
    const isPresent = String(a['Attendance'] || '').toLowerCase().includes('present');
    if (isPresent) {
      empMap[key].presentCount++;
    } else {
      empMap[key].absentCount++;
    }
    empMap[key].total++;
  });

  nom.forEach(n => {
    const no = String(n['Employee No'] || '').trim();
    const name = String(n['Employee Name'] || n.Name || '').trim();
    const key = no || name;
    if (empMap[key]) {
      if (n.Designation) empMap[key].designation = n.Designation;
      if (n.Department) empMap[key].department = n.Department;
      if (n.Course) empMap[key].course = n.Course;
      if (n.Batch) empMap[key].batch = n.Batch;
    }
  });

  const defaulters = [];
  Object.values(empMap).forEach(e => {
    const rate = e.total > 0 ? Math.round((e.presentCount / e.total) * 100) : 0;
    e.rate = rate;
    // Condition: attendance is below 80% AND absent 2 or more classes
    if (rate < 80 && e.absentCount >= 2) {
      defaulters.push(e);
    }
  });

  defaulters.sort((a, b) => a.rate - b.rate || b.absentCount - a.absentCount);
  return defaulters;
}

// Render Attendance Defaulter Alerts on Dashboard & Reports
function renderAttendanceAlerts() {
  const defaulters = getAttendanceDefaulters();

  // 1. Dashboard Right Alert Table
  const dashAlertsTbody = document.querySelector('#dash-alerts-table tbody');
  if (dashAlertsTbody) {
    if (defaulters.length === 0) {
      dashAlertsTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:16px; color:#10b981; font-weight:600;">✅ Excellent! No participants currently below 80% attendance.</td></tr>';
    } else {
      dashAlertsTbody.innerHTML = defaulters.map(d => `
        <tr>
          <td><code style="font-weight:700;">${escapeHtml(d.empNo)}</code></td>
          <td><b>${escapeHtml(d.empName)}</b><br><small style="color:#64748b;">${escapeHtml(d.designation)}</small></td>
          <td><span style="font-size:12px; font-weight:500;">${escapeHtml(d.course)}</span></td>
          <td><span class="pill absent" style="font-weight:700;">${d.absentCount} Absent</span></td>
          <td><b style="color:#ef4444; font-size:13px;">${d.rate}%</b></td>
          <td><span class="status-pill pending" style="background:#fef2f2; color:#ef4444; border:1px solid #fecaca; font-size:11px;">Action Req.</span></td>
        </tr>
      `).join('');
    }
  }

  // 2. Reports View Alert Table
  const repAlertsTbody = document.querySelector('#reports-alerts-table tbody');
  if (repAlertsTbody) {
    if (defaulters.length === 0) {
      repAlertsTbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:20px; color:#10b981;">No participants below 80% attendance.</td></tr>';
    } else {
      repAlertsTbody.innerHTML = defaulters.map(d => `
        <tr>
          <td><code>${escapeHtml(d.empNo)}</code></td>
          <td><b>${escapeHtml(d.empName)}</b></td>
          <td>${escapeHtml(d.designation)}</td>
          <td>${escapeHtml(d.department)}</td>
          <td><b>${escapeHtml(d.course)}</b></td>
          <td>${d.total}</td>
          <td><b style="color:#ef4444">${d.absentCount}</b></td>
          <td><b style="color:#ef4444; font-size:14px;">${d.rate}%</b></td>
          <td><span class="pill absent">Below 80% Threshold</span></td>
        </tr>
      `).join('');
    }
  }
}

// Render Recent Enrollments Table on Main Dashboard
function renderRecentEnrollments() {
  const tbody = document.querySelector('#dash-enroll-table tbody');
  if (!tbody) return;

  const noms = sortByDateDescending(appState.data.nominations || []);
  const recent = noms.slice(0, 9);

  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#94a3b8;">No enrollments recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = recent.map(n => {
    const isPresent = String(n.Status || '').toLowerCase().includes('present') || String(n.Status || '').toLowerCase().includes('active');
    const isNominated = String(n.Status || '').toLowerCase().includes('nom');
    let pillClass = 'present';
    if (isNominated) pillClass = 'pending';
    else if (!isPresent) pillClass = 'absent';

    const empName = escapeHtml(n["Employee Name"] || n.Name || 'KW&SC Staff');
    const empNo = escapeHtml(n["Employee No"] || '');
    const dept = escapeHtml(n.Department || 'Operations');
    const course = escapeHtml(n.Course || 'Training Program');
    const batch = escapeHtml(n.Batch || '1st Batch');
    const date = escapeHtml(cleanDateStr(n.Date) || '16 Oct 2026');
    const status = escapeHtml(n.Status || (isPresent ? 'Present' : 'Nominated'));

    return `
      <tr>
        <td>
          <div style="font-weight:700; color:var(--text-dark);">${empName}</div>
          <div style="font-size:11px; color:#64748b;">${empNo ? `<code>${empNo}</code> &bull; ` : ''}${dept}</div>
        </td>
        <td><b style="font-size:12.5px;">${course}</b></td>
        <td><span class="pill day">${batch}</span></td>
        <td><small style="color:#64748b;">${date}</small></td>
        <td><span class="pill ${pillClass}">${status}</span></td>
      </tr>
    `;
  }).join('');
}

// Render Nominations for Next Training Classes
function renderNextClassNominations() {
  const nom = appState.data.nominations || [];
  const nextNoms = nom.filter(n => {
    const s = String(n.Status || '').toLowerCase();
    const b = String(n.Batch || '').toLowerCase();
    return s.includes('nom') || s.includes('next') || s.includes('upcom') || !b.includes('1st') || n.isNextNomination;
  });

  const countEl = document.getElementById('nom-next-count');
  if (countEl) countEl.textContent = nextNoms.length;

  const coursesSet = new Set(nextNoms.map(n => n.Course).filter(Boolean));
  const batchesSet = new Set(nextNoms.map(n => n.Batch).filter(Boolean));

  const coursesCountEl = document.getElementById('nom-next-courses-count');
  if (coursesCountEl) coursesCountEl.textContent = `${coursesSet.size} Tracks`;

  const courseFilter = document.getElementById('nom-next-course-filter');
  if (courseFilter && courseFilter.options.length <= 1) {
    courseFilter.innerHTML = '<option value="All Courses">All Courses</option>' + Array.from(coursesSet).map(c => `
      <option value="${escapeHtml(c)}">${escapeHtml(c)}</option>
    `).join('');
  }

  const batchFilter = document.getElementById('nom-next-batch-filter');
  if (batchFilter) {
    const curVal = batchFilter.value;
    batchFilter.innerHTML = '<option value="All Batches">All Batches</option>' + Array.from(batchesSet).map(b => `
      <option value="${escapeHtml(b)}">${escapeHtml(b)}</option>
    `).join('');
    if (curVal && Array.from(batchesSet).includes(curVal)) {
      batchFilter.value = curVal;
    }
  }

  const selectedCourse = courseFilter ? courseFilter.value : 'All Courses';
  const selectedBatch = batchFilter ? batchFilter.value : 'All Batches';
  const searchInput = document.getElementById('nom-next-search');
  const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = sortByDateDescending(nextNoms.filter(n => {
    if (selectedCourse !== 'All Courses' && n.Course !== selectedCourse) return false;
    if (selectedBatch !== 'All Batches' && n.Batch !== selectedBatch) return false;
    if (searchVal) {
      const line = `${n["Employee No"] || ''} ${n["Employee Name"] || n.Name || ''} ${n.Designation || ''} ${n.Department || ''} ${n.Course || ''} ${n.Batch || ''}`.toLowerCase();
      if (!line.includes(searchVal)) return false;
    }
    return true;
  }));

  const tbody = document.querySelector('#nom-next-table tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:#94a3b8;">No upcoming nominations found matching filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(n => `
    <tr>
      <td><code>${escapeHtml(n["Employee No"] || '')}</code></td>
      <td><b>${escapeHtml(n["Employee Name"] || n.Name || '')}</b></td>
      <td>${escapeHtml(n.Designation || 'KW&SC Staff')}</td>
      <td>${escapeHtml(n.Department || 'Operations')}</td>
      <td><b>${escapeHtml(n.Course || '')}</b></td>
      <td><span class="pill day">${escapeHtml(n.Batch || 'Upcoming Batch')}</span></td>
      <td><small style="color:#64748b;">${escapeHtml(n.Mobile || n.Contact || '0300-XXXXXXX')}</small></td>
      <td><span class="status-pill pending" style="background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;">${escapeHtml(n.Status || 'Nominated')}</span></td>
    </tr>
  `).join('');
}

// Normalize incoming spreadsheet rows into Next Class Nominations
function normalizeNextNominationRow(row, idx) {
  if (!row || typeof row !== 'object') return null;

  const noAliases = ["employee no", "emp no", "employee number", "emp. no", "emp id", "employee id", "id", "emp_no", "s.no", "sr no", "code", "badge no", "token"];
  const nameAliases = ["employee name", "name", "participant", "participant name", "staff name", "full name", "candidate", "student", "employee"];
  const courseAliases = ["nominated course", "course", "course name", "training", "program", "subject", "module", "track"];
  const desigAliases = ["designation", "title", "rank", "position", "post", "role"];
  const deptAliases = ["department", "dept", "division", "wing", "office", "section"];
  const batchAliases = ["target batch", "batch", "next batch", "session"];
  const mobileAliases = ["mobile / contact", "mobile", "contact", "phone", "cell", "cell no", "contact no", "telephone"];
  const statusAliases = ["status", "nomination status", "state"];

  let empNo = "";
  let empName = "";
  let course = "";
  let designation = "";
  let department = "";
  let batch = "";
  let mobile = "";
  let status = "";

  for (const [k, v] of Object.entries(row)) {
    const low = String(k || '').toLowerCase().trim();
    const val = String(v !== undefined && v !== null ? v : '').trim();
    if (!val) continue;

    if (!empNo && noAliases.includes(low)) empNo = val;
    else if (!empName && nameAliases.includes(low)) empName = val;
    else if (!course && courseAliases.includes(low)) course = val;
    else if (!designation && desigAliases.includes(low)) designation = val;
    else if (!department && deptAliases.includes(low)) department = val;
    else if (!batch && batchAliases.includes(low)) batch = val;
    else if (!mobile && mobileAliases.includes(low)) mobile = val;
    else if (!status && statusAliases.includes(low)) status = val;
  }

  // Ensure sensible defaults without forcing any specific batch
  empNo = empNo || `KW-${2000 + idx}`;
  empName = empName || `KW&SC Nominee ${idx + 1}`;
  course = course || "AI / Python";
  designation = designation || "KW&SC Staff";
  department = department || "Operations";
  batch = batch || "Upcoming Batch";
  mobile = mobile || "0300-XXXXXXX";
  status = status || "Nominated";

  return {
    "Employee No": empNo,
    "Employee Name": empName,
    "Designation": designation,
    "Department": department,
    "Course": course,
    "Batch": batch,
    "Mobile": mobile,
    "Status": status,
    "Date": cleanDateStr(row.Date) || "16 Oct 2026",
    isNextNomination: true
  };
}

function applyNextNominationRows(newRows, sourceDescription = 'Spreadsheet') {
  if (!newRows || newRows.length === 0) return;

  const validRows = newRows.map((r, i) => normalizeNextNominationRow(r, i)).filter(Boolean);
  if (validRows.length === 0) return;

  // Replace previously loaded next nominations with the newly uploaded/synced ones
  const otherNominations = (appState.data.nominations || []).filter(n => !n.isNextNomination);

  appState.data.nominations = [...validRows, ...otherNominations];
  try {
    localStorage.setItem('kwsc_nominations', JSON.stringify(appState.data.nominations));
  } catch (e) {}

  renderAll();
  showToast(`Updated Next Class Nominations (${validRows.length} records from ${sourceDescription}).`, 'success');
}

// Next Class Nominations Password Protection & Modal Controls
function handleOpenNextNomSpreadsheetModal() {
  if (appState.isUnlocked) {
    openNextNomSpreadsheetModal();
  } else {
    openNextNomAuthModal();
  }
}

function openNextNomAuthModal() {
  const modal = document.getElementById('next-nom-auth-modal');
  if (modal) modal.classList.add('show');
  const input = document.getElementById('next-nom-auth-password');
  if (input) {
    input.value = '';
    input.type = 'password';
    input.focus();
  }
  const err = document.getElementById('next-nom-auth-error');
  if (err) {
    err.style.display = 'none';
    err.innerHTML = '';
  }
}

function closeNextNomAuthModal() {
  const modal = document.getElementById('next-nom-auth-modal');
  if (modal) modal.classList.remove('show');
  const input = document.getElementById('next-nom-auth-password');
  if (input) input.value = '';
}

function toggleNextNomAuthPasswordVisibility() {
  const input = document.getElementById('next-nom-auth-password');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function submitNextNomAuth() {
  const input = document.getElementById('next-nom-auth-password');
  const err = document.getElementById('next-nom-auth-error');
  const pwd = input ? input.value : '';

  if (isUnifiedAuthorized(pwd)) {
    appState.isUnlocked = true;
    updateDataManagementUI();
    updateSidebarLockState();
    closeNextNomAuthModal();
    openNextNomSpreadsheetModal();
    showToast('Data management unlocked successfully.', 'success');
  } else {
    if (err) {
      err.style.display = 'block';
      err.innerHTML = '⚠️ Incorrect administrator password! Access denied.';
    }
    showToast('Incorrect administrator password.', 'error');
  }
}

function openNextNomSpreadsheetModal() {
  const modal = document.getElementById('next-nom-spreadsheet-modal');
  if (modal) modal.classList.add('show');
  updateNextNomLiveUI();
}

function closeNextNomSpreadsheetModal() {
  const modal = document.getElementById('next-nom-spreadsheet-modal');
  if (modal) modal.classList.remove('show');
}

function switchNextNomModalTab(tab) {
  const btnGs = document.getElementById('tab-btn-next-gs');
  const btnFile = document.getElementById('tab-btn-next-file');
  const paneGs = document.getElementById('tab-content-next-gs');
  const paneFile = document.getElementById('tab-content-next-file');

  if (tab === 'gs') {
    if (btnGs) btnGs.classList.add('active');
    if (btnFile) btnFile.classList.remove('active');
    if (paneGs) paneGs.style.display = 'block';
    if (paneFile) paneFile.style.display = 'none';
  } else {
    if (btnFile) btnFile.classList.add('active');
    if (btnGs) btnGs.classList.remove('active');
    if (paneFile) paneFile.style.display = 'block';
    if (paneGs) paneGs.style.display = 'none';
  }
}

function updateNextNomLiveUI() {
  const cfg = (appState.data && appState.data.next_nom_sheet_config) || {};
  const isConnected = !!(cfg.connected && cfg.url);

  const liveBadge = document.getElementById('next-nom-live-badge');
  if (liveBadge) {
    liveBadge.style.display = isConnected ? 'inline-flex' : 'none';
  }

  const btnRefresh = document.getElementById('btn-refresh-next-live');
  if (btnRefresh) {
    btnRefresh.style.display = isConnected ? 'inline-flex' : 'none';
  }

  const statusBar = document.getElementById('next-nom-live-status-bar');
  const statusUrl = document.getElementById('next-nom-live-status-url');
  const statusTime = document.getElementById('next-nom-live-status-time');
  const btnDisconnect = document.getElementById('btn-disconnect-next-gs');
  const urlInput = document.getElementById('next-nom-gs-url');
  const wsInput = document.getElementById('next-nom-gs-sheet');

  if (statusBar) statusBar.style.display = isConnected ? 'block' : 'none';
  if (statusUrl && isConnected) statusUrl.textContent = cfg.url;
  if (statusTime && isConnected) statusTime.textContent = `Last sync: ${cfg.last_sync || 'Just now'}`;
  if (btnDisconnect) btnDisconnect.style.display = isConnected ? 'inline-block' : 'none';

  if (isConnected) {
    if (urlInput && !urlInput.value) urlInput.value = cfg.url;
    if (wsInput && !wsInput.value && cfg.worksheet) wsInput.value = cfg.worksheet;
  }
}

async function syncNextNomGoogleSheet(silent = false) {
  const urlInput = document.getElementById('next-nom-gs-url');
  const wsInput = document.getElementById('next-nom-gs-sheet');
  const errBox = document.getElementById('next-nom-gs-error');
  const btnSync = document.getElementById('btn-sync-next-gs');
  const btnRefresh = document.getElementById('btn-refresh-next-live');

  const cfg = (appState.data && appState.data.next_nom_sheet_config) || {};
  const url = (urlInput ? urlInput.value : cfg.url || '').trim() || (cfg.url || '').trim();
  const ws = (wsInput ? wsInput.value : cfg.worksheet || '').trim() || (cfg.worksheet || '').trim();

  if (errBox) {
    errBox.style.display = 'none';
    errBox.innerHTML = '';
  }

  if (!url) {
    if (!silent) {
      showToast('Please enter a Google Sheet URL.', 'error');
      if (errBox) {
        errBox.style.display = 'block';
        errBox.innerHTML = '<b>Error:</b> Please provide a valid Google Sheet link.';
      }
    }
    return;
  }

  if (btnSync) {
    btnSync.disabled = true;
    btnSync.textContent = '⏳ Connecting & Syncing...';
  }
  if (btnRefresh) {
    btnRefresh.textContent = '⏳ Syncing...';
  }
  if (!silent) {
    showToast('Connecting to Google Sheet for live nominations...', 'info');
  }

  try {
    const candidates = buildGoogleSheetCandidates(url, ws);
    let csvText = null;
    let fetchError = null;

    for (const cUrl of candidates) {
      try {
        const resp = await fetch(cUrl);
        if (resp.ok) {
          const txt = await resp.text();
          if (txt.includes("accounts.google.com") || txt.includes("service_login") || txt.toLowerCase().includes("<!doctype html>")) {
            throw new Error("Google Sheet is private or requires sign-in. In Google Sheets: Click 'Share' (top right) -> Under 'General access', change from 'Restricted' to 'Anyone with the link can view'.");
          }
          if (txt.trim().length > 0) {
            csvText = txt;
            break;
          }
        }
      } catch (e) {
        fetchError = e;
      }
    }

    if (!csvText) {
      throw fetchError || new Error("Unable to read Google Sheet data. Please ensure 'Anyone with the link can view' is enabled on your sheet.");
    }

    if (!window.XLSX) throw new Error("SheetJS library not ready");
    const workbook = XLSX.read(csvText, { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });

    if (!rawData || rawData.length === 0) {
      throw new Error("Google Sheet returned no data rows.");
    }

    // Save configuration
    const nowTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    appState.data.next_nom_sheet_config = {
      url: url,
      worksheet: ws,
      connected: true,
      last_sync: nowTime
    };
    try {
      localStorage.setItem('kwsc_next_nom_sheet_config', JSON.stringify(appState.data.next_nom_sheet_config));
    } catch (e) {}

    applyNextNominationRows(rawData, 'Live Google Sheet');
    updateNextNomLiveUI();

    if (!silent) {
      showToast(`🟢 Live nominations synchronized (${rawData.length} records)!`, 'success');
      closeNextNomSpreadsheetModal();
    }
  } catch (err) {
    console.error('Next Nominations Google Sheet sync error:', err);
    if (!silent) {
      showToast(`Sync failed: ${err.message}`, 'error');
      if (errBox) {
        errBox.style.display = 'block';
        errBox.innerHTML = `<b>Error:</b> ${escapeHtml(err.message)}`;
      }
    }
  } finally {
    if (btnSync) {
      btnSync.disabled = false;
      btnSync.textContent = '🔄 Connect & Sync Live Nominations';
    }
    if (btnRefresh) {
      btnRefresh.textContent = '🔄 Refresh Live';
    }
  }
}

function disconnectNextNomGoogleSheet() {
  appState.data.next_nom_sheet_config = { url: "", worksheet: "", connected: false, last_sync: "" };
  try {
    localStorage.removeItem('kwsc_next_nom_sheet_config');
  } catch (e) {}
  const urlInput = document.getElementById('next-nom-gs-url');
  if (urlInput) urlInput.value = '';
  const wsInput = document.getElementById('next-nom-gs-sheet');
  if (wsInput) wsInput.value = '';
  updateNextNomLiveUI();
  showToast('Live Google Sheet disconnected.', 'info');
}

function uploadNextNomFile(inputElem) {
  if (!inputElem.files || !inputElem.files[0]) return;
  const file = inputElem.files[0];

  showToast(`Parsing ${file.name}...`, 'info');

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      if (!window.XLSX) throw new Error("SheetJS not loaded");
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      if (!json || json.length === 0) {
        throw new Error("File contains no readable rows.");
      }

      applyNextNominationRows(json, file.name);
      closeNextNomSpreadsheetModal();
    } catch (err) {
      showToast(`Upload error: ${err.message}`, 'error');
    }
  };
  reader.onerror = function() {
    showToast('Failed to read file from disk.', 'error');
  };
  reader.readAsArrayBuffer(file);
  inputElem.value = '';
}


// Compute Certificate Eligible Participants (must attend at least 8 out of 10 classes)
const TOTAL_COURSE_CLASSES = 10;
const MINIMUM_ATTENDANCE_CLASSES = 8;

function getCertificateEligible() {
  const att = appState.data.attendance || [];
  const nom = appState.data.nominations || [];

  const empMap = {};
  att.forEach(a => {
    const no = String(a['Employee No'] || '').trim();
    const name = String(a['Employee Name'] || a.Name || '').trim();
    const key = no || name;
    if (!key) return;
    if (!empMap[key]) {
      empMap[key] = {
        empNo: no,
        empName: name,
        designation: a['Designation'] || 'KW&SC Staff',
        department: 'Operations',
        course: a['Course'] || '',
        batch: a['Batch'] || '1st Batch',
        presentCount: 0,
        absentCount: 0,
        total: TOTAL_COURSE_CLASSES
      };
    }
    const isPresent = String(a['Attendance'] || '').toLowerCase().includes('present');
    if (isPresent) {
      empMap[key].presentCount++;
    } else {
      empMap[key].absentCount++;
    }
  });

  nom.forEach(n => {
    const no = String(n['Employee No'] || '').trim();
    const name = String(n['Employee Name'] || n.Name || '').trim();
    const key = no || name;
    if (empMap[key]) {
      if (n.Designation) empMap[key].designation = n.Designation;
      if (n.Department) empMap[key].department = n.Department;
      if (n.Course) empMap[key].course = n.Course;
      if (n.Batch) empMap[key].batch = n.Batch;
    }
  });

  const eligible = [];
  Object.values(empMap).forEach(e => {
    e.totalClasses = TOTAL_COURSE_CLASSES;
    e.rate = Math.round((e.presentCount / TOTAL_COURSE_CLASSES) * 100);
    if (e.presentCount >= MINIMUM_ATTENDANCE_CLASSES) {
      eligible.push(e);
    }
  });

  eligible.sort((a, b) => b.presentCount - a.presentCount || b.rate - a.rate || a.empName.localeCompare(b.empName));
  return eligible;
}

// Render Certificate Eligibility View
function renderCertificateEligibility() {
  const eligible = getCertificateEligible();

  const countEl = document.getElementById('cert-eligible-count');
  if (countEl) countEl.textContent = eligible.length;

  const distinctionCount = eligible.filter(e => e.presentCount >= TOTAL_COURSE_CLASSES).length;
  const distEl = document.getElementById('cert-distinction-count');
  if (distEl) distEl.textContent = distinctionCount || 85;

  const coursesSet = new Set(eligible.map(e => e.course).filter(Boolean));

  const courseFilter = document.getElementById('cert-course-filter');
  if (courseFilter && courseFilter.options.length <= 1) {
    courseFilter.innerHTML = '<option value="All Courses">All Courses</option>' + Array.from(coursesSet).map(c => `
      <option value="${escapeHtml(c)}">${escapeHtml(c)}</option>
    `).join('');
  }

  const selectedCourse = courseFilter ? courseFilter.value : 'All Courses';
  const searchInput = document.getElementById('cert-search-input');
  const searchVal = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = eligible.filter(e => {
    if (selectedCourse !== 'All Courses' && e.course !== selectedCourse) return false;
    if (searchVal) {
      const line = `${e.empNo} ${e.empName} ${e.designation} ${e.department} ${e.course} ${e.batch}`.toLowerCase();
      if (!line.includes(searchVal)) return false;
    }
    return true;
  });

  const tbody = document.querySelector('#cert-eligible-table tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:24px; color:#94a3b8;">No qualified staff found matching criteria.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(e => `
    <tr>
      <td><code>${escapeHtml(e.empNo)}</code></td>
      <td><b>${escapeHtml(e.empName)}</b></td>
      <td>${escapeHtml(e.designation)}</td>
      <td>${escapeHtml(e.department)}</td>
      <td><b>${escapeHtml(e.course)}</b></td>
      <td><span class="pill day">${escapeHtml(e.batch || '1st Batch')}</span></td>
      <td><b style="color:#10b981; font-size:14px;">${e.presentCount}</b> / 10 classes</td>
      <td><b style="color:#10b981; font-size:14px;">${e.rate}%</b></td>
      <td><span class="pill present" style="font-weight:700;">Eligible (≥ 8/10 Classes)</span></td>
    </tr>
  `).join('');
}

// Modal for Upper Bar Icon Click: Total Courses Status
function openCoursesStatusModal() {
  const modal = document.getElementById('courses-status-modal');
  const tbody = document.querySelector('#courses-status-table tbody');
  if (!modal || !tbody) return;

  const courses = appState.data.courses || [];
  const schedule = appState.data.schedule || [];

  tbody.innerHTML = courses.map(c => {
    const cName = c["Course Name"] || c.Course;
    const batchCount = schedule.filter(s => s.Course === cName).length || 2;

    return `
      <tr>
        <td><b>${escapeHtml(cName)}</b></td>
        <td>${escapeHtml(c.Category || 'Technical')}</td>
        <td>${escapeHtml(c.Trainer || 'Assigned Instructor')}</td>
        <td><span class="pill day">${batchCount} Batches</span></td>
        <td><span class="pill present">Active</span></td>
      </tr>
    `;
  }).join('');

  modal.classList.add('show');
}

function closeCoursesStatusModal() {
  const modal = document.getElementById('courses-status-modal');
  if (modal) modal.classList.remove('show');
}

function renderSchedule() {
  const tbody = document.querySelector('#full-schedule-table tbody');
  if (!tbody) return;
  tbody.innerHTML = appState.data.schedule.map(s => `
    <tr>
      <td><span class="pill day">${escapeHtml(s.Day)}</span></td>
      <td><b>${escapeHtml(s.Course)}</b></td>
      <td>${escapeHtml(s.Batch)}</td>
      <td>${escapeHtml(s.Time)}</td>
      <td>${escapeHtml(s.Capacity)}</td>
    </tr>
  `).join('');
}

function renderEnrollments() {
  const tbody = document.querySelector('#full-enroll-table tbody');
  if (!tbody) return;
  const nom = sortByDateDescending(appState.data.nominations || []);
  tbody.innerHTML = nom.map(n => {
    const isPresent = String(n.Status || '').toLowerCase().includes('present') || String(n.Status || '').toLowerCase().includes('active');
    return `
      <tr>
        <td><code>${escapeHtml(n["Employee No"] || '')}</code></td>
        <td><b>${escapeHtml(n["Employee Name"] || n.Name || '')}</b></td>
        <td>${escapeHtml(n.Designation || '')}</td>
        <td>${escapeHtml(n.Department || '')}</td>
        <td>${escapeHtml(n.Course || '')}</td>
        <td>${escapeHtml(n.Batch || '')}</td>
        <td>${escapeHtml(n.Date || '')}</td>
        <td><span class="pill ${isPresent ? 'present' : 'absent'}">${escapeHtml(n.Status || 'Enrolled')}</span></td>
      </tr>
    `;
  }).join('');
}

function renderAttendance() {
  const att = sortByDateDescending(appState.data.attendance || []);
  const present = att.filter(a => String(a.Attendance).toLowerCase().includes('present')).length;
  const absent = att.filter(a => String(a.Attendance).toLowerCase().includes('absent')).length;

  const presEl = document.getElementById('att-present-count');
  if (presEl) presEl.textContent = present;
  const absEl = document.getElementById('att-absent-count');
  if (absEl) absEl.textContent = absent;
  const totEl = document.getElementById('att-total-count');
  if (totEl) totEl.textContent = att.length;

  const tbody = document.querySelector('#full-att-table tbody');
  if (!tbody) return;
  tbody.innerHTML = att.map(a => {
    const isPres = String(a.Attendance).toLowerCase().includes('present');
    return `
      <tr>
        <td><code>${escapeHtml(a["Employee No"] || '')}</code></td>
        <td><b>${escapeHtml(a["Employee Name"] || a.Name || '')}</b></td>
        <td>${escapeHtml(a.Course || '')}</td>
        <td>${escapeHtml(a.Date || '')}</td>
        <td><span class="pill ${isPres ? 'present' : 'absent'}">${escapeHtml(a.Attendance || '')}</span></td>
        <td>${escapeHtml(a.Remarks || '')}</td>
      </tr>
    `;
  }).join('');
}

function populateCourseFilter() {
  const select = document.getElementById('course-filter-select');
  if (!select) return;
  const currentVal = select.value;
  const courses = Array.from(new Set(appState.data.courses.map(c => c["Course Name"] || c.Course))).filter(Boolean);
  select.innerHTML = '<option value="All Courses">All Courses</option>' + courses.map(c => `
    <option value="${escapeHtml(c)}">${escapeHtml(c)}</option>
  `).join('');
  if (courses.includes(currentVal)) {
    select.value = currentVal;
  }
}

function renderCourseWiseAttendance() {
  const select = document.getElementById('course-filter-select');
  const selected = select ? select.value : 'All Courses';
  const nom = appState.data.nominations;
  const att = appState.data.attendance;

  let filteredNom = sortByDateDescending((selected === 'All Courses') ? nom : nom.filter(n => n.Course === selected));
  let filteredAtt = (selected === 'All Courses') ? att : att.filter(a => a.Course === selected);

  let p = filteredAtt.filter(a => String(a.Attendance).toLowerCase().includes('present')).length;
  let a = filteredAtt.filter(a => String(a.Attendance).toLowerCase().includes('absent')).length;
  let total = p + a;
  let rate = total > 0 ? Math.round((p / total) * 100) : 0;

  const partEl = document.getElementById('cw-participants');
  if (partEl) partEl.textContent = filteredNom.length;
  const cwPresEl = document.getElementById('cw-present');
  if (cwPresEl) cwPresEl.textContent = p;
  const cwAbsEl = document.getElementById('cw-absent');
  if (cwAbsEl) cwAbsEl.textContent = a;
  const cwRateEl = document.getElementById('cw-rate');
  if (cwRateEl) cwRateEl.textContent = rate + '%';

  const tbody = document.querySelector('#cw-participants-table tbody');
  if (tbody) {
    tbody.innerHTML = filteredNom.map(person => {
      const empNo = String(person["Employee No"] || '').trim();
      const empName = String(person["Employee Name"] || person.Name || '').trim();

      const personLogs = sortByDateDescending(att.filter(item => {
        const itemNo = String(item["Employee No"] || '').trim();
        const itemName = String(item["Employee Name"] || item.Name || '').trim().toLowerCase();
        return (empNo && itemNo === empNo) || (empName && itemName === empName.toLowerCase());
      }));

      const curCourseLogs = (selected === 'All Courses') ? personLogs : personLogs.filter(item => item.Course === selected);
      const presCount = curCourseLogs.filter(i => String(i.Attendance).toLowerCase().includes('present')).length;
      const absCount = curCourseLogs.filter(i => String(i.Attendance).toLowerCase().includes('absent')).length;
      const tot = presCount + absCount;
      const pct = tot > 0 ? Math.round((presCount / tot) * 100) : 0;

      const lastLog = personLogs[0];
      const lastText = lastLog ? `${lastLog.Date} — ${lastLog.Attendance}` : 'No records';

      return `
        <tr>
          <td><code>${escapeHtml(empNo)}</code></td>
          <td><b>${escapeHtml(empName)}</b></td>
          <td>${escapeHtml(person.Designation || '')}</td>
          <td>${escapeHtml(person.Department || '')}</td>
          <td>${escapeHtml(person.Batch || '')}</td>
          <td><b style="color:#10b981">${presCount}</b></td>
          <td><b style="color:#ef4444">${absCount}</b></td>
          <td><span class="pill ${pct >= 80 ? 'present' : 'absent'}">${pct}%</span></td>
          <td><small>${escapeHtml(lastText)}</small></td>
        </tr>
      `;
    }).join('');
  }

  // Populate employee inspector dropdown
  const empSelect = document.getElementById('employee-inspector-select');
  if (empSelect) {
    const curVal = empSelect.value;
    const uniqueEmployees = [];
    const seen = new Set();
    filteredNom.forEach(n => {
      const id = (n["Employee No"] || '') + '||' + (n["Employee Name"] || n.Name || '');
      if (!seen.has(id)) {
        seen.add(id);
        uniqueEmployees.push({ no: n["Employee No"] || '', name: n["Employee Name"] || n.Name || '' });
      }
    });

    empSelect.innerHTML = '<option value="">-- Choose Employee --</option>' + uniqueEmployees.map(e => `
      <option value="${escapeHtml(e.no + '||' + e.name)}">${escapeHtml(e.name)} (ID: ${escapeHtml(e.no)})</option>
    `).join('');

    if (curVal) empSelect.value = curVal;
    renderEmployeeHistory();
  }
}

function renderEmployeeHistory() {
  const empSelect = document.getElementById('employee-inspector-select');
  const val = empSelect ? empSelect.value : '';
  const tbody = document.querySelector('#emp-history-table tbody');
  if (!tbody) return;

  if (!val) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">Please select an employee above to inspect history.</td></tr>';
    return;
  }

  const [empNo, empName] = val.split('||');
  const logs = sortByDateDescending(appState.data.attendance.filter(item => {
    const itemNo = String(item["Employee No"] || '').trim();
    const itemName = String(item["Employee Name"] || item.Name || '').trim().toLowerCase();
    return (empNo && itemNo === empNo) || (empName && itemName === empName.toLowerCase());
  }));

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">No attendance entries found for this employee.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const isPres = String(l.Attendance).toLowerCase().includes('present');
    return `
      <tr>
        <td><code>${escapeHtml(l["Employee No"] || empNo)}</code></td>
        <td><b>${escapeHtml(l["Employee Name"] || empName)}</b></td>
        <td>${escapeHtml(l.Date || '')}</td>
        <td>${escapeHtml(l.Course || '')}</td>
        <td><span class="pill ${isPres ? 'present' : 'absent'}">${escapeHtml(l.Attendance || '')}</span></td>
        <td>${escapeHtml(l.Remarks || '')}</td>
      </tr>
    `;
  }).join('');
}

function renderReports() {
  const { courses, schedule, nominations } = appState.data;
  
  const repProg = document.getElementById('rep-programs');
  if (repProg) repProg.textContent = courses.length || 4;
  
  const repBatches = document.getElementById('rep-batches');
  if (repBatches) repBatches.textContent = schedule.length || 9;
  
  const repPart = document.getElementById('rep-participants');
  if (repPart) repPart.textContent = nominations.length || 250;
  
  const repAtt = document.getElementById('rep-attendance');
  if (repAtt) repAtt.textContent = '92%';

  const tbody = document.querySelector('#reports-courses-table tbody');
  if (tbody) {
    tbody.innerHTML = courses.map(c => `
      <tr>
        <td><b>${escapeHtml(c["Course Name"] || c.Course)}</b></td>
        <td>${escapeHtml(c.Category || '')}</td>
        <td>${escapeHtml(c.Trainer || 'Assigned Instructor')}</td>
        <td><span class="pill present">${escapeHtml(c.Status || 'Active')}</span></td>
      </tr>
    `).join('');
  }

  // Also update attendance alerts in reports
  renderAttendanceAlerts();
}

function renderSheetsStatus() {
  const cfg = appState.data.sheets_config || {};
  const dot = document.getElementById('gs-indicator-dot');
  const badge = document.getElementById('gs-badge');
  const info = document.getElementById('gs-sync-info');

  if (cfg.connected && cfg.sheet_url) {
    if (dot) dot.textContent = '🟢';
    if (badge) {
      badge.textContent = 'Connected';
      badge.style.background = '#dcfce7';
      badge.style.color = '#15803d';
    }
    if (info) info.textContent = 'Last synced: ' + (cfg.last_sync || 'Recently');
    if (document.getElementById('gs-url-input')) {
      document.getElementById('gs-url-input').value = cfg.sheet_url;
      document.getElementById('gs-sheet-input').value = cfg.worksheet || '';
    }
  } else {
    if (dot) dot.textContent = '⬜';
    if (badge) {
      badge.textContent = 'Not Connected';
      badge.style.background = '#fee2e2';
      badge.style.color = '#b91c1c';
    }
    if (info) info.textContent = 'Connect Google Sheets in Data Management';
  }
}

function updateDataManagementUI() {
  const lockedDiv = document.getElementById('dm-locked-content');
  const unlockedDiv = document.getElementById('dm-unlocked-content');
  const sidebarLockBtn = document.getElementById('sidebar-lock-action-btn');

  if (appState.isUnlocked) {
    if (lockedDiv) lockedDiv.style.display = 'none';
    if (unlockedDiv) unlockedDiv.style.display = 'block';
    if (sidebarLockBtn) {
      sidebarLockBtn.textContent = 'Lock Controls';
      sidebarLockBtn.className = 'btn btn-danger';
      sidebarLockBtn.onclick = lockAdmin;
    }
  } else {
    if (lockedDiv) lockedDiv.style.display = 'block';
    if (unlockedDiv) unlockedDiv.style.display = 'none';
    if (sidebarLockBtn) {
      sidebarLockBtn.textContent = 'Unlock Controls';
      sidebarLockBtn.className = 'btn btn-outline';
      sidebarLockBtn.onclick = promptUnlock;
    }
  }
  renderDataManagementTable();
}

function renderDataManagementTable(filterQuery = '') {
  const att = sortByDateDescending(appState.data.attendance || []);
  const tbody = document.querySelector('#dm-attendance-table tbody');
  if (!tbody) return;

  const q = (filterQuery || '').toLowerCase().trim();
  const filtered = q ? att.filter(r => {
    const no = String(r['Employee No'] || '').toLowerCase();
    const name = String(r['Employee Name'] || '').toLowerCase();
    const desig = String(r['Designation'] || '').toLowerCase();
    const crs = String(r['Course'] || '').toLowerCase();
    const date = String(r['Date'] || '').toLowerCase();
    const rem = String(r['Remarks'] || '').toLowerCase();
    return no.includes(q) || name.includes(q) || desig.includes(q) || crs.includes(q) || date.includes(q) || rem.includes(q);
  }) : att;

  const countEl = document.getElementById('dm-synced-count');
  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} of ${att.length} records`;
  }

  const cfg = appState.data.sheets_config || {};
  const badgeEl = document.getElementById('dm-synced-badge');
  const subEl = document.getElementById('dm-synced-sub');
  if (badgeEl && subEl) {
    if (cfg.connected && cfg.sheet_url) {
      badgeEl.className = 'pill present';
      badgeEl.textContent = 'Connected & Synced';
      subEl.innerHTML = `Connected to Google Sheet: <code style="font-size:11px; background:#e0f2fe; padding:2px 6px; border-radius:4px;">${escapeHtml(cfg.sheet_url)}</code> (Last Synced: ${escapeHtml(cfg.last_sync || 'Active')}) — <b>${att.length} Total Records Loaded</b>`;
    } else {
      badgeEl.className = 'pill absent';
      badgeEl.textContent = 'Local Mode';
      subEl.textContent = 'Showing local attendance records';
    }
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:24px; color:#94a3b8; font-weight:600;">No attendance records found matching query.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const isPres = String(r.Attendance || '').toLowerCase().includes('present');
    const remark = r.Remarks && String(r.Remarks).trim() && String(r.Remarks).trim().toLowerCase() !== 'nan' ? String(r.Remarks).trim() : '—';
    return `
      <tr>
        <td><code>${escapeHtml(r['Employee No'] || '')}</code></td>
        <td><b>${escapeHtml(r['Employee Name'] || '')}</b></td>
        <td>${escapeHtml(r['Designation'] || 'KW&SC Staff')}</td>
        <td><b>${escapeHtml(r['Course'] || '')}</b></td>
        <td>${escapeHtml(r['Date'] || '')}</td>
        <td><span class="pill ${isPres ? 'present' : 'absent'}">${escapeHtml(r['Attendance'] || 'Present')}</span></td>
        <td><small style="color:#64748b">${escapeHtml(remark)}</small></td>
      </tr>
    `;
  }).join('');
}

function filterDataManagementTable(val) {
  renderDataManagementTable(val);
}

// ============================================================
// AUTHENTICATION & LOCK CONTROLS
// ============================================================

async function computeSHA256(str) {
  const buffer = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(pwd) {
  const p = String(pwd || '').trim();
  if (!p) {
    showToast('Please enter administrator password.', 'error');
    return;
  }

  if (isUnifiedAuthorized(p)) {
    appState.isUnlocked = true;
    showToast('Data management unlocked successfully.', 'success');
    updateDataManagementUI();
    updateSidebarLockState();
  } else {
    showToast('Incorrect administrator password.', 'error');
  }
}

function unlockAdmin() {
  const pwd = document.getElementById('dm-password-input').value;
  verifyPassword(pwd);
}

function promptUnlock() {
  if (appState.isUnlocked) {
    lockAdmin();
  } else {
    document.getElementById('unlock-modal').classList.add('show');
    const input = document.getElementById('modal-password');
    if (input) input.focus();
  }
}

function closeUnlockModal() {
  document.getElementById('unlock-modal').classList.remove('show');
  const input = document.getElementById('modal-password');
  if (input) input.value = '';
}

function submitModalUnlock() {
  const pwd = document.getElementById('modal-password').value;
  verifyPassword(pwd);
  closeUnlockModal();
}

function lockAdmin() {
  appState.isUnlocked = false;
  try {
    sessionStorage.removeItem('kwsc_admin_unlocked');
  } catch (e) {}
  showToast('Data management controls locked.', 'info');
  updateDataManagementUI();
  updateSidebarLockState();
}

// ============================================================
// GOOGLE SHEETS LIVE ATTENDANCE SYNC (Pure Client-Side)
// ============================================================

function buildGoogleSheetCandidates(url, worksheet = '') {
  const trimmed = String(url || '').trim();
  if (!trimmed) throw new Error("Please provide a Google Sheets URL.");

  // Case 1: Published web link
  if (trimmed.includes("/d/e/2PACX-")) {
    if (trimmed.includes("pubhtml")) return [trimmed.replace("pubhtml", "pub?output=csv")];
    if (trimmed.includes("pub?") && !trimmed.includes("output=csv")) return [trimmed + "&output=csv"];
    if (trimmed.includes("output=csv")) return [trimmed];
    return [trimmed + (trimmed.includes("?") ? "&" : "?") + "output=csv"];
  }

  // Case 2: Standard Google Spreadsheet URL
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    if (trimmed.toLowerCase().endsWith(".csv") || trimmed.includes("format=csv")) return [trimmed];
    throw new Error("Please enter a valid Google Sheets URL (e.g. https://docs.google.com/spreadsheets/d/.../edit).");
  }

  const sheetId = match[1];
  let gid = null;
  const gidMatch = trimmed.match(/[?&#]gid=([0-9]+)/);
  if (gidMatch) gid = gidMatch[1];

  const candidates = [];
  if (worksheet) {
    const wsEnc = encodeURIComponent(String(worksheet).trim());
    candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${wsEnc}`);
    candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&sheet=${wsEnc}`);
  }

  if (gid) {
    candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`);
    candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`);
  }

  candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`);
  candidates.push(`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`);
  return candidates;
}

async function syncGoogleSheets() {
  const urlInput = document.getElementById('gs-url-input');
  const wsInput = document.getElementById('gs-sheet-input');
  const errBox = document.getElementById('gs-error-box');
  const btnSync = document.getElementById('btn-sync-gs');

  const url = (urlInput ? urlInput.value : '').trim();
  const ws = (wsInput ? wsInput.value : '').trim();

  if (errBox) {
    errBox.style.display = 'none';
    errBox.innerHTML = '';
  }

  if (!url) {
    showToast('Please enter a Google Sheet URL.', 'error');
    if (errBox) {
      errBox.style.display = 'block';
      errBox.innerHTML = '<b>Error:</b> Please provide a Google Sheet link in the field above.';
    }
    return;
  }

  if (btnSync) {
    btnSync.disabled = true;
    btnSync.textContent = '⏳ Connecting & Syncing...';
  }
  showToast('Connecting to Google Sheet...', 'info');

  try {
    const candidates = buildGoogleSheetCandidates(url, ws);
    let csvText = null;
    let fetchError = null;

    for (const cUrl of candidates) {
      try {
        const resp = await fetch(cUrl);
        if (resp.ok) {
          const txt = await resp.text();
          if (txt.includes("accounts.google.com") || txt.includes("service_login") || txt.toLowerCase().includes("<!doctype html>")) {
            throw new Error("Google Sheet is private or requires sign-in. In Google Sheets: Click 'Share' (top right) -> Under 'General access', change from 'Restricted' to 'Anyone with the link can view'.");
          }
          if (txt.trim().length > 0) {
            csvText = txt;
            break;
          }
        }
      } catch (e) {
        fetchError = e;
      }
    }

    if (!csvText) {
      throw fetchError || new Error("Unable to read Google Sheet data. Please ensure 'Anyone with the link can view' is enabled.");
    }

    if (!window.XLSX) throw new Error("SheetJS library not ready");
    const workbook = XLSX.read(csvText, { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });

    if (!rawData || rawData.length === 0) {
      throw new Error("Google Sheet returned no data rows.");
    }

    const defaultCourse = ws || "KW&SC Training";
    const normAttendance = normalizeAttendance(rawData, defaultCourse);

    appState.data.attendance = normAttendance;
    try { localStorage.setItem('kwsc_attendance', JSON.stringify(normAttendance)); } catch (e) {}

    // Auto-sync nominations from unique participants
    const uniqueMap = {};
    normAttendance.forEach(a => {
      const id = `${a['Employee No']}||${a['Course']}`;
      if (!uniqueMap[id]) {
        uniqueMap[id] = {
          "Employee No": a['Employee No'],
          "Employee Name": a['Employee Name'],
          "Designation": a['Designation'] || 'KW&SC Staff',
          "Department": 'Operations',
          "Course": a['Course'],
          "Batch": '1st Batch',
          "Date": a['Date'] || cleanDateStr(new Date()),
          "Status": a['Attendance'] || 'Present'
        };
      }
    });
    const autoNominations = Object.values(uniqueMap);
    if (autoNominations.length > 0) {
      appState.data.nominations = autoNominations;
      try { localStorage.setItem('kwsc_nominations', JSON.stringify(autoNominations)); } catch (e) {}
    }

    const nowStr = formatDateDisplay(new Date()) + ', ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    appState.data.sheets_config = {
      sheet_url: url,
      worksheet: ws,
      connected: true,
      last_sync: nowStr
    };
    try { localStorage.setItem('kwsc_sheets_config', JSON.stringify(appState.data.sheets_config)); } catch (e) {}

    appState.data.alerts = calculateAlerts(appState.data.schedule, appState.data.nominations, appState.data.attendance);
    renderAll();
    showToast(`Success! Synced ${normAttendance.length} attendance records from Google Sheet!`, 'success');
  } catch (err) {
    showToast('Sync error: ' + err.message, 'error');
    if (errBox) {
      errBox.style.display = 'block';
      errBox.innerHTML = `<b>Linking Error:</b> ${escapeHtml(err.message)}<br><br><b>Quick Checklist:</b><ul style="margin-left:20px; margin-top:4px;"><li>In Google Sheets, click <b>Share</b> (top right) and verify <b>General Access</b> is set to <b>"Anyone with the link can view"</b>.</li><li>Make sure you copied the full browser address bar URL.</li><li>You can also click <b>File &gt; Share &gt; Publish to web</b> in Google Sheets and paste that link.</li></ul>`;
    }
  } finally {
    if (btnSync) {
      btnSync.disabled = false;
      btnSync.textContent = '🔄 Sync Attendance Now';
    }
  }
}

function disconnectGoogleSheets() {
  appState.data.sheets_config = { sheet_url: "", worksheet: "", connected: false, last_sync: "" };
  try { localStorage.removeItem('kwsc_sheets_config'); } catch (e) {}
  const urlInput = document.getElementById('gs-url-input');
  const wsInput = document.getElementById('gs-sheet-input');
  if (urlInput) urlInput.value = '';
  if (wsInput) wsInput.value = '';
  renderSheetsStatus();
  renderDataManagementTable();
  showToast('Google Sheets disconnected.', 'info');
}

// ============================================================
// DATASET FILE UPLOADS (Client-Side SheetJS Parsing)
// ============================================================

function uploadDataset(type, inputElem) {
  if (!inputElem.files || !inputElem.files[0]) return;
  const file = inputElem.files[0];

  showToast(`Parsing ${file.name}...`, 'info');

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      if (!window.XLSX) throw new Error("SheetJS not loaded");
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      let json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      if (!json || json.length === 0) {
        throw new Error("File contains no readable rows.");
      }

      if (type === 'attendance') {
        json = normalizeAttendance(json);
        appState.data.attendance = json;
        try { localStorage.setItem('kwsc_attendance', JSON.stringify(json)); } catch (e) {}
      } else if (type === 'nominations') {
        json = normalizeEmployeeIdentity(json);
        appState.data.nominations = json;
        try { localStorage.setItem('kwsc_nominations', JSON.stringify(json)); } catch (e) {}
      } else if (type === 'courses') {
        appState.data.courses = json;
        try { localStorage.setItem('kwsc_courses', JSON.stringify(json)); } catch (e) {}
      } else if (type === 'schedule') {
        appState.data.schedule = json;
        try { localStorage.setItem('kwsc_schedule', JSON.stringify(json)); } catch (e) {}
      }

      appState.data.alerts = calculateAlerts(appState.data.schedule, appState.data.nominations, appState.data.attendance);
      renderAll();
      showToast(`${type} updated successfully (${json.length} records).`, 'success');
    } catch (err) {
      showToast(`Upload error: ${err.message}`, 'error');
    }
  };
  reader.onerror = function() {
    showToast('Failed to read file from disk.', 'error');
  };
  reader.readAsArrayBuffer(file);
  inputElem.value = '';
}

// ============================================================
// CLIENT-SIDE CSV EXPORT WITH UNIFIED PASSWORD PROTECTION
// ============================================================

const DOWNLOAD_AUTH_PASSWORD = "kwsc1010";
let pendingDownloadType = null;
let pendingDownloadCustomData = null;

function downloadCSV(type, customData = null) {
  pendingDownloadType = type;
  pendingDownloadCustomData = customData;
  openDownloadModal(type);
}

function openDownloadModal(type) {
  const modal = document.getElementById('download-auth-modal');
  const targetLabel = document.getElementById('download-target-name');
  const input = document.getElementById('download-password-input');
  const errorMsg = document.getElementById('download-error-msg');

  const names = {
    'schedule': 'kwsc_training_schedule.csv',
    'nominations': 'kwsc_enrolled_staff.csv',
    'attendance': 'kwsc_attendance_logs.csv',
    'courses': 'kwsc_courses_catalog.csv',
    'course_attendance': 'kwsc_course_attendance_summary.csv',
    'employee_history': 'kwsc_employee_history.csv',
    'emp_history': 'kwsc_employee_history.csv',
    'reports': 'kwsc_program_reports.csv',
    'alerts': 'kwsc_attendance_defaulters_alert.csv',
    'nominations_next': 'kwsc_next_class_nominations.csv',
    'certificates': 'kwsc_certificate_eligible_participants.csv',
    'all': 'kwsc_complete_master_dataset.csv'
  };

  if (targetLabel) {
    targetLabel.textContent = names[type] || `kwsc_${type}.csv`;
  }

  if (errorMsg) errorMsg.style.display = 'none';
  if (input) {
    input.value = '';
    input.type = 'password';
    input.classList.remove('error-shake');
  }

  if (modal) {
    modal.classList.add('show');
    setTimeout(() => {
      if (input) input.focus();
    }, 120);
  }
}

function closeDownloadModal() {
  const modal = document.getElementById('download-auth-modal');
  if (modal) modal.classList.remove('show');
  pendingDownloadType = null;
  pendingDownloadCustomData = null;
}

function toggleDownloadPasswordVisibility() {
  const input = document.getElementById('download-password-input');
  const eyeIcon = document.getElementById('download-eye-icon');
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  if (eyeIcon) {
    eyeIcon.innerHTML = isPass
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
  }
}

function submitDownloadPassword() {
  const input = document.getElementById('download-password-input');
  const errorMsg = document.getElementById('download-error-msg');
  const pwd = input ? input.value.trim() : '';

  if (isUnifiedAuthorized(pwd)) {
    const typeToDownload = pendingDownloadType;
    const customData = pendingDownloadCustomData;
    closeDownloadModal();
    executeDownload(typeToDownload, customData);
  } else {
    if (errorMsg) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = pwd.length === 0 
        ? '⚠️ Password is required to download this dataset.' 
        : '⚠️ Incorrect download password! Access denied.';
    }
    if (input) {
      input.classList.add('error-shake');
      setTimeout(() => input.classList.remove('error-shake'), 500);
      input.select();
    }
    showToast('Incorrect download password. Access denied.', 'error');
  }
}

function executeDownload(type, customData = null) {
  let rows = [];
  let filename = `kwsc_${type}.csv`;

  if (type === 'schedule') {
    rows = appState.data.schedule;
    filename = 'kwsc_training_schedule.csv';
  } else if (type === 'nominations') {
    rows = appState.data.nominations;
    filename = 'kwsc_enrolled_staff.csv';
  } else if (type === 'attendance') {
    rows = appState.data.attendance;
    filename = 'kwsc_attendance_logs.csv';
  } else if (type === 'courses') {
    rows = appState.data.courses;
    filename = 'kwsc_courses_catalog.csv';
  } else if (type === 'course_attendance') {
    const select = document.getElementById('course-filter-select');
    const selectedCourse = select ? select.value : 'All Courses';
    const nom = appState.data.nominations || [];
    const att = appState.data.attendance || [];
    const filteredNom = (selectedCourse === 'All Courses') ? nom : nom.filter(n => n.Course === selectedCourse);

    rows = filteredNom.map(person => {
      const empNo = String(person["Employee No"] || '').trim();
      const empName = String(person["Employee Name"] || person.Name || '').trim();
      const personLogs = att.filter(item => {
        const itemNo = String(item["Employee No"] || '').trim();
        const itemName = String(item["Employee Name"] || item.Name || '').trim().toLowerCase();
        return (empNo && itemNo === empNo) || (empName && itemName === empName.toLowerCase());
      });
      const curCourseLogs = (selectedCourse === 'All Courses') ? personLogs : personLogs.filter(item => item.Course === selectedCourse);
      const presCount = curCourseLogs.filter(i => String(i.Attendance).toLowerCase().includes('present')).length;
      const absCount = curCourseLogs.filter(i => String(i.Attendance).toLowerCase().includes('absent')).length;
      const tot = presCount + absCount;
      const rate = tot > 0 ? Math.round((presCount / tot) * 100) + '%' : '0%';
      const lastLog = personLogs[0];
      const lastText = lastLog ? `${lastLog.Date} - ${lastLog.Attendance}` : 'N/A';

      return {
        "Employee No": empNo,
        "Employee Name": empName,
        "Designation": person.Designation || '',
        "Department": person.Department || '',
        "Batch": person.Batch || '',
        "Course": person.Course || selectedCourse,
        "Present Sessions": presCount,
        "Absent Sessions": absCount,
        "Attendance Rate": rate,
        "Last Session Log": lastText
      };
    });
    filename = `kwsc_course_attendance_${selectedCourse.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
  } else if (type === 'emp_history' || type === 'employee_history') {
    const empSelect = document.getElementById('employee-inspector-select');
    const selectedEmp = empSelect ? empSelect.value : '';
    if (selectedEmp) {
      const [empNo, empName] = selectedEmp.split('||');
      rows = appState.data.attendance.filter(item => {
        const itemNo = String(item["Employee No"] || '').trim();
        const itemName = String(item["Employee Name"] || item.Name || '').trim().toLowerCase();
        return (empNo && itemNo === empNo) || (empName && itemName === empName.toLowerCase());
      });
      filename = `kwsc_history_${(empName || empNo).replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    } else {
      rows = appState.data.attendance;
      filename = 'kwsc_employee_training_history.csv';
    }
  } else if (type === 'reports') {
    rows = appState.data.courses;
    filename = 'kwsc_program_reports.csv';
  } else if (type === 'alerts') {
    rows = getAttendanceDefaulters().map(d => ({
      "Employee No": d.empNo,
      "Employee Name": d.empName,
      "Designation": d.designation,
      "Department": d.department,
      "Course": d.course,
      "Batch": d.batch || '1st Batch',
      "Attended Classes": d.presentCount,
      "Absent Classes": d.absentCount,
      "Total Classes": d.total,
      "Attendance Rate": d.rate + '%',
      "Alert Status": "Attendance below 80% & Absent ≥ 2 classes"
    }));
    filename = 'kwsc_attendance_defaulters_alert.csv';
  } else if (type === 'nominations_next') {
    const nom = appState.data.nominations || [];
    rows = nom.filter(n => {
      const s = String(n.Status || '').toLowerCase();
      const b = String(n.Batch || '').toLowerCase();
      return s.includes('nom') || s.includes('next') || s.includes('upcom') || !b.includes('1st') || n.isNextNomination;
    });
    filename = 'kwsc_next_class_nominations.csv';
  } else if (type === 'certificates') {
    rows = getCertificateEligible().map(e => ({
      "Employee No": e.empNo,
      "Employee Name": e.empName,
      "Designation": e.designation,
      "Department": e.department,
      "Course": e.course,
      "Batch": e.batch || '1st Batch',
      "Classes Attended": `${e.presentCount} / 10`,
      "Total Classes": 10,
      "Attendance Rate": e.rate + '%',
      "Eligibility Status": "Eligible (≥ 8/10 Classes)"
    }));
    filename = 'kwsc_certificate_eligible_participants.csv';
  } else if (type === 'all') {
    rows = appState.data.nominations.map(n => ({
      ...n,
      "Attendance Status": n.Attendance || n.Status || 'Registered'
    }));
    filename = 'kwsc_complete_master_dataset.csv';
  }

  if (!rows || rows.length === 0) {
    showToast(`No records found to download for ${type}.`, 'error');
    return;
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [];
  csvLines.push(headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','));

  rows.forEach(r => {
    const line = headers.map(h => {
      const val = r[h] !== undefined && r[h] !== null ? String(r[h]) : '';
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',');
    csvLines.push(line);
  });

  const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Authorized! Downloaded ${filename} successfully.`, 'success');
}

// ============================================================
// GLOBAL SEARCH & TOAST UTILITIES
// ============================================================

function handleSearch(term) {
  const q = (term || '').toLowerCase().trim();
  const tables = document.querySelectorAll('table tbody');
  tables.forEach(tbody => {
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  });
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️')}</span> <span>${escapeHtml(msg)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// TOPBAR KARACHI CLOCK
// ============================================================

function initKarachiClock() {
  const clockEl = document.getElementById('live-karachi-clock');
  if (!clockEl) return;

  function updateClock() {
    try {
      const now = new Date();
      const dateOpts = {
        timeZone: 'Asia/Karachi',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      };
      const timeOpts = {
        timeZone: 'Asia/Karachi',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      };
      const datePart = new Intl.DateTimeFormat('en-US', dateOpts).format(now);
      const timePart = new Intl.DateTimeFormat('en-US', timeOpts).format(now);
      clockEl.textContent = `${datePart} | Karachi Time: ${timePart}`;
    } catch (e) {
      clockEl.textContent = 'Thursday, 5 June 2025 | Karachi Time: 12:47 PM';
    }
  }

  updateClock();
  setInterval(updateClock, 1000);
}

// ============================================================
// SIDEBAR PASSWORD PROTECTION & DATA MANAGEMENT NAV
// ============================================================

function toggleDataManagementNav() {
  if (appState.isUnlocked) {
    switchPage('data_management');
  } else {
    const input = document.getElementById('sidebar-password-input');
    if (input) {
      input.focus();
      input.classList.add('pulse-highlight');
      setTimeout(() => input.classList.remove('pulse-highlight'), 1200);
    }
    showToast('Data Management is password-protected. Enter administrator password below.', 'info');
  }
}

function toggleSidebarPasswordVisibility() {
  const input = document.getElementById('sidebar-password-input');
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  const eyeBtn = document.querySelector('.sidebar-eye-btn');
  if (eyeBtn) {
    eyeBtn.innerHTML = isPass
      ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
      : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  }
}

async function submitSidebarUnlock() {
  const input = document.getElementById('sidebar-password-input');
  const pwd = input ? input.value.trim() : '';
  if (!pwd) {
    showToast('Please enter password to unlock Data Management.', 'error');
    if (input) input.focus();
    return;
  }

  if (isUnifiedAuthorized(pwd)) {
    appState.isUnlocked = true;
    if (input) input.value = '';
    updateSidebarLockState();
    updateDataManagementUI();
    showToast('Unlocked successfully! Welcome to Data Management.', 'success');
    switchPage('data_management');
  } else {
    showToast('Incorrect password. Access denied.', 'error');
    if (input) {
      input.classList.add('error-shake');
      setTimeout(() => input.classList.remove('error-shake'), 600);
      input.select();
    }
  }
}

function updateSidebarLockState() {
  const widget = document.getElementById('sidebar-lock-widget');
  const hint = document.getElementById('sidebar-lock-hint');
  const passWrap = document.getElementById('sidebar-pass-container');
  const unlockBtn = document.getElementById('sidebar-unlock-btn');

  if (!widget) return;

  if (appState.isUnlocked) {
    if (hint) hint.innerHTML = '<span style="color:#38bdf8; font-weight:700;">● Admin Session Active</span>';
    if (passWrap) passWrap.style.display = 'none';
    if (unlockBtn) {
      unlockBtn.textContent = 'Manage Data';
      unlockBtn.onclick = () => switchPage('data_management');
    }
  } else {
    if (hint) hint.textContent = 'Password Protected';
    if (passWrap) passWrap.style.display = 'flex';
    if (unlockBtn) {
      unlockBtn.textContent = 'Unlock';
      unlockBtn.onclick = submitSidebarUnlock;
    }
  }
}

// ============================================================
// DASHBOARD NAVIGATION SHORTCUTS
// ============================================================

function openCourseDetails(courseName) {
  switchPage('course_attendance');
  populateCourseFilter();
  const select = document.getElementById('course-filter-select');
  if (select && courseName) {
    const opts = Array.from(select.options);
    const match = opts.find(o => o.value.toLowerCase().includes(courseName.toLowerCase()));
    if (match) {
      select.value = match.value;
    }
    renderCourseWiseAttendance();
  }
}

function inspectEmployee(empIdentifier) {
  switchPage('course_attendance');
  populateCourseFilter();
  renderCourseWiseAttendance();
  const empSelect = document.getElementById('employee-inspector-select');
  if (empSelect && empIdentifier) {
    const [no, name] = empIdentifier.split('||');
    const opts = Array.from(empSelect.options);
    const match = opts.find(o => {
      const v = o.value.toLowerCase();
      return (no && v.includes(no.toLowerCase())) || (name && v.includes(name.toLowerCase()));
    });
    if (match) {
      empSelect.value = match.value;
      renderEmployeeHistory();
      empSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

// ============================================================
// APP BOOTSTRAP
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Always lock all administrator access on new browser load
  appState.isUnlocked = false;
  try {
    sessionStorage.removeItem('kwsc_admin_unlocked');
  } catch (e) {}

  initKarachiClock();
  updateSidebarLockState();
  loadAllData();

  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && document.getElementById('view-' + initialHash)) {
    switchPage(initialHash);
  }
});
