/*
 * krill.js: utilities related to handling and processing boolean predicates.
 */

var mod_assert = require('assert-plus');
var mod_stream = require('stream');
var mod_util = require('util');

var mod_jsprim = require('jsprim');
var mod_verror = require('verror');
var VError = mod_verror.VError;


/* Public interface */
exports.createPredicate = createPredicate;
exports.createPredicateStream = createPredicateStream;


/*
 * Construct a predicate based on the JSON-like representation "pred".  "types"
 * maps field names to either "string" or "number".  See README.md for details.
 */
function createPredicate(pred, types)
{
	krillPrimValidateSyntax(pred);

	if (arguments.length >= 2 && types !== null) {
		mod_jsprim.forEachKey(types, function (k, v) {
			if (v !== 'string' && v !== 'number' && v !== 'boolean')
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
	return (krillPrimPrintCStyle(this.p_pred));
};

/*
 * Returns a string representation of this predicate using an LDAP filter
 * syntax.
 */
Predicate.prototype.toLDAPFilterString = function ()
{
	if (this.trivial()) {
		throw new Error('Cannot serialize empty predicate to LDAP '
		    + 'search filter');
	}

	return (krillPrimPrintLDAP(this.p_pred));
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
 * Returns a map of fields to a list of values referenced in this predicate for
 * these fields.
 */
Predicate.prototype.fieldsAndValues = function ()
{
	var fieldNamesToValues = {};

	krillPrimWalk(function (subpred, key) {
		var valuesList = fieldNamesToValues[subpred[key][0]];
		var value = subpred[key][1];
		if (valuesList === undefined) {
			fieldNamesToValues[subpred[key][0]] = [ value ];
		} else {
			mod_assert.array(valuesList, 'valuesList');
			valuesList.push(value);
		}
	}, this.p_pred);

	return (fieldNamesToValues);
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
		var value = mod_jsprim.pluck(xlate, field);
		if (value === undefined)
			throw (new VError('subpredicate "%j": ' +
			    'no translation for field "%s"',
			    subpred, field));
		subpred[key][0] = value;
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
 * A PredicateStream is an object-mode transform stream based on a predicate.
 * It receives non-null JavaScript objects, evaluates the predicate on each one,
 * and emits the objects that pass the predicate.  Arguments:
 *
 *     predicate		the predicate to use (created with
 *     				createPredicate)
 *
 *     streamOptions		Node.js Stream constructor options
 *
 * You can also use stats() to see how many items failed to be evaluated or were
 * dropped by the predicate.
 *
 * If an item fails to be evaluated, an "invalid_object" event is emitted with
 * the object itself, the error, and the ordinal number of the object.  An
 * "error" event is not emitted.
 */
function createPredicateStream(args)
{
	return (new PredicateStream(args));
}

function PredicateStream(args)
{
	var streamoptions, k;

	mod_assert.ok(typeof (args) == 'object' && args !== null);
	mod_assert.ok(typeof (args.predicate) == 'object' && args !== null);

	streamoptions = {};
	if (args.streamOptions) {
		for (k in args.streamOptions)
			streamoptions[k] = args.streamOptions[k];
	}
	streamoptions['objectMode'] = true;
	mod_stream.Transform.call(this, streamoptions);

	this.ps_predicate = args.predicate;

	this.ps_nentries = 0;
	this.ps_nerrors = 0;
	this.ps_nfilteredout = 0;
}

mod_util.inherits(PredicateStream, mod_stream.Transform);

PredicateStream.prototype._transform = function (record, _, callback)
{
	var result, error;

	this.ps_nentries++;
	mod_assert.equal(typeof (record), 'object');
	mod_assert.ok(record !== null);

	try {
		result = this.ps_predicate.eval(record);
	} catch (ex) {
		error = ex;
	}

	if (error) {
		this.ps_nerrors++;
		this.emit('invalid_object', record, error, this.ps_nentries);
	} else if (result) {
		this.push(record);
	} else {
		this.ps_nfilteredout++;
	}

	callback();
};

PredicateStream.prototype.stats = function ()
{
	return ({
	    'ninputs': this.ps_nentries,
	    'nerrors': this.ps_nerrors,
	    'nfilteredout': this.ps_nfilteredout
	});
};


/*
 * Definitions of operators.  Operators have three fields: "name" (used when
 * translating to a C-syntax string), "validate" (which validates an input
 * predicate of this type), and "print" (which converts an entire predicate to
 * the corresponding C-syntax string).
 */

function RelationalOperator(options, types, evalfunc)
{
	mod_assert.object(options, 'options');
	mod_assert.object(options.names, 'options.names');
	mod_assert.arrayOfString(types, 'types');
	mod_assert.func(evalfunc, 'evalfunc');

	var names = options.names;

	this.names = names;
	this.types = types.slice(0);
	this.validate = krillPrimValidateRel;
	this.printCStyle = krillPrimPrintRelCStyle;
	this.printLDAP = krillPrimPrintRelLDAP;
	this.eval = evalfunc;
}

function LogicalOperator(names)
{
	mod_assert.object(names, 'names');

	this.names = names;
	this.validate = krillPrimValidateLog;
	this.printCStyle = krillPrimPrintLogCStyle;
	this.printLDAP = krillPrimPrintLogLDAP;
}

function buildLdapNotEqualFilter(lhs, rhs) {
	return ('(!(' + lhs + '=' + rhs + '))');
}

var krillOps = {
    'le': new RelationalOperator({
	'names': {
	    'cstyle': '<=',
	    'ldap': '<='
	}
    }, [ 'number' ], function (a, b) { return (a <= b); }),
    'lt': new RelationalOperator({
	'names': {
	    'cstyle': '<',
	    'ldap': '<'
	}
    }, [ 'number' ], function (a, b) { return (a <  b); }),
    'ge': new RelationalOperator({
	'names': {
	    'cstyle': '>=',
	    'ldap': '>='
	}
    }, [ 'number' ], function (a, b) { return (a >= b); }),
    'gt': new RelationalOperator({
	'names': {
	    'cstyle': '>',
	    'ldap': '>'
	}
    }, [ 'number' ], function (a, b) { return (a >  b); }),
    'eq': new RelationalOperator({
	'names': {
	    'cstyle': '==',
	    'ldap': '='
	}
    }, [ 'number', 'string', 'boolean' ], function (a, b) { return (a == b); }),
    'ne': new RelationalOperator({
	'names': {
	    'cstyle': '!=',
	    'ldap': buildLdapNotEqualFilter
	}
    }, [ 'number', 'string', 'boolean' ], function (a, b) { return (a != b); }),
    'and': new LogicalOperator({
	'cstyle': '&&',
	'ldap': '&'
    }),
    'or': new LogicalOperator({
	'cstyle': '||',
	'ldap': '|'
    })
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
	if (!(key in krillOps))
		throw (new VError('predicate %j: unknown operator "%s"',
		    pred, key));

	krillOps[key].validate(pred, key);
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
		throw (new VError('predicate %j: operator "%s": expected array',
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

	if (typeof (constant) != 'number' &&
	    typeof (constant) != 'string' &&
	    typeof (constant) != 'boolean')
		throw (new VError('predicate %j: field "%s" is not a string, ' +
		    'number, or boolean', pred, key));
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
		    'least 2 elements in array', pred, key));

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
	var field, constant, actual_type, field_type;

	field = pred[key][0];
	constant = pred[key][1];
	actual_type = typeof (constant);

	if (krillOps[key].types &&
	    krillOps[key].types.indexOf(actual_type) == -1)
		throw (new VError('predicate %j: operator "%s" cannot be ' +
		    'applied to fields of type "%s"', pred, key, actual_type));

	if (fieldtypes === null)
		return;

	if (!(field in fieldtypes))
		throw (new VError('predicate %j: field "%s" is not defined',
		    pred, field));
	field_type = fieldtypes[field];
	if (field_type != actual_type)
		throw (new VError('predicate %j: field "%s" value ("%j") ' +
		    'expected "%s", but got "%s"', pred, field, constant,
		    field_type, actual_type));

}

/*
 * Verifies a few basic assertions about the predicate object "pred".
 *
 * Inputs:
 *  - pred: The predicate for which to verify basic assertions.
 *
 * Output:
 *  - Returns an object of the following form:
 *    {
 *      nbKeys: numberOfKeysInPredicate,
 *      key: rootKeyOfPredicate
 *    }
 *
 *    where "numberOfKeysInPredicate"" is an integer with the value 0 (empty
 *    predicate) or 1, and "rootKeyOfPredicate" is a string that represents
 *    the root key of the predicate.
 */
function sanityCheck(pred) {
	var key;
	var keysFound = 0;

	/* Let's just do a bit of extra sanity checking, can't hurt */
	for (var val in pred) {
		key = val;
		keysFound++;
	}

	mod_assert.ok(keysFound === 0 || keysFound === 1);

	if (keysFound > 0) {
		mod_assert.ok(krillOps[key]);
	}

	return ({
		nbKeys: keysFound,
		key: key
	});
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
 *  - Returns the string representation of the specified predicate as a C
 * statement.
 */
function krillPrimPrintCStyle(pred)
{
	var sanityCheckResult = sanityCheck(pred);
	var key = sanityCheckResult.key;
	var nbKeys = sanityCheckResult.nbKeys;

	if (nbKeys === 0)
		return ('1');

	return (krillOps[key].printCStyle(pred, key));
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
 *  - Returns the string representation of the specified predicate as an LDAP
 *  search filter.
 */
function krillPrimPrintLDAP(pred) {
	var sanityCheckResult = sanityCheck(pred);
	var key = sanityCheckResult.key;
	var nbKeys = sanityCheckResult.nbKeys;

	/*
	 * Serializing an individual predicate with a number of keys !== 1 --
	 * that is an empty predicate, or a predicate with several keys -- to a
	 * LDAP filter string is not supported.
	 */
	mod_assert(nbKeys === 1);

	return (krillOps[key].printLDAP(pred, key));
}

/*
 * Prints out the value of a relational predicate as the condition of a C "if"
 * statement.
 * This should print as:
 * <field> <operator> <constant>
 *
 * Input:
 *  - pred: The predicate to print
 *  - key: The key for the predicate
 *
 * Output:
 *  - Returns the string representation of the specified predicate as a C
 *  condition expression.
 */
function krillPrimPrintRelCStyle(pred, key)
{
	var out = pred[key][0] + ' ';

	out += krillOps[key].names.cstyle + ' ';
	if (typeof (pred[key][1]) == 'string')
		out += '"';
	out += pred[key][1];
	if (typeof (pred[key][1]) == 'string')
		out += '"';

	return (out);
}

/*
 * Prints out the value of a relational predicate as a LDAP filter.
 * This should print as:
 * <field><operator><constant>
 *
 * Input:
 *  - pred: The predicate to print
 *  - key: The key for the predicate
 *
 * Output:
 *  - Returns the string representation of the specified predicate as a
 *  component of an LDAP search filter.
 */
function krillPrimPrintRelLDAP(pred, key)
{
	mod_assert.ok(typeof (krillOps[key].names.ldap) === 'function' ||
		typeof (krillOps[key].names.ldap) === 'string',
			'LDAP name must be a function or a string');

	var out;
	var expressionBuilder;

	if (typeof (krillOps[key].names.ldap) === 'function') {
		expressionBuilder = krillOps[key].names.ldap;
		out = expressionBuilder(pred[key][0], pred[key][1]);
	} else {
		out = '(' + pred[key][0] + krillOps[key].names.ldap +
			pred[key][1] + ')';
	}

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
 *  - Returns the string representation of the specified predicate as a
 *  condition expression of a C if statement.
 */
function krillPrimPrintLogCStyle(pred, key)
{
	var elts = pred[key].map(function (x) {
		return ('(' + krillPrimPrintCStyle(x) + ')');
	});

	return (elts.join(' ' + krillOps[key].names.cstyle + ' '));
}

/*
 * Prints out the value of a logical expression.
 * This should print as:
 * <operator>(<predicate>)(<predicate>)...
 *
 * The parens may seem unnecessary in most cases, but it is designed to
 * distinguish between nested logical expressions.
 *
 * Inputs:
 *  - pred: The logical expression to print
 *  - key: The key for the object in the logical expression
 *
 * Output:
 *  - Returns the string representation of the specified predicate as a
 *  component of an LDAP search filter.
 */
function krillPrimPrintLogLDAP(pred, key)
{
	var elts = pred[key].map(function (x) {
		return (krillPrimPrintLDAP(x));
	});

	return ('(' + krillOps[key].names.ldap + elts.join('') + ')');
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
		mod_assert.ok(key in krillOps);
		mod_assert.ok(pred[key].length == 2);
		break;
	}

	return (krillOps[key].eval(pred[key][0], pred[key][1]));
}
