import * as vscode from 'vscode';
import { TRNParser, Boundary, findBoundariesAtPoint } from './trnParser';
import { validateTRN, ValidationResult } from './trnValidator';
import { TRNTreeParser, TRNTree, TRNNode, searchTree, markTreeErrors, getLayerHierarchy, getBoundariesInLayer, LayerInfo } from './trnTree';

export class TRNEditorProvider implements vscode.CustomReadonlyEditorProvider<TRNDocument> {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            'swgemu.trnViewer',
            new TRNEditorProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false
            }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(uri: vscode.Uri): Promise<TRNDocument> {
        const data = await vscode.workspace.fs.readFile(uri);
        return new TRNDocument(uri, data);
    }

    async resolveCustomEditor(
        document: TRNDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        webviewPanel.webview.options = { enableScripts: true };
        webviewPanel.webview.html = this.getHtmlContent(webviewPanel.webview, document);

        webviewPanel.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'query':
                    const x = parseFloat(message.x);
                    const z = parseFloat(message.z);
                    const results = findBoundariesAtPoint(x, z, document.boundaries);
                    webviewPanel.webview.postMessage({
                        type: 'queryResults',
                        x, z,
                        boundaries: results
                    });
                    break;
                case 'validate':
                    const validation = validateTRN(document.boundaries);
                    webviewPanel.webview.postMessage({
                        type: 'validationResults',
                        ...validation
                    });
                    break;
            }
        });
    }

    private getHtmlContent(webview: vscode.Webview, document: TRNDocument): string {
        const boundaries = document.boundaries;
        const boundariesJson = JSON.stringify(boundaries);
        const treeJson = JSON.stringify(document.tree);

        // Get layer hierarchy for layer filtering
        const layerHierarchy = getLayerHierarchy(document.tree.root);
        const layersJson = JSON.stringify(layerHierarchy);

        // Build boundary-to-layer mapping using offsets
        const boundaryLayerMap: Record<number, string> = {};
        layerHierarchy.forEach(layer => {
            const layerBoundaries = getBoundariesInLayer(layer.node);
            layerBoundaries.forEach(b => {
                boundaryLayerMap[b.offset] = layer.node.id;
            });
        });
        const boundaryLayerMapJson = JSON.stringify(boundaryLayerMap);

        const counts = {
            circle: boundaries.filter(b => b.type === 'circle').length,
            rectangle: boundaries.filter(b => b.type === 'rectangle').length,
            polygon: boundaries.filter(b => b.type === 'polygon').length,
            polyline: boundaries.filter(b => b.type === 'polyline').length
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TRN Viewer</title>
    <style>
        :root {
            --bg: var(--vscode-editor-background);
            --fg: var(--vscode-editor-foreground);
            --border: var(--vscode-panel-border);
            --input-bg: var(--vscode-input-background);
            --input-fg: var(--vscode-input-foreground);
            --input-border: var(--vscode-input-border);
            --button-bg: var(--vscode-button-background);
            --button-fg: var(--vscode-button-foreground);
            --button-hover: var(--vscode-button-hoverBackground);
            --accent: var(--vscode-focusBorder);
        }

        * { box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--fg);
            background: var(--bg);
            padding: 16px;
            margin: 0;
        }

        h1 { margin: 0 0 8px 0; font-size: 1.4em; }
        h2 { margin: 16px 0 8px 0; font-size: 1.2em; }

        .header {
            border-bottom: 1px solid var(--border);
            padding-bottom: 12px;
            margin-bottom: 16px;
        }

        .stats {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            margin-top: 8px;
        }

        .stat {
            background: var(--input-bg);
            padding: 8px 12px;
            border-radius: 4px;
            border: 1px solid var(--border);
        }

        .stat-value {
            font-size: 1.3em;
            font-weight: bold;
            color: var(--accent);
        }

        .stat-label {
            font-size: 0.85em;
            opacity: 0.8;
        }

        .main-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--border);
        }

        .main-tab {
            padding: 10px 20px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--fg);
            opacity: 0.7;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            font-size: 1em;
        }

        .main-tab:hover { opacity: 1; }
        .main-tab.active {
            opacity: 1;
            border-bottom-color: var(--accent);
        }

        .main-content { display: none; }
        .main-content.active { display: block; }

        /* Map View Styles */
        .map-container {
            position: relative;
            background: #1a1a2e;
            border: 1px solid var(--border);
            border-radius: 6px;
            overflow: hidden;
        }

        #mapCanvas {
            display: block;
            cursor: crosshair;
        }

        .map-controls {
            position: absolute;
            top: 10px;
            right: 10px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            z-index: 10;
        }

        .map-controls button {
            width: 32px;
            height: 32px;
            padding: 0;
            font-size: 18px;
            border-radius: 4px;
        }

        .map-info {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            z-index: 10;
        }

        .map-legend {
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 11px;
            z-index: 10;
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 4px 0;
        }

        .legend-color {
            width: 14px;
            height: 14px;
            border-radius: 2px;
        }

        .map-query-results {
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(0,0,0,0.85);
            padding: 12px;
            border-radius: 6px;
            max-width: 300px;
            max-height: 200px;
            overflow-y: auto;
            font-size: 12px;
            z-index: 10;
        }

        .map-query-results h4 {
            margin: 0 0 8px 0;
            color: #fff;
        }

        .map-result-item {
            padding: 4px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .map-result-item:last-child { border: none; }

        .filter-controls {
            display: flex;
            gap: 12px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        }

        .filter-controls label {
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }

        .filter-controls input[type="checkbox"] {
            width: 16px;
            height: 16px;
        }

        /* Query Section */
        .query-section {
            background: var(--input-bg);
            padding: 16px;
            border-radius: 6px;
            border: 1px solid var(--border);
            margin-bottom: 16px;
        }

        .query-form {
            display: flex;
            gap: 12px;
            align-items: flex-end;
            flex-wrap: wrap;
        }

        .input-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .input-group label {
            font-size: 0.85em;
            opacity: 0.8;
        }

        input[type="number"], input[type="text"] {
            background: var(--bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border, var(--border));
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 1em;
        }

        input[type="number"] { width: 120px; }

        input:focus {
            outline: 1px solid var(--accent);
            border-color: var(--accent);
        }

        button {
            background: var(--button-bg);
            color: var(--button-fg);
            border: none;
            padding: 8px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 1em;
        }

        button:hover { background: var(--button-hover); }

        .results { margin-top: 16px; }
        .results-header { font-weight: bold; margin-bottom: 8px; }

        .no-results {
            color: var(--vscode-errorForeground);
            padding: 12px;
            background: var(--input-bg);
            border-radius: 4px;
        }

        .boundary-card {
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 8px;
        }

        .boundary-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }

        .boundary-type {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 0.85em;
            font-weight: bold;
            text-transform: uppercase;
        }

        .type-circle { background: #3b82f6; color: white; }
        .type-rectangle { background: #10b981; color: white; }
        .type-polygon { background: #f59e0b; color: black; }
        .type-polyline { background: #8b5cf6; color: white; }

        .boundary-name { font-weight: bold; }

        .boundary-details {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 8px;
            font-size: 0.9em;
        }

        .detail-item { display: flex; flex-direction: column; }
        .detail-label { opacity: 0.7; font-size: 0.85em; }
        .detail-value { font-family: monospace; }

        .layer-path {
            font-size: 0.85em;
            opacity: 0.7;
            margin-top: 8px;
        }

        .boundary-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .sub-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--border);
        }

        .sub-tab {
            padding: 8px 16px;
            cursor: pointer;
            border: none;
            background: transparent;
            color: var(--fg);
            opacity: 0.7;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
        }

        .sub-tab:hover { opacity: 1; }
        .sub-tab.active {
            opacity: 1;
            border-bottom-color: var(--accent);
        }

        .sub-content { display: none; }
        .sub-content.active { display: block; }

        .search-box { margin-bottom: 12px; }
        .search-box input { width: 100%; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Terrain Viewer</h1>
        <div class="stats">
            <div class="stat">
                <div class="stat-value">${boundaries.length}</div>
                <div class="stat-label">Total Boundaries</div>
            </div>
            <div class="stat">
                <div class="stat-value">${counts.circle}</div>
                <div class="stat-label">Circles</div>
            </div>
            <div class="stat">
                <div class="stat-value">${counts.rectangle}</div>
                <div class="stat-label">Rectangles</div>
            </div>
            <div class="stat">
                <div class="stat-value">${counts.polygon}</div>
                <div class="stat-label">Polygons</div>
            </div>
            <div class="stat">
                <div class="stat-value">${counts.polyline}</div>
                <div class="stat-label">Polylines</div>
            </div>
        </div>
    </div>

    <div class="main-tabs">
        <button class="main-tab active" data-tab="mapView">Map View</button>
        <button class="main-tab" data-tab="treeView">Tree View</button>
        <button class="main-tab" data-tab="listView">List View</button>
        <button class="main-tab" data-tab="validateView">Validate</button>
    </div>

    <!-- MAP VIEW -->
    <div id="mapView" class="main-content active">
        <div class="map-layout">
            <div class="map-sidebar">
                <div class="sidebar-section">
                    <div class="sidebar-header" onclick="toggleSidebarSection('typeFilters')">
                        <span>▼</span> Type Filters
                    </div>
                    <div class="sidebar-content" id="typeFilters">
                        <label><input type="checkbox" id="showCircles" checked> Circles</label>
                        <label><input type="checkbox" id="showRectangles" checked> Rectangles</label>
                        <label><input type="checkbox" id="showPolygons" checked> Polygons</label>
                        <label><input type="checkbox" id="showPolylines" checked> Polylines</label>
                    </div>
                </div>
                <div class="sidebar-section">
                    <div class="sidebar-header" onclick="toggleSidebarSection('layerFilters')">
                        <span>▼</span> Layer Filters
                        <button class="small-btn" onclick="event.stopPropagation(); selectAllLayers(true)">All</button>
                        <button class="small-btn" onclick="event.stopPropagation(); selectAllLayers(false)">None</button>
                    </div>
                    <div class="sidebar-content" id="layerFilters">
                        <div id="layerList"></div>
                    </div>
                </div>
            </div>
            <div class="map-main">
                <div class="filter-controls">
                    <button id="resetView">Reset View</button>
                    <button id="fitBounds">Fit All</button>
                    <span id="visibleCount" style="margin-left:auto;opacity:0.7"></span>
                </div>
                <div class="map-container" style="height: 550px;">
            <canvas id="mapCanvas"></canvas>
            <div class="map-controls">
                <button id="zoomIn">+</button>
                <button id="zoomOut">-</button>
            </div>
            <div class="map-legend">
                <div class="legend-item"><div class="legend-color" style="background:#3b82f6"></div> Circle</div>
                <div class="legend-item"><div class="legend-color" style="background:#10b981"></div> Rectangle</div>
                <div class="legend-item"><div class="legend-color" style="background:#f59e0b"></div> Polygon</div>
                <div class="legend-item"><div class="legend-color" style="background:#8b5cf6"></div> Polyline</div>
                <div style="margin-top:8px;opacity:0.7">Click to query<br>Drag to pan<br>Scroll to zoom</div>
            </div>
            <div class="map-info" id="mapInfo">Coords: (0, 0)</div>
            <div class="map-query-results" id="mapQueryResults" style="display:none;"></div>
                </div>
            </div>
        </div>
    </div>

    <style>
        .map-layout {
            display: flex;
            gap: 12px;
        }
        .map-sidebar {
            width: 220px;
            flex-shrink: 0;
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            max-height: 600px;
            overflow-y: auto;
        }
        .map-main {
            flex: 1;
            min-width: 0;
        }
        .sidebar-section {
            border-bottom: 1px solid var(--border);
        }
        .sidebar-section:last-child {
            border-bottom: none;
        }
        .sidebar-header {
            padding: 10px 12px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            user-select: none;
        }
        .sidebar-header:hover {
            background: rgba(255,255,255,0.05);
        }
        .sidebar-header .small-btn {
            padding: 2px 8px;
            font-size: 0.75em;
            margin-left: auto;
        }
        .sidebar-content {
            padding: 8px 12px;
        }
        .sidebar-content.collapsed {
            display: none;
        }
        .sidebar-content label {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 0;
            cursor: pointer;
            font-size: 0.9em;
        }
        .sidebar-content label:hover {
            background: rgba(255,255,255,0.05);
        }
        #layerList {
            max-height: 350px;
            overflow-y: auto;
        }
        .layer-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 0;
            font-size: 0.85em;
        }
        .layer-item.depth-1 { padding-left: 12px; }
        .layer-item.depth-2 { padding-left: 24px; }
        .layer-item.depth-3 { padding-left: 36px; }
        .layer-count {
            opacity: 0.6;
            font-size: 0.8em;
            margin-left: auto;
        }
    </style>

    <!-- TREE VIEW -->
    <div id="treeView" class="main-content">
        <div class="tree-controls">
            <div class="search-row">
                <input type="text" id="treeSearch" placeholder="Search by name...">
                <input type="number" id="treeSearchX" placeholder="X coord" style="width:100px">
                <input type="number" id="treeSearchZ" placeholder="Z coord" style="width:100px">
                <button id="treeSearchBtn">Search</button>
                <button id="treeClearBtn">Clear</button>
            </div>
            <div class="filter-row">
                <label><input type="checkbox" id="filterBCIR" checked> BCIR</label>
                <label><input type="checkbox" id="filterBREC" checked> BREC</label>
                <label><input type="checkbox" id="filterBPOL" checked> BPOL</label>
                <label><input type="checkbox" id="filterBPLN" checked> BPLN</label>
                <label><input type="checkbox" id="filterLAYR" checked> LAYR</label>
                <label><input type="checkbox" id="filterErrors"> Errors Only</label>
                <button id="expandAll">Expand All</button>
                <button id="collapseAll">Collapse All</button>
            </div>
        </div>
        <div class="tree-container" id="treeContainer"></div>
    </div>

    <style>
        .tree-controls {
            background: var(--input-bg);
            padding: 12px;
            border-radius: 6px;
            border: 1px solid var(--border);
            margin-bottom: 12px;
        }
        .search-row, .filter-row {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
        }
        .filter-row { margin-top: 8px; }
        .filter-row label {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 0.9em;
        }
        .tree-container {
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 8px;
            max-height: 600px;
            overflow: auto;
            font-family: monospace;
            font-size: 13px;
        }
        .tree-node {
            padding: 2px 0;
        }
        .tree-node-header {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 3px 6px;
            border-radius: 3px;
            cursor: pointer;
        }
        .tree-node-header:hover {
            background: rgba(255,255,255,0.1);
        }
        .tree-node-header.selected {
            background: var(--accent);
            color: var(--button-fg);
        }
        .tree-node-header.has-error {
            background: rgba(239, 68, 68, 0.2);
            border-left: 3px solid #ef4444;
        }
        .tree-node-header.search-match {
            background: rgba(245, 158, 11, 0.3);
        }
        .tree-toggle {
            width: 16px;
            text-align: center;
            color: var(--accent);
        }
        .tree-icon {
            width: 20px;
            text-align: center;
        }
        .tree-type {
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 0.8em;
            font-weight: bold;
        }
        .tree-type.boundary { background: #3b82f6; color: white; }
        .tree-type.layer { background: #10b981; color: white; }
        .tree-type.group { background: #8b5cf6; color: white; }
        .tree-type.affector { background: #f59e0b; color: black; }
        .tree-type.filter { background: #ec4899; color: white; }
        .tree-type.data { background: #6b7280; color: white; }
        .tree-name {
            flex: 1;
        }
        .tree-info {
            font-size: 0.85em;
            opacity: 0.7;
        }
        .tree-children {
            margin-left: 20px;
            border-left: 1px dashed rgba(255,255,255,0.2);
            padding-left: 8px;
        }
        .tree-children.collapsed {
            display: none;
        }
        .node-details {
            background: var(--bg);
            padding: 8px 12px;
            margin: 4px 0 4px 28px;
            border-radius: 4px;
            font-size: 0.9em;
        }
        .node-details-row {
            display: flex;
            gap: 16px;
        }
        .node-details-item {
            display: flex;
            gap: 4px;
        }
        .node-details-label {
            opacity: 0.7;
        }
    </style>

    <!-- LIST VIEW -->
    <div id="listView" class="main-content">
        <div class="query-section">
            <h2>Query Coordinates</h2>
            <p style="opacity: 0.8; margin: 0 0 12px 0;">Enter world coordinates to find boundaries.</p>
            <div class="query-form">
                <div class="input-group">
                    <label for="coordX">X Coordinate</label>
                    <input type="number" id="coordX" placeholder="-2500" step="any">
                </div>
                <div class="input-group">
                    <label for="coordZ">Z Coordinate</label>
                    <input type="number" id="coordZ" placeholder="4500" step="any">
                </div>
                <button id="queryBtn">Find Boundaries</button>
            </div>
            <div id="queryResults" class="results"></div>
        </div>

        <div class="sub-tabs">
            <button class="sub-tab active" data-subtab="circles">Circles (${counts.circle})</button>
            <button class="sub-tab" data-subtab="rectangles">Rectangles (${counts.rectangle})</button>
            <button class="sub-tab" data-subtab="polygons">Polygons (${counts.polygon})</button>
            <button class="sub-tab" data-subtab="polylines">Polylines (${counts.polyline})</button>
        </div>

        <div id="circles" class="sub-content active">
            <div class="search-box"><input type="text" id="searchCircles" placeholder="Search circles..."></div>
            <div class="boundary-list" id="circlesList">${this.renderBoundariesByType(boundaries, 'circle')}</div>
        </div>
        <div id="rectangles" class="sub-content">
            <div class="search-box"><input type="text" id="searchRectangles" placeholder="Search rectangles..."></div>
            <div class="boundary-list" id="rectanglesList">${this.renderBoundariesByType(boundaries, 'rectangle')}</div>
        </div>
        <div id="polygons" class="sub-content">
            <div class="search-box"><input type="text" id="searchPolygons" placeholder="Search polygons..."></div>
            <div class="boundary-list" id="polygonsList">${this.renderBoundariesByType(boundaries, 'polygon')}</div>
        </div>
        <div id="polylines" class="sub-content">
            <div class="search-box"><input type="text" id="searchPolylines" placeholder="Search polylines..."></div>
            <div class="boundary-list" id="polylinesList">${this.renderBoundariesByType(boundaries, 'polyline')}</div>
        </div>
    </div>

    <!-- VALIDATE VIEW -->
    <div id="validateView" class="main-content">
        <div class="query-section">
            <h2>Validate TRN File</h2>
            <p style="opacity: 0.8; margin: 0 0 12px 0;">Check for common errors and issues in boundary definitions.</p>
            <button id="validateBtn" style="font-size: 1.1em; padding: 10px 24px;">Run Validation</button>
        </div>
        <div id="validationResults" style="display:none;">
            <div id="validationSummary" class="validation-summary"></div>
            <div id="validationIssues"></div>
        </div>
    </div>

    <style>
        .validation-summary {
            display: flex;
            gap: 16px;
            margin-bottom: 16px;
            flex-wrap: wrap;
        }
        .validation-stat {
            padding: 12px 20px;
            border-radius: 6px;
            font-weight: bold;
        }
        .validation-stat.errors {
            background: rgba(239, 68, 68, 0.2);
            border: 1px solid #ef4444;
            color: #ef4444;
        }
        .validation-stat.warnings {
            background: rgba(245, 158, 11, 0.2);
            border: 1px solid #f59e0b;
            color: #f59e0b;
        }
        .validation-stat.info {
            background: rgba(59, 130, 246, 0.2);
            border: 1px solid #3b82f6;
            color: #3b82f6;
        }
        .validation-stat.success {
            background: rgba(16, 185, 129, 0.2);
            border: 1px solid #10b981;
            color: #10b981;
        }
        .issue-card {
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 8px;
            border-left: 4px solid;
        }
        .issue-card.error { border-left-color: #ef4444; }
        .issue-card.warning { border-left-color: #f59e0b; }
        .issue-card.info { border-left-color: #3b82f6; }
        .issue-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }
        .issue-severity {
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 0.75em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .issue-severity.error { background: #ef4444; color: white; }
        .issue-severity.warning { background: #f59e0b; color: black; }
        .issue-severity.info { background: #3b82f6; color: white; }
        .issue-message { font-weight: bold; }
        .issue-details {
            font-size: 0.9em;
            opacity: 0.8;
            margin-top: 4px;
            font-family: monospace;
        }
        .issue-location {
            font-size: 0.85em;
            opacity: 0.7;
        }
    </style>

    <script>
        const vscode = acquireVsCodeApi();
        const boundaries = ${boundariesJson};
        const treeData = ${treeJson};
        const layerHierarchy = ${layersJson};
        const boundaryLayerMap = ${boundaryLayerMapJson};

        // Layer visibility state
        const visibleLayers = new Set();
        layerHierarchy.forEach(l => visibleLayers.add(l.node.id));

        // Colors for each type
        const colors = {
            circle: '#3b82f6',
            rectangle: '#10b981',
            polygon: '#f59e0b',
            polyline: '#8b5cf6'
        };

        // Map state
        let canvas, ctx;
        let viewX = 0, viewZ = 0;  // Center of view in world coords
        let zoom = 0.05;           // Pixels per world unit
        let isDragging = false;
        let lastMouseX, lastMouseY;
        let queryPoint = null;
        let queryResults = [];

        // Visibility filters
        const filters = {
            circle: true,
            rectangle: true,
            polygon: true,
            polyline: true
        };

        // Initialize map
        function initMap() {
            canvas = document.getElementById('mapCanvas');
            ctx = canvas.getContext('2d');
            resizeCanvas();
            window.addEventListener('resize', resizeCanvas);

            // Mouse events
            canvas.addEventListener('mousedown', onMouseDown);
            canvas.addEventListener('mousemove', onMouseMove);
            canvas.addEventListener('mouseup', onMouseUp);
            canvas.addEventListener('mouseleave', onMouseUp);
            canvas.addEventListener('wheel', onWheel);
            canvas.addEventListener('click', onClick);

            // Controls
            document.getElementById('zoomIn').addEventListener('click', () => { zoom *= 1.5; render(); });
            document.getElementById('zoomOut').addEventListener('click', () => { zoom /= 1.5; render(); });
            document.getElementById('resetView').addEventListener('click', resetView);
            document.getElementById('fitBounds').addEventListener('click', fitAllBounds);

            // Filters
            ['Circles', 'Rectangles', 'Polygons', 'Polylines'].forEach(type => {
                const checkbox = document.getElementById('show' + type);
                checkbox.addEventListener('change', () => {
                    filters[type.toLowerCase().slice(0, -1)] = checkbox.checked;
                    updateVisibleCount();
                    render();
                });
            });

            fitAllBounds();
            initLayerList();
        }

        function initLayerList() {
            const container = document.getElementById('layerList');
            if (layerHierarchy.length === 0) {
                container.innerHTML = '<div style="opacity:0.6;padding:4px">No layers found</div>';
                return;
            }

            let html = '';
            layerHierarchy.forEach(layer => {
                const depthClass = 'depth-' + Math.min(layer.depth, 3);
                html += '<div class="layer-item ' + depthClass + '">';
                html += '<input type="checkbox" id="layer_' + layer.node.id + '" checked onchange="toggleLayer(\\'' + layer.node.id + '\\')">';
                html += '<label for="layer_' + layer.node.id + '" style="flex:1;cursor:pointer">' + escapeHtml(layer.name) + '</label>';
                html += '<span class="layer-count">' + layer.boundaryCount + '</span>';
                html += '</div>';
            });
            container.innerHTML = html;
            updateVisibleCount();
        }

        window.toggleLayer = function(layerId) {
            if (visibleLayers.has(layerId)) {
                visibleLayers.delete(layerId);
            } else {
                visibleLayers.add(layerId);
            }
            updateVisibleCount();
            render();
        };

        window.selectAllLayers = function(selectAll) {
            visibleLayers.clear();
            if (selectAll) {
                layerHierarchy.forEach(l => visibleLayers.add(l.node.id));
            }
            // Update checkboxes
            layerHierarchy.forEach(l => {
                const checkbox = document.getElementById('layer_' + l.node.id);
                if (checkbox) checkbox.checked = selectAll;
            });
            updateVisibleCount();
            render();
        };

        window.toggleSidebarSection = function(sectionId) {
            const content = document.getElementById(sectionId);
            content.classList.toggle('collapsed');
            const header = content.previousElementSibling;
            const arrow = header.querySelector('span');
            arrow.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
        };

        function updateVisibleCount() {
            let count = 0;
            boundaries.forEach((b, i) => {
                if (isBoundaryVisible(b, i)) count++;
            });
            document.getElementById('visibleCount').textContent = count + ' / ' + boundaries.length + ' visible';
        }

        function isBoundaryVisible(boundary, index) {
            // Check type filter
            if (!filters[boundary.type]) return false;

            // Check layer filter - find which layer this boundary belongs to
            // Use the boundary's offset to match with tree nodes
            const layerId = findBoundaryLayer(boundary, index);
            if (layerId && !visibleLayers.has(layerId)) return false;

            return true;
        }

        function findBoundaryLayer(boundary, index) {
            // Try to match by offset if available
            if (boundary.offset !== undefined && boundaryLayerMap[boundary.offset]) {
                return boundaryLayerMap[boundary.offset];
            }
            // Fallback: if no offset, show the boundary (not filtered by layer)
            return null;
        }

        function escapeHtml(str) {
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function resizeCanvas() {
            const container = canvas.parentElement;
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            render();
        }

        function resetView() {
            viewX = 0;
            viewZ = 0;
            zoom = 0.05;
            render();
        }

        function fitAllBounds() {
            if (boundaries.length === 0) {
                resetView();
                return;
            }

            let minX = Infinity, maxX = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;

            boundaries.forEach(b => {
                if (b.type === 'circle') {
                    minX = Math.min(minX, b.centerX - b.radius);
                    maxX = Math.max(maxX, b.centerX + b.radius);
                    minZ = Math.min(minZ, b.centerZ - b.radius);
                    maxZ = Math.max(maxZ, b.centerZ + b.radius);
                } else if (b.type === 'rectangle') {
                    minX = Math.min(minX, b.x1, b.x2);
                    maxX = Math.max(maxX, b.x1, b.x2);
                    minZ = Math.min(minZ, b.z1, b.z2);
                    maxZ = Math.max(maxZ, b.z1, b.z2);
                } else if (b.vertices && b.vertices.length > 0) {
                    b.vertices.forEach(v => {
                        minX = Math.min(minX, v.x);
                        maxX = Math.max(maxX, v.x);
                        minZ = Math.min(minZ, v.z);
                        maxZ = Math.max(maxZ, v.z);
                    });
                }
            });

            if (minX === Infinity) {
                resetView();
                return;
            }

            viewX = (minX + maxX) / 2;
            viewZ = (minZ + maxZ) / 2;

            const rangeX = maxX - minX;
            const rangeZ = maxZ - minZ;
            const padding = 1.1;

            zoom = Math.min(
                canvas.width / (rangeX * padding),
                canvas.height / (rangeZ * padding)
            );

            render();
        }

        // Coordinate transforms
        function worldToScreen(wx, wz) {
            const sx = canvas.width / 2 + (wx - viewX) * zoom;
            const sy = canvas.height / 2 - (wz - viewZ) * zoom;  // Flip Z for screen
            return { x: sx, y: sy };
        }

        function screenToWorld(sx, sy) {
            const wx = viewX + (sx - canvas.width / 2) / zoom;
            const wz = viewZ - (sy - canvas.height / 2) / zoom;  // Flip Z
            return { x: wx, z: wz };
        }

        // Rendering
        function render() {
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw grid
            drawGrid();

            // Draw boundaries
            boundaries.forEach((b, index) => {
                if (!isBoundaryVisible(b, index)) return;

                const isHighlighted = queryResults.includes(b);
                const alpha = isHighlighted ? 0.8 : 0.3;
                const color = colors[b.type];

                ctx.strokeStyle = color;
                ctx.fillStyle = color.replace(')', ', ' + alpha + ')').replace('rgb', 'rgba').replace('#', '');
                // Convert hex to rgba
                const r = parseInt(color.slice(1,3), 16);
                const g = parseInt(color.slice(3,5), 16);
                const b2 = parseInt(color.slice(5,7), 16);
                ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b2 + ',' + alpha + ')';
                ctx.lineWidth = isHighlighted ? 2 : 1;

                if (b.type === 'circle') {
                    drawCircle(b);
                } else if (b.type === 'rectangle') {
                    drawRectangle(b);
                } else if (b.type === 'polygon') {
                    drawPolygon(b);
                } else if (b.type === 'polyline') {
                    drawPolyline(b);
                }
            });

            // Draw query point
            if (queryPoint) {
                const sp = worldToScreen(queryPoint.x, queryPoint.z);
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        }

        function drawGrid() {
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;

            // Calculate grid spacing based on zoom
            let gridSize = 1000;
            if (zoom > 0.1) gridSize = 500;
            if (zoom > 0.2) gridSize = 250;
            if (zoom > 0.5) gridSize = 100;
            if (zoom > 1) gridSize = 50;

            const topLeft = screenToWorld(0, 0);
            const bottomRight = screenToWorld(canvas.width, canvas.height);

            const startX = Math.floor(topLeft.x / gridSize) * gridSize;
            const endX = Math.ceil(bottomRight.x / gridSize) * gridSize;
            const startZ = Math.floor(bottomRight.z / gridSize) * gridSize;
            const endZ = Math.ceil(topLeft.z / gridSize) * gridSize;

            ctx.beginPath();
            for (let x = startX; x <= endX; x += gridSize) {
                const sp = worldToScreen(x, 0);
                ctx.moveTo(sp.x, 0);
                ctx.lineTo(sp.x, canvas.height);
            }
            for (let z = startZ; z <= endZ; z += gridSize) {
                const sp = worldToScreen(0, z);
                ctx.moveTo(0, sp.y);
                ctx.lineTo(canvas.width, sp.y);
            }
            ctx.stroke();

            // Draw origin axes
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 2;
            const origin = worldToScreen(0, 0);
            ctx.beginPath();
            ctx.moveTo(origin.x, 0);
            ctx.lineTo(origin.x, canvas.height);
            ctx.moveTo(0, origin.y);
            ctx.lineTo(canvas.width, origin.y);
            ctx.stroke();
        }

        function drawCircle(b) {
            const center = worldToScreen(b.centerX, b.centerZ);
            const radiusPixels = b.radius * zoom;
            ctx.beginPath();
            ctx.arc(center.x, center.y, radiusPixels, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        function drawRectangle(b) {
            const p1 = worldToScreen(b.x1, b.z1);
            const p2 = worldToScreen(b.x2, b.z2);
            const x = Math.min(p1.x, p2.x);
            const y = Math.min(p1.y, p2.y);
            const w = Math.abs(p2.x - p1.x);
            const h = Math.abs(p2.y - p1.y);
            ctx.fillRect(x, y, w, h);
            ctx.strokeRect(x, y, w, h);
        }

        function drawPolygon(b) {
            if (b.vertices.length < 3) return;
            ctx.beginPath();
            const first = worldToScreen(b.vertices[0].x, b.vertices[0].z);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < b.vertices.length; i++) {
                const p = worldToScreen(b.vertices[i].x, b.vertices[i].z);
                ctx.lineTo(p.x, p.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        function drawPolyline(b) {
            if (b.vertices.length < 2) return;
            ctx.lineWidth = Math.max(2, b.width * zoom);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const first = worldToScreen(b.vertices[0].x, b.vertices[0].z);
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < b.vertices.length; i++) {
                const p = worldToScreen(b.vertices[i].x, b.vertices[i].z);
                ctx.lineTo(p.x, p.y);
            }
            ctx.stroke();
        }

        // Mouse handlers
        function onMouseDown(e) {
            isDragging = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
        }

        function onMouseMove(e) {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const world = screenToWorld(mx, my);

            document.getElementById('mapInfo').textContent =
                'Coords: (' + world.x.toFixed(1) + ', ' + world.z.toFixed(1) + ')';

            if (isDragging) {
                const dx = e.clientX - lastMouseX;
                const dy = e.clientY - lastMouseY;
                viewX -= dx / zoom;
                viewZ += dy / zoom;  // Flip for screen coords
                lastMouseX = e.clientX;
                lastMouseY = e.clientY;
                render();
            }
        }

        function onMouseUp() {
            isDragging = false;
        }

        function onWheel(e) {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            zoom *= factor;
            zoom = Math.max(0.001, Math.min(10, zoom));
            render();
        }

        function onClick(e) {
            if (isDragging) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const world = screenToWorld(mx, my);

            queryPoint = { x: world.x, z: world.z };
            queryResults = findBoundariesAtPoint(world.x, world.z);
            render();
            showMapQueryResults(world.x, world.z, queryResults);
        }

        // Point-in-boundary tests
        function findBoundariesAtPoint(x, z) {
            return boundaries.filter((b, index) => {
                if (!isBoundaryVisible(b, index)) return false;
                if (b.type === 'circle') {
                    const dx = x - b.centerX;
                    const dz = z - b.centerZ;
                    return dx*dx + dz*dz <= b.radius*b.radius;
                } else if (b.type === 'rectangle') {
                    return x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2;
                } else if (b.type === 'polygon' && b.vertices.length >= 3) {
                    return pointInPolygon(x, z, b.vertices);
                } else if (b.type === 'polyline') {
                    return pointNearPolyline(x, z, b);
                }
                return false;
            });
        }

        function pointInPolygon(x, z, vertices) {
            let inside = false;
            for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
                const xi = vertices[i].x, zi = vertices[i].z;
                const xj = vertices[j].x, zj = vertices[j].z;
                if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        function pointNearPolyline(x, z, b) {
            const halfWidth = b.width / 2;
            for (let i = 0; i < b.vertices.length - 1; i++) {
                const dist = pointToSegmentDist(x, z, b.vertices[i], b.vertices[i+1]);
                if (dist <= halfWidth) return true;
            }
            return false;
        }

        function pointToSegmentDist(px, pz, v1, v2) {
            const dx = v2.x - v1.x;
            const dz = v2.z - v1.z;
            const lengthSq = dx*dx + dz*dz;
            if (lengthSq === 0) return Math.sqrt((px-v1.x)**2 + (pz-v1.z)**2);
            let t = ((px - v1.x) * dx + (pz - v1.z) * dz) / lengthSq;
            t = Math.max(0, Math.min(1, t));
            const nearX = v1.x + t * dx;
            const nearZ = v1.z + t * dz;
            return Math.sqrt((px - nearX)**2 + (pz - nearZ)**2);
        }

        function showMapQueryResults(x, z, results) {
            const div = document.getElementById('mapQueryResults');
            if (results.length === 0) {
                div.innerHTML = '<h4>Query: (' + x.toFixed(1) + ', ' + z.toFixed(1) + ')</h4><p>No boundaries found</p>';
            } else {
                let html = '<h4>' + results.length + ' at (' + x.toFixed(1) + ', ' + z.toFixed(1) + ')</h4>';
                results.forEach(b => {
                    html += '<div class="map-result-item"><span class="boundary-type type-' + b.type + '" style="font-size:10px">' + b.type + '</span> ';
                    if (b.type === 'circle') {
                        html += 'R=' + b.radius.toFixed(0);
                    } else if (b.type === 'rectangle') {
                        html += (b.x2-b.x1).toFixed(0) + 'x' + (b.z2-b.z1).toFixed(0);
                    } else if (b.type === 'polygon') {
                        html += b.vertices.length + ' verts';
                    }
                    html += '</div>';
                });
            }
            div.innerHTML = html;
            div.style.display = 'block';
        }

        // Main tabs
        document.querySelectorAll('.main-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.main-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab).classList.add('active');
                if (tab.dataset.tab === 'mapView') {
                    setTimeout(resizeCanvas, 10);
                }
            });
        });

        // Sub tabs
        document.querySelectorAll('.sub-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.sub-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.subtab).classList.add('active');
            });
        });

        // Query button
        document.getElementById('queryBtn').addEventListener('click', () => {
            const x = document.getElementById('coordX').value;
            const z = document.getElementById('coordZ').value;
            if (x && z) {
                vscode.postMessage({ type: 'query', x, z });
            }
        });

        ['coordX', 'coordZ'].forEach(id => {
            document.getElementById(id).addEventListener('keypress', (e) => {
                if (e.key === 'Enter') document.getElementById('queryBtn').click();
            });
        });

        // Search
        function setupSearch(inputId, listId) {
            const input = document.getElementById(inputId);
            const list = document.getElementById(listId);
            const cards = list.querySelectorAll('.boundary-card');
            input.addEventListener('input', () => {
                const query = input.value.toLowerCase();
                cards.forEach(card => {
                    card.style.display = card.textContent.toLowerCase().includes(query) ? 'block' : 'none';
                });
            });
        }

        setupSearch('searchCircles', 'circlesList');
        setupSearch('searchRectangles', 'rectanglesList');
        setupSearch('searchPolygons', 'polygonsList');
        setupSearch('searchPolylines', 'polylinesList');

        // Validation button
        document.getElementById('validateBtn').addEventListener('click', () => {
            document.getElementById('validateBtn').textContent = 'Validating...';
            document.getElementById('validateBtn').disabled = true;
            vscode.postMessage({ type: 'validate' });
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'queryResults') {
                const resultsDiv = document.getElementById('queryResults');
                const bs = message.boundaries;
                if (bs.length === 0) {
                    resultsDiv.innerHTML = '<div class="results-header">Results for (' + message.x + ', ' + message.z + ')</div><div class="no-results">No boundaries found.</div>';
                } else {
                    resultsDiv.innerHTML = '<div class="results-header">Found ' + bs.length + ' at (' + message.x + ', ' + message.z + ')</div>' + bs.map(renderBoundaryCard).join('');
                }
            } else if (message.type === 'validationResults') {
                showValidationResults(message);
            }
        });

        function showValidationResults(result) {
            document.getElementById('validateBtn').textContent = 'Run Validation';
            document.getElementById('validateBtn').disabled = false;

            const container = document.getElementById('validationResults');
            const summary = document.getElementById('validationSummary');
            const issues = document.getElementById('validationIssues');

            container.style.display = 'block';

            // Summary
            if (result.stats.errors === 0 && result.stats.warnings === 0 && result.stats.info === 0) {
                summary.innerHTML = '<div class="validation-stat success">No issues found - TRN file looks valid!</div>';
                issues.innerHTML = '';
            } else {
                let summaryHtml = '';
                if (result.stats.errors > 0) {
                    summaryHtml += '<div class="validation-stat errors">' + result.stats.errors + ' Error' + (result.stats.errors > 1 ? 's' : '') + '</div>';
                }
                if (result.stats.warnings > 0) {
                    summaryHtml += '<div class="validation-stat warnings">' + result.stats.warnings + ' Warning' + (result.stats.warnings > 1 ? 's' : '') + '</div>';
                }
                if (result.stats.info > 0) {
                    summaryHtml += '<div class="validation-stat info">' + result.stats.info + ' Info</div>';
                }
                summary.innerHTML = summaryHtml;

                // Issues list
                let issuesHtml = '';
                result.issues.forEach(issue => {
                    issuesHtml += '<div class="issue-card ' + issue.severity + '">';
                    issuesHtml += '<div class="issue-header">';
                    issuesHtml += '<span class="issue-message">' + issue.message + '</span>';
                    issuesHtml += '<span class="issue-severity ' + issue.severity + '">' + issue.severity + '</span>';
                    issuesHtml += '</div>';
                    issuesHtml += '<div class="issue-location">' + issue.boundaryType + ' #' + issue.boundaryIndex + '</div>';
                    if (issue.details) {
                        issuesHtml += '<div class="issue-details">' + issue.details + '</div>';
                    }
                    issuesHtml += '</div>';
                });
                issues.innerHTML = issuesHtml;
            }
        }

        function renderBoundaryCard(b) {
            let details = '';
            if (b.type === 'circle') {
                details = '<div class="detail-item"><span class="detail-label">Center</span><span class="detail-value">(' + b.centerX.toFixed(1) + ', ' + b.centerZ.toFixed(1) + ')</span></div><div class="detail-item"><span class="detail-label">Radius</span><span class="detail-value">' + b.radius.toFixed(1) + '</span></div>';
            } else if (b.type === 'rectangle') {
                details = '<div class="detail-item"><span class="detail-label">Min</span><span class="detail-value">(' + b.x1.toFixed(1) + ', ' + b.z1.toFixed(1) + ')</span></div><div class="detail-item"><span class="detail-label">Max</span><span class="detail-value">(' + b.x2.toFixed(1) + ', ' + b.z2.toFixed(1) + ')</span></div>';
            } else if (b.type === 'polygon') {
                details = '<div class="detail-item"><span class="detail-label">Vertices</span><span class="detail-value">' + b.vertices.length + '</span></div>';
            } else if (b.type === 'polyline') {
                details = '<div class="detail-item"><span class="detail-label">Vertices</span><span class="detail-value">' + b.vertices.length + '</span></div><div class="detail-item"><span class="detail-label">Width</span><span class="detail-value">' + b.width.toFixed(1) + '</span></div>';
            }
            return '<div class="boundary-card"><div class="boundary-header"><span class="boundary-name">' + b.name + '</span><span class="boundary-type type-' + b.type + '">' + b.type + '</span></div><div class="boundary-details">' + details + '</div></div>';
        }

        // === TREE VIEW ===
        let selectedNode = null;
        let expandedNodes = new Set();
        let searchMatches = new Set();

        function initTreeView() {
            renderTree();

            // Search button
            document.getElementById('treeSearchBtn').addEventListener('click', performTreeSearch);
            document.getElementById('treeClearBtn').addEventListener('click', clearTreeSearch);
            document.getElementById('treeSearch').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') performTreeSearch();
            });

            // Filter checkboxes
            ['filterBCIR', 'filterBREC', 'filterBPOL', 'filterBPLN', 'filterLAYR', 'filterErrors'].forEach(id => {
                document.getElementById(id).addEventListener('change', renderTree);
            });

            // Expand/collapse all
            document.getElementById('expandAll').addEventListener('click', () => {
                expandAllNodes(treeData.root);
                renderTree();
            });
            document.getElementById('collapseAll').addEventListener('click', () => {
                expandedNodes.clear();
                renderTree();
            });
        }

        function expandAllNodes(node) {
            if (node.children && node.children.length > 0) {
                expandedNodes.add(node.id);
                node.children.forEach(expandAllNodes);
            }
        }

        function getNodeTypeClass(type) {
            if (['BCIR', 'BREC', 'BPOL', 'BPLN'].includes(type)) return 'boundary';
            if (type === 'LAYR') return 'layer';
            if (['SGRP', 'FGRP', 'RGRP', 'EGRP', 'MGRP', 'TGEN', 'LYRS'].includes(type)) return 'group';
            if (type.startsWith('A') && type !== 'ADTA') return 'affector';
            if (type.startsWith('F') && type.length === 4) return 'filter';
            return 'data';
        }

        function shouldShowNode(node) {
            const filters = {
                BCIR: document.getElementById('filterBCIR').checked,
                BREC: document.getElementById('filterBREC').checked,
                BPOL: document.getElementById('filterBPOL').checked,
                BPLN: document.getElementById('filterBPLN').checked,
                LAYR: document.getElementById('filterLAYR').checked
            };
            const errorsOnly = document.getElementById('filterErrors').checked;

            // If filtering by errors, only show nodes with errors or their ancestors
            if (errorsOnly && !node.hasError && !hasErrorDescendant(node)) {
                return false;
            }

            // Don't filter out container nodes
            if (['PTAT', 'TGEN', 'LYRS', 'SGRP', 'FGRP', 'RGRP', 'EGRP', 'MGRP'].includes(node.type)) {
                return true;
            }

            // Check type filters for boundaries and layers
            if (filters[node.type] === false) {
                return false;
            }

            return true;
        }

        function hasErrorDescendant(node) {
            if (node.hasError) return true;
            return node.children && node.children.some(hasErrorDescendant);
        }

        function renderTree() {
            const container = document.getElementById('treeContainer');
            container.innerHTML = renderNode(treeData.root, 0);
        }

        function renderNode(node, depth) {
            if (!shouldShowNode(node)) return '';

            const hasChildren = node.children && node.children.length > 0;
            const isExpanded = expandedNodes.has(node.id);
            const isMatch = searchMatches.has(node.id);
            const typeClass = getNodeTypeClass(node.type);

            let html = '<div class="tree-node" data-id="' + node.id + '">';
            html += '<div class="tree-node-header';
            if (selectedNode === node.id) html += ' selected';
            if (node.hasError) html += ' has-error';
            if (isMatch) html += ' search-match';
            html += '" onclick="selectNode(\\'' + node.id + '\\')">';

            // Toggle
            if (hasChildren) {
                html += '<span class="tree-toggle" onclick="event.stopPropagation(); toggleNode(\\'' + node.id + '\\')">' + (isExpanded ? '▼' : '▶') + '</span>';
            } else {
                html += '<span class="tree-toggle"></span>';
            }

            // Type badge
            html += '<span class="tree-type ' + typeClass + '">' + node.type + '</span>';

            // Name
            html += '<span class="tree-name">' + escapeHtml(node.name) + '</span>';

            // Info (for boundaries)
            if (node.data) {
                if (node.type === 'BCIR' && node.data.centerX !== undefined) {
                    html += '<span class="tree-info">(' + node.data.centerX.toFixed(0) + ', ' + node.data.centerZ.toFixed(0) + ') R=' + node.data.radius.toFixed(0) + '</span>';
                } else if (node.type === 'BREC' && node.data.x1 !== undefined) {
                    html += '<span class="tree-info">[' + node.data.x1.toFixed(0) + ',' + node.data.z1.toFixed(0) + ' to ' + node.data.x2.toFixed(0) + ',' + node.data.z2.toFixed(0) + ']</span>';
                } else if ((node.type === 'BPOL' || node.type === 'BPLN') && node.data.vertexCount !== undefined) {
                    html += '<span class="tree-info">' + node.data.vertexCount + ' vertices</span>';
                }
            }

            // Error indicator
            if (node.hasError) {
                html += '<span style="color:#ef4444;margin-left:8px" title="' + escapeHtml(node.errorMessage || '') + '">⚠</span>';
            }

            html += '</div>';

            // Children
            if (hasChildren) {
                html += '<div class="tree-children' + (isExpanded ? '' : ' collapsed') + '">';
                for (const child of node.children) {
                    html += renderNode(child, depth + 1);
                }
                html += '</div>';
            }

            html += '</div>';
            return html;
        }

        function escapeHtml(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        window.toggleNode = function(nodeId) {
            if (expandedNodes.has(nodeId)) {
                expandedNodes.delete(nodeId);
            } else {
                expandedNodes.add(nodeId);
            }
            renderTree();
        };

        window.selectNode = function(nodeId) {
            selectedNode = nodeId;
            renderTree();
            // Could show details panel here
        };

        function performTreeSearch() {
            const text = document.getElementById('treeSearch').value.toLowerCase();
            const x = parseFloat(document.getElementById('treeSearchX').value);
            const z = parseFloat(document.getElementById('treeSearchZ').value);

            searchMatches.clear();
            expandedNodes.clear();

            function searchNode(node, ancestors) {
                let matches = false;

                // Text search
                if (text && (node.type.toLowerCase().includes(text) || node.name.toLowerCase().includes(text))) {
                    matches = true;
                }

                // Coordinate search
                if (!isNaN(x) && !isNaN(z)) {
                    if (nodeContainsPoint(node, x, z)) {
                        matches = true;
                    }
                }

                if (matches) {
                    searchMatches.add(node.id);
                    // Expand ancestors
                    ancestors.forEach(a => expandedNodes.add(a.id));
                }

                // Search children
                if (node.children) {
                    node.children.forEach(child => searchNode(child, [...ancestors, node]));
                }
            }

            if (text || (!isNaN(x) && !isNaN(z))) {
                searchNode(treeData.root, []);
            }

            renderTree();
        }

        function nodeContainsPoint(node, x, z) {
            if (!node.data) return false;
            if (node.type === 'BCIR' && node.data.centerX !== undefined) {
                const dx = x - node.data.centerX;
                const dz = z - node.data.centerZ;
                return dx*dx + dz*dz <= node.data.radius * node.data.radius;
            } else if (node.type === 'BREC' && node.data.x1 !== undefined) {
                const x1 = Math.min(node.data.x1, node.data.x2);
                const x2 = Math.max(node.data.x1, node.data.x2);
                const z1 = Math.min(node.data.z1, node.data.z2);
                const z2 = Math.max(node.data.z1, node.data.z2);
                return x >= x1 && x <= x2 && z >= z1 && z <= z2;
            }
            return false;
        }

        function clearTreeSearch() {
            document.getElementById('treeSearch').value = '';
            document.getElementById('treeSearchX').value = '';
            document.getElementById('treeSearchZ').value = '';
            searchMatches.clear();
            renderTree();
        }

        // Init
        initMap();
        initTreeView();
    </script>
</body>
</html>`;
    }

    private renderBoundariesByType(boundaries: Boundary[], type: string): string {
        const filtered = boundaries.filter(b => b.type === type);
        if (filtered.length === 0) {
            return '<div style="opacity: 0.6; padding: 12px;">No boundaries of this type.</div>';
        }
        return filtered.map(b => this.renderBoundaryCard(b)).join('');
    }

    private renderBoundaryCard(b: Boundary): string {
        let details = '';
        switch (b.type) {
            case 'circle':
                details = `
                    <div class="detail-item"><span class="detail-label">Center X</span><span class="detail-value">${b.centerX.toFixed(2)}</span></div>
                    <div class="detail-item"><span class="detail-label">Center Z</span><span class="detail-value">${b.centerZ.toFixed(2)}</span></div>
                    <div class="detail-item"><span class="detail-label">Radius</span><span class="detail-value">${b.radius.toFixed(2)}</span></div>
                `;
                break;
            case 'rectangle':
                details = `
                    <div class="detail-item"><span class="detail-label">X1</span><span class="detail-value">${b.x1.toFixed(2)}</span></div>
                    <div class="detail-item"><span class="detail-label">Z1</span><span class="detail-value">${b.z1.toFixed(2)}</span></div>
                    <div class="detail-item"><span class="detail-label">X2</span><span class="detail-value">${b.x2.toFixed(2)}</span></div>
                    <div class="detail-item"><span class="detail-label">Z2</span><span class="detail-value">${b.z2.toFixed(2)}</span></div>
                `;
                break;
            case 'polygon':
                details = `<div class="detail-item"><span class="detail-label">Vertices</span><span class="detail-value">${b.vertices.length}</span></div>`;
                break;
            case 'polyline':
                details = `
                    <div class="detail-item"><span class="detail-label">Vertices</span><span class="detail-value">${b.vertices.length}</span></div>
                    <div class="detail-item"><span class="detail-label">Width</span><span class="detail-value">${b.width.toFixed(2)}</span></div>
                `;
                break;
        }

        return `
            <div class="boundary-card">
                <div class="boundary-header">
                    <span class="boundary-name">${b.name}</span>
                    <span class="boundary-type type-${b.type}">${b.type}</span>
                </div>
                <div class="boundary-details">
                    ${details}
                    <div class="detail-item"><span class="detail-label">Feather</span><span class="detail-value">${b.featherAmount.toFixed(2)}</span></div>
                </div>
                ${b.layerPath.length > 0 ? `<div class="layer-path">Layer: ${b.layerPath.join(' &gt; ')}</div>` : ''}
            </div>
        `;
    }
}

class TRNDocument implements vscode.CustomDocument {
    public readonly boundaries: Boundary[];
    public readonly tree: TRNTree;

    constructor(
        public readonly uri: vscode.Uri,
        data: Uint8Array
    ) {
        const parser = new TRNParser(data);
        const doc = parser.parse();
        this.boundaries = doc.boundaries;

        // Parse tree structure
        const treeParser = new TRNTreeParser(data);
        this.tree = treeParser.parse();
    }

    dispose(): void {}
}
