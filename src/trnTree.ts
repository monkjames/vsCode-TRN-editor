/**
 * TRN Tree Structure Parser
 * Parses full TRN hierarchy including all chunk types for tree view display
 */

export interface TRNNode {
    id: string;
    type: string;           // FORM type or chunk tag
    name: string;           // Display name
    offset: number;         // File offset
    size: number;           // Chunk size
    children: TRNNode[];
    data?: any;             // Parsed data for specific types
    hasError?: boolean;     // Validation error flag
    errorMessage?: string;  // Error details
}

export interface TRNTree {
    root: TRNNode;
    boundaries: TRNNode[];  // Quick access to all boundary nodes
    layers: TRNNode[];      // Quick access to all layer nodes
}

// Known chunk type descriptions
const CHUNK_DESCRIPTIONS: Record<string, string> = {
    // Main containers
    'PTAT': 'Terrain File',
    'TGEN': 'Terrain Generator',
    'LYRS': 'Layers Container',
    'LAYR': 'Layer',

    // Groups
    'SGRP': 'Shader Group',
    'SFAM': 'Shader Family',
    'FGRP': 'Flora Group',
    'FFAM': 'Flora Family',
    'RGRP': 'Radial Group',
    'RFAM': 'Radial Family',
    'EGRP': 'Environment Group',
    'EFAM': 'Environment Family',
    'MGRP': 'Multi-Fractal Group',
    'MFAM': 'Multi-Fractal Family',
    'MFRC': 'Fractal Settings',

    // Boundaries
    'BCIR': 'Boundary Circle',
    'BREC': 'Boundary Rectangle',
    'BPOL': 'Boundary Polygon',
    'BPLN': 'Boundary Polyline',

    // Filters
    'FFRA': 'Filter Fractal',
    'FSLP': 'Filter Slope',
    'FHGT': 'Filter Height',
    'FSHD': 'Filter Shader',
    'FBIT': 'Filter Bitmap',
    'FDIR': 'Filter Direction',

    // Affectors
    'AENV': 'Affector Environment',
    'ASCN': 'Affector Shader Constant',
    'AFDN': 'Affector Flora Near',
    'AFDF': 'Affector Flora Far',
    'AFSN': 'Affector Flora Static Near',
    'AFSC': 'Affector Flora Static Collidable',
    'ACRF': 'Affector Color Ramp Fractal',
    'AHCN': 'Affector Height Constant',
    'AHFR': 'Affector Height Fractal',
    'AHTR': 'Affector Height Terrace',
    'ACCN': 'Affector Color Constant',
    'AEXC': 'Affector Exclude',
    'ARIV': 'Affector River',
    'AROD': 'Affector Road',

    // Headers & Data
    'IHDR': 'Item Header',
    'DATA': 'Data',
    'ADTA': 'Additional Data',
    'PARM': 'Parameters',
    'WMAP': 'Water Map',
    'SMAP': 'Shader Map',
};

export class TRNTreeParser {
    private data: Uint8Array;
    private pos: number = 0;
    private nodeId: number = 0;
    private boundaries: TRNNode[] = [];
    private layers: TRNNode[] = [];

    constructor(data: Uint8Array) {
        this.data = data;
    }

    parse(): TRNTree {
        this.pos = 0;
        this.nodeId = 0;
        this.boundaries = [];
        this.layers = [];

        const root = this.parseChunk(0);

        return {
            root,
            boundaries: this.boundaries,
            layers: this.layers
        };
    }

    private parseChunk(startOffset: number): TRNNode {
        this.pos = startOffset;

        const tag = this.readString(4);
        const size = this.readUint32BE();

        if (tag === 'FORM') {
            return this.parseFORM(startOffset, size);
        } else {
            // Data chunk
            return this.parseDataChunk(tag, startOffset, size);
        }
    }

    private parseFORM(startOffset: number, size: number): TRNNode {
        const formType = this.readString(4);
        const contentStart = this.pos;
        const contentEnd = startOffset + 8 + size;

        const node: TRNNode = {
            id: `node_${this.nodeId++}`,
            type: formType,
            name: this.getChunkName(formType),
            offset: startOffset,
            size: size + 8,
            children: [],
            data: {}
        };

        // Track boundaries and layers
        if (['BCIR', 'BREC', 'BPOL', 'BPLN'].includes(formType)) {
            this.boundaries.push(node);
        } else if (formType === 'LAYR') {
            this.layers.push(node);
        }

        // Parse children
        while (this.pos < contentEnd - 8) {
            const childTag = this.peekString(4);
            if (!this.isValidTag(childTag)) {
                this.pos++;
                continue;
            }

            const childStart = this.pos;
            const child = this.parseChunk(childStart);
            node.children.push(child);

            // Extract names and data from children
            this.extractNodeData(node, child);

            this.pos = childStart + (child.type === 'FORM' ? child.size : 8 + this.readUint32BEAt(childStart + 4));
        }

        this.pos = contentEnd;

        // Update name if we found one
        if (node.data?.name) {
            node.name = `${this.getChunkName(formType)}: ${node.data.name}`;
        }

        return node;
    }

    private parseDataChunk(tag: string, startOffset: number, size: number): TRNNode {
        const node: TRNNode = {
            id: `node_${this.nodeId++}`,
            type: tag,
            name: this.getChunkName(tag),
            offset: startOffset,
            size: size + 8,
            children: [],
            data: {}
        };

        // Parse specific data chunks
        if (tag === 'DATA') {
            this.parseDATA(node, size);
        }

        this.pos = startOffset + 8 + size;
        return node;
    }

    private parseDATA(node: TRNNode, size: number): void {
        if (size < 4) return;

        const dataStart = this.pos;

        // Try to extract name (common pattern: uint32 id + null-terminated string)
        const id = this.readUint32LE();
        const remainingSize = size - 4;

        if (remainingSize > 0) {
            const nameBytes: number[] = [];
            let i = 0;
            while (i < remainingSize && i < 256) {
                const byte = this.data[this.pos + i];
                if (byte === 0) break;
                if (byte >= 32 && byte < 127) {
                    nameBytes.push(byte);
                } else {
                    break;
                }
                i++;
            }

            if (nameBytes.length > 0) {
                const name = String.fromCharCode(...nameBytes);
                if (/^[\w\s_-]+$/.test(name)) {
                    node.data.name = name;
                    node.name = `DATA: ${name}`;
                }
            }
        }

        this.pos = dataStart;
    }

    private extractNodeData(parent: TRNNode, child: TRNNode): void {
        // Extract name from IHDR or DATA children
        if (child.type === 'IHDR' || child.type === 'DATA') {
            if (child.data?.name && !parent.data?.name) {
                parent.data.name = child.data.name;
            }
        }

        // Recursively check IHDR children for names
        if (child.type === 'IHDR') {
            for (const grandchild of child.children) {
                if (grandchild.data?.name) {
                    parent.data.name = grandchild.data.name;
                    break;
                }
            }
        }

        // Extract boundary data
        if (child.type === 'DATA' && ['BCIR', 'BREC', 'BPOL', 'BPLN'].includes(parent.type)) {
            this.extractBoundaryData(parent, child);
        }
    }

    private extractBoundaryData(parent: TRNNode, dataNode: TRNNode): void {
        const dataStart = dataNode.offset + 8;
        const dataSize = dataNode.size - 8;

        if (parent.type === 'BCIR' && dataSize >= 20) {
            parent.data.centerX = this.readFloat32LEAt(dataStart);
            parent.data.centerZ = this.readFloat32LEAt(dataStart + 4);
            parent.data.radius = this.readFloat32LEAt(dataStart + 8);
            parent.data.featherType = this.readUint32LEAt(dataStart + 12);
            parent.data.featherAmount = this.readFloat32LEAt(dataStart + 16);
        } else if (parent.type === 'BREC' && dataSize >= 24) {
            parent.data.x1 = this.readFloat32LEAt(dataStart);
            parent.data.z1 = this.readFloat32LEAt(dataStart + 4);
            parent.data.x2 = this.readFloat32LEAt(dataStart + 8);
            parent.data.z2 = this.readFloat32LEAt(dataStart + 12);
            parent.data.featherType = this.readUint32LEAt(dataStart + 16);
            parent.data.featherAmount = this.readFloat32LEAt(dataStart + 20);
        } else if ((parent.type === 'BPOL' || parent.type === 'BPLN') && dataSize >= 8) {
            const vertexCount = this.readUint32LEAt(dataStart);
            parent.data.vertexCount = vertexCount;
            parent.data.featherAmount = this.readFloat32LEAt(dataStart + 4);
            if (parent.type === 'BPLN' && dataSize >= 12) {
                parent.data.width = this.readFloat32LEAt(dataStart + 8);
            }
        }
    }

    private getChunkName(type: string): string {
        return CHUNK_DESCRIPTIONS[type] || type;
    }

    private isValidTag(tag: string): boolean {
        return /^[A-Z0-9]{4}$/.test(tag);
    }

    // Reader helpers
    private readString(length: number): string {
        let str = '';
        for (let i = 0; i < length && this.pos < this.data.length; i++) {
            str += String.fromCharCode(this.data[this.pos++]);
        }
        return str;
    }

    private peekString(length: number): string {
        let str = '';
        for (let i = 0; i < length && this.pos + i < this.data.length; i++) {
            str += String.fromCharCode(this.data[this.pos + i]);
        }
        return str;
    }

    private readUint32BE(): number {
        const val = (this.data[this.pos] << 24) |
                    (this.data[this.pos + 1] << 16) |
                    (this.data[this.pos + 2] << 8) |
                    this.data[this.pos + 3];
        this.pos += 4;
        return val >>> 0;
    }

    private readUint32BEAt(pos: number): number {
        return ((this.data[pos] << 24) |
                (this.data[pos + 1] << 16) |
                (this.data[pos + 2] << 8) |
                this.data[pos + 3]) >>> 0;
    }

    private readUint32LE(): number {
        const val = this.data[this.pos] |
                    (this.data[this.pos + 1] << 8) |
                    (this.data[this.pos + 2] << 16) |
                    (this.data[this.pos + 3] << 24);
        this.pos += 4;
        return val >>> 0;
    }

    private readUint32LEAt(pos: number): number {
        return (this.data[pos] |
                (this.data[pos + 1] << 8) |
                (this.data[pos + 2] << 16) |
                (this.data[pos + 3] << 24)) >>> 0;
    }

    private readFloat32LEAt(pos: number): number {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setUint8(0, this.data[pos]);
        view.setUint8(1, this.data[pos + 1]);
        view.setUint8(2, this.data[pos + 2]);
        view.setUint8(3, this.data[pos + 3]);
        return view.getFloat32(0, true);
    }
}

/**
 * Search the tree for nodes matching criteria
 */
export interface SearchCriteria {
    text?: string;          // Search by name
    types?: string[];       // Filter by chunk type
    hasError?: boolean;     // Only nodes with errors
    containsPoint?: { x: number; z: number };  // Boundaries containing point
}

export function searchTree(root: TRNNode, criteria: SearchCriteria): TRNNode[] {
    const results: TRNNode[] = [];

    function search(node: TRNNode): void {
        let matches = true;

        // Text search
        if (criteria.text) {
            const searchText = criteria.text.toLowerCase();
            const nodeText = `${node.type} ${node.name}`.toLowerCase();
            if (!nodeText.includes(searchText)) {
                matches = false;
            }
        }

        // Type filter
        if (criteria.types && criteria.types.length > 0) {
            if (!criteria.types.includes(node.type)) {
                matches = false;
            }
        }

        // Error filter
        if (criteria.hasError !== undefined) {
            if (node.hasError !== criteria.hasError) {
                matches = false;
            }
        }

        // Coordinate containment
        if (criteria.containsPoint && matches) {
            if (!nodeContainsPoint(node, criteria.containsPoint.x, criteria.containsPoint.z)) {
                matches = false;
            }
        }

        if (matches) {
            results.push(node);
        }

        // Search children
        for (const child of node.children) {
            search(child);
        }
    }

    search(root);
    return results;
}

function nodeContainsPoint(node: TRNNode, x: number, z: number): boolean {
    if (!node.data) return false;

    if (node.type === 'BCIR') {
        const dx = x - (node.data.centerX || 0);
        const dz = z - (node.data.centerZ || 0);
        const r = node.data.radius || 0;
        return dx * dx + dz * dz <= r * r;
    } else if (node.type === 'BREC') {
        const x1 = Math.min(node.data.x1 || 0, node.data.x2 || 0);
        const x2 = Math.max(node.data.x1 || 0, node.data.x2 || 0);
        const z1 = Math.min(node.data.z1 || 0, node.data.z2 || 0);
        const z2 = Math.max(node.data.z1 || 0, node.data.z2 || 0);
        return x >= x1 && x <= x2 && z >= z1 && z <= z2;
    }
    // TODO: Add polygon/polyline containment

    return false;
}

/**
 * Mark nodes with validation errors
 */
export function markTreeErrors(root: TRNNode, boundaryErrors: Map<number, string>): void {
    let boundaryIndex = 0;

    function mark(node: TRNNode): void {
        if (['BCIR', 'BREC', 'BPOL', 'BPLN'].includes(node.type)) {
            const error = boundaryErrors.get(boundaryIndex);
            if (error) {
                node.hasError = true;
                node.errorMessage = error;
            }
            boundaryIndex++;
        }

        for (const child of node.children) {
            mark(child);
        }
    }

    mark(root);
}

/**
 * Get all boundaries that belong to a specific layer (or any of its nested layers)
 */
export function getBoundariesInLayer(layerNode: TRNNode): TRNNode[] {
    const boundaries: TRNNode[] = [];

    function collect(node: TRNNode): void {
        if (['BCIR', 'BREC', 'BPOL', 'BPLN'].includes(node.type)) {
            boundaries.push(node);
        }
        for (const child of node.children) {
            collect(child);
        }
    }

    collect(layerNode);
    return boundaries;
}

/**
 * Build a map of layer ID to layer info for UI display
 */
export interface LayerInfo {
    node: TRNNode;
    name: string;
    boundaryCount: number;
    depth: number;  // Nesting level
    parentId?: string;
}

export function getLayerHierarchy(root: TRNNode): LayerInfo[] {
    const layers: LayerInfo[] = [];

    function traverse(node: TRNNode, depth: number, parentId?: string): void {
        if (node.type === 'LAYR') {
            const boundaries = getBoundariesInLayer(node);
            // Only count direct boundaries, not from nested layers
            const directBoundaries = node.children.filter(c =>
                ['BCIR', 'BREC', 'BPOL', 'BPLN'].includes(c.type)
            ).length;

            layers.push({
                node,
                name: node.data?.name || `Layer ${layers.length + 1}`,
                boundaryCount: boundaries.length,
                depth,
                parentId
            });

            // Traverse children to find nested layers
            for (const child of node.children) {
                traverse(child, depth + 1, node.id);
            }
        } else {
            // Continue searching for layers
            for (const child of node.children) {
                traverse(child, depth, parentId);
            }
        }
    }

    traverse(root, 0);
    return layers;
}
