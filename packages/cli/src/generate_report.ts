#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

// ============================================================================
// contex Benchmark Report Generator v4.2
// ============================================================================
// Updated to match website design + added Theme Toggle & Navigation
// ============================================================================

const DATA_PATH = path.join(process.cwd(), 'benchmark_results.json');
const OUTPUT_PATH = path.join(process.cwd(), 'benchmark_report.html');

if (!fs.existsSync(DATA_PATH)) {
  console.error(`Error: Data file not found at ${DATA_PATH}`);
  process.exit(1);
}

const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
const DATA = JSON.parse(rawData);

// Fallback model data if not present in input
const MODELS = {
  'gpt-4o': { name: 'GPT-4o', inputPricePer1M: 2.5, contextWindow: 128000 },
  'claude-3-5-sonnet': { name: 'Claude 3.5 Sonnet', inputPricePer1M: 3.0, contextWindow: 200000 },
};

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>contex Benchmark v{{VERSION}}</title>
    
    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    
    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

    <style>
        :root {
            /* ─── Variables (Matches style.css) ─── */
            --bg-body: #09090b;
            --bg-card: #18181b;
            --bg-elevated: #27272a;
            --bg-code: #121215;
            
            --border-subtle: #27272a;
            --border: #3f3f46;
            --border-active: #52525b;
            
            --text-primary: #f4f4f5;
            --text-secondary: #a1a1aa;
            --text-muted: #71717a;
            --text-inverse: #09090b;

            --accent-blue: #3b82f6;
            --accent-green: #22c55e;
            --accent-purple: #8b5cf6;
            --accent-red: #ef4444;
            --accent-amber: #f59e0b;

            --radius-md: 8px;
            --radius-lg: 12px;
            --nav-height: 64px;
            --max-width: 1200px;
        }

        [data-theme="light"] {
            --bg-body: #ffffff;
            --bg-card: #ffffff;
            --bg-elevated: #f4f4f5;
            --bg-code: #f4f4f5;
            
            --border-subtle: #e4e4e7;
            --border: #d4d4d8;
            --border-active: #a1a1aa;
            
            --text-primary: #18181b;
            --text-secondary: #52525b;
            --text-muted: #71717a;
            --text-inverse: #ffffff;
        }

        /* ─── Reset ─── */
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg-body);
            color: var(--text-primary);
            font-family: 'Inter', system-ui, sans-serif;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
            padding-top: var(--nav-height); /* Nav spacing */
        }
        a { text-decoration: none; color: inherit; transition: color 0.2s; }
        ul { list-style: none; }

        /* ─── Navigation (Copied from style.css) ─── */
        .nav {
            position: fixed;
            top: 0; left: 0; right: 0;
            height: var(--nav-height);
            background: var(--bg-body); /* Solid bg for report to avoid overlap issues */
            border-bottom: 1px solid var(--border-subtle);
            z-index: 50;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 24px max(0px, calc(50vw - 600px)); /* Center align */
        }
        .nav-brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 18px; color: var(--text-primary); }
        .logo-icon { width: 24px; height: 24px; background: var(--accent-blue); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #fff; font-weight: 800; }
        .nav-links { display: flex; gap: 24px; margin-left: 48px; }
        .nav-links a { font-size: 14px; color: var(--text-secondary); font-weight: 500; }
        .nav-links a:hover, .nav-links a.active { color: var(--text-primary); }
        .nav-actions { margin-left: auto; display: flex; align-items: center; gap: 16px; }

        /* ─── Report Layout ─── */
        .container { max-width: 1200px; margin: 0 auto; padding: 40px 24px; }
        
        h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 4px; }
        h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; color: var(--text-primary); }
        .dim { color: var(--text-muted); }
        .mono { font-family: 'JetBrains Mono', monospace; }
        
        .header-controls {
            display: flex;
            gap: 16px;
            align-items: center;
            margin-top: 24px;
            padding-bottom: 24px;
            border-bottom: 1px solid var(--border-subtle);
            margin-bottom: 40px;
        }

        select, button {
            background: var(--bg-card);
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: 8px 12px;
            font-family: inherit;
            font-size: 13px;
            border-radius: var(--radius-md);
            cursor: pointer;
            transition: border-color 0.2s;
        }
        select:hover, button:hover { border-color: var(--border-active); }

        .grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 24px;
            margin-bottom: 48px;
        }
        .col-2 { grid-column: span 2; }
        .col-4 { grid-column: span 4; }

        .card {
            border: 1px solid var(--border-subtle);
            padding: 24px;
            background: var(--bg-card);
            border-radius: var(--radius-lg);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        .card-label { font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; font-weight: 600; }
        .card-value { font-size: 36px; font-weight: 700; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; letter-spacing: -0.03em; }
        .card-sub { font-size: 13px; color: var(--text-muted); margin-top: 8px; display: flex; align-items: center; gap: 6px; }

        .chart-wrap { height: 320px; width: 100%; position: relative; }

        /* Tables */
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
        td { padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); color: var(--text-primary); }
        .cell-mono { font-family: 'JetBrains Mono', monospace; color: var(--text-secondary); }
        
        .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .tag-tens { color: var(--accent-purple); border: 1px solid rgba(139,92,246,0.3); background: rgba(139,92,246,0.1); }
        .tag-json { color: var(--text-muted); border: 1px solid var(--border); }

        .trend-up { color: var(--accent-green); }
        .trend-down { color: var(--accent-red); }

        .comparison-tool {
            background: var(--bg-elevated);
            padding: 24px;
            border-radius: var(--radius-lg);
            border: 1px solid var(--border-subtle);
            margin-top: 40px;
        }
        .comp-stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-top: 24px;
        }
        .stat-box {
            background: var(--bg-card);
            padding: 16px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border-subtle);
            text-align: center;
        }
        .stat-box div:first-child { font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; }
        .stat-box div:last-child { font-size: 18px; font-weight: 700; font-family: 'JetBrains Mono'; }

        /* Responsive */
        @media (max-width: 900px) {
            .grid { grid-template-columns: 1fr; }
            .col-2, .col-4 { grid-column: span 1; }
            .nav-links { display: none; }
        }
        

        #error-log {
            display: none;
            background: #ef44441a;
            border: 1px solid #ef4444;
            color: #ef4444;
            padding: 16px;
            margin: 20px;
            border-radius: 8px;
            font-family: monospace;
            white-space: pre-wrap;
        }

        header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    </style>
    <script>
        window.onerror = function(msg, url, line, col, error) {
            const div = document.getElementById('error-log');
            if (div) {
                div.style.display = 'block';
                div.textContent += \`Error: \${msg}\\nAt: \${line}:\${col}\\n\${error ? error.stack : ''}\\n\\n\`;
            }
            return false;
        };
        console.warn = function(...args) {
             const div = document.getElementById('error-log');
             if (div) {
                div.style.display = 'block';
                div.textContent += \`Warn: \${args.join(' ')}\\n\\n\`;
             }
        }
    </script>
</head>
<body>
    <div class="container">
        <div id="error-log"></div>
        
        <header>
            <div>
                <h1>Benchmark Report</h1>
                <div class="dim text-sm">Automated Performance Analysis &bull; {{DATE}}</div>
            </div>
            <button id="themeBtn">☀ Light</button>
        </header>

        <div class="header-controls">
            <div style="display:flex; align-items:center; gap:12px;">
                <label class="dim" style="font-size: 13px; font-weight:500;">DATASET:</label>
                <select id="datasetSelect"></select>
            </div>
            <div style="width: 1px; height: 24px; background: var(--border-subtle); margin: 0 16px;"></div> 
            <div class="dim" style="font-size:13px;">Reviewing <strong style="color:var(--text-primary)">1,000 records</strong> (std batch)</div>
        </div>

        <!-- Key Metrics -->
        <div class="grid">
            <div class="card">
                <div class="card-label">Token Savings</div>
                <div class="card-value number" id="kpiSavings">--</div>
                <div class="card-sub">vs JSON (1k rows)</div>
            </div>
            <div class="card">
                <div class="card-label">Context Density</div>
                <div class="card-value number" id="kpiDensity">--</div>
                <div class="card-sub trend-up">More data per window</div>
            </div>
            <div class="card">
                <div class="card-label">Cost Efficiency</div>
                <div class="card-value number" id="kpiRoi">--</div>
                <div class="card-sub">Est. ROI (GPT-4o)</div>
            </div>
            <div class="card">
                <div class="card-label">Encoding Speed</div>
                <div class="card-value number" id="kpiSpeed">--</div>
                <div class="card-sub">Ops/Sec (Global)</div>
            </div>
        </div>

        <!-- Charts -->
        <div class="grid">
            <div class="card col-2">
                <h2><span style="color:var(--accent-blue)">■</span> Cost Projection ($/Year)</h2>
                <div class="chart-wrap"><canvas id="chartCost"></canvas></div>
            </div>
            <div class="card col-2">
                <h2><span style="color:var(--accent-purple)">■</span> Token Growth Scaling</h2>
                <div class="chart-wrap"><canvas id="chartScaling"></canvas></div>
            </div>
        </div>

        <!-- Comparison Tool -->
        <div class="comparison-tool" id="comparisonTool">
            <h2>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M9 21H4v-5"/></svg>
                Direct Comparison
            </h2>
            <div style="margin-top:16px; display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
                <select id="compA"><option value="json">JSON</option></select>
                <span class="dim">vs</span>
                <select id="compB"><option value="tens" selected>TENS</option></select>
            </div>

            <div class="comp-stats">
                <div class="stat-box">
                    <div>Tokens</div>
                    <div id="diffTokens" style="color:var(--accent-green)">-59%</div>
                </div>
                <div class="stat-box">
                    <div>Size</div>
                    <div id="diffSize" style="color:var(--accent-purple)">-76%</div>
                </div>
                <div class="stat-box">
                    <div>Cost/Avg</div>
                    <div id="diffCost" style="color:var(--accent-green)">-59%</div>
                </div>
                <div class="stat-box">
                    <div>Density</div>
                    <div id="diffDensity" style="color:var(--text-primary)">2.4x</div>
                </div>
            </div>
        </div>

        <div style="height:48px;"></div>

        <!-- Data Table -->
        <div class="card col-4">
            <h2>Detailed Matrix (<span id="tableName">RealWorld</span>)</h2>
            <div style="overflow-x:auto">
                <table id="matrixTable">
                    <thead>
                        <tr>
                            <th>Format</th>
                            <th>Rows</th>
                            <th>Tokens</th>
                            <th>Size (KB)</th>
                            <th>Overhead</th>
                            <th>Est. Cost ($/1M)</th>
                        </tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>

    </div>

<script>
    const DATA = {{DATA}};
    const MODELS = {{MODELS}};
    const INPUT_PRICE = 2.50;

    // -- State
    let costChart = null;
    let scalingChart = null;
    
    // -- Theme State
    let currentTheme = localStorage.getItem('contex-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);

    // -- Init Dataset Selector
    const validDatasets = [...new Set(DATA.matrix.map(d => d.dataset))];
    const selector = document.getElementById('datasetSelect');
    validDatasets.forEach(ds => {
        const opt = document.createElement('option');
        opt.value = ds;
        opt.textContent = ds;
        if (ds === 'RealWorld') opt.selected = true;
        selector.appendChild(opt);
    });

    selector.addEventListener('change', (e) => render(e.target.value));
    
    // -- Init Theme Toggle
    const themeBtn = document.getElementById('themeBtn');
    
    function updateThemeBtn() {
        themeBtn.textContent = currentTheme === 'dark' ? '☀ Light' : '☾ Dark';
    }
    updateThemeBtn();

    themeBtn.addEventListener('click', () => {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', currentTheme);
        localStorage.setItem('contex-theme', currentTheme);
        updateThemeBtn();
        render(selector.value); // Re-render charts
    });

    // -- Render Function
    function render(datasetName) {
        document.getElementById('tableName').textContent = datasetName;
        
        // Theme Colors
        const isDark = currentTheme === 'dark';
        // Match CSS vars
        const cGrid = isDark ? '#27272a' : '#e4e4e7';
        const cText = isDark ? '#a1a1aa' : '#71717a';
        
        // Filter Data
        const rows = DATA.matrix.filter(d => d.dataset === datasetName);
        const rows1k = rows.filter(d => d.rows === 1000);
        
        // 1. KPIs
        const json = rows1k.find(d => d.format === 'json');
        const tens = rows1k.find(d => d.format === 'tens');
        
        if (json && tens) {
            const savings = ((1 - tens.tokens / json.tokens) * 100).toFixed(1);
            const density = (json.tokens / tens.tokens).toFixed(2);
            document.getElementById('kpiSavings').textContent = savings + '%';
            document.getElementById('kpiDensity').textContent = density + 'x';
            
            // ROI Calculation (very rough)
            document.getElementById('kpiRoi').textContent = density + 'x';
        } else {
            document.getElementById('kpiSavings').textContent = '--';
            document.getElementById('kpiDensity').textContent = '--';
            document.getElementById('kpiRoi').textContent = '--';
        }

        if (DATA.tens && DATA.tens.encodingSpeed) {
            document.getElementById('kpiSpeed').textContent = new Intl.NumberFormat('en-US', { notation: "compact" }).format(DATA.tens.encodingSpeed);
        }

        // 2. Data Table (Render FIRST so it always shows)
        const tbody = document.querySelector('#matrixTable tbody');
        tbody.innerHTML = '';
        const tableRows = rows.sort((a,b) => b.rows - a.rows || a.tokens - b.tokens);
        tableRows.forEach(row => {
            const tr = document.createElement('tr');
            const cost = (row.tokens / 1e6 * INPUT_PRICE).toFixed(4);
            const sizeKB = (row.bytes / 1024).toFixed(2);
            tr.innerHTML = \`
                <td><span class="tag \${row.format === 'tens' ? 'tag-tens' : 'tag-json'}">\${row.format.toUpperCase()}</span></td>
                <td class="cell-mono">\${row.rows}</td>
                <td class="cell-mono">\${new Intl.NumberFormat('en-US').format(row.tokens)}</td>
                <td class="cell-mono">\${sizeKB}</td>
                <td class="cell-mono">\${(row.structuralOverhead * 100).toFixed(1)}%</td>
                <td class="cell-mono">$\${cost}</td>
            \`;
            tbody.appendChild(tr);
        });

        // 3. Charts (Wrap in try-catch to prevent crash if Chart.js fails)
        try {
            if (typeof Chart === 'undefined') throw new Error('Chart.js not loaded');

            // Cost Chart
            const sorted1k = rows1k.sort((a,b) => a.tokens - b.tokens);
            const labels = sorted1k.map(d => d.format.toUpperCase());
            const costCtx = document.getElementById('chartCost');
            if (costChart) costChart.destroy();
            
            costChart = new Chart(costCtx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Annual Cost ($)',
                        data: sorted1k.map(d => (d.tokens / 1e6 * INPUT_PRICE * 1e6 * 12).toFixed(0)),
                        backgroundColor: sorted1k.map(d => d.format === 'tens' ? '#8b5cf6' : (isDark ? '#27272a' : '#e4e4e7')),
                        maxBarThickness: 40,
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { grid: { color: cGrid }, ticks: { color: cText } },
                        x: { grid: { display: false }, ticks: { color: cText } }
                    }
                }
            });

            // Scaling Chart
            const formats = ['json', 'tens', 'toon', 'csv'];
            const uniqueSizes = [...new Set(rows.map(r => r.rows))].sort((a,b) => a-b);
            const scalingDatasets = formats.map(fmt => ({
                label: fmt.toUpperCase(),
                data: uniqueSizes.map(s => rows.find(r => r.format === fmt && r.rows === s)?.tokens || null),
                borderColor: fmt === 'tens' ? '#8b5cf6' : 
                             fmt === 'json' ? '#ef4444' : 
                             fmt === 'toon' ? '#3b82f6' : cText,
                backgroundColor: 'transparent',
                tension: 0.2,
                borderWidth: 2
            }));
            
            const scalingCtx = document.getElementById('chartScaling');
            if (scalingChart) scalingChart.destroy();
            scalingChart = new Chart(scalingCtx, {
                type: 'line',
                data: { labels: uniqueSizes, datasets: scalingDatasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                         y: { type: 'logarithmic', grid: { color: cGrid }, ticks: { color: cText } },
                         x: { grid: { color: cGrid }, ticks: { color: cText } }
                    },
                    plugins: { 
                        legend: { labels: { color: cText } },
                        tooltip: { mode: 'index', intersect: false }
                    }
                }
            });
        } catch (e) {
            console.warn('Charts failed to load:', e);
            document.querySelectorAll('.chart-wrap').forEach(el => {
                el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;">Charts unavailable (Offline mode)</div>';
            });
        }

        // 4. Comparison Tool Update (Interactive)
        updateComparison();
    }

    // -- Comparison Tool Logic
    const compA = document.getElementById('compA');
    const compB = document.getElementById('compB');
    
    // Populate format options
    const allFormats = [...new Set(DATA.matrix.map(d => d.format))];
    [compA, compB].forEach(sel => {
        sel.innerHTML = '';
        allFormats.forEach(fmt => {
            const opt = document.createElement('option');
            opt.value = fmt;
            opt.textContent = fmt.toUpperCase();
            sel.appendChild(opt);
        });
    });
    compA.value = 'json';
    compB.value = 'tens';

    [compA, compB].forEach(sel => sel.addEventListener('change', updateComparison));

    function updateComparison() {
        // Use currently selected dataset
        const dataset = selector.value || 'RealWorld';
        const rows = DATA.matrix.filter(d => d.dataset === dataset && d.rows === 1000);
        
        const rowA = rows.find(r => r.format === compA.value);
        const rowB = rows.find(r => r.format === compB.value);

        if (!rowA || !rowB) return;

        // Calc Diffs
        const diffTokens = ((rowB.tokens - rowA.tokens) / rowA.tokens * 100).toFixed(0);
        const diffSize = ((rowB.bytes - rowA.bytes) / rowA.bytes * 100).toFixed(0);
        const diffCost = diffTokens; // proportional
        const densityA = rowA.tokens / rowA.bytes;
        const densityB = rowB.tokens / rowB.bytes; // wait, density is Tokens/Byte? No, info density usually inversed or calc'd differently.
        // Let's use the density field in data:
        // density = overhead free bytes / total bytes?
        // Let's just use raw ratio overlap:
        const densityImp = (rowA.tokens / rowB.tokens).toFixed(1) + 'x'; // How many times more efficient B is than A

        document.getElementById('diffTokens').textContent = (diffTokens > 0 ? '+' : '') + diffTokens + '%';
        document.getElementById('diffTokens').style.color = diffTokens < 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        
        document.getElementById('diffSize').textContent = (diffSize > 0 ? '+' : '') + diffSize + '%';
        document.getElementById('diffSize').style.color = diffSize < 0 ? 'var(--accent-purple)' : 'var(--text-muted)';
        
        document.getElementById('diffCost').textContent = (diffTokens > 0 ? '+' : '') + diffTokens + '%';
        document.getElementById('diffCost').style.color = diffTokens < 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        
        document.getElementById('diffDensity').textContent = densityImp;
    }

    // Initial render
    render(selector.value || 'RealWorld');

</script>
</body>
</html>`;

const outHtml = HTML_TEMPLATE.replace('{{VERSION}}', DATA.metadata.version)
  .replace('{{DATE}}', new Date(DATA.metadata.timestamp).toLocaleDateString())
  .replace('{{DATA}}', JSON.stringify(DATA))
  .replace('{{MODELS}}', JSON.stringify(MODELS));

// -- Copy data to website for dynamic loading
const WEBSITE_DATA_PATH = path.join(process.cwd(), 'website', 'benchmark_results.json');
fs.copyFileSync(DATA_PATH, WEBSITE_DATA_PATH);
console.log(`Data synced to website: ${WEBSITE_DATA_PATH}`);

fs.writeFileSync(OUTPUT_PATH, outHtml);
console.log(`Report generated: ${OUTPUT_PATH}`);
