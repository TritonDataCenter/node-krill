/*
 * examples/basic.js: outline basic usage
 */

var krill = require('../lib/krill');

/*
 * Example user input.  There are two fields: "hostname", a string, and
 * "latency", a number.
 */
var types = {
    'hostname': 'string',
    'latency': 'number'
};

/*
 * This predicate will be true if the "hostname" value is "spike" OR the
 * "latency" variable is a number greater than 300.
 */
var input = {
    'or': [
	{ 'eq': [ 'hostname', 'spike' ] },
	{ 'gt': [ 'latency', 300 ] }
    ]
};

/* Validate predicate syntax and types and throw on error. */
var predicate = krill.createPredicate(input, types);
console.log(input);

/* Check whether this predicate is trivial (always returns true) */
console.log('trivial? ', predicate.trivial());

/* Enumerate the fields contained in this predicate. */
console.log('fields: ', predicate.fields().join(', '));

/* Print a DTrace-like representation of the predicate. */
console.log('DTrace format: ', predicate.toCStyleString());

/* Evaluate the predicate for specific sets of values. */

/* Should print "true".  */
var value = { 'hostname': 'spike', 'latency': 12 };
console.log(value, predicate.eval(value));

/* Should print "true".  */
value = { 'hostname': 'sharptooth', 'latency': 400 };
console.log(value, predicate.eval(value));

/* Should print "false".  */
value = { 'hostname': 'sharptooth', 'latency': 12 };
console.log(value, predicate.eval(value));
