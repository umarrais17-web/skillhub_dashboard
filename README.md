# KW&SC Skill Hub Dashboard

A comprehensive web dashboard for managing and visualizing training programs, nominations, attendance, and certification records for the **Karachi Water & Sewerage Corporation (KW&SC)** Skill Hub.

## 🌟 Key Features

- **Executive KPI Dashboard**: Real-time stats on completed, active, and upcoming training programs, participant counts, and pass rates.
- **Training Schedule**: Detailed view of course schedules, batches, venues, trainers, and timelines.
- **Enrollments & Nominations**: Department-wise nomination tracking with live search, filters, and batch indicators.
- **Attendance & Course Attendance**: Daily session attendance tracking, attendance percentage calculations, and eligibility validation.
- **Interactive Reports & Analytics**: Department-wise breakdowns, course statistics, and Chart.js data visualizations.
- **Next Class Nominations**: Support for importing second-batch nominations via Excel/CSV or live Google Sheets synchronization.
- **Certificates Management**: Automated verification of course completion and issuance records.
- **Offline & Zero-Latency Support**: Pre-bundled datasets with client-side fallback, local storage caching, and instant rendering.

## 🛠️ Built With

- **HTML5 & CSS3**: Responsive UI styled with custom design tokens, accessible cards, modals, and tables.
- **JavaScript (Vanilla)**: High performance, dependency-light client-side application logic.
- **SheetJS (xlsx)**: In-browser Excel (`.xlsx`, `.xls`, `.csv`) spreadsheet ingestion and parsing.
- **Chart.js**: Dynamic charts for course progress and attendance metrics.

## 🚀 Getting Started

### Option 1: Open Directly in Browser
Double-click `index.html` or open it with Google Chrome / any modern browser.

### Option 2: Run with Local Server (PowerShell)
```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```
Then visit: `http://localhost:8080`

## 📁 Project Structure

```
├── index.html                   # Main dashboard application UI
├── styles.css                   # Custom styles, responsive grid, themes
├── script.js                    # Application state, calculations, charts, SheetJS
├── data.js                      # Bundled initial datasets
├── serve.ps1                    # Lightweight local preview web server
├── assets/                      # Logos and visual branding
├── skill_data/                  # Source spreadsheets (courses, schedule, attendance, nominations)
└── netlify.toml                 # Netlify deployment configuration
```

## 📄 License

Internal tool developed for Karachi Water & Sewerage Corporation (KW&SC).
