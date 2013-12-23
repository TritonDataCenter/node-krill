/*
 * krill.js: utilities related to handling and processing boolean predicates.
 *
 * We export several functions:
 *  - caPredValidate: Validates a given predicate or throws an error if it
 *  fails.
 *  - caPredPrint: Returns a valid D expression for the predicate
 *  - caPredWalk: Walks a predicate applying a function at every leaf
 *  - caPredContainsField: Returns true if a predicate contains a given field
 *  - caPredReplaceFields: Replaces each fieldname with a new value
 */
var mod_assert = require('assert');

var mod_jsprim = require('jsprim');
var mod_verror = require('verror');

var VError = mod_verror.VError;

/* Public interface */
exports.validateSyntax = krillValidateSyntax;
exports.validateSemantics = krillValidateSemantics;
exports.print = krillPrint;
exports.replaceFields = krillReplaceFields;
exports.nonTrivial = krillNonTrivial;
exports.fields = krillFields;
exports.eval = krillEval;

/* For testing only */
exports.containsField = krillContainsField;


/*
 * A mapping from a predicate key to the type specific parsing routine.  Any
 * change to the set of possible initial keys must update these data structures
 * as well as krillEvaluate().
 */
var parseFuncs = {
    lt: krillValidateRel,
    le: krillValidateRel,
    gt: krillValidateRel,
    ge: krillValidateRel,
    eq: krillValidateRel,
    ne: krillValidateRel,
    and: krillValidateLog,
    or: krillValidateLog
};

/*
 * A mapping that determines which specific instrumentation fields are supported
 * by which predicate relational and logical operators.
 */
var keyFields = {
    lt: {},
    le: {},
    gt: {},
    ge: {},
    eq: {},
    ne: {}
};

keyFields['lt']['numeric'] = true;
keyFields['lt']['string'] = false;
keyFields['le']['numeric'] = true;
keyFields['le']['string'] = false;
keyFields['gt']['numeric'] = true;
keyFields['gt']['string'] = false;
keyFields['ge']['numeric'] = true;
keyFields['ge']['string'] = false;
keyFields['eq']['numeric'] = true;
keyFields['eq']['string'] = true;
keyFields['ne']['numeric'] = true;
keyFields['ne']['string'] = true;

/*
 * A mapping to the operator specific printing routine.
 */
var printFuncs = {
    lt: krillPrintRel,
    le: krillPrintRel,
    gt: krillPrintRel,
    ge: krillPrintRel,
    eq: krillPrintRel,
    ne: krillPrintRel,
    and: krillPrintLog,
    or: krillPrintLog
};

/*
 * The operator specific string to use while printing
 */
var printStrings = {
    lt: '<',
    le: '<=',
    gt: '>',
    ge: '>=',
    eq: '==',
    ne: '!=',
    and: '&&',
    or: '||'
};

/*
 * Gets the key for the given predicate
 *
 * Input:
 *  - pred: The predicate to get the key for
 * Output:
 *  - returns the key for the specified predicate object
 */
function krillGetKey(pred)
{
	var key, keysFound = 0;

	for (var val in pred) {
		keysFound++;
		key = val;
	}

	if (keysFound > 1)
		throw (new VError('predicate "%j": expected one key, ' +
		    'but found %d', pred, keysFound));

	if (keysFound < 1)
		throw (new VError('predicate "%j": missing key', pred));

	return (key);
}

/*
 * Validates that the predicate has a valid format for relational predicates.
 * That means that it fits the format:
 * { key: [ field, constant ] }
 *
 * Input:
 *  - pred: The predicate
 *  - key: The key that we're interested in
 *
 * On return the following points have been validated:
 *  - That the key points to a two element array
 *  - That the first field is a valid type
 */
function krillValidateRel(pred, key)
{
	var field, constant;

	if (!pred[key])
		throw (new VError('predicate %j: missing key "%s"', pred, key));

	if (!(pred[key] instanceof Array))
		throw (new VError('predicate %j: "%s" is not an array',
		    pred, key));

	if (pred[key].length != 2)
		throw (new VError(
		    'predicate %j: "%s" array must have 2 elements',
		    pred, key));

	field = pred[key][0];
	constant = pred[key][1];

	if (typeof (field) != 'string')
		throw (new VError('predicate %j: field "%s" is not a string',
		    pred, key));

	if (typeof (constant) != 'number' && typeof (constant) != 'string')
		throw (new VError('predicate %j: field "%s" is not a string ' +
		    'or number'));
}

/*
 * This function assumes that we have a syntactically valid object and the
 * caller has already established that the only fields present are fields which
 * are "valid". We now go through and do checks to validate that fields are used
 * appropriately given their types (as specified in "fieldtypes").
 *
 *  Input:
 *   - fieldtypes: valid fields for the metric and their types
 *   - pred: The relational predicate to validate
 *   - key: The key that we are interested in validating
 */
function krillValidateField(fieldtypes, pred, key)
{
	var field, constant, type;

	field = pred[key][0];
	constant = pred[key][1];

	if (!(field in fieldtypes))
		throw (new VError('predicate %j: field "%s" is not defined',
		    pred, field));
	type = fieldtypes[field];
	if (!(type in keyFields[key]))
		throw (new VError('predicate %j: unknown type "%s"',
		    pred, type));

	if (type == 'numeric' && typeof (constant) != 'number')
		throw (new VError('predicate %j: field "%s" value ("%j") ' +
		    'should be a number', pred, key, constant));

	if (type != 'numeric' && typeof (constant) != 'string')
		throw (new VError('predicate %j: field "%s" value ("%j") ' +
		    'should be a string', pred, key, constant));
}

/*
 * Validates that the logical expression has a valid format. This means that it
 * is of the format:
 * { key: [ obj, obj,... ] }
 *
 * Input:
 *  - pred: The current predicate
 *  - key: The key that we're interested in
 *
 * On Return the following points have been validated:
 *  - The key points to an array of at least length two
 *  - Every object in the array is a valid predicate or logical expression
 */
function krillValidateLog(pred, key)
{
	var ii;

	if (!pred[key])
		throw (new VError('predicate %j: expected "%s" in logical ' +
		    'expression', pred, key));

	if (!(pred[key] instanceof Array))
		throw (new VError('predicate %j: operator "%s": expected array',
		    pred, key));

	if (pred[key].length < 2)
		throw (new VError('predicate %j: operator "%s": expected at ' +
		    'least two elements in array', pred, key));

	for (ii = 0; ii < pred[key].length; ii++)
		krillValidateSyntax(pred[key][ii]);
}

/*
 * This is the entry point for validating and parsing any given predicate. This
 * will be called when beginning to parse any specific predicate.
 *
 * Input:
 *  - pred: The predicate that we want to validate
 *
 * Output: None on success, an exception is thrown on error.
 */
function krillValidateSyntax(pred)
{
	var key;

	if (!(pred instanceof Object))
		throw (new VError('predicate %j: must be an object', pred));

	if (!krillNonTrivial(pred))
		return;

	key = krillGetKey(pred);
	if (!(key in parseFuncs))
		throw (new VError('predicate %j: unknown operator "%s"',
		    pred, key));

	parseFuncs[key](pred, key);
}

/*
 * We want to walk every leaf predicate and apply a function to it
 * Input:
 *  - func: A function of the signature void (*func)(predicate, key)
 *  - pred: A predicate that has previously been validated
 */
function krillWalk(func, pred)
{
	var key, ii;

	if (!krillNonTrivial(pred))
		return;

	key = krillGetKey(pred);

	switch (key) {
	case 'and':
	case 'or':
		for (ii = 0; ii < pred[key].length; ii++)
			krillWalk(func, pred[key][ii]);

		break;
	default:
		func(pred, key);
		break;
	}

}

/*
 * Validates the semantic properties of the predicate. This includes making sure
 * that every field is valid for the predicate and the values present match the
 * expected type.
 */
function krillValidateSemantics(fieldtypes, pred)
{
	var func = function (ent, key) {
	    return (krillValidateField(fieldtypes, ent, key));
	};

	krillWalk(func, pred);
}

/*
 * Prints out the value of a relational predicate.
 * This should print as:
 * <field> <operator> <constant>
 *
 * Input:
 *  - pred: The predicate to print
 *  - key: The key for the predicate
 *
 * Output:
 *  - Returns the string representation of the specified predicate.
 */
function krillPrintRel(pred, key)
{
	var out = pred[key][0] + ' ';

	out += printStrings[key] + ' ';
	if (typeof (pred[key][1]) == 'string')
		out += '"';
	out += pred[key][1];
	if (typeof (pred[key][1]) == 'string')
		out += '"';

	return (out);
}

/*
 * Prints out the value of a logical expression.
 * This should print as:
 * (<predicate>) <operator> (<predicate>)...
 *
 * The parens may seem unnecessary in most cases, but it is designed to
 * distinguish between nested logical expressions.
 *
 * Inputs:
 *  - pred: The logical expression to print
 *  - key: The key for the object in the logical expression
 *
 * Output:
 *  - Returns the string representation of the specified predicate.
 */
function krillPrintLog(pred, key)
{
	var elts = pred[key].map(function (x) {
		return ('(' + krillPrintGen(x) + ')');
	});

	return (elts.join(' ' + printStrings[key] + ' '));
}

/*
 * This is the generic entry point to begin parsing an individual predicate.
 * This is responsible for determining the key and dispatching to the correct
 * function.
 *
 * Inputs:
 *  - pred: The predicate to be printed
 *
 * Output:
 *  - Returns the string representation of the specified predicate.
 */
function krillPrintGen(pred)
{
	var key;
	var keysFound = 0;

	/* Let's just do a bit of extra sanity checking, can't hurt */
	for (var val in pred) {
		key = val;
		keysFound++;
	}

	if (keysFound === 0)
		return ('1');

	mod_assert.equal(1, keysFound);
	mod_assert.ok(printFuncs[key]);
	return (printFuncs[key](pred, key));
}

/*
 * Prints out a human readable form of a predicate. This is the general entry
 * point.
 *
 * Input:
 *  - pred: A predicate that has already been validated by krillValidate
 *
 * Output:
 *  - Returns the string representation of the specified predicate.
 */
function krillPrint(pred)
{
	return (krillPrintGen(pred));
}

/*
 * Walk a predicate and check if any of the leaves are checking a specific
 * field.
 * Input:
 *  - field: The name of the field to search for
 *  - pred: The predicate to search in
 */
function krillContainsField(field, pred)
{
	var found = false;

	krillWalk(function (x, key) {
	    if (x[key][0] == field)
		found = true;
	}, pred);

	return (found);
}

/*
 * Walks the predicate and replaces all of the field names with appropriate
 * values from the specified object. The object is defined where each possible
 * predicate field is a key in the object and we replace the predicate field
 * with the value from the object. This allows us to replace simple consumer
 * predicate names i.e. latency or optype with the correct D expressions.
 *
 * Input:
 *  - obj: An Object where keys match the fields in the predicate and the values
 *    are what should be substituted in
 *  - pred: The predicate to apply this transformation to
 */
function krillReplaceFields(obj, pred)
{
	krillWalk(function (x, key) {
	    var field = x[key][0];
	    mod_assert.ok(field in obj);
	    x[key][0] = obj[field];
	}, pred);
}

/*
 * Determines whether a predicate has expressions that need to evaluated.
 *
 * Input:
 *  - The predicate to evaluate
 * Output:
 *  - True if this predicate is not trivial, false otherwise
 */
function krillNonTrivial(pred)
{
	return (!mod_jsprim.isEmpty(pred));
}

/*
 * Iterates over the predicates and returns the list of fields that are at the
 * leaves in the predicate. The list will not contain duplicates.
 *
 * Input:
 *  - pred: The predicate to extract the fields from.
 *
 * Return:
 *  - The list of fields used in the predicate without duplicates.
 */
function krillFields(pred)
{
	var ret = [];

	krillWalk(function (x, key) {
		var ii;
		var field = x[key][0];
		var found = false;

		for (ii = 0; ii < ret.length; ii++) {
			if (field == ret[ii]) {
				found = true;
				break;
			}
		}

		if (!found)
			ret.push(field);
	}, pred);

	return (ret);
}

/*
 * Given a predicate and an object mapping key names to values, return whether
 * the predicate is satisfied by the specified fields.
 */
function krillEval(pred, values)
{
	var expr;

	if (!krillNonTrivial(pred))
		return (true);

	mod_assert.ok(pred);
	mod_assert.ok(pred instanceof Object);
	expr = mod_jsprim.deepCopy(pred);
	krillReplaceFields(values, expr);
	return (krillEvalExpr(expr));
}

function krillEvalExpr(expr)
{
	var key, ii;

	key = krillGetKey(expr);

	switch (key) {
	case 'and':
		for (ii = 0; ii < expr['and'].length; ii++) {
			if (!krillEvalExpr(expr['and'][ii]))
				return (false);
		}

		return (true);

	case 'or':
		for (ii = 0; ii < expr['or'].length; ii++) {
			if (krillEvalExpr(expr['or'][ii]))
				return (true);
		}

		return (false);

	case 'lt':
	case 'le':
	case 'gt':
	case 'ge':
		mod_assert.ok(typeof (expr[key][0]) == 'number');
		mod_assert.ok(typeof (expr[key][1]) == 'number');
		/*jsl:fallthru*/
	default:
		mod_assert.ok(key in krillEvalHelpers);
		mod_assert.ok(expr[key].length == 2);
		break;
	}

	return (krillEvalHelpers[key](expr[key][0], expr[key][1]));
}

var krillEvalHelpers = {
	lt: function (a, b) { return (a <  b); },
	le: function (a, b) { return (a <= b); },
	gt: function (a, b) { return (a >  b); },
	ge: function (a, b) { return (a >= b); },
	eq: function (a, b) { return (a == b); },
	ne: function (a, b) { return (a != b); }
};
