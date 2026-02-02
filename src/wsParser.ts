/**
 * World Snapshot (.ws) Parser for SWG
 * Parses WSNP IFF files containing object placements
 */

export interface WSObject {
    objectId: number;
    parentId: number;
    templateIndex: number;
    templatePath: string;
    position: { x: number; y: number; z: number };
    rotation: { qw: number; qx: number; qy: number; qz: number };
    radius: number;
    category: string;  // 'building', 'static', 'tangible', 'cell', 'other'
}

export interface WSDocument {
    templates: string[];
    objects: WSObject[];
    buildings: WSObject[];
    statics: WSObject[];
    containers: WSObject[];
}

export class WSParser {
    private data: Uint8Array;
    private pos: number = 0;

    constructor(data: Uint8Array) {
        this.data = data;
    }

    parse(): WSDocument {
        // Parse OTNL template list first
        const templates = this.parseTemplates();

        // Parse all NODE objects
        const objects = this.parseNodes(templates);

        // Categorize
        const buildings = objects.filter(o => o.category === 'building');
        const statics = objects.filter(o => o.category === 'static');
        const containers = objects.filter(o =>
            o.category === 'tangible' && o.templatePath.includes('/container/')
        );

        return { templates, objects, buildings, statics, containers };
    }

    private parseTemplates(): string[] {
        // Find OTNL chunk
        const otnlPos = this.findChunk('OTNL');
        if (otnlPos === -1) return [];

        this.pos = otnlPos + 4;
        const size = this.readUint32BE();
        const count = this.readUint32LE();

        const templates: string[] = [];
        const end = otnlPos + 8 + size;

        while (this.pos < end && templates.length < count) {
            const str = this.readNullTerminatedString();
            if (str) templates.push(str);
        }

        return templates;
    }

    private parseNodes(templates: string[]): WSObject[] {
        const objects: WSObject[] = [];
        this.pos = 0;

        while (this.pos < this.data.length - 60) {
            // Look for DATA chunks with size 0x34 (52 bytes)
            if (this.data[this.pos] === 0x44 &&     // 'D'
                this.data[this.pos + 1] === 0x41 && // 'A'
                this.data[this.pos + 2] === 0x54 && // 'T'
                this.data[this.pos + 3] === 0x41 && // 'A'
                this.data[this.pos + 4] === 0x00 &&
                this.data[this.pos + 5] === 0x00 &&
                this.data[this.pos + 6] === 0x00 &&
                this.data[this.pos + 7] === 0x34) { // size = 52

                this.pos += 8; // Skip DATA header

                const objectId = this.readUint32LE();
                const parentId = this.readUint32LE();
                const templateIndex = this.readUint32LE();
                this.readUint32LE(); // unknown/padding

                const qw = this.readFloat32LE();
                const qx = this.readFloat32LE();
                const qy = this.readFloat32LE();
                const qz = this.readFloat32LE();

                const x = this.readFloat32LE();
                const y = this.readFloat32LE();
                const z = this.readFloat32LE();

                const radius = this.readFloat32LE();
                this.readUint32LE(); // instance hash/padding

                const templatePath = templates[templateIndex] || '';

                // Skip cells and objects without world position
                if (templatePath.includes('/cell/')) continue;
                if (parentId !== 0) continue; // Skip child objects (inside buildings)
                if (x === 0 && z === 0) continue;

                // Exception: include containers even if inside buildings
                const isContainer = templatePath.includes('/container/');

                const category = this.categorize(templatePath);

                objects.push({
                    objectId,
                    parentId,
                    templateIndex,
                    templatePath,
                    position: { x, y, z },
                    rotation: { qw, qx, qy, qz },
                    radius,
                    category
                });
            } else {
                this.pos++;
            }
        }

        return objects;
    }

    private categorize(templatePath: string): string {
        if (templatePath.startsWith('object/building/')) return 'building';
        if (templatePath.startsWith('object/static/')) return 'static';
        if (templatePath.startsWith('object/tangible/')) return 'tangible';
        return 'other';
    }

    private findChunk(tag: string): number {
        const tagBytes = new TextEncoder().encode(tag);
        for (let i = 0; i < this.data.length - 4; i++) {
            if (this.data[i] === tagBytes[0] &&
                this.data[i + 1] === tagBytes[1] &&
                this.data[i + 2] === tagBytes[2] &&
                this.data[i + 3] === tagBytes[3]) {
                return i;
            }
        }
        return -1;
    }

    private readUint32BE(): number {
        const val = (this.data[this.pos] << 24) |
                    (this.data[this.pos + 1] << 16) |
                    (this.data[this.pos + 2] << 8) |
                    this.data[this.pos + 3];
        this.pos += 4;
        return val >>> 0;
    }

    private readUint32LE(): number {
        const val = this.data[this.pos] |
                    (this.data[this.pos + 1] << 8) |
                    (this.data[this.pos + 2] << 16) |
                    (this.data[this.pos + 3] << 24);
        this.pos += 4;
        return val >>> 0;
    }

    private readFloat32LE(): number {
        const buf = new ArrayBuffer(4);
        const view = new DataView(buf);
        view.setUint8(0, this.data[this.pos]);
        view.setUint8(1, this.data[this.pos + 1]);
        view.setUint8(2, this.data[this.pos + 2]);
        view.setUint8(3, this.data[this.pos + 3]);
        this.pos += 4;
        return view.getFloat32(0, true);
    }

    private readNullTerminatedString(): string {
        const start = this.pos;
        while (this.pos < this.data.length && this.data[this.pos] !== 0) {
            this.pos++;
        }
        const str = new TextDecoder().decode(this.data.slice(start, this.pos));
        this.pos++; // skip null
        return str;
    }
}

/**
 * Convert quaternion to yaw angle (rotation around Y axis)
 */
export function quaternionToYaw(qw: number, qx: number, qy: number, qz: number): number {
    // For Y-up coordinate system, yaw is rotation around Y
    const siny_cosp = 2 * (qw * qy + qz * qx);
    const cosy_cosp = 1 - 2 * (qx * qx + qy * qy);
    return Math.atan2(siny_cosp, cosy_cosp);
}
