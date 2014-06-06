/*
 * Test streaming interface.
 */

var mod_assert = require('assert');
var mod_krill = require('../lib/krill');

/* Set up the test case. */
var types, input, predicate, stream, value, warned, results;
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
predicate = mod_krill.createPredicate(input, types);
stream = mod_krill.createPredicateStream({ 'predicate': predicate });

/* Check initial conditions. */
mod_assert.deepEqual(stream.stats(), {
    'ninputs': 0,
    'nerrors': 0,
    'nfilteredout': 0
});

/* Check the "invalid object" warning.  */
stream.on('invalid_object', function (obj, err, count) {
	mod_assert.deepEqual(obj, { 'hostname': 'invalid' });
	/* JSSTYLED */
	mod_assert.ok(/no translation for field "latency"/, err.message);
	mod_assert.ok(count == 3);
	warned = true;
});

/* Collect the emitted records. */
results = [];
stream.on('data', function (c) { results.push(c); });

/* Write some records. */
stream.write({ 'hostname': 'spike', 'latency': 12 });		/* pass */
stream.write({ 'hostname': 'sharptooth', 'latency': 12 });	/* fail */
stream.write({ 'hostname': 'invalid' });			/* invalid */
stream.write({ 'hostname': 'sharptooth', 'latency': 400 });	/* pass */
stream.end();

/*
 * This is where we actually check that we emitted the proper records, in order,
 * as well as the appropriate warning.
 */
stream.on('end', function () {
	mod_assert.deepEqual(results, [ {
	    'hostname': 'spike',
	    'latency': 12
	}, {
	    'hostname': 'sharptooth',
	    'latency': 400
	} ]);
	mod_assert.ok(warned);
	mod_assert.deepEqual(stream.stats(), {
	    'ninputs': 4,
	    'nerrors': 1,
	    'nfilteredout': 1
	});
	console.error(stream.stats());
	console.log('test okay');
});
