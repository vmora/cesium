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
        '../Shaders/ShadowVolumeFS',
        '../Shaders/ShadowVolumeVS',
        './BlendingState',
        './CullFace',
        './DepthFunction',
        './Pass',
        './ShadowVolume',
        './StencilFunction',
        './StencilOperation'
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
        ShadowVolumeFS,
        ShadowVolumeVS,
        BlendingState,
        CullFace,
        DepthFunction,
        Pass,
        ShadowVolume,
        StencilFunction,
        StencilOperation) {
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

        this._zFailCommands = [];
        this._zPassCommands = [];
        this._colorInsideSphereCommands = [];
        this._colorOutsideSphereCommands = [];
    };

    var attributeLocations = {
        positionHigh : 0,
        positionLow : 1,
        normal : 2
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
            boundaryIndices.push(0);

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
                vertexBuffer           : shadowVolume.positionBuffer,
                componentsPerAttribute : 3,
                componentDatatype      : ComponentDatatype.FLOAT,
                offsetInBytes          : 0,
                strideInBytes          : ComponentDatatype.getSizeInBytes(ComponentDatatype.FLOAT) * 3 * 2
            }, {
                index                  : attributeLocations.positionLow,
                vertexBuffer           : shadowVolume.positionBuffer,
                componentsPerAttribute : 3,
                componentDatatype      : ComponentDatatype.FLOAT,
                offsetInBytes          : ComponentDatatype.getSizeInBytes(ComponentDatatype.FLOAT) * 3,
                strideInBytes          : ComponentDatatype.getSizeInBytes(ComponentDatatype.FLOAT) * 3 * 2
            }, {
                index                  : attributeLocations.normal,
                vertexBuffer           : shadowVolume.normalBuffer,
                componentsPerAttribute : 3,
                componentDatatype      : ComponentDatatype.FLOAT
            }];

            this._va = context.createVertexArray(attributes, shadowVolume.indexBuffer);

            this._capsAndWalls = shadowVolume.capsAndWalls;
            this._topCapAndWalls = shadowVolume.topCapAndWalls;
        }

        if (!defined(this._sp)) {
            this._sp = context.createShaderProgram(ShadowVolumeVS, ShadowVolumeFS, attributeLocations);
        }

        if (this._zFailCommands.length === 0) {
            var uniformMap = {
                centralBodyMinimumAltitude : function() {
                    return -100.0;
                },
                LODNegativeToleranceOverDistance : function() {
                    return -2;
                }
            };

            var disableColorWrites = {
                red : false,
                green : false,
                blue : false,
                alpha : false
            };

            var zFailRenderState = context.createRenderState({
                colorMask : disableColorWrites,
                stencilTest : {
                    enabled : true,
                    frontFunction : StencilFunction.ALWAYS,
                    frontOperation : {
                        fail : StencilOperation.KEEP,
                        zFail : StencilOperation.DECREMENT_WRAP,
                        zPass : StencilOperation.KEEP
                    },
                    backFunction : StencilFunction.ALWAYS,
                    backOperation : {
                        fail : StencilOperation.KEEP,
                        zFail : StencilOperation.INCREMENT_WRAP,
                        zPass : StencilOperation.KEEP
                    },
                    reference : 0,
                    mask : ~0
                },
                depthTest : {
                    enabled : true
                },
                depthMask : false
            });

            var commands = this._capsAndWalls;
            var commandsLength = commands.length;
            var j;
            for (j = 0; j < commandsLength; ++j) {
                this._zFailCommands.push(new DrawCommand({
                    primitiveType : commands[j].primitiveType,
                    offset : commands[j].offset,
                    count : commands[j].count,
                    vertexArray : this._va,
                    renderState : zFailRenderState,
                    shaderProgram : this._sp,
                    uniformMap : uniformMap,
                    owner : this,
                    modelMatrix : Matrix4.IDENTITY,
                    pass : Pass.TRANSLUCENT
                }));
            }

            var zPassRenderState = context.createRenderState({
                colorMask : disableColorWrites,
                stencilTest : {
                    enabled : true,
                    frontFunction : StencilFunction.ALWAYS,
                    frontOperation : {
                        fail : StencilOperation.KEEP,
                        zFail : StencilOperation.KEEP,
                        zPass : StencilOperation.INCREMENT_WRAP
                    },
                    backFunction : StencilFunction.ALWAYS,
                    backOperation : {
                        fail : StencilOperation.KEEP,
                        zFail : StencilOperation.KEEP,
                        zPass : StencilOperation.DECREMENT_WRAP
                    },
                    reference : 0,
                    mask : ~0
                },
                depthTest : {
                    enabled : true
                },
                depthMask : false
            });

            commands = this._topCapAndWalls;
            commandsLength = commands.length;
            for (j = 0; j < commandsLength; ++j) {
                this._zPassCommands.push(new DrawCommand({
                    primitiveType : commands[j].primitiveType,
                    offset : commands[j].offset,
                    count : commands[j].count,
                    vertexArray : this._va,
                    renderState : zPassRenderState,
                    shaderProgram : this._sp,
                    uniformMap : uniformMap,
                    owner : this,
                    modelMatrix : Matrix4.IDENTITY,
                    pass : Pass.TRANSLUCENT
                }));
            }

            var colorStencilTest = {
                enabled : true,
                frontFunction : StencilFunction.NOT_EQUAL,
                frontOperation : {
                    fail : StencilOperation.KEEP,
                    zFail : StencilOperation.KEEP,
                    zPass : StencilOperation.DECREMENT
                },
                backFunction : StencilFunction.NOT_EQUAL,
                backOperation : {
                    fail : StencilOperation.KEEP,
                    zFail : StencilOperation.KEEP,
                    zPass : StencilOperation.DECREMENT
                },
                reference : 0,
                mask : ~0
            };

            var colorInsideSphereRenderState = context.createRenderState({
                stencilTest : colorStencilTest,
                depthTest : {
                    enabled : true,
                    func : DepthFunction.ALWAYS
                },
                depthMask : false
            });

            commands = this._capsAndWalls;
            commandsLength = commands.length;
            for (j = 0; j < commandsLength; ++j) {
                this._colorInsideSphereCommands.push(new DrawCommand({
                    primitiveType : commands[j].primitiveType,
                    offset : commands[j].offset,
                    count : commands[j].count,
                    vertexArray : this._va,
                    renderState : colorInsideSphereRenderState,
                    shaderProgram : this._sp,
                    uniformMap : uniformMap,
                    owner : this,
                    modelMatrix : Matrix4.IDENTITY,
                    pass : Pass.TRANSLUCENT
                }));
            }

            var colorOutsideSphereRenderState = context.createRenderState({
                stencilTest : colorStencilTest,
                cull : {
                    enabled : true,
                    face : CullFace.BACK
                },
                depthTest : {
                    enabled : true
                },
                depthMask : false
            });

            commands = this._topCapAndWalls;
            commandsLength = commands.length;
            for (j = 0; j < commandsLength; ++j) {
                this._colorOutsideSphereCommands.push(new DrawCommand({
                    primitiveType : commands[j].primitiveType,
                    offset : commands[j].offset,
                    count : commands[j].count,
                    vertexArray : this._va,
                    renderState : colorOutsideSphereRenderState,
                    shaderProgram : this._sp,
                    uniformMap : uniformMap,
                    owner : this,
                    modelMatrix : Matrix4.IDENTITY,
                    pass : Pass.TRANSLUCENT
                }));
            }
        }

        var pass = frameState.passes;
        if (pass.render) {
            // intersects near/far plane: z-fail else z-pass
            // inside bounding sphere : colorInsideSphere commands else color outside

            var k;
            var stencilPassCommands = this._zPassCommands;
            var stencilPassCommandsLength = stencilPassCommands.length;
            for (k = 0; k < stencilPassCommandsLength; ++k) {
                commandList.push(stencilPassCommands[k]);
            }

            var colorPassCommands = this._colorOutsideSphereCommands;
            var colorPassCommandsLength = colorPassCommands.length;
            for (k = 0; k < colorPassCommandsLength; ++k) {
                commandList.push(colorPassCommands[k]);
            }
        }
    };

    return PolygonOnTerrain;
});
