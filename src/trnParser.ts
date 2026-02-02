/**
 * SWG Terrain (TRN) File Parser
 *
 * TRN files are IFF-based terrain definition files containing:
 * - PTAT: Main terrain container
 * - LYRS: Layer groups containing boundaries and affectors
 * - Boundary types: BCIR (circle), BREC (rectangle), BPOL (polygon), BPLN (polyline)
 */

export interface Point2D {
    x: number;
    z: number;
}

export interface MapInfo {
    // Terrain Map and Flora Parameters (from IFF template)
    terrainFile: string;
    mapSize: number;                    // Map Size (meters) - total size, e.g. 16384 means -8192 to 8192
    mapBoundsMin: number;               // Calculated: -mapSize/2
    mapBoundsMax: number;               // Calculated: mapSize/2
    chunkWidth: number;                 // Chunk Width
    tilesPerChunk: number;              // TilesPerChunk (int)
    useGlobalWaterTable: boolean;       // useGlobalWaterTable (int, 0 or 1)
    globalWaterTableHeight: number;     // globalWaterTableHeight
    globalWaterTableShaderSize: number; // globalWaterTableShaderSize
    waterShaderName: string;            // ShaderName
    timeCycle: number;                  // timeCycle
    // Flora Collidable
    floraCollidableMinDistance: number;
    floraCollidableMaxDistance: number;
    floraCollidableTileSize: number;
    floraCollidableTileBorder: number;
    floraCollidableSeed: number;
    // Flora Non-Collidable
    floraNonCollidableMinDistance: number;
    floraNonCollidableMaxDistance: number;
    floraNonCollidableTileSize: number;
    floraNonCollidableTileBorder: number;
    floraNonCollidableSeed: number;
    // Radial Near
    radialNearMinDistance: number;
    radialNearMaxDistance: number;
    radialNearTileSize: number;
    radialNearTileBorder: number;
    radialNearSeed: number;
    // Radial Far
    radialFarMinDistance: number;
    radialFarMaxDistance: number;
    radialFarTileSize: number;
    radialFarTileBorder: number;
    radialFarSeed: number;
}

export interface BoundaryCircle {
    type: 'circle';
    name: string;
    centerX: number;
    centerZ: number;
    radius: number;
    featherType: number;
    featherAmount: number;
    layerPath: string[];
    offset: number;  // File offset for matching with tree nodes
}

export interface BoundaryRectangle {
    type: 'rectangle';
    name: string;
    x1: number;
    z1: number;
    x2: number;
    z2: number;
    featherType: number;
    featherAmount: number;
    layerPath: string[];
    offset: number;
}

export interface BoundaryPolygon {
    type: 'polygon';
    name: string;
    vertices: Point2D[];
    featherType: number;
    featherAmount: number;
    layerPath: string[];
    offset: number;
}

export interface BoundaryPolyline {
    type: 'polyline';
    name: string;
    vertices: Point2D[];
    width: number;
    featherType: number;
    featherAmount: number;
    layerPath: string[];
    offset: number;
}

export type Boundary = BoundaryCircle | BoundaryRectangle | BoundaryPolygon | BoundaryPolyline;

export interface Layer {
    name: string;
    boundaries: Boundary[];
    children: Layer[];
}

export interface TRNDocument {
    filename: string;
    boundaries: Boundary[];
    layers: Layer[];
    mapInfo: MapInfo;
}

export class TRNParser {
    private data: Uint8Array;
    private pos: number = 0;

    constructor(data: Uint8Array) {
        this.data = data;
    }

    parse(): TRNDocument {
        const boundaries: Boundary[] = [];
        this.pos = 0;

        // Verify FORM PTAT header
        const formTag = this.readString(4);
        if (formTag !== 'FORM') {
            throw new Error('Not a valid IFF file');
        }
        const formSize = this.readUint32BE();
        const formType = this.readString(4);
        if (formType !== 'PTAT') {
            throw new Error(`Expected PTAT, got ${formType}`);
        }

        // Parse map info from header DATA chunk
        const mapInfo = this.parseMapInfo();

        // Parse the content recursively
        this.parseContent(this.pos, formSize - 4, boundaries, []);

        return {
            filename: mapInfo.terrainFile,
            boundaries,
            layers: [],
            mapInfo
        };
    }

    private parseMapInfo(): MapInfo {
        // Find the first DATA chunk in the file (contains map parameters)
        const savedPos = this.pos;

        // Skip through to find the header DATA chunk (should be near the start)
        // Structure: FORM PTAT > FORM 00xx > DATA
        this.pos = 12;  // Skip FORM PTAT header

        // Look for the DATA chunk within the first nested FORM
        const tag = this.readString(4);
        const size = this.readUint32BE();

        if (tag === 'FORM') {
            this.readString(4);  // Skip form type (e.g., "0014")

            // Now look for DATA
            const dataTag = this.readString(4);
            const dataSize = this.readUint32BE();

            if (dataTag === 'DATA') {
                const mapInfo = this.parseMapInfoData(dataSize);
                this.pos = savedPos;
                return mapInfo;
            }
        }

        // Restore position and return defaults if not found
        this.pos = savedPos;
        return this.getDefaultMapInfo();
    }

    private parseMapInfoData(size: number): MapInfo {
        const dataStart = this.pos;

        // string[Terrain File]
        const terrainFile = this.readNullTerminatedString(256);

        // float[Map Size (meters)]
        const mapSize = this.readFloat32LE();

        // float[Chunk Width]
        const chunkWidth = this.readFloat32LE();

        // int[TilesPerChunk]
        const tilesPerChunk = this.readUint32LE();

        // int[useGlobalWaterTable]
        const useGlobalWaterTable = this.readUint32LE() !== 0;

        // float[globalWaterTableHeight]
        const globalWaterTableHeight = this.readFloat32LE();

        // float[globalWaterTableShaderSize]
        const globalWaterTableShaderSize = this.readFloat32LE();

        // string[ShaderName]
        const waterShaderName = this.readNullTerminatedString(64);

        // float[timeCycle]
        const timeCycle = this.readFloat32LE();

        // Flora Collidable: int, float, float, float, int
        const floraCollidableMinDistance = this.readUint32LE();
        const floraCollidableMaxDistance = this.readFloat32LE();
        const floraCollidableTileSize = this.readFloat32LE();
        const floraCollidableTileBorder = this.readFloat32LE();
        const floraCollidableSeed = this.readUint32LE();

        // Flora Non-Collidable: int, float, float, float, int
        const floraNonCollidableMinDistance = this.readUint32LE();
        const floraNonCollidableMaxDistance = this.readFloat32LE();
        const floraNonCollidableTileSize = this.readFloat32LE();
        const floraNonCollidableTileBorder = this.readFloat32LE();
        const floraNonCollidableSeed = this.readUint32LE();

        // Radial Near: int, float, float, float, int
        const radialNearMinDistance = this.readUint32LE();
        const radialNearMaxDistance = this.readFloat32LE();
        const radialNearTileSize = this.readFloat32LE();
        const radialNearTileBorder = this.readFloat32LE();
        const radialNearSeed = this.readUint32LE();

        // Radial Far: float, float, float, float, int
        const radialFarMinDistance = this.readFloat32LE();
        const radialFarMaxDistance = this.readFloat32LE();
        const radialFarTileSize = this.readFloat32LE();
        const radialFarTileBorder = this.readFloat32LE();
        const radialFarSeed = this.readUint32LE();

        return {
            terrainFile,
            mapSize,
            mapBoundsMin: -mapSize / 2,
            mapBoundsMax: mapSize / 2,
            chunkWidth,
            tilesPerChunk,
            useGlobalWaterTable,
            globalWaterTableHeight,
            globalWaterTableShaderSize,
            waterShaderName,
            timeCycle,
            floraCollidableMinDistance,
            floraCollidableMaxDistance,
            floraCollidableTileSize,
            floraCollidableTileBorder,
            floraCollidableSeed,
            floraNonCollidableMinDistance,
            floraNonCollidableMaxDistance,
            floraNonCollidableTileSize,
            floraNonCollidableTileBorder,
            floraNonCollidableSeed,
            radialNearMinDistance,
            radialNearMaxDistance,
            radialNearTileSize,
            radialNearTileBorder,
            radialNearSeed,
            radialFarMinDistance,
            radialFarMaxDistance,
            radialFarTileSize,
            radialFarTileBorder,
            radialFarSeed
        };
    }

    private getDefaultMapInfo(): MapInfo {
        return {
            terrainFile: '',
            mapSize: 16384,
            mapBoundsMin: -8192,
            mapBoundsMax: 8192,
            chunkWidth: 8,
            tilesPerChunk: 2,
            useGlobalWaterTable: false,
            globalWaterTableHeight: 0,
            globalWaterTableShaderSize: 0,
            waterShaderName: '',
            timeCycle: 0,
            floraCollidableMinDistance: 0,
            floraCollidableMaxDistance: 0,
            floraCollidableTileSize: 0,
            floraCollidableTileBorder: 0,
            floraCollidableSeed: 0,
            floraNonCollidableMinDistance: 0,
            floraNonCollidableMaxDistance: 0,
            floraNonCollidableTileSize: 0,
            floraNonCollidableTileBorder: 0,
            floraNonCollidableSeed: 0,
            radialNearMinDistance: 0,
            radialNearMaxDistance: 0,
            radialNearTileSize: 0,
            radialNearTileBorder: 0,
            radialNearSeed: 0,
            radialFarMinDistance: 0,
            radialFarMaxDistance: 0,
            radialFarTileSize: 0,
            radialFarTileBorder: 0,
            radialFarSeed: 0
        };
    }

    private parseContent(start: number, size: number, boundaries: Boundary[], layerPath: string[]): void {
        const end = start + size;
        this.pos = start;

        while (this.pos < end - 8) {
            const chunkStart = this.pos;
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();

            if (tag === 'FORM') {
                const formType = this.readString(4);

                if (formType === 'BCIR') {
                    const boundary = this.parseBCIR(chunkSize - 4, layerPath, chunkStart);
                    if (boundary) boundaries.push(boundary);
                } else if (formType === 'BREC') {
                    const boundary = this.parseBREC(chunkSize - 4, layerPath, chunkStart);
                    if (boundary) boundaries.push(boundary);
                } else if (formType === 'BPOL') {
                    const boundary = this.parseBPOL(chunkSize - 4, layerPath, chunkStart);
                    if (boundary) boundaries.push(boundary);
                } else if (formType === 'BPLN') {
                    const boundary = this.parseBPLN(chunkSize - 4, layerPath, chunkStart);
                    if (boundary) boundaries.push(boundary);
                } else if (formType === 'LAYR') {
                    // Parse layer recursively
                    const layerName = this.extractLayerName(this.pos, chunkSize - 4);
                    this.parseContent(this.pos, chunkSize - 4, boundaries, [...layerPath, layerName]);
                } else {
                    // Skip other FORM types but recurse into them
                    this.parseContent(this.pos, chunkSize - 4, boundaries, layerPath);
                }
                this.pos = chunkStart + 8 + chunkSize;
            } else {
                // Skip non-FORM chunks
                this.pos = chunkStart + 8 + chunkSize;
            }
        }
    }

    private extractLayerName(start: number, size: number): string {
        // Look for FORM IHDR that contains the layer name
        const end = start + size;
        let pos = start;

        while (pos < end - 8) {
            const tag = this.readStringAt(pos, 4);
            const chunkSize = this.readUint32BEAt(pos + 4);

            if (tag === 'FORM') {
                const formType = this.readStringAt(pos + 8, 4);
                if (formType === 'IHDR') {
                    // Found IHDR, now look for DATA chunk inside it
                    const ihdrStart = pos + 12; // After FORM + size + IHDR
                    const ihdrEnd = pos + 8 + chunkSize;
                    let ihdrPos = ihdrStart;

                    while (ihdrPos < ihdrEnd - 8) {
                        const innerTag = this.readStringAt(ihdrPos, 4);
                        const innerSize = this.readUint32BEAt(ihdrPos + 4);

                        if (innerTag === 'DATA' && innerSize > 4) {
                            // IHDR DATA: 4 bytes ID + null-terminated name
                            const nameStart = ihdrPos + 8 + 4; // Skip tag + size + ID
                            const name = this.readNullTerminatedStringAt(nameStart, Math.min(64, innerSize - 4));
                            if (name && name.length > 0) {
                                return name;
                            }
                        }
                        ihdrPos += 8 + innerSize;
                    }
                }
            }
            pos += 8 + chunkSize;
        }
        return 'Layer';
    }

    private isValidName(name: string): boolean {
        return /^[\w\s_-]+$/.test(name);
    }

    private parseBCIR(size: number, layerPath: string[], offset: number): BoundaryCircle | null {
        const end = this.pos + size;
        let name = 'BoundaryCircle';
        let centerX = 0, centerZ = 0, radius = 0, featherType = 0, featherAmount = 0;
        let foundData = false;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();
            const chunkEnd = this.pos + chunkSize;

            if (tag === 'FORM') {
                const formType = this.readString(4);
                if (formType === 'IHDR') {
                    name = this.parseIHDR(chunkSize - 4);
                } else {
                    // Recursively parse versioned FORMs (like 0001, 0002)
                    // to find DATA chunks inside
                    const innerResult = this.parseBCIRInner(chunkSize - 4);
                    if (innerResult.name) name = innerResult.name;
                    if (innerResult.foundData) {
                        centerX = innerResult.centerX;
                        centerZ = innerResult.centerZ;
                        radius = innerResult.radius;
                        featherType = innerResult.featherType;
                        featherAmount = innerResult.featherAmount;
                        foundData = true;
                    }
                }
                this.pos = chunkEnd;
            } else if (tag === 'DATA') {
                // BCIR DATA: centerX, centerZ, radius, featherType, featherAmount
                if (chunkSize >= 20) {
                    centerX = this.readFloat32LE();
                    centerZ = this.readFloat32LE();
                    radius = this.readFloat32LE();
                    featherType = this.readUint32LE();
                    featherAmount = this.readFloat32LE();
                    foundData = true;
                }
                this.pos = chunkEnd;
            } else {
                this.pos = chunkEnd;
            }
        }

        return {
            type: 'circle',
            name,
            centerX,
            centerZ,
            radius,
            featherType,
            featherAmount,
            layerPath,
            offset
        };
    }

    private parseBCIRInner(size: number): { name?: string; foundData: boolean; centerX: number; centerZ: number; radius: number; featherType: number; featherAmount: number } {
        const end = this.pos + size;
        let name: string | undefined;
        let centerX = 0, centerZ = 0, radius = 0, featherType = 0, featherAmount = 0;
        let foundData = false;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();
            const chunkEnd = this.pos + chunkSize;

            if (tag === 'FORM') {
                const formType = this.readString(4);
                if (formType === 'IHDR') {
                    name = this.parseIHDR(chunkSize - 4);
                } else {
                    // Recurse further if needed
                    const inner = this.parseBCIRInner(chunkSize - 4);
                    if (inner.name) name = inner.name;
                    if (inner.foundData) {
                        centerX = inner.centerX;
                        centerZ = inner.centerZ;
                        radius = inner.radius;
                        featherType = inner.featherType;
                        featherAmount = inner.featherAmount;
                        foundData = true;
                    }
                }
                this.pos = chunkEnd;
            } else if (tag === 'DATA') {
                if (chunkSize >= 20) {
                    centerX = this.readFloat32LE();
                    centerZ = this.readFloat32LE();
                    radius = this.readFloat32LE();
                    featherType = this.readUint32LE();
                    featherAmount = this.readFloat32LE();
                    foundData = true;
                }
                this.pos = chunkEnd;
            } else {
                this.pos = chunkEnd;
            }
        }

        return { name, foundData, centerX, centerZ, radius, featherType, featherAmount };
    }

    private parseBREC(size: number, layerPath: string[], offset: number): BoundaryRectangle | null {
        const end = this.pos + size;
        let name = 'BoundaryRectangle';
        let x1 = 0, z1 = 0, x2 = 0, z2 = 0, featherType = 0, featherAmount = 0;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();
            const chunkEnd = this.pos + chunkSize;

            if (tag === 'FORM') {
                const formType = this.readString(4);
                if (formType === 'IHDR') {
                    name = this.parseIHDR(chunkSize - 4);
                } else {
                    // Recursively parse versioned FORMs
                    const innerResult = this.parseBRECInner(chunkSize - 4);
                    if (innerResult.name) name = innerResult.name;
                    if (innerResult.foundData) {
                        x1 = innerResult.x1;
                        z1 = innerResult.z1;
                        x2 = innerResult.x2;
                        z2 = innerResult.z2;
                        featherType = innerResult.featherType;
                        featherAmount = innerResult.featherAmount;
                    }
                }
                this.pos = chunkEnd;
            } else if (tag === 'DATA') {
                // BREC DATA: x1, z1, x2, z2, featherType, featherAmount
                if (chunkSize >= 24) {
                    x1 = this.readFloat32LE();
                    z1 = this.readFloat32LE();
                    x2 = this.readFloat32LE();
                    z2 = this.readFloat32LE();
                    featherType = this.readUint32LE();
                    featherAmount = this.readFloat32LE();
                }
                this.pos = chunkEnd;
            } else {
                this.pos = chunkEnd;
            }
        }

        // Normalize coordinates (ensure x1 < x2, z1 < z2)
        if (x1 > x2) [x1, x2] = [x2, x1];
        if (z1 > z2) [z1, z2] = [z2, z1];

        return {
            type: 'rectangle',
            name,
            x1, z1, x2, z2,
            featherType,
            featherAmount,
            layerPath,
            offset
        };
    }

    private parseBRECInner(size: number): { name?: string; foundData: boolean; x1: number; z1: number; x2: number; z2: number; featherType: number; featherAmount: number } {
        const end = this.pos + size;
        let name: string | undefined;
        let x1 = 0, z1 = 0, x2 = 0, z2 = 0, featherType = 0, featherAmount = 0;
        let foundData = false;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();
            const chunkEnd = this.pos + chunkSize;

            if (tag === 'FORM') {
                const formType = this.readString(4);
                if (formType === 'IHDR') {
                    name = this.parseIHDR(chunkSize - 4);
                } else {
                    const inner = this.parseBRECInner(chunkSize - 4);
                    if (inner.name) name = inner.name;
                    if (inner.foundData) {
                        x1 = inner.x1; z1 = inner.z1;
                        x2 = inner.x2; z2 = inner.z2;
                        featherType = inner.featherType;
                        featherAmount = inner.featherAmount;
                        foundData = true;
                    }
                }
                this.pos = chunkEnd;
            } else if (tag === 'DATA') {
                if (chunkSize >= 24) {
                    x1 = this.readFloat32LE();
                    z1 = this.readFloat32LE();
                    x2 = this.readFloat32LE();
                    z2 = this.readFloat32LE();
                    featherType = this.readUint32LE();
                    featherAmount = this.readFloat32LE();
                    foundData = true;
                }
                this.pos = chunkEnd;
            } else {
                this.pos = chunkEnd;
            }
        }

        return { name, foundData, x1, z1, x2, z2, featherType, featherAmount };
    }

    private parseBPOL(size: number, layerPath: string[], offset: number): BoundaryPolygon | null {
        const end = this.pos + size;
        let name = 'BoundaryPolygon';
        let vertices: Point2D[] = [];
        let featherType = 0, featherAmount = 0;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();
            const chunkEnd = this.pos + chunkSize;

            if (tag === 'FORM') {
                const formType = this.readString(4);
                if (formType === 'IHDR') {
                    name = this.parseIHDR(chunkSize - 4);
                } else {
                    const inner = this.parseBPOLInner(chunkSize - 4);
                    if (inner.name) name = inner.name;
                    if (inner.vertices.length > 0) {
                        vertices = inner.vertices;
                        featherAmount = inner.featherAmount;
                    }
                }
                this.pos = chunkEnd;
            } else if (tag === 'DATA') {
                // BPOL DATA: vertexCount(4) | vertices(n*8) | featherType(4) | featherAmount(4)
                if (chunkSize >= 12) {
                    const vertexCount = this.readUint32LE();

                    vertices = [];
                    for (let i = 0; i < vertexCount; i++) {
                        vertices.push({
                            x: this.readFloat32LE(),
                            z: this.readFloat32LE()
                        });
                    }

                    // Read tail: featherType(4) + featherAmount(4)
                    featherType = this.readUint32LE();
                    featherAmount = this.readFloat32LE();
                }
                this.pos = chunkEnd;
            } else {
                this.pos = chunkEnd;
            }
        }

        return {
            type: 'polygon',
            name,
            vertices,
            featherType,
            featherAmount,
            layerPath,
            offset
        };
    }

    private parseBPOLInner(size: number): { name?: string; vertices: Point2D[]; featherAmount: number } {
        const end = this.pos + size;
        let name: string | undefined;
        let vertices: Point2D[] = [];
        let featherAmount = 0;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();
            const chunkEnd = this.pos + chunkSize;

            if (tag === 'FORM') {
                const formType = this.readString(4);
                if (formType === 'IHDR') {
                    name = this.parseIHDR(chunkSize - 4);
                } else {
                    const inner = this.parseBPOLInner(chunkSize - 4);
                    if (inner.name) name = inner.name;
                    if (inner.vertices.length > 0) {
                        vertices = inner.vertices;
                        featherAmount = inner.featherAmount;
                    }
                }
                this.pos = chunkEnd;
            } else if (tag === 'DATA') {
                // BPOL DATA: vertexCount(4) | vertices(n*8) | featherType(4) | featherAmount(4)
                if (chunkSize >= 12) {
                    const vertexCount = this.readUint32LE();
                    vertices = [];
                    for (let i = 0; i < vertexCount; i++) {
                        vertices.push({
                            x: this.readFloat32LE(),
                            z: this.readFloat32LE()
                        });
                    }
                    this.readUint32LE(); // featherType (skip)
                    featherAmount = this.readFloat32LE();
                }
                this.pos = chunkEnd;
            } else {
                this.pos = chunkEnd;
            }
        }

        return { name, vertices, featherAmount };
    }

    private parseBPLN(size: number, layerPath: string[], offset: number): BoundaryPolyline | null {
        const end = this.pos + size;
        let name = 'BoundaryPolyline';
        let vertices: Point2D[] = [];
        let width = 0, featherAmount = 0;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();
            const chunkEnd = this.pos + chunkSize;

            if (tag === 'FORM') {
                const formType = this.readString(4);
                if (formType === 'IHDR') {
                    name = this.parseIHDR(chunkSize - 4);
                } else {
                    const inner = this.parseBPLNInner(chunkSize - 4);
                    if (inner.name) name = inner.name;
                    if (inner.vertices.length > 0) {
                        vertices = inner.vertices;
                        width = inner.width;
                        featherAmount = inner.featherAmount;
                    }
                }
                this.pos = chunkEnd;
            } else if (tag === 'DATA') {
                // BPLN DATA: vertexCount(4) | vertices(n*8) | featherType(4) | featherAmount(4) | width(4)
                if (chunkSize >= 16) {
                    const vertexCount = this.readUint32LE();

                    vertices = [];
                    for (let i = 0; i < vertexCount; i++) {
                        vertices.push({
                            x: this.readFloat32LE(),
                            z: this.readFloat32LE()
                        });
                    }

                    // Read tail: featherType(4) + featherAmount(4) + width(4)
                    this.readUint32LE(); // featherType (skip)
                    featherAmount = this.readFloat32LE();
                    width = this.readFloat32LE();
                }
                this.pos = chunkEnd;
            } else {
                this.pos = chunkEnd;
            }
        }

        return {
            type: 'polyline',
            name,
            vertices,
            width,
            featherType: 0,
            featherAmount,
            layerPath,
            offset
        };
    }

    private parseBPLNInner(size: number): { name?: string; vertices: Point2D[]; width: number; featherAmount: number } {
        const end = this.pos + size;
        let name: string | undefined;
        let vertices: Point2D[] = [];
        let width = 0, featherAmount = 0;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();
            const chunkEnd = this.pos + chunkSize;

            if (tag === 'FORM') {
                const formType = this.readString(4);
                if (formType === 'IHDR') {
                    name = this.parseIHDR(chunkSize - 4);
                } else {
                    const inner = this.parseBPLNInner(chunkSize - 4);
                    if (inner.name) name = inner.name;
                    if (inner.vertices.length > 0) {
                        vertices = inner.vertices;
                        width = inner.width;
                        featherAmount = inner.featherAmount;
                    }
                }
                this.pos = chunkEnd;
            } else if (tag === 'DATA') {
                // BPLN DATA: vertexCount(4) | vertices(n*8) | featherType(4) | featherAmount(4) | width(4)
                if (chunkSize >= 16) {
                    const vertexCount = this.readUint32LE();
                    vertices = [];
                    for (let i = 0; i < vertexCount; i++) {
                        vertices.push({
                            x: this.readFloat32LE(),
                            z: this.readFloat32LE()
                        });
                    }
                    this.readUint32LE(); // featherType (skip)
                    featherAmount = this.readFloat32LE();
                    width = this.readFloat32LE();
                }
                this.pos = chunkEnd;
            } else {
                this.pos = chunkEnd;
            }
        }

        return { name, vertices, width, featherAmount };
    }

    private parseIHDR(size: number): string {
        const end = this.pos + size;

        while (this.pos < end - 8) {
            const tag = this.readString(4);
            const chunkSize = this.readUint32BE();

            if (tag === 'FORM') {
                const formType = this.readString(4);
                this.pos += chunkSize - 4;
            } else if (tag === 'DATA') {
                // IHDR DATA contains ID and name
                if (chunkSize > 4) {
                    this.pos += 4; // Skip ID
                    return this.readNullTerminatedString(chunkSize - 4);
                } else {
                    this.pos += chunkSize;
                }
            } else {
                this.pos += chunkSize;
            }
        }
        return 'Unknown';
    }

    // Reader helpers
    private readString(length: number): string {
        let str = '';
        for (let i = 0; i < length && this.pos < this.data.length; i++) {
            str += String.fromCharCode(this.data[this.pos++]);
        }
        return str;
    }

    private readStringAt(pos: number, length: number): string {
        let str = '';
        for (let i = 0; i < length && pos + i < this.data.length; i++) {
            str += String.fromCharCode(this.data[pos + i]);
        }
        return str;
    }

    private readNullTerminatedString(maxLength: number): string {
        let str = '';
        const end = Math.min(this.pos + maxLength, this.data.length);
        while (this.pos < end && this.data[this.pos] !== 0) {
            str += String.fromCharCode(this.data[this.pos++]);
        }
        if (this.pos < end) this.pos++; // Skip null terminator
        return str;
    }

    private readNullTerminatedStringAt(pos: number, maxLength: number): string {
        let str = '';
        const end = Math.min(pos + maxLength, this.data.length);
        while (pos < end && this.data[pos] !== 0) {
            str += String.fromCharCode(this.data[pos++]);
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

    private readFloat32LE(): number {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setUint8(0, this.data[this.pos]);
        view.setUint8(1, this.data[this.pos + 1]);
        view.setUint8(2, this.data[this.pos + 2]);
        view.setUint8(3, this.data[this.pos + 3]);
        this.pos += 4;
        return view.getFloat32(0, true);
    }
}

/**
 * Check if a point is inside a boundary
 */
export function isPointInBoundary(x: number, z: number, boundary: Boundary): boolean {
    switch (boundary.type) {
        case 'circle':
            return isPointInCircle(x, z, boundary);
        case 'rectangle':
            return isPointInRectangle(x, z, boundary);
        case 'polygon':
            return isPointInPolygon(x, z, boundary);
        case 'polyline':
            return isPointNearPolyline(x, z, boundary);
        default:
            return false;
    }
}

function isPointInCircle(x: number, z: number, circle: BoundaryCircle): boolean {
    const dx = x - circle.centerX;
    const dz = z - circle.centerZ;
    const distSq = dx * dx + dz * dz;
    const radiusSq = circle.radius * circle.radius;
    return distSq <= radiusSq;
}

function isPointInRectangle(x: number, z: number, rect: BoundaryRectangle): boolean {
    return x >= rect.x1 && x <= rect.x2 && z >= rect.z1 && z <= rect.z2;
}

function isPointInPolygon(x: number, z: number, polygon: BoundaryPolygon): boolean {
    const vertices = polygon.vertices;
    if (vertices.length < 3) return false;

    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].x, zi = vertices[i].z;
        const xj = vertices[j].x, zj = vertices[j].z;

        if (((zi > z) !== (zj > z)) &&
            (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function isPointNearPolyline(x: number, z: number, polyline: BoundaryPolyline): boolean {
    const vertices = polyline.vertices;
    const halfWidth = polyline.width / 2;

    for (let i = 0; i < vertices.length - 1; i++) {
        const dist = pointToSegmentDistance(
            x, z,
            vertices[i].x, vertices[i].z,
            vertices[i + 1].x, vertices[i + 1].z
        );
        if (dist <= halfWidth) return true;
    }
    return false;
}

function pointToSegmentDistance(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lengthSq = dx * dx + dz * dz;

    if (lengthSq === 0) {
        // Segment is a point
        return Math.sqrt((px - x1) ** 2 + (pz - z1) ** 2);
    }

    let t = ((px - x1) * dx + (pz - z1) * dz) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const nearestX = x1 + t * dx;
    const nearestZ = z1 + t * dz;

    return Math.sqrt((px - nearestX) ** 2 + (pz - nearestZ) ** 2);
}

/**
 * Find all boundaries that contain the given point
 */
export function findBoundariesAtPoint(x: number, z: number, boundaries: Boundary[]): Boundary[] {
    return boundaries.filter(b => isPointInBoundary(x, z, b));
}
