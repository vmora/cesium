/*global define*/
define([
        '../Core/defaultValue',
        '../Core/defined'
    ], function(
        defaultValue,
        defined) {
    "use strict";

    function createGetter(name, privateName, subscriptionName) {
        return function() {
            return this[privateName];
        };
    }

    function createSetter(name, privateName, subscriptionName) {
        return function(value) {
            var oldValue = this[privateName];
            var subscription = this[subscriptionName];
            if (defined(subscription)) {
                subscription();
                this[subscriptionName] = undefined;
            }
            if (oldValue !== value) {
                this[privateName] = value;
                this._definitionChanged.raiseEvent(this, name, value, oldValue);
            }
            if (defined(value) && defined(value.definitionChanged)) {
                this[subscriptionName] = value.definitionChanged.addEventListener(function() {
                    this._definitionChanged.raiseEvent(this, name, value, value);
                }, this);
            }
        };
    }

    function createProperty(name, privateName, subscriptionName, configurable) {
        return {
            configurable : configurable,
            get : createGetter(name, privateName, subscriptionName),
            set : createSetter(name, privateName, subscriptionName)
        };
    }

    /**
     * Used to consistently define all DataSources graphics objects.
     * This is broken into two functions because the Chrome profiler does a better
     * job of optimizing lookups if it notices that the string is constant throughout the function.
     * @private
     */
    function createPropertyDescriptor(name, configurable) {
        return createProperty(name, '_' + name, '_' + name + 'Subscription', defaultValue(configurable, false));
    }

    return createPropertyDescriptor;
});