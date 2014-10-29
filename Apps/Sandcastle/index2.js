/*global require*/
/*global gallery_demos*/// defined by gallery/gallery-index.js, created by build
require({
    baseUrl : '.',
    paths : {
        domReady : '../../ThirdParty/requirejs-2.1.9/domReady',
        Cesium : '../../Source'
    }
}, ['Cesium/ThirdParty/knockout'], function(knockout) {
    "use strict";

    var viewModel = {
        galleryItems : gallery_demos
    };

    knockout.applyBindings(viewModel, document.body);

});