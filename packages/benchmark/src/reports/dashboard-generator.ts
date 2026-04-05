/**
 * Dashboard Generator
 *
 * Generates an HTML dashboard with Chart.js visualizations
 * aggregating all benchmark runs.
 */

import * as fs from "fs";
import * as path from "path";
import { TaskRun } from "../types";

interface RunData {
  runId: string;
  timestamp: string;
  results: TaskRun[];
}

interface AggregatedData {
  runs: RunData[];
  agents: string[];
  tasks: string[];
  categories: string[];
}

/**
 * Scan benchmark-results directory and collect all runs
 */
export function collectAllRuns(resultsDir: string): AggregatedData {
  const runs: RunData[] = [];
  const agentsSet = new Set<string>();
  const tasksSet = new Set<string>();
  const categoriesSet = new Set<string>();

  if (!fs.existsSync(resultsDir)) {
    return { runs: [], agents: [], tasks: [], categories: [] };
  }

  const runDirs = fs.readdirSync(resultsDir).filter((name) => {
    const fullPath = path.join(resultsDir, name);
    return fs.statSync(fullPath).isDirectory();
  });

  for (const runId of runDirs) {
    const jsonlPath = path.join(resultsDir, runId, "results.jsonl");
    if (!fs.existsSync(jsonlPath)) continue;

    const content = fs.readFileSync(jsonlPath, "utf-8").trim();
    if (!content) continue;
    
    const results: TaskRun[] = [];
    
    // Try to parse as single-line JSONL first
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    
    if (lines.length > 0 && lines[0].trim().startsWith("{") && lines[0].trim().endsWith("}")) {
      // Standard JSONL format - one JSON object per line
      for (const line of lines) {
        try {
          results.push(JSON.parse(line));
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
    } else {
      // Multi-line JSON format - try to parse the whole content
      // Could be a single object or an array
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          results.push(...parsed);
        } else {
          results.push(parsed);
        }
      } catch (e) {
        // Try to find JSON objects by matching braces
        const matches = content.match(/\{[\s\S]*?\n\}/g);
        if (matches) {
          for (const match of matches) {
            try {
              results.push(JSON.parse(match));
            } catch (e2) {
              // Skip invalid JSON
            }
          }
        }
      }
    }

    if (results.length === 0) continue;

    // Extract timestamp from first result or run ID
    const timestamp = results[0]?.timestamp || runId;

    runs.push({ runId, timestamp, results });

    for (const r of results) {
      agentsSet.add(r.agent);
      tasksSet.add(r.taskId);
    }
  }

  // Sort runs by timestamp (newest first)
  runs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    runs,
    agents: Array.from(agentsSet).sort(),
    tasks: Array.from(tasksSet).sort(),
    categories: Array.from(categoriesSet).sort(),
  };
}

/**
 * Generate the complete HTML dashboard
 */
export function generateDashboardHtml(data: AggregatedData): string {
  const chartData = prepareChartData(data);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nella Benchmark Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text-primary: #f0f6fc;
      --text-secondary: #8b949e;
      --border: #30363d;
      --accent: #58a6ff;
      --success: #3fb950;
      --danger: #f85149;
      --warning: #d29922;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 20px;
    }
    
    .container { max-width: 1400px; margin: 0 auto; }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    
    h1 { font-size: 1.8rem; font-weight: 600; }
    h2 { font-size: 1.3rem; font-weight: 600; margin-bottom: 15px; color: var(--text-secondary); }
    
    .stats {
      display: flex;
      gap: 30px;
    }
    
    .stat {
      text-align: center;
    }
    
    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--accent);
    }
    
    .stat-label {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    
    .filters {
      display: flex;
      gap: 15px;
      margin-bottom: 25px;
      flex-wrap: wrap;
    }
    
    .filter-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .filter-group label {
      font-size: 0.9rem;
      color: var(--text-secondary);
    }
    
    select {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 0.9rem;
      cursor: pointer;
    }
    
    select:hover { border-color: var(--accent); }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 20px;
    }
    
    .card-full {
      grid-column: 1 / -1;
    }
    
    .chart-container {
      position: relative;
      height: 300px;
    }
    
    .chart-container-tall {
      height: 400px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    
    th, td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    
    th {
      color: var(--text-secondary);
      font-weight: 500;
      font-size: 0.85rem;
      text-transform: uppercase;
    }
    
    th.sortable {
      cursor: pointer;
      user-select: none;
      transition: color 0.2s;
    }
    
    th.sortable:hover {
      color: var(--accent);
    }
    
    th .sort-icon {
      margin-left: 4px;
      opacity: 0.6;
    }
    
    tr:hover { background: var(--bg-tertiary); }
    
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 0.8rem;
      font-weight: 500;
    }
    
    .badge-success { background: rgba(63, 185, 80, 0.2); color: var(--success); }
    .badge-danger { background: rgba(248, 81, 73, 0.2); color: var(--danger); }
    .badge-warning { background: rgba(210, 153, 34, 0.2); color: var(--warning); }
    
    .metric-bar {
      height: 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      overflow: hidden;
    }
    
    .metric-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    
    .legend {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      margin-top: 15px;
      font-size: 0.85rem;
      color: var(--text-secondary);
    }
    
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    
    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 3px;
    }
    
    .run-selector {
      margin-bottom: 20px;
    }
    
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }
    
    .empty-state h2 {
      color: var(--text-primary);
      margin-bottom: 10px;
    }
    
    footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }
    
    @media (max-width: 768px) {
      .grid {
        grid-template-columns: 1fr;
      }
      
      header {
        flex-direction: column;
        gap: 20px;
      }
      
      .stats {
        flex-wrap: wrap;
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🔬 Nella Benchmark Dashboard</h1>
      <div class="stats">
        <div class="stat">
          <div class="stat-value">${data.runs.length}</div>
          <div class="stat-label">Runs</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.agents.length}</div>
          <div class="stat-label">Agents</div>
        </div>
        <div class="stat">
          <div class="stat-value">${data.tasks.length}</div>
          <div class="stat-label">Tasks</div>
        </div>
        <div class="stat">
          <div class="stat-value">${getTotalRuns(data)}</div>
          <div class="stat-label">Total Executions</div>
        </div>
      </div>
    </header>

    ${data.runs.length === 0 ? `
    <div class="empty-state">
      <h2>No benchmark results yet</h2>
      <p>Run some benchmarks first to see data here.</p>
      <p style="margin-top: 10px;"><code>npm run benchmark -- -a gpt-4o</code></p>
    </div>
    ` : `
    <div class="filters">
      <div class="filter-group">
        <label for="agentFilter">Agent:</label>
        <select id="agentFilter" onchange="applyFilters()">
          <option value="all">All Agents</option>
          ${data.agents.map((a) => `<option value="${a}">${a}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="taskFilter">Task:</label>
        <select id="taskFilter" onchange="applyFilters()">
          <option value="all">All Tasks</option>
          ${data.tasks.map((t) => `<option value="${t}">${t}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="runFilter">Run:</label>
        <select id="runFilter" onchange="applyFilters()">
          <option value="all">All Runs</option>
          ${data.runs.map((r) => `<option value="${r.runId}">${r.runId}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Pass Rate by Agent</h2>
        <div class="chart-container">
          <canvas id="passRateChart"></canvas>
        </div>
      </div>
      
      <div class="card">
        <h2>Cost & Tokens by Agent</h2>
        <div class="chart-container">
          <canvas id="costChart"></canvas>
        </div>
      </div>

      <div class="card">
        <h2>Nella Cost Comparison</h2>
        <div class="chart-container">
          <canvas id="nellaCostChart"></canvas>
        </div>
      </div>

      <div class="card">
        <h2>Metrics Comparison (Radar)</h2>
        <div class="chart-container">
          <canvas id="radarChart"></canvas>
        </div>
      </div>
      
      <div class="card">
        <h2>Time to Green Distribution</h2>
        <div class="chart-container">
          <canvas id="ttgChart"></canvas>
        </div>
      </div>
      
      <div class="card card-full">
        <h2>Task × Agent Success Matrix</h2>
        <div style="overflow-x: auto;">
          ${generateHeatmapTable(data)}
        </div>
      </div>
      
      <div class="card card-full">
        <h2>Task Statistics</h2>
        <div style="overflow-x: auto;">
          ${generateTaskStatsTable(data)}
        </div>
      </div>
      
      <div class="card card-full">
        <h2>Performance Over Time</h2>
        <div class="chart-container chart-container-tall">
          <canvas id="timelineChart"></canvas>
        </div>
      </div>
      
      <div class="card card-full">
        <h2>Recent Results</h2>
        <div style="overflow-x: auto;">
          ${generateResultsTable(data)}
        </div>
      </div>
    </div>
    
    <div class="legend">
      <div class="legend-item"><strong>Metrics:</strong></div>
      <div class="legend-item">BTP = Build/Test Pass</div>
      <div class="legend-item">VI = Validation Integrity</div>
      <div class="legend-item">CVR = Constraint Violation Rate</div>
      <div class="legend-item">SC = Scope Creep</div>
      <div class="legend-item">DA = Diff Accuracy</div>
      <div class="legend-item">TTG = Time to Green (s)</div>
      <div class="legend-item">IC = Iteration Count</div>
    </div>
    `}

    <footer>
      Generated on ${new Date().toISOString()} | Nella Benchmark
    </footer>
  </div>

  ${data.runs.length > 0 ? `
  <script>
    // Chart.js defaults
    Chart.defaults.color = '#8b949e';
    Chart.defaults.borderColor = '#30363d';
    
    const rawData = ${JSON.stringify(chartData)};
    let filteredData = JSON.parse(JSON.stringify(rawData));
    
    const colors = {
      blue: 'rgba(88, 166, 255, 0.8)',
      green: 'rgba(63, 185, 80, 0.8)',
      red: 'rgba(248, 81, 73, 0.8)',
      yellow: 'rgba(210, 153, 34, 0.8)',
      purple: 'rgba(163, 113, 247, 0.8)',
      cyan: 'rgba(57, 211, 204, 0.8)',
    };
    
    const colorArray = Object.values(colors);
    
    let charts = {};
    
    function getFilteredResults() {
      const agent = document.getElementById('agentFilter').value;
      const task = document.getElementById('taskFilter').value;
      const run = document.getElementById('runFilter').value;
      
      let results = [];
      const allRuns = ${JSON.stringify(data.runs)};
      
      for (const r of allRuns) {
        if (run !== 'all' && r.runId !== run) continue;
        for (const result of r.results) {
          if (agent !== 'all' && result.agent !== agent) continue;
          if (task !== 'all' && result.taskId !== task) continue;
          results.push({ ...result, runId: r.runId });
        }
      }
      
      return results;
    }
    
    function recalculateChartData(results) {
      const agents = [...new Set(results.map(r => r.agent))].sort();
      const agentStats = {};

      for (const agent of agents) {
        agentStats[agent] = { passed: 0, total: 0, cost: 0, successCost: 0, tokens: 0, ttg: 0, vi: 0, da: 0, cvr: 0, sc: 0, btp: 0 };
      }

      // Nella vs non-Nella aggregation
      const nellaStats = { cost: 0, tokens: 0, total: 0, passed: 0 };
      const bareStats = { cost: 0, tokens: 0, total: 0, passed: 0 };

      for (const r of results) {
        const stats = agentStats[r.agent];
        if (!stats) continue;

        stats.total++;
        if (r.passed) {
          stats.passed++;
          stats.successCost += r.metrics.estimatedCost;
        }
        if (r.metrics.btp) stats.btp++;
        stats.cost += r.metrics.estimatedCost;
        stats.tokens += r.metrics.tokensUsed;
        stats.ttg += r.metrics.ttg;
        stats.vi += r.metrics.vi;
        stats.da += r.metrics.da;
        stats.cvr += r.metrics.cvr;
        stats.sc += r.metrics.sc;

        // Track nella vs bare
        const mode = r.nellaEnabled ? nellaStats : bareStats;
        mode.cost += r.metrics.estimatedCost;
        mode.tokens += r.metrics.tokensUsed;
        mode.total++;
        if (r.passed) mode.passed++;
      }

      return {
        agents,
        passRates: agents.map(a => agentStats[a].total > 0 ? (agentStats[a].passed / agentStats[a].total) * 100 : 0),
        avgCosts: agents.map(a => agentStats[a].total > 0 ? agentStats[a].cost / agentStats[a].total : 0),
        avgSuccessCosts: agents.map(a => agentStats[a].passed > 0 ? agentStats[a].successCost / agentStats[a].passed : 0),
        avgTokens: agents.map(a => agentStats[a].total > 0 ? agentStats[a].tokens / agentStats[a].total : 0),
        avgTtg: agents.map(a => agentStats[a].total > 0 ? agentStats[a].ttg / agentStats[a].total : 0),
        radarData: Object.fromEntries(agents.map(a => {
          const s = agentStats[a];
          if (s.total === 0) return [a, [0, 0, 0, 0, 0]];
          return [a, [
            s.vi / s.total,
            s.da / s.total,
            1 - (s.cvr / s.total),
            1 - (s.sc / s.total),
            s.btp / s.total,
          ]];
        })),
        nellaCost: {
          hasData: nellaStats.total > 0 && bareStats.total > 0,
          nella: {
            avgCost: nellaStats.total > 0 ? nellaStats.cost / nellaStats.total : 0,
            avgTokens: nellaStats.total > 0 ? nellaStats.tokens / nellaStats.total : 0,
            totalCost: nellaStats.cost,
            totalTokens: nellaStats.tokens,
            total: nellaStats.total,
            passRate: nellaStats.total > 0 ? (nellaStats.passed / nellaStats.total) * 100 : 0,
          },
          bare: {
            avgCost: bareStats.total > 0 ? bareStats.cost / bareStats.total : 0,
            avgTokens: bareStats.total > 0 ? bareStats.tokens / bareStats.total : 0,
            totalCost: bareStats.cost,
            totalTokens: bareStats.tokens,
            total: bareStats.total,
            passRate: bareStats.total > 0 ? (bareStats.passed / bareStats.total) * 100 : 0,
          },
        },
      };
    }
    
    function applyFilters() {
      const results = getFilteredResults();
      filteredData = recalculateChartData(results);

      // Update charts
      updatePassRateChart();
      updateCostChart();
      updateNellaCostChart();
      updateRadarChart();
      updateTtgChart();
    }
    
    function updatePassRateChart() {
      charts.passRate.data.labels = filteredData.agents;
      charts.passRate.data.datasets[0].data = filteredData.passRates;
      charts.passRate.update();
    }
    
    function updateCostChart() {
      charts.cost.data.labels = filteredData.agents;
      charts.cost.data.datasets[0].data = filteredData.avgCosts;
      charts.cost.data.datasets[1].data = filteredData.avgSuccessCosts;
      charts.cost.data.datasets[2].data = filteredData.avgTokens.map(t => t / 1000);
      charts.cost.update();
    }

    function updateNellaCostChart() {
      if (!charts.nellaCost) return;
      const nc = filteredData.nellaCost;
      if (!nc || !nc.hasData) {
        charts.nellaCost.data.datasets.forEach(ds => { ds.data = [0, 0]; });
        charts.nellaCost.update();
        return;
      }
      charts.nellaCost.data.datasets[0].data = [nc.nella.avgCost, nc.bare.avgCost];
      charts.nellaCost.data.datasets[1].data = [nc.nella.avgTokens / 1000, nc.bare.avgTokens / 1000];
      charts.nellaCost.update();
    }
    
    function updateRadarChart() {
      charts.radar.data.datasets = filteredData.agents.map((agent, i) => ({
        label: agent,
        data: filteredData.radarData[agent] || [0, 0, 0, 0, 0],
        backgroundColor: colorArray[i % colorArray.length].replace('0.8', '0.2'),
        borderColor: colorArray[i % colorArray.length],
        borderWidth: 2,
      }));
      charts.radar.update();
    }
    
    function updateTtgChart() {
      charts.ttg.data.labels = filteredData.agents;
      charts.ttg.data.datasets[0].data = filteredData.avgTtg;
      charts.ttg.update();
    }
    
    function createPassRateChart() {
      const ctx = document.getElementById('passRateChart');
      charts.passRate = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: rawData.agents,
          datasets: [{
            label: 'Pass Rate (%)',
            data: rawData.passRates,
            backgroundColor: colors.green,
            borderRadius: 4,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, max: 100, grid: { color: '#21262d' } },
            x: { grid: { display: false } }
          }
        }
      });
    }
    
    function createCostChart() {
      const ctx = document.getElementById('costChart');
      charts.cost = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: rawData.agents,
          datasets: [
            {
              label: 'Avg Cost ($)',
              data: rawData.avgCosts,
              backgroundColor: colors.blue,
              borderRadius: 4,
              yAxisID: 'y',
            },
            {
              label: 'Success Cost ($)',
              data: rawData.avgSuccessCosts,
              backgroundColor: colors.green,
              borderRadius: 4,
              yAxisID: 'y',
            },
            {
              label: 'Avg Tokens (K)',
              data: rawData.avgTokens.map(t => t / 1000),
              backgroundColor: colors.purple,
              borderRadius: 4,
              yAxisID: 'y1',
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { 
              type: 'linear', 
              position: 'left', 
              beginAtZero: true,
              grid: { color: '#21262d' },
              title: { display: true, text: 'Cost ($)' }
            },
            y1: { 
              type: 'linear', 
              position: 'right', 
              beginAtZero: true,
              grid: { display: false },
              title: { display: true, text: 'Tokens (K)' }
            },
            x: { grid: { display: false } }
          }
        }
      });
    }
    
    function createNellaCostChart() {
      const ctx = document.getElementById('nellaCostChart');
      if (!ctx) return;
      const nc = rawData.nellaCost;
      const hasData = nc && nc.hasData;
      charts.nellaCost = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['With Nella', 'Without Nella'],
          datasets: [
            {
              label: 'Avg Cost/Run ($)',
              data: hasData ? [nc.nella.avgCost, nc.bare.avgCost] : [0, 0],
              backgroundColor: [colors.blue, colors.red],
              borderRadius: 4,
              yAxisID: 'y',
            },
            {
              label: 'Avg Tokens/Run (K)',
              data: hasData ? [nc.nella.avgTokens / 1000, nc.bare.avgTokens / 1000] : [0, 0],
              backgroundColor: [
                colors.blue.replace('0.8', '0.4'),
                colors.red.replace('0.8', '0.4'),
              ],
              borderRadius: 4,
              yAxisID: 'y1',
            },
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: !hasData,
              text: 'No comparison data (need both Nella and non-Nella runs)',
              color: '#8b949e',
            },
            tooltip: {
              callbacks: {
                afterBody: function() {
                  if (!hasData) return '';
                  const costDiff = nc.nella.avgCost - nc.bare.avgCost;
                  const costPct = nc.bare.avgCost > 0 ? ((costDiff / nc.bare.avgCost) * 100).toFixed(1) : 'n/a';
                  return 'Cost overhead: ' + (costDiff >= 0 ? '+' : '') + costPct + '%';
                }
              }
            }
          },
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              beginAtZero: true,
              grid: { color: '#21262d' },
              title: { display: true, text: 'Cost ($)' }
            },
            y1: {
              type: 'linear',
              position: 'right',
              beginAtZero: true,
              grid: { display: false },
              title: { display: true, text: 'Tokens (K)' }
            },
            x: { grid: { display: false } }
          }
        }
      });
    }

    function createRadarChart() {
      const ctx = document.getElementById('radarChart');
      const datasets = rawData.agents.map((agent, i) => ({
        label: agent,
        data: rawData.radarData[agent] || [0, 0, 0, 0, 0],
        backgroundColor: colorArray[i % colorArray.length].replace('0.8', '0.2'),
        borderColor: colorArray[i % colorArray.length],
        borderWidth: 2,
      }));
      
      charts.radar = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: ['VI', 'DA', '1-CVR', '1-SC', 'BTP Rate'],
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              beginAtZero: true,
              max: 1,
              grid: { color: '#21262d' },
              angleLines: { color: '#21262d' },
              pointLabels: { color: '#f0f6fc' }
            }
          }
        }
      });
    }
    
    function createTtgChart() {
      const ctx = document.getElementById('ttgChart');
      charts.ttg = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: rawData.agents,
          datasets: [{
            label: 'Avg TTG (seconds)',
            data: rawData.avgTtg,
            backgroundColor: colors.yellow,
            borderRadius: 4,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#21262d' } },
            x: { grid: { display: false } }
          }
        }
      });
    }
    
    function createTimelineChart() {
      const ctx = document.getElementById('timelineChart');
      const datasets = rawData.agents.map((agent, i) => ({
        label: agent,
        data: rawData.timeline[agent] || [],
        borderColor: colorArray[i % colorArray.length],
        backgroundColor: colorArray[i % colorArray.length].replace('0.8', '0.2'),
        fill: false,
        tension: 0.3,
      }));
      
      charts.timeline = new Chart(ctx, {
        type: 'line',
        data: {
          labels: rawData.runIds,
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { 
              beginAtZero: true, 
              max: 100,
              grid: { color: '#21262d' },
              title: { display: true, text: 'Pass Rate (%)' }
            },
            x: { 
              grid: { display: false },
              ticks: { maxRotation: 45 }
            }
          }
        }
      });
    }
    
    // Table sorting state
    let currentSort = { column: 'run', direction: 'desc' };
    
    function sortResultsTable(column) {
      const table = document.getElementById('resultsTable');
      if (!table) return;
      
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      
      // Toggle direction if same column
      if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        currentSort.column = column;
        currentSort.direction = 'asc';
      }
      
      // Update header icons
      document.querySelectorAll('.sortable').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (th.dataset.sort === column) {
          icon.textContent = currentSort.direction === 'asc' ? '↑' : '↓';
          th.style.color = 'var(--accent)';
        } else {
          icon.textContent = '↕';
          th.style.color = 'var(--text-secondary)';
        }
      });
      
      // Sort rows
      rows.sort((a, b) => {
        let aVal, bVal;
        
        switch (column) {
          case 'run':
            aVal = a.dataset.run;
            bVal = b.dataset.run;
            break;
          case 'agent':
            aVal = a.dataset.agent;
            bVal = b.dataset.agent;
            break;
          case 'task':
            aVal = a.dataset.task;
            bVal = b.dataset.task;
            break;
          case 'status':
            aVal = a.dataset.passed === 'true' ? 1 : 0;
            bVal = b.dataset.passed === 'true' ? 1 : 0;
            break;
          case 'ttg':
            aVal = parseFloat(a.dataset.ttg);
            bVal = parseFloat(b.dataset.ttg);
            break;
          case 'cost':
            aVal = parseFloat(a.dataset.cost);
            bVal = parseFloat(b.dataset.cost);
            break;
          case 'vi':
            aVal = parseFloat(a.dataset.vi);
            bVal = parseFloat(b.dataset.vi);
            break;
          case 'da':
            aVal = parseFloat(a.dataset.da);
            bVal = parseFloat(b.dataset.da);
            break;
          case 'cvr':
            aVal = parseFloat(a.dataset.cvr);
            bVal = parseFloat(b.dataset.cvr);
            break;
          default:
            aVal = a.textContent;
            bVal = b.textContent;
        }
        
        // Compare
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
        }
        return currentSort.direction === 'asc' 
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      });
      
      // Re-append sorted rows
      rows.forEach(row => tbody.appendChild(row));
    }
    
    function filterResultsTable() {
      const table = document.getElementById('resultsTable');
      if (!table) return;
      
      const showPassedOnly = document.getElementById('showPassedOnly')?.checked;
      const showFailedOnly = document.getElementById('showFailedOnly')?.checked;
      
      const rows = table.querySelectorAll('tbody tr');
      let visibleCount = 0;
      
      rows.forEach(row => {
        const passed = row.dataset.passed === 'true';
        let show = true;
        
        if (showPassedOnly && !passed) show = false;
        if (showFailedOnly && passed) show = false;
        
        row.style.display = show ? '' : 'none';
        if (show) visibleCount++;
      });
    }
    
    // Initialize all charts
    createPassRateChart();
    createCostChart();
    createNellaCostChart();
    createRadarChart();
    createTtgChart();
    createTimelineChart();
  </script>
  ` : ''}
</body>
</html>`;
}

function getTotalRuns(data: AggregatedData): number {
  return data.runs.reduce((sum, run) => sum + run.results.length, 0);
}

function prepareChartData(data: AggregatedData) {
  const agentStats: Record<string, { passed: number; total: number; cost: number; tokens: number; ttg: number; vi: number; da: number; cvr: number; sc: number; btp: number }> = {};

  // Initialize stats for each agent
  for (const agent of data.agents) {
    agentStats[agent] = { passed: 0, total: 0, cost: 0, tokens: 0, ttg: 0, vi: 0, da: 0, cvr: 0, sc: 0, btp: 0 };
  }

  // Nella vs non-Nella aggregation
  const nellaStats = { cost: 0, tokens: 0, total: 0, passed: 0 };
  const bareStats = { cost: 0, tokens: 0, total: 0, passed: 0 };

  // Aggregate stats
  for (const run of data.runs) {
    for (const result of run.results) {
      const stats = agentStats[result.agent];
      if (!stats) continue;

      stats.total++;
      if (result.passed) stats.passed++;
      if (result.metrics.btp) stats.btp++;
      stats.cost += result.metrics.estimatedCost;
      stats.tokens += result.metrics.tokensUsed;
      stats.ttg += result.metrics.ttg;
      stats.vi += result.metrics.vi;
      stats.da += result.metrics.da;
      stats.cvr += result.metrics.cvr;
      stats.sc += result.metrics.sc;

      // Track nella vs bare
      const mode = result.nellaEnabled ? nellaStats : bareStats;
      mode.cost += result.metrics.estimatedCost;
      mode.tokens += result.metrics.tokensUsed;
      mode.total++;
      if (result.passed) mode.passed++;
    }
  }

  // Calculate averages
  const agents = data.agents;
  const passRates = agents.map((a) => agentStats[a].total > 0 ? (agentStats[a].passed / agentStats[a].total) * 100 : 0);
  const avgCosts = agents.map((a) => agentStats[a].total > 0 ? agentStats[a].cost / agentStats[a].total : 0);
  const avgTokens = agents.map((a) => agentStats[a].total > 0 ? agentStats[a].tokens / agentStats[a].total : 0);
  const avgTtg = agents.map((a) => agentStats[a].total > 0 ? agentStats[a].ttg / agentStats[a].total : 0);

  // Radar data (normalized 0-1)
  const radarData: Record<string, number[]> = {};
  for (const agent of agents) {
    const s = agentStats[agent];
    if (s.total === 0) {
      radarData[agent] = [0, 0, 0, 0, 0];
    } else {
      radarData[agent] = [
        s.vi / s.total,           // VI
        s.da / s.total,           // DA
        1 - (s.cvr / s.total),    // 1-CVR (higher is better)
        1 - (s.sc / s.total),     // 1-SC (higher is better)
        s.btp / s.total,          // BTP rate
      ];
    }
  }

  // Timeline data (pass rate per run) - reverse to show oldest first
  const sortedRuns = [...data.runs].reverse();
  const runIds = sortedRuns.map((r) => r.runId.substring(0, 16)); // Truncate for display
  const timeline: Record<string, number[]> = {};
  
  for (const agent of agents) {
    timeline[agent] = [];
  }
  
  for (const run of sortedRuns) {
    const runAgentStats: Record<string, { passed: number; total: number }> = {};
    for (const agent of agents) {
      runAgentStats[agent] = { passed: 0, total: 0 };
    }
    
    for (const result of run.results) {
      runAgentStats[result.agent].total++;
      if (result.passed) runAgentStats[result.agent].passed++;
    }
    
    for (const agent of agents) {
      const s = runAgentStats[agent];
      timeline[agent].push(s.total > 0 ? (s.passed / s.total) * 100 : 0);
    }
  }

  return {
    agents,
    passRates,
    avgCosts,
    avgTokens,
    avgTtg,
    radarData,
    runIds,
    timeline,
    nellaCost: {
      hasData: nellaStats.total > 0 && bareStats.total > 0,
      nella: {
        avgCost: nellaStats.total > 0 ? nellaStats.cost / nellaStats.total : 0,
        avgTokens: nellaStats.total > 0 ? nellaStats.tokens / nellaStats.total : 0,
        totalCost: nellaStats.cost,
        totalTokens: nellaStats.tokens,
        total: nellaStats.total,
        passRate: nellaStats.total > 0 ? (nellaStats.passed / nellaStats.total) * 100 : 0,
      },
      bare: {
        avgCost: bareStats.total > 0 ? bareStats.cost / bareStats.total : 0,
        avgTokens: bareStats.total > 0 ? bareStats.tokens / bareStats.total : 0,
        totalCost: bareStats.cost,
        totalTokens: bareStats.tokens,
        total: bareStats.total,
        passRate: bareStats.total > 0 ? (bareStats.passed / bareStats.total) * 100 : 0,
      },
    },
  };
}

function generateHeatmapTable(data: AggregatedData): string {
  if (data.tasks.length === 0 || data.agents.length === 0) {
    return '<p style="color: var(--text-secondary);">No data available</p>';
  }

  // Build task × agent matrix from most recent run
  const matrix: Record<string, Record<string, boolean | null>> = {};
  
  for (const task of data.tasks) {
    matrix[task] = {};
    for (const agent of data.agents) {
      matrix[task][agent] = null;
    }
  }
  
  // Fill with results (latest run takes precedence)
  for (const run of [...data.runs].reverse()) {
    for (const result of run.results) {
      if (matrix[result.taskId]) {
        matrix[result.taskId][result.agent] = result.passed;
      }
    }
  }
  
  let html = `<table>
    <thead>
      <tr>
        <th>Task</th>
        ${data.agents.map((a) => `<th>${a}</th>`).join("")}
      </tr>
    </thead>
    <tbody>`;
  
  for (const task of data.tasks) {
    html += `<tr><td>${task}</td>`;
    for (const agent of data.agents) {
      const result = matrix[task][agent];
      if (result === null) {
        html += `<td>—</td>`;
      } else if (result) {
        html += `<td><span class="badge badge-success">✓</span></td>`;
      } else {
        html += `<td><span class="badge badge-danger">✗</span></td>`;
      }
    }
    html += `</tr>`;
  }
  
  html += `</tbody></table>`;
  return html;
}

function generateTaskStatsTable(data: AggregatedData): string {
  if (data.tasks.length === 0) {
    return '<p style="color: var(--text-secondary);">No data available</p>';
  }

  // Calculate per-task statistics
  const taskStats: Record<string, { runs: number; passed: number; totalCost: number; successCost: number }> = {};
  
  for (const task of data.tasks) {
    taskStats[task] = { runs: 0, passed: 0, totalCost: 0, successCost: 0 };
  }
  
  // Aggregate across all runs
  for (const run of data.runs) {
    for (const result of run.results) {
      const stats = taskStats[result.taskId];
      if (!stats) continue;
      
      stats.runs++;
      stats.totalCost += result.metrics?.estimatedCost ?? 0;
      if (result.passed) {
        stats.passed++;
        stats.successCost += result.metrics?.estimatedCost ?? 0;
      }
    }
  }
  
  // Sort tasks by pass rate (ascending - hardest first)
  const sortedTasks = [...data.tasks].sort((a, b) => {
    const rateA = taskStats[a].runs > 0 ? taskStats[a].passed / taskStats[a].runs : 0;
    const rateB = taskStats[b].runs > 0 ? taskStats[b].passed / taskStats[b].runs : 0;
    return rateA - rateB;
  });
  
  let html = `<table>
    <thead>
      <tr>
        <th>Task</th>
        <th>Total Runs</th>
        <th>Passed</th>
        <th>Pass Rate</th>
        <th>Total Cost ($)</th>
        <th>Cost per Success ($)</th>
      </tr>
    </thead>
    <tbody>`;
  
  for (const task of sortedTasks) {
    const stats = taskStats[task];
    const passRate = stats.runs > 0 ? (stats.passed / stats.runs) * 100 : 0;
    const totalCost = stats.totalCost;
    const costPerSuccess = stats.passed > 0 ? stats.totalCost / stats.passed : 0;
    const badgeClass = passRate >= 70 ? 'badge-success' : passRate >= 40 ? 'badge-warning' : 'badge-danger';
    
    html += `<tr>
      <td>${task}</td>
      <td>${stats.runs}</td>
      <td>${stats.passed}</td>
      <td><span class="badge ${badgeClass}">${passRate.toFixed(0)}%</span></td>
      <td>$${totalCost.toFixed(4)}</td>
      <td>${stats.passed > 0 ? '$' + costPerSuccess.toFixed(4) : '—'}</td>
    </tr>`;
  }
  
  html += `</tbody></table>`;
  return html;
}

function generateResultsTable(data: AggregatedData): string {
  // Flatten and sort by timestamp (newest first)
  const allResults: Array<TaskRun & { runId: string }> = [];
  
  for (const run of data.runs) {
    for (const result of run.results) {
      allResults.push({ ...result, runId: run.runId });
    }
  }
  
  if (allResults.length === 0) {
    return '<p style="color: var(--text-secondary);">No results yet</p>';
  }
  
  allResults.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  
  // Show all results (no limit) - pagination handled via scrolling
  let html = `
    <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
      <span style="color: var(--text-secondary); font-size: 0.9rem;">Showing ${allResults.length} results</span>
      <div style="display: flex; gap: 10px; align-items: center;">
        <label style="font-size: 0.9rem; color: var(--text-secondary);">
          <input type="checkbox" id="showPassedOnly" onchange="filterResultsTable()"> Passed only
        </label>
        <label style="font-size: 0.9rem; color: var(--text-secondary);">
          <input type="checkbox" id="showFailedOnly" onchange="filterResultsTable()"> Failed only
        </label>
      </div>
    </div>
    <div style="max-height: 600px; overflow-y: auto;">
    <table id="resultsTable">
    <thead>
      <tr>
        <th class="sortable" data-sort="run" onclick="sortResultsTable('run')">Run <span class="sort-icon">↕</span></th>
        <th class="sortable" data-sort="agent" onclick="sortResultsTable('agent')">Agent <span class="sort-icon">↕</span></th>
        <th class="sortable" data-sort="task" onclick="sortResultsTable('task')">Task <span class="sort-icon">↕</span></th>
        <th class="sortable" data-sort="status" onclick="sortResultsTable('status')">Status <span class="sort-icon">↕</span></th>
        <th class="sortable" data-sort="ttg" onclick="sortResultsTable('ttg')">TTG <span class="sort-icon">↕</span></th>
        <th class="sortable" data-sort="cost" onclick="sortResultsTable('cost')">Cost <span class="sort-icon">↕</span></th>
        <th class="sortable" data-sort="vi" onclick="sortResultsTable('vi')">VI <span class="sort-icon">↕</span></th>
        <th class="sortable" data-sort="da" onclick="sortResultsTable('da')">DA <span class="sort-icon">↕</span></th>
        <th class="sortable" data-sort="cvr" onclick="sortResultsTable('cvr')">CVR <span class="sort-icon">↕</span></th>
      </tr>
    </thead>
    <tbody>`;
  
  for (const r of allResults) {
    const statusBadge = r.passed
      ? `<span class="badge badge-success">Passed</span>`
      : `<span class="badge badge-danger">Failed</span>`;
    
    html += `<tr data-passed="${r.passed}" data-run="${r.runId}" data-agent="${r.agent}" data-task="${r.taskId}" data-ttg="${r.metrics.ttg}" data-cost="${r.metrics.estimatedCost}" data-vi="${r.metrics.vi}" data-da="${r.metrics.da}" data-cvr="${r.metrics.cvr}">
      <td>${r.runId.substring(0, 16)}</td>
      <td>${r.agent}</td>
      <td>${r.taskId}</td>
      <td>${statusBadge}</td>
      <td>${r.metrics.ttg.toFixed(1)}s</td>
      <td>$${r.metrics.estimatedCost.toFixed(4)}</td>
      <td>${(r.metrics.vi * 100).toFixed(0)}%</td>
      <td>${(r.metrics.da * 100).toFixed(0)}%</td>
      <td>${(r.metrics.cvr * 100).toFixed(0)}%</td>
    </tr>`;
  }
  
  html += `</tbody></table></div>`;
  return html;
}

/**
 * Write dashboard to file
 */
export function writeDashboard(resultsDir: string): string {
  const data = collectAllRuns(resultsDir);
  const html = generateDashboardHtml(data);
  
  // Ensure directory exists
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  const outputPath = path.join(resultsDir, "dashboard.html");
  fs.writeFileSync(outputPath, html, "utf-8");
  
  return outputPath;
}
