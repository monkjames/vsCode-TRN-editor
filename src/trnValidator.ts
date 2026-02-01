/**
 * TRN File Validator
 * Detects common errors and warnings in terrain boundary definitions
 */

import { Boundary, BoundaryCircle, BoundaryRectangle, BoundaryPolygon, BoundaryPolyline, Point2D } from './trnParser';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
    severity: IssueSeverity;
    message: string;
    boundaryIndex: number;
    boundaryType: string;
    details?: string;
}

export interface ValidationResult {
    issues: ValidationIssue[];
    stats: {
        errors: number;
        warnings: number;
        info: number;
    };
}

// World bounds for SWG (typical 16km x 16km maps)
const WORLD_MIN = -8192;
const WORLD_MAX = 8192;
const WORLD_WARN_MIN = -16384;
const WORLD_WARN_MAX = 16384;

export function validateTRN(boundaries: Boundary[]): ValidationResult {
    const issues: ValidationIssue[] = [];

    boundaries.forEach((boundary, index) => {
        // Check for NaN/Infinity in any numeric field
        checkForInvalidNumbers(boundary, index, issues);

        // Type-specific validation
        switch (boundary.type) {
            case 'circle':
                validateCircle(boundary, index, issues);
                break;
            case 'rectangle':
                validateRectangle(boundary, index, issues);
                break;
            case 'polygon':
                validatePolygon(boundary, index, issues);
                break;
            case 'polyline':
                validatePolyline(boundary, index, issues);
                break;
        }

        // Check feather values
        validateFeather(boundary, index, issues);
    });

    // Check for potential duplicates
    checkForDuplicates(boundaries, issues);

    // Sort by severity (errors first)
    issues.sort((a, b) => {
        const order = { error: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
    });

    return {
        issues,
        stats: {
            errors: issues.filter(i => i.severity === 'error').length,
            warnings: issues.filter(i => i.severity === 'warning').length,
            info: issues.filter(i => i.severity === 'info').length
        }
    };
}

function checkForInvalidNumbers(boundary: Boundary, index: number, issues: ValidationIssue[]): void {
    const checkValue = (value: number, fieldName: string) => {
        if (Number.isNaN(value)) {
            issues.push({
                severity: 'error',
                message: `NaN value in ${fieldName}`,
                boundaryIndex: index,
                boundaryType: boundary.type,
                details: `${boundary.type} #${index} has NaN in ${fieldName}`
            });
        } else if (!Number.isFinite(value)) {
            issues.push({
                severity: 'error',
                message: `Infinity value in ${fieldName}`,
                boundaryIndex: index,
                boundaryType: boundary.type,
                details: `${boundary.type} #${index} has Infinity in ${fieldName}`
            });
        }
    };

    if (boundary.type === 'circle') {
        checkValue(boundary.centerX, 'centerX');
        checkValue(boundary.centerZ, 'centerZ');
        checkValue(boundary.radius, 'radius');
    } else if (boundary.type === 'rectangle') {
        checkValue(boundary.x1, 'x1');
        checkValue(boundary.z1, 'z1');
        checkValue(boundary.x2, 'x2');
        checkValue(boundary.z2, 'z2');
    } else if (boundary.type === 'polygon' || boundary.type === 'polyline') {
        boundary.vertices.forEach((v, vi) => {
            checkValue(v.x, `vertex[${vi}].x`);
            checkValue(v.z, `vertex[${vi}].z`);
        });
    }
}

function validateCircle(circle: BoundaryCircle, index: number, issues: ValidationIssue[]): void {
    // Zero or negative radius
    if (circle.radius <= 0) {
        issues.push({
            severity: 'error',
            message: 'Circle has zero or negative radius',
            boundaryIndex: index,
            boundaryType: 'circle',
            details: `Radius: ${circle.radius}`
        });
    }

    // Very small radius (might be unintentional)
    if (circle.radius > 0 && circle.radius < 1) {
        issues.push({
            severity: 'warning',
            message: 'Circle has very small radius (< 1)',
            boundaryIndex: index,
            boundaryType: 'circle',
            details: `Radius: ${circle.radius.toFixed(4)}`
        });
    }

    // Extremely large radius
    if (circle.radius > 10000) {
        issues.push({
            severity: 'warning',
            message: 'Circle has very large radius (> 10000)',
            boundaryIndex: index,
            boundaryType: 'circle',
            details: `Radius: ${circle.radius.toFixed(1)}`
        });
    }

    // Center outside world bounds
    checkWorldBounds(circle.centerX, circle.centerZ, 'center', index, 'circle', issues);

    // Circle extends outside world bounds
    const minX = circle.centerX - circle.radius;
    const maxX = circle.centerX + circle.radius;
    const minZ = circle.centerZ - circle.radius;
    const maxZ = circle.centerZ + circle.radius;

    if (minX < WORLD_MIN || maxX > WORLD_MAX || minZ < WORLD_MIN || maxZ > WORLD_MAX) {
        issues.push({
            severity: 'info',
            message: 'Circle extends outside standard world bounds',
            boundaryIndex: index,
            boundaryType: 'circle',
            details: `Bounds: (${minX.toFixed(0)}, ${minZ.toFixed(0)}) to (${maxX.toFixed(0)}, ${maxZ.toFixed(0)})`
        });
    }
}

function validateRectangle(rect: BoundaryRectangle, index: number, issues: ValidationIssue[]): void {
    // Zero width or height
    const width = Math.abs(rect.x2 - rect.x1);
    const height = Math.abs(rect.z2 - rect.z1);

    if (width === 0 || height === 0) {
        issues.push({
            severity: 'error',
            message: 'Rectangle has zero area',
            boundaryIndex: index,
            boundaryType: 'rectangle',
            details: `Width: ${width}, Height: ${height}`
        });
    }

    // Very small rectangle
    if (width > 0 && width < 1 || height > 0 && height < 1) {
        issues.push({
            severity: 'warning',
            message: 'Rectangle has very small dimension (< 1)',
            boundaryIndex: index,
            boundaryType: 'rectangle',
            details: `Width: ${width.toFixed(4)}, Height: ${height.toFixed(4)}`
        });
    }

    // Corners outside world bounds
    checkWorldBounds(rect.x1, rect.z1, 'corner 1', index, 'rectangle', issues);
    checkWorldBounds(rect.x2, rect.z2, 'corner 2', index, 'rectangle', issues);

    // Inverted coordinates (x1 > x2 or z1 > z2) - should be normalized
    if (rect.x1 > rect.x2 || rect.z1 > rect.z2) {
        issues.push({
            severity: 'info',
            message: 'Rectangle coordinates may be inverted',
            boundaryIndex: index,
            boundaryType: 'rectangle',
            details: `x1=${rect.x1.toFixed(1)} > x2=${rect.x2.toFixed(1)} or z1=${rect.z1.toFixed(1)} > z2=${rect.z2.toFixed(1)}`
        });
    }
}

function validatePolygon(polygon: BoundaryPolygon, index: number, issues: ValidationIssue[]): void {
    // Too few vertices
    if (polygon.vertices.length < 3) {
        issues.push({
            severity: 'error',
            message: `Polygon has fewer than 3 vertices (${polygon.vertices.length})`,
            boundaryIndex: index,
            boundaryType: 'polygon',
            details: 'A polygon requires at least 3 vertices'
        });
        return;
    }

    // Check all vertices for world bounds
    polygon.vertices.forEach((v, vi) => {
        checkWorldBounds(v.x, v.z, `vertex ${vi}`, index, 'polygon', issues);
    });

    // Check for degenerate polygon (all points collinear)
    if (polygon.vertices.length >= 3 && isCollinear(polygon.vertices)) {
        issues.push({
            severity: 'error',
            message: 'Polygon vertices are collinear (zero area)',
            boundaryIndex: index,
            boundaryType: 'polygon',
            details: 'All vertices lie on a single line'
        });
    }

    // Check for self-intersection
    if (polygon.vertices.length >= 4 && isSelfIntersecting(polygon.vertices)) {
        issues.push({
            severity: 'warning',
            message: 'Polygon may be self-intersecting',
            boundaryIndex: index,
            boundaryType: 'polygon',
            details: 'Edges cross each other'
        });
    }

    // Check for duplicate consecutive vertices
    for (let i = 0; i < polygon.vertices.length; i++) {
        const next = (i + 1) % polygon.vertices.length;
        if (polygon.vertices[i].x === polygon.vertices[next].x &&
            polygon.vertices[i].z === polygon.vertices[next].z) {
            issues.push({
                severity: 'warning',
                message: 'Polygon has duplicate consecutive vertices',
                boundaryIndex: index,
                boundaryType: 'polygon',
                details: `Vertices ${i} and ${next} are identical`
            });
        }
    }
}

function validatePolyline(polyline: BoundaryPolyline, index: number, issues: ValidationIssue[]): void {
    // Too few vertices
    if (polyline.vertices.length < 2) {
        issues.push({
            severity: 'error',
            message: `Polyline has fewer than 2 vertices (${polyline.vertices.length})`,
            boundaryIndex: index,
            boundaryType: 'polyline',
            details: 'A polyline requires at least 2 vertices'
        });
        return;
    }

    // Zero or negative width
    if (polyline.width <= 0) {
        issues.push({
            severity: 'error',
            message: 'Polyline has zero or negative width',
            boundaryIndex: index,
            boundaryType: 'polyline',
            details: `Width: ${polyline.width}`
        });
    }

    // Very small width
    if (polyline.width > 0 && polyline.width < 1) {
        issues.push({
            severity: 'warning',
            message: 'Polyline has very small width (< 1)',
            boundaryIndex: index,
            boundaryType: 'polyline',
            details: `Width: ${polyline.width.toFixed(4)}`
        });
    }

    // Check vertices for world bounds
    polyline.vertices.forEach((v, vi) => {
        checkWorldBounds(v.x, v.z, `vertex ${vi}`, index, 'polyline', issues);
    });

    // Check for zero-length segments
    for (let i = 0; i < polyline.vertices.length - 1; i++) {
        const v1 = polyline.vertices[i];
        const v2 = polyline.vertices[i + 1];
        if (v1.x === v2.x && v1.z === v2.z) {
            issues.push({
                severity: 'warning',
                message: 'Polyline has zero-length segment',
                boundaryIndex: index,
                boundaryType: 'polyline',
                details: `Segment ${i} to ${i + 1} has zero length`
            });
        }
    }
}

function validateFeather(boundary: Boundary, index: number, issues: ValidationIssue[]): void {
    if (boundary.featherAmount < 0) {
        issues.push({
            severity: 'warning',
            message: 'Negative feather amount',
            boundaryIndex: index,
            boundaryType: boundary.type,
            details: `Feather: ${boundary.featherAmount}`
        });
    }

    if (boundary.featherAmount > 1) {
        issues.push({
            severity: 'info',
            message: 'Feather amount greater than 1',
            boundaryIndex: index,
            boundaryType: boundary.type,
            details: `Feather: ${boundary.featherAmount.toFixed(4)}`
        });
    }
}

function checkWorldBounds(x: number, z: number, location: string, index: number, type: string, issues: ValidationIssue[]): void {
    // Error for extreme values
    if (x < WORLD_WARN_MIN || x > WORLD_WARN_MAX || z < WORLD_WARN_MIN || z > WORLD_WARN_MAX) {
        issues.push({
            severity: 'error',
            message: `Coordinates far outside world bounds at ${location}`,
            boundaryIndex: index,
            boundaryType: type,
            details: `(${x.toFixed(1)}, ${z.toFixed(1)}) - expected within +-16384`
        });
    }
    // Warning for outside standard bounds but within extended
    else if (x < WORLD_MIN || x > WORLD_MAX || z < WORLD_MIN || z > WORLD_MAX) {
        issues.push({
            severity: 'info',
            message: `Coordinates outside standard world bounds at ${location}`,
            boundaryIndex: index,
            boundaryType: type,
            details: `(${x.toFixed(1)}, ${z.toFixed(1)}) - standard bounds are +-8192`
        });
    }
}

function isCollinear(vertices: Point2D[]): boolean {
    if (vertices.length < 3) return true;

    const v0 = vertices[0];
    const v1 = vertices[1];

    // Check if all other vertices are collinear with first two
    for (let i = 2; i < vertices.length; i++) {
        const v2 = vertices[i];
        // Cross product should be zero for collinear points
        const cross = (v1.x - v0.x) * (v2.z - v0.z) - (v1.z - v0.z) * (v2.x - v0.x);
        if (Math.abs(cross) > 0.0001) {
            return false;
        }
    }
    return true;
}

function isSelfIntersecting(vertices: Point2D[]): boolean {
    const n = vertices.length;
    if (n < 4) return false;

    // Check all pairs of non-adjacent edges
    for (let i = 0; i < n; i++) {
        const a1 = vertices[i];
        const a2 = vertices[(i + 1) % n];

        for (let j = i + 2; j < n; j++) {
            // Skip adjacent edges
            if (j === (i + n - 1) % n) continue;

            const b1 = vertices[j];
            const b2 = vertices[(j + 1) % n];

            if (segmentsIntersect(a1, a2, b1, b2)) {
                return true;
            }
        }
    }
    return false;
}

function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D): boolean {
    const d1 = direction(b1, b2, a1);
    const d2 = direction(b1, b2, a2);
    const d3 = direction(a1, a2, b1);
    const d4 = direction(a1, a2, b2);

    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
    }

    return false;
}

function direction(a: Point2D, b: Point2D, c: Point2D): number {
    return (c.x - a.x) * (b.z - a.z) - (b.x - a.x) * (c.z - a.z);
}

function checkForDuplicates(boundaries: Boundary[], issues: ValidationIssue[]): void {
    const seen = new Map<string, number>();

    boundaries.forEach((b, index) => {
        let key = '';

        if (b.type === 'circle') {
            key = `circle:${b.centerX.toFixed(1)}:${b.centerZ.toFixed(1)}:${b.radius.toFixed(1)}`;
        } else if (b.type === 'rectangle') {
            key = `rect:${b.x1.toFixed(1)}:${b.z1.toFixed(1)}:${b.x2.toFixed(1)}:${b.z2.toFixed(1)}`;
        } else if (b.type === 'polygon' && b.vertices.length > 0) {
            key = `poly:${b.vertices.map(v => `${v.x.toFixed(1)},${v.z.toFixed(1)}`).join(':')}`;
        } else if (b.type === 'polyline' && b.vertices.length > 0) {
            key = `line:${b.vertices.map(v => `${v.x.toFixed(1)},${v.z.toFixed(1)}`).join(':')}:${b.width.toFixed(1)}`;
        }

        if (key) {
            const existingIndex = seen.get(key);
            if (existingIndex !== undefined) {
                issues.push({
                    severity: 'warning',
                    message: 'Possible duplicate boundary',
                    boundaryIndex: index,
                    boundaryType: b.type,
                    details: `Same as boundary #${existingIndex}`
                });
            } else {
                seen.set(key, index);
            }
        }
    });
}
