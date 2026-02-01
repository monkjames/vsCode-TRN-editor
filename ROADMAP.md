# TRN Editor Roadmap

## Current Features (v1.0)

### Map View
- [x] Canvas-based visualization with pan/zoom
- [x] Render all boundary types (BCIR, BREC, BPOL, BPLN)
- [x] Click to query boundaries at coordinates
- [x] Type filters (show/hide circles, rectangles, etc.)
- [x] Layer filters (show/hide specific terrain layers)
- [x] Visible boundary count indicator

### Tree View
- [x] Full IFF hierarchy display
- [x] Search by name
- [x] Search by coordinates (X, Z)
- [x] Filter by boundary type
- [x] Filter by errors only
- [x] Expand/collapse all
- [x] Color-coded type badges

### List View
- [x] Browse boundaries by type
- [x] Search within each type
- [x] Coordinate query tool

### Validation
- [x] Detect NaN/Infinity values
- [x] Zero radius circles
- [x] Zero-area rectangles
- [x] Polygons with < 3 vertices
- [x] Polylines with < 2 vertices
- [x] Self-intersecting polygons
- [x] Out-of-bounds coordinates
- [x] Duplicate boundaries
- [x] Negative feather amounts

---

## Completed Features

### Phase 1: Property Editing (Read-Write Support) ✓

Converted from `CustomReadonlyEditorProvider` to `CustomEditorProvider` with full edit support.

#### Property Panel ✓
- [x] Show properties when boundary is selected (tree or map click)
- [x] Editable fields for each boundary type:
  - **BCIR**: Center X, Center Z, Radius, Feather Amount
  - **BREC**: X1, Z1, X2, Z2, Feather Amount
  - **BPLN**: Width, Feather Amount
  - **BPOL**: Feather Amount
- [x] Real-time map update when properties change
- [x] Modified field highlighting (orange border)
- [ ] Feather type dropdown (easeIn, easeOut, easeInOut, linear) - *future*
- [ ] Name editing (IHDR/DATA chunk) - *future*

#### Binary Writing ✓
- [x] Track DATA chunk offsets during parsing
- [x] Write float32/uint32 values back to correct positions
- [ ] Handle size changes if name length changes - *future*
- [ ] Recalculate parent FORM sizes when content changes - *future*

#### Save Workflow ✓
- [x] Mark document as dirty on edits
- [x] Implement `saveCustomDocument` and `saveCustomDocumentAs`
- [x] Undo/redo support via VS Code edit events
- [x] Backup on save
- [ ] Verify file integrity after save - *future*

---

## Planned Features

### Phase 2: Visual Editing

#### Map Interaction
- [ ] Click boundary on map to select it
- [ ] Highlight selected boundary
- [ ] Drag to move boundary center/position
- [ ] Drag handles to resize (radius for circles, corners for rectangles)
- [ ] Drag vertices for polygons/polylines

#### Coordinate Snapping
- [ ] Snap to grid (configurable: 1, 5, 10, 50, 100 units)
- [ ] Snap to other boundary edges/centers
- [ ] Show snap guides while dragging

### Phase 3: Layer Operations

#### Layer Management
- [ ] Rename layers
- [ ] Reorder layers (drag in tree)
- [ ] Duplicate layer with all children
- [ ] Delete layer (with confirmation)

#### Boundary Operations
- [ ] Move boundary to different layer
- [ ] Duplicate boundary
- [ ] Delete boundary
- [ ] Copy/paste boundaries between files

### Phase 4: Creation Tools

#### New Boundary Creation
- [ ] "Add Circle" tool - click to place, drag to set radius
- [ ] "Add Rectangle" tool - click and drag corners
- [ ] "Add Polygon" tool - click to add vertices, double-click to close
- [ ] "Add Polyline" tool - click to add vertices, double-click to finish

#### Templates
- [ ] Save boundary as template
- [ ] Insert from template library
- [ ] Common presets (POI marker, region, path)

### Phase 5: Advanced Features

#### Multi-Select
- [ ] Shift+click to add to selection
- [ ] Ctrl+click to toggle selection
- [ ] Drag box selection on map
- [ ] Move/delete multiple boundaries at once

#### Undo/Redo
- [ ] Track all edits in undo stack
- [ ] Ctrl+Z / Ctrl+Shift+Z support
- [ ] Show undo history

#### Import/Export
- [ ] Export boundaries to JSON
- [ ] Import boundaries from JSON
- [ ] Export map view as PNG
- [ ] Generate boundary report (CSV)

#### Comparison
- [ ] Compare two TRN files side-by-side
- [ ] Highlight differences
- [ ] Merge boundaries from another file

---

## Technical Notes

### TRN File Structure
```
FORM PTAT
├── FORM TGEN (Terrain Generator settings)
├── FORM LYRS (Layers container)
│   └── FORM LAYR (Layer)
│       ├── FORM IHDR (Item Header - contains name)
│       │   └── DATA (id + name string)
│       ├── FORM BCIR (Boundary Circle)
│       │   ├── FORM 0002 (versioned container)
│       │   │   ├── FORM IHDR
│       │   │   └── DATA (centerX, centerZ, radius, featherType, featherAmount)
│       ├── FORM BREC (Boundary Rectangle)
│       ├── FORM BPOL (Boundary Polygon)
│       ├── FORM BPLN (Boundary Polyline)
│       ├── FORM AHFR (Affector Height Fractal)
│       ├── FORM ASCN (Affector Shader Constant)
│       └── ... (other affectors, filters, nested layers)
├── FORM SGRP (Shader Groups)
├── FORM FGRP (Flora Groups)
├── FORM RGRP (Radial Groups)
└── FORM EGRP (Environment Groups)
```

### Binary DATA Formats

**BCIR** (20 bytes):
| Offset | Type    | Field         |
|--------|---------|---------------|
| 0      | float32 | centerX       |
| 4      | float32 | centerZ       |
| 8      | float32 | radius        |
| 12     | uint32  | featherType   |
| 16     | float32 | featherAmount |

**BREC** (24 bytes):
| Offset | Type    | Field         |
|--------|---------|---------------|
| 0      | float32 | x1            |
| 4      | float32 | z1            |
| 8      | float32 | x2            |
| 12     | float32 | z2            |
| 16     | uint32  | featherType   |
| 20     | float32 | featherAmount |

**BPOL** (8 + 8*N bytes):
| Offset | Type    | Field         |
|--------|---------|---------------|
| 0      | uint32  | vertexCount   |
| 4      | float32 | featherAmount |
| 8+     | float32 | vertex[n].x   |
| 12+    | float32 | vertex[n].z   |

**BPLN** (12 + 8*N bytes):
| Offset | Type    | Field         |
|--------|---------|---------------|
| 0      | uint32  | vertexCount   |
| 4      | float32 | featherAmount |
| 8      | float32 | width         |
| 12+    | float32 | vertex[n].x   |
| 16+    | float32 | vertex[n].z   |

### Feather Types
| Value | Name        |
|-------|-------------|
| 0     | linear      |
| 1     | easeIn      |
| 2     | easeOut     |
| 3     | easeInOut   |

---

## Contributing

Issues and pull requests welcome at:
https://github.com/monkjames/vsCode-TRN-editor
