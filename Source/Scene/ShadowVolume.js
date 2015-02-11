/*global define*/
define([
        '../Core/Cartesian3',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/EncodedCartesian3',
        '../Core/IndexDatatype',
        '../Core/PrimitiveType',
        '../Renderer/BufferUsage'
    ], function(
        Cartesian3,
        defaultValue,
        defined,
        EncodedCartesian3,
        IndexDatatype,
        PrimitiveType,
        BufferUsage) {
    "use strict";

    function getSurfaceDelta(ellipsoid, granularity) {
        var refDistance = ellipsoid.maximumRadius;
        return refDistance - (refDistance * Math.cos(granularity / 2.0));
    }

    var scratchNormal = new Cartesian3();

    var ShadowVolume = function(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        var context = options.context;
        var positions = options.positions;
        var indices = options.indices;
        var boundaryIndices = options.boundaryIndices;
        var interiorBoundaries = options.interiorBoundaries;
        var granularity = options.granularity;
        var ellipsoid = options.ellipsoid;

        var numberOfInteriorBoundariesPositions = 0;
        var numberOfInteriorBoundariesPositionsM1 = 0;

        var numInteriorBoundaries = defined(interiorBoundaries) ? interiorBoundaries.length : 0;

        var j;
        for (j = 0; j < numInteriorBoundaries; ++j) {
            var interiorBoundariesLength = interiorBoundaries[j].length;
            numberOfInteriorBoundariesPositions += interiorBoundariesLength;
            numberOfInteriorBoundariesPositionsM1 += interiorBoundariesLength - 1;
        }

        var numberOfInteriorBoundariesIndices = (numberOfInteriorBoundariesPositionsM1 * 3) * 2;

        //
        // Wall needs to raise above ellipsoid and terrain
        //
        var maxAlt = 8500.0; // TODO: get max alt of terrain
        var surfaceDelta = getSurfaceDelta(ellipsoid, granularity);
        var upDelta = maxAlt + surfaceDelta;

        //
        // Since the interior of the volume is just the mesh extruded both
        // directions along it's normals, we need twice as much vertex and
        // index data.
        //
        // Then we need to consider the boundary: Each point turns into
        // two: a top and a bottom point.
        //
        var numPositions = positions.length;
        var numIndices = indices.length;
        var numBoundaryIndices = boundaryIndices.length;

        var numCapIndices = numIndices + numIndices;
        var numWallIndices = numBoundaryIndices + numBoundaryIndices;
        var numInteriorWallIndices = numberOfInteriorBoundariesPositions;

        var numTotalVertices = numPositions + numPositions;
        var numTotalIndices = numCapIndices + numWallIndices;

        var numberOfVertices = numTotalVertices + numberOfInteriorBoundariesPositions + numberOfInteriorBoundariesPositions;
        var numberOfIndices = numTotalIndices + numberOfInteriorBoundariesIndices;

        var vbPositions = new Float32Array(numberOfVertices * 3 * 2);
        var vbNormals = new Float32Array(numberOfVertices * 3);
        var ibIndices = IndexDatatype.createTypedArray(numberOfVertices, numberOfIndices);

        var position;
        var topPosition;
        var normal;

        var index = 0;
        var normalIndex = 0;
        for (j = 0; j < numPositions; ++j) {
            position = positions[j];
            normal = ellipsoid.geodeticSurfaceNormal(position, scratchNormal);

            topPosition = Cartesian3.multiplyByScalar(normal, upDelta, normal);
            Cartesian3.add(position, topPosition, topPosition);

            EncodedCartesian3.writeElements(topPosition, vbPositions, index);
            EncodedCartesian3.writeElements(position, vbPositions, index + 6);
            index += 12;

            Cartesian3.pack(Cartesian3.ZERO, vbNormals, normalIndex);
            Cartesian3.pack(normal, vbNormals, normalIndex + 3);
            normalIndex += 6;
        }

        //
        // This is creating duplicate vertices with some of the above - not ideal
        //
        var k;
        var interiorBoundary;
        var numBoundaryPositions;

        for (j = 0; j < numInteriorBoundaries; ++j) {
            interiorBoundary = interiorBoundaries[j];
            numBoundaryPositions = interiorBoundary.length;

            for (k = 0; k < numBoundaryPositions; ++k) {
                position = interiorBoundary[k];
                normal = ellipsoid.geodeticSurfaceNormal(position, scratchNormal);

                topPosition = Cartesian3.multiplyByScalar(upDelta, normal, scratchNormal);
                Cartesian3.add(position, topPosition, topPosition);

                EncodedCartesian3.writeElements(topPosition, vbPositions, index);
                EncodedCartesian3.writeElements(position, vbPositions, index + 6);
                index += 12;

                Cartesian3.pack(Cartesian3.ZERO, vbNormals, normalIndex);
                Cartesian3.pack(normal, vbNormals, normalIndex + 3);
                normalIndex += 6;
            }
        }

        // TODO: Optimize indices?

        var i0;
        var i1;
        var i2;

        index = 0;

        //
        // Top Cap - Triangles
        //
        for (j = 0; j < numIndices; j += 3) {
            i0 = indices[j] * 2;
            i1 = indices[j + 1] * 2;
            i2 = indices[j + 2] * 2;

            ibIndices[index++] = i0;
            ibIndices[index++] = i1;
            ibIndices[index++] = i2;
        }

        //
        // Bottom Cap - Triangles, Swap order to maintain CCW
        //
        for (j = 0; j < numIndices; j += 3) {
            i0 = indices[j] * 2;
            i1 = indices[j + 1] * 2;
            i2 = indices[j + 2] * 2;

            ibIndices[index++] = i2 + 1;
            ibIndices[index++] = i1 + 1;
            ibIndices[index++] = i0 + 1;
        }

        //
        // Wall - Triangle Strip
        //
        var firstIndex = boundaryIndices[0] * 2;
        ibIndices[index++] = firstIndex;
        ibIndices[index++] = firstIndex + 1;

        for (j = 0; j < numBoundaryIndices - 1; ++j) {
            var topRight = boundaryIndices[j + 1] * 2;
            var bottomRight = topRight + 1;

            ibIndices[index++] = topRight;
            ibIndices[index++] = bottomRight;
        }

        //
        // Interior Wall - Triangles
        //
        var interiorIndex = numTotalVertices;
        for (j = 0; j < numInteriorBoundaries; ++j) {
            interiorBoundary = interiorBoundaries[j];
            numBoundaryPositions = interiorBoundary.length;

            for (k = 0; k < numBoundaryPositions; ++k) {
                ibIndices[index++] = interiorIndex;
                ibIndices[index++] = interiorIndex + 1;
                ibIndices[index++] = interiorIndex + 2;

                ibIndices[index++] = interiorIndex + 1;
                ibIndices[index++] = interiorIndex + 3;
                ibIndices[index++] = interiorIndex + 2;

                interiorIndex += 2;
            }
            interiorIndex += 2;
        }

        var positionBuffer = context.createVertexBuffer(vbPositions, BufferUsage.STATIC_DRAW);
        var normalBuffer = context.createVertexBuffer(vbNormals, BufferUsage.STATIC_DRAW);

        var indexDatatype = (ibIndices.BYTES_PER_ELEMENT === 2) ?  IndexDatatype.UNSIGNED_SHORT : IndexDatatype.UNSIGNED_INT;
        var indexBuffer = context.createIndexBuffer(ibIndices, BufferUsage.STATIC_DRAW, indexDatatype);

        var capsAndWalls = [{
            offset : 0,
            count : numCapIndices,
            primitiveType : PrimitiveType.TRIANGLES
        }];

        var topCapAndWalls = [{
            offset : 0,
            count : numCapIndices / 2,
            primitiveType : PrimitiveType.TRIANGLES
        }];

        var walls = {
            offset : numCapIndices,
            count : numWallIndices,
            primitiveType : PrimitiveType.TRIANGLE_STRIP
        };
        capsAndWalls.push(walls);
        topCapAndWalls.push(walls);

        if (numInteriorWallIndices > 0) {
            var interiorWalls = {
                offset : numWallIndices + numCapIndices,
                count : numInteriorWallIndices,
                primitiveType : PrimitiveType.TRIANGLES
            };
            capsAndWalls.push(interiorWalls);
            topCapAndWalls.push(interiorWalls);
        }

        this.positionBuffer = positionBuffer;
        this.normalBuffer = normalBuffer;
        this.indexBuffer = indexBuffer;
        this.capsAndWalls = capsAndWalls;
        this.topCapAndWalls = topCapAndWalls;
    };

    return ShadowVolume;
});