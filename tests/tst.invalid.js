/*
 * tests/tst.invalid.js: tests invalid predicate inputs
 */

var mod_assert = require('assert');
var mod_krill = require('../lib/krill');
var mod_verror = require('verror');
var VError = mod_verror.VError;

var types = {
    's': 'string',
    'n': 'number'
};

var invalids = [
    /* INPUT			ERROR MESSAGE REGEX */
    /* BEGIN JSSTYLED */
    [ 23,			/must be an object/ ],
    [ '23',			/must be an object/ ],
    [ true,			/must be an object/ ],
    [ [ 'foo' ],		/unknown operator/ ],
    [ { 'foo': 1 },		/unknown operator/ ],
    [ { 'foo': [ 1, 2 ] },	/unknown operator/ ],
    [ { 'and': 1 },		/expected array/ ],
    [ { 'and': [] },		/expected at least 2 elements in array/ ],
    [ { 'or': 1 },		/expected array/ ],
    [ { 'or': [] },		/expected at least 2 elements in array/ ],
    [ { 'or': [ {}, 'foo' ] },	/predicate 'foo': must be an object/ ],
    [ { 'eq': {} },		/expected array/ ],
    [ { 'eq': [] },		/"eq" array must have 2 elements/ ],
    [ { 'eq': [ 'foo' ] },	/"eq" array must have 2 elements/ ],
    [ { 'eq': [ 'foo', 'bar', 'baz' ] },
        /"eq" array must have 2 elements/ ],
    [ { 'eq': [ 'n', '3' ] },	/expected "number"/, types ],
    [ { 'le': [ 's', 3 ] },	/expected "string"/, types ],
    [ { 'lt': [ 's', '3' ] },	/cannot be applied to fields of type/, types ],
    [ { 'le': [ 's', '3' ] },	/cannot be applied to fields of type/, types ],
    [ { 'ge': [ 's', '3' ] },	/cannot be applied to fields of type/, types ],
    [ { 'gt': [ 's', '3' ] },	/cannot be applied to fields of type/, types ]
    /* END JSSTYLED */
];

invalids.forEach(function (input) {
	console.log('checking invalid case', input[0]);
	try {
		mod_krill.createPredicate(input[0], input[2] || null);
	} catch (ex) {
		console.log('error: ' + ex.message);
		if (!input[1].test(ex.message))
			throw (new VError('expected message to match "%s"',
			    input[1].source));
		return;
	}

	throw (new Error('expected exception, but found none'));
});

console.log('test okay');
