/*global define*/
define([
        '../Core/TinGeometry',
        '../Core/defined'
    ], function(
        TinGeometry,
        defined) {
    "use strict";

    return function(tinGeometry, offset) {
        if (defined(offset)) {
            tinGeometry = TinGeometry.unpack(tinGeometry, offset);
        }
        return TinGeometry.createGeometry(tinGeometry);
    };
});
