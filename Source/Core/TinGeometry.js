/*global define*/
define([
        './BoundingSphere',
        './Cartesian3',
        './ComponentDatatype',
        './defaultValue',
        './defined',
        './DeveloperError',
        './Geometry',
        './GeometryAttribute',
        './GeometryAttributes',
        './GeometryPipeline',
        './PrimitiveType',
        './VertexFormat'
    ], function(
        BoundingSphere,
        Cartesian3,
        ComponentDatatype,
        defaultValue,
        defined,
        DeveloperError,
        Geometry,
        GeometryAttribute,
        GeometryAttributes,
        GeometryPipeline,
        PrimitiveType,
        VertexFormat) {
    "use strict";


    /**
     * Describes a cube centered at the origin.
     *
     * @alias TinGeometry
     * @constructor
     *
     * @param {Object} options Object with the following properties:
     * @param {Triangles[]} [position] The triangles vertices, 4 vertices per triangles: Triangle = Vtx[], Vtx = [x,y,z]
     * @param {ST[]} [st] The texture coord of the vertices, 4 per triangle: ST = [s,t]
     * @param {VertexFormat} [options.vertexFormat=VertexFormat.DEFAULT] The vertex attributes to be computed.
     *
     * @see TinGeometry.createGeometry
     * @see Packable
     *
     * @example
     * var box = new Cesium.TinGeometry({
     *   position : 
     *   st : 
     *   vertexFormat : Cesium.VertexFormat.POSITION_ONLY,
     * });
     * var geometry = Cesium.TinGeometry.createGeometry(tin);
     */
    var TinGeometry = function(options) {
        options = defaultValue(options, defaultValue.EMPTY_OBJECT);

        //>>includeStart('debug', pragmas.debug);
        if (!defined(options.position)) {
            throw new DeveloperError('options.position is required.');
        }
        if (!defined(options.st)) {
            throw new DeveloperError('options.st is required');
        }
        //>>includeEnd('debug');

        var vertexFormat = defaultValue(options.vertexFormat, VertexFormat.DEFAULT);

        var i,j,k;
        this._positions = [];
        if ( options.position.length && options.position[0].length ){
            for (i = 0; i < options.position.length; i++){
                for (j = 0; j < 3; j++){
                    var p = Cartesian3.fromDegrees( 
                            options.position[i][0][j][0], 
                            options.position[i][0][j][1],
                            options.position[i][0][j][2] );
                    this._positions.push( p.x );
                    this._positions.push( p.y );
                    this._positions.push( p.z );
                }
            }
        }
        else{ // position is a flat array
            for (i = 0; i < options.position.length; i++){
                this._positions.push( options.position[i] );
            }
        }

        this._st = [];
        if ( options.st.length && options.st[0].length ){
            for (i = 0; i < options.position.length; i++){
                for (j = 0; j < 3; j++){
                    for (k = 0; k < 2; k++){
                        this._st.push( options.st[i*4+j][k] ); // 4 vtx per triangle
                    }
                }
            }
        }
        else{ // st is already a flat array
            for (i = 0; i < options.st.length; i++){
                this._st.push( options.st[i] );
            }
        }

        this._vertexFormat = vertexFormat;
        this._workerName = 'createTinGeometry';
        /**
         * The number of elements used to pack the object into an array.
         * @type {Number}
         * the nb of vertices is packed in first place
         */
        this.packedLength = 1 + this._positions.length + this._st.length + VertexFormat.packedLength;
    };


    /**
     * Stores the provided instance into the provided array.
     * @function
     *
     * @param {Object} value The value to pack.
     * @param {Number[]} array The array to pack into.
     * @param {Number} [startingIndex=0] The index into the array at which to start packing the elements.
     */
    TinGeometry.pack = function(value, array, startingIndex) {
        if (!defined(value)) {
            throw new DeveloperError('value is required');
        }
        if (!defined(array)) {
            throw new DeveloperError('array is required');
        }

        startingIndex = defaultValue(startingIndex, 0);

        var curIdx = startingIndex;

        array[startingIndex] = value._positions.length;
        ++curIdx;

        var i;
        for (i = 0; i < value._positions.length; i++, curIdx++){
            array[curIdx] = value._positions[i];
        }

        for (i = 0; i < value._st.length; i++, curIdx++){
            array[curIdx] = value._st[i];
        }

        VertexFormat.pack(value._vertexFormat, array, curIdx);
    };


    /**
     * Retrieves an instance from a packed array.
     *
     * @param {Number[]} array The packed array.
     * @param {Number} [startingIndex=0] The starting index of the element to be unpacked.
     * @param {TinGeometry} [result] The object into which to store the result.
     */
    TinGeometry.unpack = function(array, startingIndex, result) {
        if (!defined(array)) {
            throw new DeveloperError('array is required');
        }

        startingIndex = defaultValue(startingIndex, 0);

        var scratchVertexFormat = new VertexFormat();
        var scratchPosition = [];
        var scratchSt = [];

        var curIdx = startingIndex;

        var len = array[curIdx];
        ++curIdx;
        var i,j;
        for (i = 0; i < len; i++, curIdx++){
            scratchPosition.push( array[curIdx] );
        }

        len = (len / 3) * 2;
        for (i = 0; i < len; i++, curIdx++){
            scratchSt.push( array[curIdx] );
        } 

        var vertexFormat = VertexFormat.unpack(array, curIdx, scratchVertexFormat);

        if (!defined(result)) {
            return new TinGeometry({
                position : scratchPosition,
                st : scratchSt,
                vertexFormat : scratchVertexFormat });
        }

        result._positions = scratchPosition;
        result._st = scratchSt;
        result._vertexFormat = VertexFormat.clone(vertexFormat, result._vertexFormat);

        return result;
    };

    /**
     * Computes the geometric representation of a tin, including its vertices, indices, and a bounding sphere.
     *
     * @param {TinGeometry} tinGeometry A description of the tin.
     * @returns {Geometry} The computed vertices and indices.
     */
    TinGeometry.createGeometry = function(tinGeometry) {
        var vertexFormat = tinGeometry._vertexFormat;

        var attributes = new GeometryAttributes();
        var position = new Float64Array(tinGeometry._positions.length);
        var i;
        for (i = 0; i < position.length; i++){
            position[i] = tinGeometry._positions[i];
        }
 
        var centroid = new Cartesian3(0,0,0);
        var curIdx = 0;
        for (i = 0; i < position.length; i+=3){
            centroid.x += position[i];
            centroid.y += position[i+1];
            centroid.z += position[i+2];
        }
        centroid.x /= position.length/3;
        centroid.y /= position.length/3;
        centroid.z /= position.length/3;

        // find a bounding sphere radius
        var radiusSquare = 0;
        for (i = 0; i<position.length; i+=3 ){
            var v = new Cartesian3( position[i] - centroid.x, position[i+1] - centroid.y, position[i+2] - centroid.z);
            var d2 = v.x*v.x + v.y*v.y + v.z*v.z;
            if ( d2 > radiusSquare ){ radiusSquare = d2; }
        }

        if (vertexFormat.position) {
            attributes.position = new GeometryAttribute({
                componentDatatype : ComponentDatatype.DOUBLE,
                componentsPerAttribute : 3,
                values : position
            });
        }

        if (vertexFormat.st) {
            var st = new Float32Array( tinGeometry._st.length);
            for (i = 0; i < st.length; i++){
                st[i] = tinGeometry._st[i];
            }
            attributes.st = new GeometryAttribute({
                componentDatatype : ComponentDatatype.FLOAT,
                componentsPerAttribute : 2,
                values : st
            });
        }

        var indices = new Uint16Array(position.length/3);
        for (i=0; i<indices.length; i++ ){ indices[i] = i; }


        var geom = new Geometry({
            attributes : attributes,
            indices : indices,
            primitiveType : PrimitiveType.TRIANGLES,
            boundingSphere : new BoundingSphere(centroid, Math.sqrt(radiusSquare))
        });
        
        if (vertexFormat.normal) {
            geom = GeometryPipeline.computeNormal( geom );
        }

        if (vertexFormat.tangent || vertexFormat.binorma) {
            geom = GeometryPipeline.computeBinormalAndTangent( geom );
        }

        return geom;
    };

    return TinGeometry;
});
