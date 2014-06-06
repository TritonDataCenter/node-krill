/*
 * examples/stream.js: outline streaming usage
 */

var krill = require('../lib/krill');

/*
 * See the "basic" example first.
 */

var types, input, predicate, stream, value;
types = {
    'hostname': 'string',
    'latency': 'number'
};
input = {
    'or': [
	{ 'eq': [ 'hostname', 'spike' ] },
	{ 'gt': [ 'latency', 300 ] }
    ]
};
predicate = krill.createPredicate(input, types);
stream = krill.createPredicateStream({ 'predicate': predicate });

/* Shows that nothing's happened yet. */
console.log(stream.stats());

stream.write({ 'hostname': 'spike', 'latency': 12 });
stream.write({ 'hostname': 'sharptooth', 'latency': 12 });
stream.write({ 'hostname': 'sharptooth', 'latency': 400 });

/* Prints only the first and third data points. */
stream.on('data', function (c) { console.log(c); });

/* Prints a warning for invalid records. */
stream.on('invalid_object', function (obj, err, count) {
	console.error('object %d is invalid: %s', count, err.message);
	console.error('object was: %s', JSON.stringify(obj));
});
stream.write({ 'hostname': 'invalid' });

/* Shows that 4 objects were processed, 1 was invalid, and 1 was ignored. */
stream.on('end', function () { console.log(stream.stats()); });
stream.end();
