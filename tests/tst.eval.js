/*
 * Tests krillPrimEval, evaluating predicates with a given set of values.
 */

var mod_assert = require('assert');
var mod_extsprintf = require('extsprintf');
var mod_krill = require('../lib/krill');

function println()
{
	var args = Array.prototype.slice.call(arguments);
	var msg = mod_extsprintf.sprintf.apply(null, args);
	console.log(msg);
}

var test_cases = [ {
	pred: {},				/* trivial case */
	values: {},
	result: true
}, {
	pred: { eq: ['hostname', 'tony'] },	/* eq: strings, != */
	values: { 'hostname': 'louie' },
	result: false
}, {
	pred: { eq: ['hostname', 'tony'] },	/* eq: strings, == */
	values: { 'hostname': 'tony' },
	result: true
}, {
	pred: { eq: ['pid', 12] },		/* eq: numbers, != */
	values: { 'pid': 15 },
	result: false
}, {
	pred: { eq: ['pid', 12] },		/* eq: numbers, == */
	values: { 'pid': 12 },
	result: true
}, {
	pred: { eq: ['audit', true] },		/* eq: booleans, == */
	values: { 'audit': true },
	result: true
}, {
	pred: { eq: ['audit', false] },		/* eq: booleans, == */
	values: { 'audit': true },
	result: false
}, {
	pred: { eq: ['audit', true] },		/* eq: booleans, != */
	values: { 'audit': false },
	result: false
}, {
	pred: { eq: ['audit', false] },		/* eq: booleans, != */
	values: { 'audit': false },
	result: true
}, {
	pred: { ne: ['hostname', 'tony'] },	/* ne: strings, != */
	values: { 'hostname': 'louie' },
	result: true
}, {
	pred: { ne: ['hostname', 'tony'] },	/* ne: strings, == */
	values: { 'hostname': 'tony' },
	result: false
}, {
	pred: { ne: ['pid', 12] },		/* ne: numbers, != */
	values: { 'pid': 15 },
	result: true
}, {
	pred: { ne: ['pid', 12] },		/* ne: numbers, == */
	values: { 'pid': 12 },
	result: false
}, {
	pred: { ne: ['audit', true] },		/* ne: booleans, == */
	values: { 'audit': true },
	result: false
}, {
	pred: { ne: ['audit', false] },		/* ne: booleans, == */
	values: { 'audit': true },
	result: true
}, {
	pred: { ne: ['audit', true] },		/* ne: booleans, != */
	values: { 'audit': false },
	result: true
}, {
	pred: { ne: ['audit', false] },		/* ne: booleans, != */
	values: { 'audit': false },
	result: false
}, {
	pred: { le: ['pid', 10] },		/* le: <, =, > */
	values: { 'pid': 5 },
	result: true
}, {
	pred: { le: ['pid', 10] },
	values: { 'pid': 10 },
	result: true
}, {
	pred: { le: ['pid', 10] },
	values: { 'pid': 15 },
	result: false
}, {
	pred: { lt: ['pid', 10] },		/* lt: <, =, > */
	values: { 'pid': 5 },
	result: true
}, {
	pred: { lt: ['pid', 10] },
	values: { 'pid': 10 },
	result: false
}, {
	pred: { lt: ['pid', 10] },
	values: { 'pid': 15 },
	result: false
}, {
	pred: { ge: ['pid', 10] },		/* ge: <, =, > */
	values: { 'pid': 5 },
	result: false
}, {
	pred: { ge: ['pid', 10] },
	values: { 'pid': 10 },
	result: true
}, {
	pred: { ge: ['pid', 10] },
	values: { 'pid': 15 },
	result: true
}, {
	pred: { gt: ['pid', 10] },		/* gt: <, =, > */
	values: { 'pid': 5 },
	result: false
}, {
	pred: { gt: ['pid', 10] },
	values: { 'pid': 10 },
	result: false
}, {
	pred: { gt: ['pid', 10] },
	values: { 'pid': 15 },
	result: true
}, {
	pred: {
	    and: [
		{ eq: [ 'hostname', 'johnny tightlips' ] },
		{ eq: [ 'pid', 15 ] },
		{ eq: [ 'execname', 'sid the squealer' ] }
	    ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 15,
	    execname: 'sid the squealer'
	},
	result: true
}, {
	pred: {
	    and: [
		{ eq: [ 'hostname', 'johnny tightlips' ] },
		{ eq: [ 'pid', 15 ] },
		{ eq: [ 'execname', 'sid the squealer' ] }
	    ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 10,
	    execname: 'sid the squealer'
	},
	result: false
}, {
	pred: {
	    or: [
		{ eq: [ 'hostname', 'johnny tightlips' ] },
		{ eq: [ 'pid', 15 ] },
		{ eq: [ 'execname', 'sid the squealer' ] }
	    ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 10,
	    execname: 'sid the squealer'
	},
	result: true
}, {
	pred: {
	    or: [ {
		and: [
		    { eq: [ 'hostname', 'johnny tightlips' ] },
		    { eq: [ 'pid', 15 ] },
		    { eq: [ 'execname', 'sid the squealer' ] }
		]
	    }, {
		eq: [ 'trump', 'true' ]
	    } ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 10,
	    execname: 'sid the squealer',
	    trump: 'true'
	},
	result: true
}, {
	pred: {
	    or: [ {
		and: [
		    { eq: [ 'hostname', 'johnny tightlips' ] },
		    { eq: [ 'pid', 15 ] },
		    { eq: [ 'execname', 'sid the squealer' ] }
		]
	    }, {
		eq: [ 'trump', 'true' ]
	    } ]
	},
	values: {
	    hostname: 'johnny tightlips',
	    pid: 10,
	    execname: 'sid the squealer',
	    trump: 'false'
	},
	result: false
}, {
	pred: { eq: [ 'nested.hostname', 'johnny tightlips' ] },
	values: {
	    nested: {
	        hostname: 'johnny tightlips'
	    },
	    pid: 15
	},
	result: true
}, {
	pred: { eq: [ 'nested.hostname', 'sid the squealer' ] },
	values: {				/* nested properties */
	    nested: {
	        hostname: 'johnny tightlips'
	    },
	    pid: 15
	},
	result: false
} ];

var ii, pred, result;
for (ii = 0; ii < test_cases.length; ii++) {
	println('test case %2d: checking %j with values %j',
	    ii + 1, test_cases[ii]['pred'], test_cases[ii]['values'],
	    test_cases[ii]['result']);
	pred = mod_krill.createPredicate(test_cases[ii]['pred']);
	mod_assert.equal(test_cases[ii]['result'], pred.eval(
	    test_cases[ii]['values']));
}

console.log('test okay');
