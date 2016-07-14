/*
 * A test suite for krill.js
 */

var mod_assert = require('assert');
var mod_krill = require('../lib/krill');

var pred;

/*
 * Test the trivial predicate.
 */
pred = mod_krill.createPredicate({});
mod_assert.ok(pred.trivial());
mod_assert.deepEqual([], pred.fields());
mod_assert.deepEqual({}, pred.fieldsAndValues());
mod_assert.equal('1', pred.toCStyleString());
mod_assert.ok(pred.eval({}));
mod_assert.ok(pred.eval({ 'hostname': 'sharptooth' }));

/*
 * Test an "eq" predicate.
 */
pred = mod_krill.createPredicate(
    { 'eq': [ 'zonename', 'bar' ] },
    { 'zonename': 'string' });
mod_assert.ok(!pred.trivial());
mod_assert.deepEqual([ 'zonename' ], pred.fields());
mod_assert.deepEqual({ zonename: [ 'bar' ] }, pred.fieldsAndValues());
mod_assert.equal('zonename == "bar"', pred.toCStyleString());
mod_assert.throws(function () { pred.eval({}); }, /no translation/);
mod_assert.ok(pred.eval({ 'zonename': 'bar' }));
mod_assert.ok(!pred.eval({ 'zonename': 'bob' }));

/*
 * Test a more complicated predicate, including "and", "ne" and "ge".
 */
pred = mod_krill.createPredicate({
    'and': [
	{ 'eq': [ 'zonename', 'bar' ] },
	{ 'ne': [ 'hostname', 'sharptooth' ] },
	{ 'ge': [ 'latency', 15 ] }
    ]
}, {
    'zonename': 'string',
    'hostname': 'string',
    'latency': 'number'
});
mod_assert.ok(!pred.trivial());
mod_assert.deepEqual([ 'hostname', 'latency', 'zonename' ],
    pred.fields().sort());
mod_assert.deepEqual({
    zonename: [ 'bar' ],
    hostname: [ 'sharptooth' ],
    latency: [ 15 ]
}, pred.fieldsAndValues());
mod_assert.equal('(zonename == "bar") && (hostname != "sharptooth") && ' +
    '(latency >= 15)', pred.toCStyleString());
mod_assert.throws(function () { pred.eval({}); }, /no translation/);
mod_assert.throws(function () { pred.eval({
    'hostname': 'bigfoot',
    'zonename': 'junk'
}); }, /no translation/);
mod_assert.throws(function () { pred.eval({
    'latency': 12,
    'zonename': 'junk'
}); }, /no translation/);
mod_assert.ok(pred.eval({
    'hostname': 'bigfoot',
    'zonename': 'bar',
    'latency': 16
}));
mod_assert.ok(pred.eval({
    'hostname': 'bigfoot',
    'zonename': 'bar',
    'latency': 15
}));
mod_assert.ok(!pred.eval({
    'hostname': 'bigfoot',
    'zonename': 'bar',
    'latency': 14
}));
mod_assert.ok(!pred.eval({
    'hostname': 'sharptooth',
    'zonename': 'bar',
    'latency': 15
}));
mod_assert.ok(!pred.eval({
    'hostname': 'bigfoot',
    'zonename': 'foo',
    'latency': 15
}));

pred = pred.replaceFields({
    'hostname': '"spike"',
    'zonename': 'zonename',
    'latency': 'timestamp - self->f'
});
mod_assert.equal('(zonename == "bar") && ("spike" != "sharptooth") && ' +
    '(timestamp - self->f >= 15)', pred.toCStyleString());

/*
 * Test "or", "lt", "gt", and "le".
 */
pred = mod_krill.createPredicate({
    'or': [
	{ 'lt': [ 'latency', 10 ] },
	{ 'le': [ 'count', 15 ] },
	{ 'gt': [ 'latency', 20 ] }
    ]
}, {
    'latency': 'number',
    'count': 'number'
});
mod_assert.ok(!pred.trivial());
mod_assert.deepEqual([ 'count', 'latency' ], pred.fields().sort());
mod_assert.deepEqual({
    count: [ 15 ],
    latency: [ 10, 20 ]
}, pred.fieldsAndValues());
mod_assert.equal('(latency < 10) || (count <= 15) || (latency > 20)',
    pred.toCStyleString());
mod_assert.ok(pred.eval({ 'latency': 9, 'count': 20 }));
mod_assert.ok(!pred.eval({ 'latency': 10, 'count': 20 }));
mod_assert.ok(!pred.eval({ 'latency': 20, 'count': 20 }));
mod_assert.ok(pred.eval({ 'latency': 21, 'count': 20 }));

mod_assert.ok(!pred.eval({ 'latency': 10, 'count': 16 }));
mod_assert.ok(pred.eval({ 'latency': 10, 'count': 15 }));
mod_assert.ok(pred.eval({ 'latency': 10, 'count': 14 }));

/*
 * Test printing a few odd cases.
 */
pred = mod_krill.createPredicate({
    'and': [ {}, { 'eq': [ 'latency', 23 ] } ]
});
mod_assert.equal('(1) && (latency == 23)', pred.toCStyleString());

console.log('test okay');
