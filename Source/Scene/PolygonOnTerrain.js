/*global define*/
define([
        '../Core/ComponentDatatype',
        '../Core/Color',
        '../Core/defaultValue',
        '../Core/defined',
        '../Core/Ellipsoid',
        '../Core/EllipsoidTangentPlane',
        '../Core/Math',
        '../Core/Matrix4',
        '../Core/PolygonPipeline',
        '../Core/WindingOrder',
        '../Renderer/DrawCommand',
        './BlendingState',
        './CullFace',
        './Pass',
        './ShadowVolume'
    ], function(
        ComponentDatatype,
        Color,
        defaultValue,
        defined,
        Ellipsoid,
        EllipsoidTangentPlane,
        CesiumMath,
        Matrix4,
        PolygonPipeline,
        WindingOrder,
        DrawCommand,
        BlendingState,
        CullFace,
        Pass,
        ShadowVolume) {
    "use strict";

    var PolygonOnTerrain = function(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        var ellipsoid = defaultValue(options.ellipsoid, Ellipsoid.WGS84);
        var granularity = defaultValue(options.granularity, CesiumMath.RADIANS_PER_DEGREE);
        var boundary = options.boundary;

        this._ellipsoid = ellipsoid;
        this._granularity = granularity;
        this._boundary = boundary;

        this._va = undefined;
        this._sp = undefined;
        this._rs = undefined;

        this._commands = [];
    };

    var attributeLocations = {
        positionHigh : 0,
        positionLow : 1
    };

    PolygonOnTerrain.prototype.update = function(context, frameState, commandList) {

        if (!defined(this._va)) {
            var granularity = this._granularity;
            var ellipsoid = this._ellipsoid;

            var boundary = this._boundary;
            var interiorBoundaries = this._interiorBoundaries;

            //var positions = interiorBoundaries.length > 0 ? PolygonPipeline.eliminateHoles(boundary, interiorBoundaries) : boundary;
            var positions = boundary;

            // TODO
            var boundaryIndices = [];
            for (var i = 0; i < positions.length; ++i) {
                boundaryIndices.push(i);
            }

            var tangentPlane = EllipsoidTangentPlane.fromPoints(positions, ellipsoid);
            var positions2D = tangentPlane.projectPointsOntoPlane(positions);

            var originalWindingOrder = PolygonPipeline.computeWindingOrder2D(positions2D);
            if (originalWindingOrder === WindingOrder.CLOCKWISE) {
                positions2D.reverse();
                positions.reverse();
            }

            var indices = PolygonPipeline.triangulate(positions2D);
            /* If polygon is completely unrenderable, just use the first three vertices */
            if (indices.length < 3) {
                indices = [0, 1, 2];
            }

            //var geo = PolygonPipeline.computeSubdivision(ellipsoid, positions, indices, granularity);

            var shadowVolume = new ShadowVolume({
                context : context,
                positions : positions,
                indices : indices,
                boundaryIndices : boundaryIndices,
                interiorBoundaries : interiorBoundaries,
                granularity : granularity,
                ellipsoid : ellipsoid
            });

            var attributes = [{
                index                  : attributeLocations.positionHigh,
                vertexBuffer           : shadowVolume.vertexBuffer,
                componentsPerAttribute : 3,
                componentDatatype      : ComponentDatatype.FLOAT,
                offsetInBytes          : 0,
                strideInBytes          : ComponentDatatype.getSizeInBytes(ComponentDatatype.FLOAT) * 3 * 2
            }, {
                index                  : attributeLocations.positionLow,
                vertexBuffer           : shadowVolume.vertexBuffer,
                componentsPerAttribute : 3,
                componentDatatype      : ComponentDatatype.FLOAT,
                offsetInBytes          : ComponentDatatype.getSizeInBytes(ComponentDatatype.FLOAT) * 3,
                strideInBytes          : ComponentDatatype.getSizeInBytes(ComponentDatatype.FLOAT) * 3 * 2
            }];

            this._va = context.createVertexArray(attributes, shadowVolume.indexBuffer);

            this._capsAndWalls = shadowVolume.capsAndWalls;
            this._topCapAndWalls = shadowVolume.topCapAndWalls;
        }

        if (!defined(this._sp)) {
            var vs =
                'attribute vec3 positionHigh;\n' +
                'attribute vec3 positionLow;\n' +
                'void main() {\n' +
                '    gl_Position = czm_modelViewProjectionRelativeToEye * czm_translateRelativeToEye(positionHigh, positionLow);\n' +
                '}\n';

            var fs =
                'uniform vec4 color;\n' +
                'void main() {\n' +
                //'    gl_FragColor = vec4(1.0, 1.0, 0.0, 0.5);\n' +
                '    gl_FragColor = color;\n' +
                '}\n';

            this._sp = context.createShaderProgram(vs, fs, attributeLocations);
        }

        if (this._commands.length === 0) {
            this._rs = context.createRenderState({
                blending : BlendingState.ALPHA_BLEND,
                depthMask : false,
                depthTest : {
                    enabled : false
                },
                cull : {
                    enabled : true,
                    face : CullFace.BACK
                }
            });

            var drawCommands = this._capsAndWalls;
            var length = drawCommands.length;
            for (var j = 0; j < length; ++j) {
                var color = Color.fromRandom({alpha : 0.5});
                this._commands.push(new DrawCommand({
                    primitiveType : drawCommands[j].primitiveType,
                    offset : drawCommands[j].offset,
                    count : drawCommands[j].count,
                    vertexArray : this._va,
                    renderState : this._rs,
                    shaderProgram : this._sp,
                    owner : this,
                    modelMatrix : Matrix4.IDENTITY,
                    pass : Pass.TRANSLUCENT,
                    uniformMap : {
                        color : function() {
                            return color;
                        }
                    }
                }));
            }
        }

        var pass = frameState.passes;
        if (pass.render) {
            for (var k = 0; k < this._commands.length; ++k) {
                commandList.push(this._commands[k]);
            }
        }
    };

    return PolygonOnTerrain;
});
