/*
 * examples/basic.js: outline basic usage
 */

var krill = require('../lib/krill');

var predicate = {
    'or': [
	{ 'eq': [ 'hostname', 'spike' ] },
	{ 'gt': [ 'latency', 300 ] }
    ]
};

/* Validate predicate syntax and throw on error. */
krill.validateSyntax(predicate);
console.log(predicate);

/* Validate types and throw on error. */
krill.validateSemantics({
    'hostname': 'string',
    'latency': 'numeric'
}, predicate);

/* Check whether this predicate is trivial (always returns true) */
console.log('trivial? ', !krill.nonTrivial(predicate));

/* Enumerate the fields contained in this predicate. */
console.log('fields: ', krill.fields(predicate).join(', '));

/* Print a DTrace-like representation of the predicate. */
console.log('DTrace format: ', krill.print(predicate));

/* Evaluate the predicate for a specific set of values (should return true) */
var values = [ {
    'hostname': 'spike',
    'latency': 12
}, {
    'hostname': 'sharptooth',
    'latency': 400
}, {
    'hostname': 'sharptooth',
    'latency': 15
} ];

values.forEach(function (val) {
	console.log(val, krill.eval(predicate, val));
});
