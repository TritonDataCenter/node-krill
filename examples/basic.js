/*
 * examples/basic.js: outline basic usage
 */

var krill = require('../lib/krill');

var typesconf, predconf, predicate, values;

typesconf = {
    'hostname': 'string',
    'latency': 'numeric'
};

predconf = {
    'or': [
	{ 'eq': [ 'hostname', 'spike' ] },
	{ 'gt': [ 'latency', 300 ] }
    ]
};

/* Validate predicate syntax and types and throw on error. */
predicate = krill.createPredicate(predconf, typesconf);
console.log(predconf);

/* Check whether this predicate is trivial (always returns true) */
console.log('trivial? ', predicate.trivial());

/* Enumerate the fields contained in this predicate. */
console.log('fields: ', predicate.fields().join(', '));

/* Print a DTrace-like representation of the predicate. */
console.log('DTrace format: ', predicate.toCStyleString());

/* Evaluate the predicate for a specific set of values (should return true) */
values = [ {
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
	console.log(val, predicate.eval(val));
});
