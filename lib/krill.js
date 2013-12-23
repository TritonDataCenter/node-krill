/*
 * krill.js: utilities related to handling and processing boolean predicates.
 */

var mod_assert = require('assert');

var mod_jsprim = require('jsprim');
var mod_verror = require('verror');
var VError = mod_verror.VError;


/* Public interface */
exports.createPredicate = createPredicate;


/*
 * Construct a predicate based on the JSON-like representation "pred".  "types"
 * maps field names to either "string" or "numeric".  See README.md for details.
 */
function createPredicate(pred, types)
{
	krillPrimValidateSyntax(pred);

	if (types !== null) {
		mod_jsprim.forEachKey(types, function (k, v) {
			if (v !== 'string' && v !== 'numeric')
				throw (new VError(
				    'field "%s": unknown type "%s"', k, v));
		});

		krillPrimValidateTypes(types, pred);
	}

	return (new Predicate(mod_jsprim.deepCopy(pred), types));
}

/*
 * External, immutable representation of a predicate.  This representation just
 * references the JSON-like representation that users pass to createPredicate.
 */
function Predicate(pred, types)
{
	this.p_pred = pred;
	this.p_types = types || null;
}

/*
 * Returns true if this predicate obviously always returns true.  (This may
 * return false for some predicates that do always return true.)
 */
Predicate.prototype.trivial = function ()
{
	return (krillPrimTrivial(this.p_pred));
};

/*
 * Returns a string representation of this predicate using a C-like syntax.
 */
Predicate.prototype.toCStyleString = function ()
{
	return (krillPrimPrint(this.p_pred));
};

/*
 * Returns the array of fields referenced in this predicate.
 */
Predicate.prototype.fields = function ()
{
	var fields = {};
	krillPrimWalk(function (subpred, key) {
		fields[subpred[key][0]] = true;
	}, this.p_pred);
	return (Object.keys(fields));
};

/*
 * Returns a new Predicate where all references to fields named in "xlate" are
 * replaced with the corresponding value in "xlate".  The original Predicate is
 * unchanged.
 */
Predicate.prototype.replaceFields = function (xlate)
{
	var newpred = mod_jsprim.deepCopy(this.p_pred);
	krillPrimWalk(function (subpred, key) {
		var field = subpred[key][0];
		if (!xlate.hasOwnProperty(field))
			throw (new VError('subpred %j: replacing fields: no ' +
			    'translation for field "%s"', subpred, field));
		subpred[key][0] = xlate[field];
	}, newpred);
	return (new Predicate(newpred, this.p_types));
};

/*
 * Check whether the given object passes the predicate (i.e., whether the
 * predicate's logical value is "true" for the given assignment of values).
 */
Predicate.prototype.eval = function (obj)
{
	var expr;

	if (this.trivial())
		return (true);

	expr = this.replaceFields(obj);
	return (krillPrimEval(expr.p_pred));
};


/*
 * A mapping from a predicate key to the type specific parsing routine.  Any
 * change to the set of possible initial keys must update these data structures
 * as well as krillPrimEval().
 */
var parseFuncs = {
    lt: krillPrimValidateRel,
    le: krillPrimValidateRel,
    gt: krillPrimValidateRel,
    ge: krillPrimValidateRel,
    eq: krillPrimValidateRel,
    ne: krillPrimValidateRel,
    and: krillPrimValidateLog,
    or: krillPrimValidateLog
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
    lt: krillPrimPrintRel,
    le: krillPrimPrintRel,
    gt: krillPrimPrintRel,
    ge: krillPrimPrintRel,
    eq: krillPrimPrintRel,
    ne: krillPrimPrintRel,
    and: krillPrimPrintLog,
    or: krillPrimPrintLog
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

var krillEvalHelpers = {
	lt: function (a, b) { return (a <  b); },
	le: function (a, b) { return (a <= b); },
	gt: function (a, b) { return (a >  b); },
	ge: function (a, b) { return (a >= b); },
	eq: function (a, b) { return (a == b); },
	ne: function (a, b) { return (a != b); }
};

/*
 * Primitive functions: these implement predicate operations on the primitive
 * representation (a straight object) rather than the Predicate class.  The
 * primitive representation is exactly the format that users pass into
 * createPredicate().  For details, see README.md.  These primitive operations
 * don't reference the higher-level Predicate class at all.
 */

/*
 * Determines whether a predicate has expressions that need to evaluated.
 *
 * Input:
 *  - The predicate to evaluate
 * Output:
 *  - True if this predicate is not trivial, false otherwise
 */
function krillPrimTrivial(pred)
{
	return (mod_jsprim.isEmpty(pred));
}

/*
 * Gets the key for the given predicate.  This is the operator at the root of
 * this predicate ("lt" for less-than, "and" for boolean "and", and so on).
 *
 * Input:
 *  - pred: The predicate to get the key for
 * Output:
 *  - returns the key for the specified predicate object
 */
function krillPrimGetKey(pred)
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
 * Walk every leaf predicate and apply a function to it.
 *
 * Input:
 *  - func: A function of the signature void (*func)(predicate, key)
 *  - pred: A predicate that has previously been validated
 */
function krillPrimWalk(func, pred)
{
	var key, ii;

	if (krillPrimTrivial(pred))
		return;

	key = krillPrimGetKey(pred);

	switch (key) {
	case 'and':
	case 'or':
		for (ii = 0; ii < pred[key].length; ii++)
			krillPrimWalk(func, pred[key][ii]);

		break;
	default:
		func(pred, key);
		break;
	}

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
function krillPrimValidateSyntax(pred)
{
	var key;

	if (!(pred instanceof Object))
		throw (new VError('predicate %j: must be an object', pred));

	if (krillPrimTrivial(pred))
		return;

	key = krillPrimGetKey(pred);
	if (!(key in parseFuncs))
		throw (new VError('predicate %j: unknown operator "%s"',
		    pred, key));

	parseFuncs[key](pred, key);
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
function krillPrimValidateRel(pred, key)
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
function krillPrimValidateLog(pred, key)
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
		krillPrimValidateSyntax(pred[key][ii]);
}

/*
 * Validates the semantic properties of the predicate. This includes making sure
 * that every field is valid for the predicate and the values present match the
 * expected type.
 */
function krillPrimValidateTypes(fieldtypes, pred)
{
	var func = function (ent, key) {
	    return (krillPrimValidateFieldType(fieldtypes, ent, key));
	};

	krillPrimWalk(func, pred);
}

/*
 * This function assumes that we have a syntactically valid object. We now go
 * through and do checks to validate that fields are used appropriately given
 * their types (as specified in "fieldtypes").
 *
 * Input:
 *  - fieldtypes: valid fields for the metric and their types
 *  - pred: The relational predicate to validate
 *  - key: The key that we are interested in validating
 */
function krillPrimValidateFieldType(fieldtypes, pred, key)
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
function krillPrimPrint(pred)
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
function krillPrimPrintRel(pred, key)
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
function krillPrimPrintLog(pred, key)
{
	var elts = pred[key].map(function (x) {
		return ('(' + krillPrimPrint(x) + ')');
	});

	return (elts.join(' ' + printStrings[key] + ' '));
}

/*
 * Evaluate the given predicate (whose named fields have already been replaced
 * with corresponding values) and return whether the boolean expression is true.
 */
function krillPrimEval(pred)
{
	var key, ii;

	key = krillPrimGetKey(pred);

	switch (key) {
	case 'and':
		for (ii = 0; ii < pred['and'].length; ii++) {
			if (!krillPrimEval(pred['and'][ii]))
				return (false);
		}

		return (true);

	case 'or':
		for (ii = 0; ii < pred['or'].length; ii++) {
			if (krillPrimEval(pred['or'][ii]))
				return (true);
		}

		return (false);

	case 'lt':
	case 'le':
	case 'gt':
	case 'ge':
		mod_assert.ok(typeof (pred[key][0]) == 'number');
		mod_assert.ok(typeof (pred[key][1]) == 'number');
		/*jsl:fallthru*/
	default:
		mod_assert.ok(key in krillEvalHelpers);
		mod_assert.ok(pred[key].length == 2);
		break;
	}

	return (krillEvalHelpers[key](pred[key][0], pred[key][1]));
}
