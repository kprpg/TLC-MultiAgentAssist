let electron = require("electron");
//#region node_modules/zod/v4/core/core.js
var _a$1;
function $constructor(name, initializer, params) {
	function init(inst, def) {
		if (!inst._zod) Object.defineProperty(inst, "_zod", {
			value: {
				def,
				constr: _,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: false
		});
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		const proto = _.prototype;
		const keys = Object.keys(proto);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		var _a;
		const inst = params?.Parent ? new Definition() : this;
		init(inst, def);
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		for (const fn of inst._zod.deferred) fn();
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
var propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
	});
}
var NUMBER_FORMAT_RANGES = {
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				newShape[key] = currDef.shape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask) {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key in oldShape) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key in mask) {
			if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key in oldShape) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
//#endregion
//#region node_modules/zod/v4/core/errors.js
var initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	Object.defineProperty(inst, "_zod", {
		value: inst._zod,
		enumerable: false
	});
	Object.defineProperty(inst, "issues", {
		value: def,
		enumerable: false
	});
	inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
	Object.defineProperty(inst, "toString", {
		value: () => inst.message,
		enumerable: false
	});
};
var $ZodError = $constructor("$ZodError", initializer$1);
var $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) {
		fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
		fieldErrors[sub.path[0]].push(mapper(sub));
	} else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
//#endregion
//#region node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	if (result.issues.length) {
		const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, _params?.callee);
		throw e;
	}
	return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	if (result.issues.length) {
		const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, params?.callee);
		throw e;
	}
	return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
var safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
var safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
	return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
var duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
var uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date$4 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const time = timeSource({ precision: args.precision });
	const opts = ["Z"];
	if (args.local) opts.push("");
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const timeRegex = `${time}(?:${opts.join("|")})`;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
var integer = /^-?\d+$/;
var number$1 = /^-?\d+(?:\.\d+)?$/;
var boolean$1 = /^(?:true|false)$/i;
var _null$2 = /^null$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
//#endregion
//#region node_modules/zod/v4/core/checks.js
var $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
var $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
		if (def.value < curr) {
			if (def.inclusive) bag.maximum = def.value;
			else bag.exclusiveMaximum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
		if (def.value > curr) {
			if (def.inclusive) bag.minimum = def.value;
			else bag.exclusiveMinimum = def.value;
		}
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		var _a;
		(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
	});
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		bag.minimum = minimum;
		bag.maximum = maximum;
		if (isInt) bag.pattern = integer;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const length = input.length;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = []) {
		this.content = [];
		this.indent = 0;
		if (this) this.args = args;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const args = this?.args;
		const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
		return new F(...args, lines.join("\n"));
	}
};
//#endregion
//#region node_modules/zod/v4/core/versions.js
var version = {
	major: 4,
	minor: 4,
	patch: 3
};
//#endregion
//#region node_modules/zod/v4/core/schemas.js
var $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const checks = [...inst._zod.def.checks ?? []];
	if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
	defineLazy(inst, "~standard", () => ({
		validate: (value) => {
			try {
				const r = safeParse$1(inst, value);
				return r.success ? { value: r.data } : { issues: r.error?.issues };
			} catch (_) {
				return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
});
var $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
var $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
var $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
var $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
var $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
var $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			if (!def.normalize && def.protocol?.source === httpProtocol.source) {
				if (!/^https?:\/\//i.test(trimmed)) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid URL format",
						input: payload.value,
						inst,
						continue: !def.abort
					});
					return;
				}
			}
			const url = new URL(trimmed);
			if (def.hostname) {
				def.hostname.lastIndex = 0;
				if (!def.hostname.test(url.hostname)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid hostname",
					pattern: def.hostname.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.protocol) {
				def.protocol.lastIndex = 0;
				if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid protocol",
					pattern: def.protocol.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.normalize) payload.value = url.href;
			else payload.value = trimmed;
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
var $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	def.pattern ?? (def.pattern = nanoid);
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
var $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
var $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
var $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date$4);
	$ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time$1(def));
	$ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration$1);
	$ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		try {
			new URL(`http://[${payload.value}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
var $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		const parts = payload.value.split("/");
		try {
			if (parts.length !== 2) throw new Error();
			const [address, prefix] = parts;
			if (!prefix) throw new Error();
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) throw new Error();
			if (prefixNum < 0 || prefixNum > 128) throw new Error();
			new URL(`http://[${address}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
var $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
var $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
var $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
var $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
var $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
var $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
var $ZodNull = /*@__PURE__*/ $constructor("$ZodNull", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = _null$2;
	inst._zod.values = /* @__PURE__ */ new Set([null]);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (input === null) return payload;
		payload.issues.push({
			expected: "null",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
var $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
var $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
var $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
	const isPresent = key in input;
	if (result.issues.length) {
		if (isOptionalIn && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && !isOptionalIn) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		keys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const isOptionalIn = _catchall.optin === "optional";
	const isOptionalOut = _catchall.optout === "optional";
	for (const key in input) {
		if (key === "__proto__") continue;
		if (keySet.has(key)) continue;
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
		else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
var $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			return newSh;
		} });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazy(inst._zod, "propValues", () => {
		const shape = def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
			}
		}
		return propValues;
	});
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.keys) {
			const el = shape[key];
			const isOptionalIn = el._zod.optin === "optional";
			const isOptionalOut = el._zod.optout === "optional";
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
var $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const generateFastpass = (shape) => {
		const doc = new Doc([
			"shape",
			"payload",
			"ctx"
		]);
		const normalized = _normalized.value;
		const parseStr = (key) => {
			const k = esc(key);
			return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		};
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.keys) ids[key] = `key_${counter++}`;
		doc.write(`const newResult = {};`);
		for (const key of normalized.keys) {
			const id = ids[key];
			const k = esc(key);
			const schema = shape[key];
			const isOptionalIn = schema?._zod?.optin === "optional";
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(key)};`);
			if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
			else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		const fn = doc.compile();
		return (payload, ctx) => fn(shape, payload, ctx);
	};
	let fastpass;
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
var $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "values", () => {
		if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazy(inst._zod, "pattern", () => {
		if (def.options.every((o) => o._zod.pattern)) {
			const patterns = def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
var $ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
	def.inclusive = false;
	$ZodUnion.init(inst, def);
	const _super = inst._zod.parse;
	defineLazy(inst._zod, "propValues", () => {
		const propValues = {};
		for (const option of def.options) {
			const pv = option._zod.propValues;
			if (!pv || Object.keys(pv).length === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
			for (const [k, v] of Object.entries(pv)) {
				if (!propValues[k]) propValues[k] = /* @__PURE__ */ new Set();
				for (const val of v) propValues[k].add(val);
			}
		}
		return propValues;
	});
	const disc = cached(() => {
		const opts = def.options;
		const map = /* @__PURE__ */ new Map();
		for (const o of opts) {
			const values = o._zod.propValues?.[def.discriminator];
			if (!values || values.size === 0) throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
			for (const v of values) {
				if (map.has(v)) throw new Error(`Duplicate discriminator value "${String(v)}"`);
				map.set(v, o);
			}
		}
		return map;
	});
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				code: "invalid_type",
				expected: "object",
				input,
				inst
			});
			return payload;
		}
		const opt = disc.value.get(input?.[def.discriminator]);
		if (opt) return opt._zod.run(payload, ctx);
		if (def.unionFallback || ctx.direction === "backward") return _super(payload, ctx);
		payload.issues.push({
			code: "invalid_union",
			errors: [],
			note: "No matching discriminator",
			discriminator: def.discriminator,
			options: Array.from(disc.value.keys()),
			input,
			path: [def.discriminator],
			inst
		});
		return payload;
	};
});
var $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
		unrecIssue ?? (unrecIssue = iss);
		for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).l = true;
		}
	} else result.issues.push(iss);
	for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
		if (!unrecKeys.has(k)) unrecKeys.set(k, {});
		unrecKeys.get(k).r = true;
	}
	else result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length && unrecIssue) result.issues.push({
		...unrecIssue,
		keys: bothKeys
	});
	if (aborted(result)) return result;
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	result.value = merged.data;
	return result;
}
var $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isPlainObject(input)) {
			payload.issues.push({
				expected: "record",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		const proms = [];
		const values = def.keyType._zod.values;
		if (values) {
			payload.value = {};
			const recordKeys = /* @__PURE__ */ new Set();
			for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
				recordKeys.add(typeof key === "number" ? key.toString() : key);
				const keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (keyResult.issues.length) {
					payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			let unrecognized;
			for (const key in input) if (!recordKeys.has(key)) {
				unrecognized = unrecognized ?? [];
				unrecognized.push(key);
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized
			});
		} else {
			payload.value = {};
			for (const key of Reflect.ownKeys(input)) {
				if (key === "__proto__") continue;
				if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
				let keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
					const retryResult = def.keyType._zod.run({
						value: Number(key),
						issues: []
					}, ctx);
					if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (retryResult.issues.length === 0) keyResult = retryResult;
				}
				if (keyResult.issues.length) {
					if (def.mode === "loose") payload.value[key] = input[key];
					else payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}
			}
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
var $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
var $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
	const values = new Set(def.values);
	inst._zod.values = values;
	inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
var $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		payload.fallback = true;
		return payload;
	};
});
function handleOptionalResult(result, input) {
	if (input === void 0 && (result.issues.length || result.fallback)) return {
		issues: [],
		value: void 0
	};
	return result;
}
var $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.optout = "optional";
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
	});
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (def.innerType._zod.optin === "optional") {
			const input = payload.value;
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
			return handleOptionalResult(result, input);
		}
		if (payload.value === void 0) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
var $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
var $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => {
		const v = def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
var $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => {
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
				payload.fallback = true;
			}
			return payload;
		});
		payload.value = result.value;
		if (result.issues.length) {
			payload.value = def.catchValue({
				...payload,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			payload.issues = [];
			payload.fallback = true;
		}
		return payload;
	};
});
var $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => def.in._zod.values);
	defineLazy(inst._zod, "optin", () => def.in._zod.optin);
	defineLazy(inst._zod, "optout", () => def.out._zod.optout);
	defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.length) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues,
		fallback: left.fallback
	}, ctx);
}
var $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
	defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	payload.value = Object.freeze(payload.value);
	return payload;
}
var $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class({
		type: "number",
		checks: [],
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _null$1(Class, params) {
	return new Class({
		type: "null",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		external: params?.external ?? void 0
	};
}
function process(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) Object.assign(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
			};
		}
		if (entry[1] === root) return { ref: "#" };
		const defUriPrefix = `#/${defsSegment}/`;
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + defId
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else Object.assign(schema, refSchema);
			Object.assign(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	Object.assign(result, root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			defs[seen.defId] = seen.def;
		}
	}
	if (ctx.external) {} else if (Object.keys(defs).length > 0) {
		if (ctx.target === "draft-2020-12") result.$defs = defs;
		else result.definitions = defs;
	}
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
var stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time") delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
var numberProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
	if (typeof format === "string" && format.includes("int")) json.type = "integer";
	else json.type = "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) {
		if (legacy) {
			json.minimum = exclusiveMinimum;
			json.exclusiveMinimum = true;
		} else json.exclusiveMinimum = exclusiveMinimum;
	} else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) {
		if (legacy) {
			json.maximum = exclusiveMaximum;
			json.exclusiveMaximum = true;
		} else json.exclusiveMaximum = exclusiveMaximum;
	} else if (typeof maximum === "number") json.maximum = maximum;
	if (typeof multipleOf === "number") json.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
var nullProcessor = (_schema, ctx, json, _params) => {
	if (ctx.target === "openapi-3.0") {
		json.type = "string";
		json.nullable = true;
		json.enum = [null];
	} else json.type = "null";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
var enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
var literalProcessor = (schema, ctx, json, _params) => {
	const def = schema._zod.def;
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
	} else if (typeof val === "bigint") {
		if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
		else vals.push(Number(val));
	} else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
var customProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
var objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	json.properties = {};
	const shape = def.shape;
	for (const key in shape) json.properties[key] = process(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	});
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const v = def.shape[key]._zod;
		if (ctx.io === "input") return v.optin === void 0;
		else return v.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
var unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
var intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
};
var recordProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	const keyType = def.keyType;
	const patterns = keyType._zod.bag?.patterns;
	if (def.mode === "loose" && patterns && patterns.size > 0) {
		const valueSchema = process(def.valueType, ctx, {
			...params,
			path: [
				...params.path,
				"patternProperties",
				"*"
			]
		});
		json.patternProperties = {};
		for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
	} else {
		if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process(def.keyType, ctx, {
			...params,
			path: [...params.path, "propertyNames"]
		});
		json.additionalProperties = process(def.valueType, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	}
	const keyValues = keyType._zod.values;
	if (keyValues) {
		const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
		if (validKeyValues.length > 0) json.required = validKeyValues;
	}
};
var nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		throw new Error("Dynamic catch values are not supported in JSON Schema");
	}
	json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
//#endregion
//#region node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function date$3(params) {
	return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
var ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function time(params) {
	return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
var ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function duration(params) {
	return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
//#endregion
//#region node_modules/zod/v4/classic/errors.js
var initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	Object.defineProperties(inst, {
		format: { value: (mapper) => formatError(inst, mapper) },
		flatten: { value: (mapper) => flattenError(inst, mapper) },
		addIssue: { value: (issue) => {
			inst.issues.push(issue);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		addIssues: { value: (issues) => {
			inst.issues.push(...issues);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		isEmpty: { get() {
			return inst.issues.length === 0;
		} }
	});
};
var ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
//#endregion
//#region node_modules/zod/v4/classic/parse.js
var parse = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
	const proto = Object.getPrototypeOf(inst);
	let installed = _installedGroups.get(proto);
	if (!installed) {
		installed = /* @__PURE__ */ new Set();
		_installedGroups.set(proto, installed);
	}
	if (installed.has(group)) return;
	installed.add(group);
	for (const key in methods) {
		const fn = methods[key];
		Object.defineProperty(proto, key, {
			configurable: true,
			enumerable: false,
			get() {
				const bound = fn.bind(this);
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: bound
				});
				return bound;
			},
			set(v) {
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: v
				});
			}
		});
	}
}
var ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	$ZodType.init(inst, def);
	Object.assign(inst["~standard"], { jsonSchema: {
		input: createStandardJSONSchemaMethod(inst, "input"),
		output: createStandardJSONSchemaMethod(inst, "output")
	} });
	inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
	inst.def = def;
	inst.type = def.type;
	Object.defineProperty(inst, "_def", { value: def });
	inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
	inst.safeParse = (data, params) => safeParse(inst, data, params);
	inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
	inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
	inst.spa = inst.safeParseAsync;
	inst.encode = (data, params) => encode(inst, data, params);
	inst.decode = (data, params) => decode(inst, data, params);
	inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
	inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
	inst.safeEncode = (data, params) => safeEncode(inst, data, params);
	inst.safeDecode = (data, params) => safeDecode(inst, data, params);
	inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
	inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
	_installLazyMethods(inst, "ZodType", {
		check(...chks) {
			const def = this.def;
			return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		},
		with(...chks) {
			return this.check(...chks);
		},
		clone(def, params) {
			return clone(this, def, params);
		},
		brand() {
			return this;
		},
		register(reg, meta) {
			reg.add(this, meta);
			return this;
		},
		refine(check, params) {
			return this.check(refine(check, params));
		},
		superRefine(refinement, params) {
			return this.check(superRefine(refinement, params));
		},
		overwrite(fn) {
			return this.check(/* @__PURE__ */ _overwrite(fn));
		},
		optional() {
			return optional(this);
		},
		exactOptional() {
			return exactOptional(this);
		},
		nullable() {
			return nullable(this);
		},
		nullish() {
			return optional(nullable(this));
		},
		nonoptional(params) {
			return nonoptional(this, params);
		},
		array() {
			return array(this);
		},
		or(arg) {
			return union([this, arg]);
		},
		and(arg) {
			return intersection(this, arg);
		},
		transform(tx) {
			return pipe(this, transform(tx));
		},
		default(d) {
			return _default(this, d);
		},
		prefault(d) {
			return prefault(this, d);
		},
		catch(params) {
			return _catch(this, params);
		},
		pipe(target) {
			return pipe(this, target);
		},
		readonly() {
			return readonly(this);
		},
		describe(description) {
			const cl = this.clone();
			globalRegistry.add(cl, { description });
			return cl;
		},
		meta(...args) {
			if (args.length === 0) return globalRegistry.get(this);
			const cl = this.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(fn) {
			return fn(this);
		}
	});
	Object.defineProperty(inst, "description", {
		get() {
			return globalRegistry.get(inst)?.description;
		},
		configurable: true
	});
	return inst;
});
/** @internal */
var _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
	_installLazyMethods(inst, "_ZodString", {
		regex(...args) {
			return this.check(/* @__PURE__ */ _regex(...args));
		},
		includes(...args) {
			return this.check(/* @__PURE__ */ _includes(...args));
		},
		startsWith(...args) {
			return this.check(/* @__PURE__ */ _startsWith(...args));
		},
		endsWith(...args) {
			return this.check(/* @__PURE__ */ _endsWith(...args));
		},
		min(...args) {
			return this.check(/* @__PURE__ */ _minLength(...args));
		},
		max(...args) {
			return this.check(/* @__PURE__ */ _maxLength(...args));
		},
		length(...args) {
			return this.check(/* @__PURE__ */ _length(...args));
		},
		nonempty(...args) {
			return this.check(/* @__PURE__ */ _minLength(1, ...args));
		},
		lowercase(params) {
			return this.check(/* @__PURE__ */ _lowercase(params));
		},
		uppercase(params) {
			return this.check(/* @__PURE__ */ _uppercase(params));
		},
		trim() {
			return this.check(/* @__PURE__ */ _trim());
		},
		normalize(...args) {
			return this.check(/* @__PURE__ */ _normalize(...args));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ _toLowerCase());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ _toUpperCase());
		},
		slugify() {
			return this.check(/* @__PURE__ */ _slugify());
		}
	});
});
var ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
	inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
	inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
	inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
	inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
	inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
	inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
	inst.datetime = (params) => inst.check(datetime(params));
	inst.date = (params) => inst.check(date$3(params));
	inst.time = (params) => inst.check(time(params));
	inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
var ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
var ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function url(params) {
	return /* @__PURE__ */ _url(ZodURL, params);
}
var ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
var ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
var ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	_installLazyMethods(inst, "ZodNumber", {
		gt(value, params) {
			return this.check(/* @__PURE__ */ _gt(value, params));
		},
		gte(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		min(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		lt(value, params) {
			return this.check(/* @__PURE__ */ _lt(value, params));
		},
		lte(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		max(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		int(params) {
			return this.check(int(params));
		},
		safe(params) {
			return this.check(int(params));
		},
		positive(params) {
			return this.check(/* @__PURE__ */ _gt(0, params));
		},
		nonnegative(params) {
			return this.check(/* @__PURE__ */ _gte(0, params));
		},
		negative(params) {
			return this.check(/* @__PURE__ */ _lt(0, params));
		},
		nonpositive(params) {
			return this.check(/* @__PURE__ */ _lte(0, params));
		},
		multipleOf(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		step(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		finite() {
			return this;
		}
	});
	const bag = inst._zod.bag;
	inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
	inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
	inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
	inst.isFinite = true;
	inst.format = bag.format ?? null;
});
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
var ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
var ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
var ZodNull = /*@__PURE__*/ $constructor("ZodNull", (inst, def) => {
	$ZodNull.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullProcessor(inst, ctx, json, params);
});
function _null(params) {
	return /* @__PURE__ */ _null$1(ZodNull, params);
}
var ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
var ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
var ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
	_installLazyMethods(inst, "ZodArray", {
		min(n, params) {
			return this.check(/* @__PURE__ */ _minLength(n, params));
		},
		nonempty(params) {
			return this.check(/* @__PURE__ */ _minLength(1, params));
		},
		max(n, params) {
			return this.check(/* @__PURE__ */ _maxLength(n, params));
		},
		length(n, params) {
			return this.check(/* @__PURE__ */ _length(n, params));
		},
		unwrap() {
			return this.element;
		}
	});
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
var ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	defineLazy(inst, "shape", () => {
		return def.shape;
	});
	_installLazyMethods(inst, "ZodObject", {
		keyof() {
			return _enum(Object.keys(this._zod.def.shape));
		},
		catchall(catchall) {
			return this.clone({
				...this._zod.def,
				catchall
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: never()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(incoming) {
			return extend(this, incoming);
		},
		safeExtend(incoming) {
			return safeExtend(this, incoming);
		},
		merge(other) {
			return merge(this, other);
		},
		pick(mask) {
			return pick(this, mask);
		},
		omit(mask) {
			return omit(this, mask);
		},
		partial(...args) {
			return partial(ZodOptional, this, args[0]);
		},
		required(...args) {
			return required(ZodNonOptional, this, args[0]);
		}
	});
});
function object(shape, params) {
	return new ZodObject({
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	});
}
var ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
var ZodDiscriminatedUnion = /*@__PURE__*/ $constructor("ZodDiscriminatedUnion", (inst, def) => {
	ZodUnion.init(inst, def);
	$ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
	return new ZodDiscriminatedUnion({
		type: "union",
		options,
		discriminator,
		...normalizeParams(params)
	});
}
var ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
var ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
	$ZodRecord.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
	inst.keyType = def.keyType;
	inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
	if (!valueType || !valueType._zod) return new ZodRecord({
		type: "record",
		keyType: string(),
		valueType: keyType,
		...normalizeParams(valueType)
	});
	return new ZodRecord({
		type: "record",
		keyType,
		valueType,
		...normalizeParams(params)
	});
}
var ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	return new ZodEnum({
		type: "enum",
		entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
		...normalizeParams(params)
	});
}
var ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
var ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		payload.value = output;
		payload.fallback = true;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
var ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
var ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
var ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
var ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
var ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
var ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
var ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
	});
}
var ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
var ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
var ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
var momentumRuleVersion = "momentum-rules-1";
var id = string().min(1).max(200);
var label = string().min(1).max(500);
var date$2 = date$3();
var timestamp$2 = datetime({ offset: true });
var count$2 = number().int().nonnegative();
var currency = string().regex(/^[A-Z]{3}$/);
var ids = array(id).max(500).default([]);
var momentumBasisSchema = _enum(["pipeline", "monthly-usage"]);
var momentumCustomerIndustrySchema = _enum(["hls", "all"]);
var momentumQualitySchema = _enum([
	"complete",
	"partial",
	"unknown"
]);
var momentumDeadlineSchema = _enum([
	"overdue",
	"this-week",
	"rest-of-month",
	"later",
	"undated"
]);
var momentumEventSchema = object({
	id,
	kind: _enum([
		...[
			"stage-advanced",
			"milestone-completed",
			"commitment-recorded",
			"proof-completed"
		],
		"activity",
		"note",
		"task",
		"forecast-comment",
		"loopback",
		"date-slipped"
	]),
	source: _enum(["msx", "observed"]),
	sourceAt: timestamp$2.nullable(),
	observedAt: timestamp$2,
	intervalStart: timestamp$2.nullable(),
	intervalEnd: timestamp$2.nullable(),
	field: string().max(100).nullable(),
	relatedRecordKey: id.optional(),
	from: string().max(500).nullable(),
	to: string().max(500).nullable()
}).strict();
var momentumHistorySchema = object({
	state: _enum([
		"insufficient",
		"observed",
		"authoritative",
		"unavailable"
	]),
	scope: _enum([
		"shared",
		"synthetic",
		"unavailable"
	]),
	availableSince: timestamp$2.nullable(),
	lastObserved: timestamp$2.nullable(),
	observations: count$2,
	maxGapDays: number().nonnegative().nullable()
}).strict();
var momentumRecordSchema = object({
	key: id,
	id,
	entity: _enum(["opportunity", "milestone"]),
	name: label,
	accountId: id.nullable(),
	accountName: label.nullable(),
	opportunityId: id,
	stage: label.nullable(),
	status: label.nullable(),
	ownerId: id.nullable(),
	ownerName: label.nullable(),
	dueDate: date$2.nullable(),
	value: object({
		basis: momentumBasisSchema,
		amount: number().finite().nonnegative().nullable(),
		currency: currency.nullable()
	}).strict(),
	active: boolean().nullable(),
	onMyTeam: boolean().nullable(),
	role: _enum([
		"SSP",
		"SE",
		"both"
	]),
	commitment: boolean().nullable(),
	blocked: boolean().nullable(),
	blockingMilestoneIds: array(id).max(2e4),
	plannedHold: boolean(),
	sourceQuality: momentumQualitySchema,
	sourceUpdatedAt: timestamp$2.nullable(),
	sourceUrl: url().refine((value) => {
		const url = new URL(value);
		return url.protocol === "https:" && !url.username && !url.password;
	}, "Evidence links must use HTTPS without credentials.").nullable(),
	history: momentumHistorySchema,
	events: array(momentumEventSchema).max(1096)
}).strict();
var momentumFocusQuerySchema = object({
	timezone: string().max(100).refine((value) => {
		try {
			new Intl.DateTimeFormat("en", { timeZone: value });
			return true;
		} catch (error) {
			if (error instanceof RangeError) return false;
			throw error;
		}
	}, "Use a valid IANA timezone.").default("UTC"),
	focus: _enum([
		"week",
		"month",
		"custom"
	]).default("week"),
	from: date$2.optional(),
	to: date$2.optional(),
	lookbackDays: union([
		literal(7),
		literal(14),
		literal(30),
		literal(90)
	]).default(30),
	role: _enum(["SSP", "SE"]).default("SSP"),
	scope: _enum([
		"portfolio",
		"mine",
		"team"
	]).default("portfolio"),
	customerIndustry: momentumCustomerIndustrySchema.default("hls"),
	accountIds: ids,
	opportunityIds: ids,
	milestoneIds: ids,
	stages: ids,
	opportunityStatuses: ids,
	milestoneStatuses: ids,
	ownerIds: ids,
	entity: _enum([
		"all",
		"opportunity",
		"milestone"
	]).default("all"),
	sourceQuality: array(momentumQualitySchema).max(3).default([]),
	basis: _enum([
		"all",
		"pipeline",
		"monthly-usage"
	]).default("all"),
	currency: currency.optional(),
	minValue: number().finite().nonnegative().optional(),
	maxValue: number().finite().nonnegative().optional(),
	dateFrom: date$2.optional(),
	dateTo: date$2.optional(),
	includeUndated: boolean().default(true),
	lens: _enum([
		"all",
		"advancing",
		"review",
		"busy",
		"weekly",
		"monthly",
		"history",
		"unknown-history"
	]).default("all"),
	deadline: momentumDeadlineSchema.optional(),
	accountSort: _enum([
		"traction",
		"activity",
		"review"
	]).default("traction"),
	heatmap: _enum(["count", "value"]).default("count"),
	page: number().int().min(1).max(1e4).default(1),
	pageSize: number().int().min(1).max(100).default(25)
}).strict().superRefine((query, context) => {
	if (query.focus === "custom" && (!query.from || !query.to || query.from > query.to)) context.addIssue({
		code: "custom",
		message: "A custom focus needs an ordered start and end date."
	});
	if (query.minValue !== void 0 && query.maxValue !== void 0 && query.minValue > query.maxValue || query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) context.addIssue({
		code: "custom",
		message: "Filter ranges must be ordered."
	});
	if (query.heatmap === "value" && (query.basis !== "monthly-usage" || !query.currency)) context.addIssue({
		code: "custom",
		message: "Monetary heatmaps require monthly usage and one verified currency."
	});
	if ((query.minValue !== void 0 || query.maxValue !== void 0) && (query.basis === "all" || !query.currency)) context.addIssue({
		code: "custom",
		message: "Value ranges require one financial basis and a verified currency."
	});
});
var momentumFocusRequestSchema = object({
	contractVersion: literal("1.2"),
	operation: _enum([
		"load",
		"get",
		"refresh",
		"detail"
	]),
	query: momentumFocusQuerySchema.prefault({}),
	refresh: boolean().optional(),
	recordKey: id.optional(),
	snapshotId: id.optional()
}).strict().superRefine((request, context) => {
	if (request.operation === "detail" && (!request.recordKey || !request.snapshotId)) context.addIssue({
		code: "custom",
		message: "Detail reads require a record key and snapshot identity."
	});
	if (request.operation !== "detail" && (request.recordKey || request.snapshotId)) context.addIssue({
		code: "custom",
		message: "Record and snapshot identities are only valid for detail reads."
	});
	if (request.operation !== "load" && request.refresh !== void 0) context.addIssue({
		code: "custom",
		message: "The dataset refresh flag is only valid for load requests."
	});
});
var momentumSourceHealthSchema = object({
	source: _enum([
		"portfolio",
		"milestones",
		"activities",
		"notes",
		"currencies",
		"hierarchy",
		"industry",
		"history",
		"m365"
	]),
	state: _enum([
		"complete",
		"partial",
		"unavailable",
		"denied",
		"capped"
	]),
	detail: string().min(1).max(2e3),
	count: count$2.nullable(),
	checkedAt: timestamp$2
}).strict();
var momentumCollectionSchema = object({
	mode: _enum(["sample", "live"]),
	generatedAt: timestamp$2,
	scopeKey: id,
	scope: _enum([
		"portfolio",
		"mine",
		"team"
	]),
	customerIndustry: momentumCustomerIndustrySchema,
	teamAvailable: boolean(),
	complete: boolean(),
	records: array(momentumRecordSchema).max(3e4),
	sources: array(momentumSourceHealthSchema).max(12)
}).strict();
var momentumDatasetSchema = object({
	contractVersion: literal("1.2"),
	kind: literal("dataset"),
	ruleVersion: literal(momentumRuleVersion),
	snapshotId: id,
	asOf: timestamp$2,
	data: momentumCollectionSchema
}).strict();
var momentumPrioritySchema = momentumRecordSchema.extend({
	tier: _enum([
		"act-now",
		"this-week",
		"plan-month",
		"verify"
	]),
	deadline: momentumDeadlineSchema,
	reviewDate: date$2.nullable(),
	progressCount: count$2.nullable(),
	historyCoverage: _enum([
		"sufficient",
		"partial",
		"unknown"
	]),
	signalCount: count$2.nullable(),
	signalTypes: array(string().max(100)).max(12),
	latestSignal: timestamp$2.nullable(),
	latestProgress: timestamp$2.nullable(),
	reasons: array(object({
		code: id,
		text: string().min(1).max(1e3)
	}).strict()).max(20),
	nextAction: string().min(1).max(1e3),
	accountableRole: label,
	needsReview: boolean()
}).strict();
var window = object({
	from: string().min(1),
	to: string().min(1)
}).strict();
var momentumFocusResponseSchema = discriminatedUnion("kind", [
	momentumDatasetSchema,
	object({
		contractVersion: literal("1.2"),
		kind: literal("snapshot"),
		ruleVersion: literal(momentumRuleVersion),
		mode: _enum(["sample", "live"]),
		generatedAt: timestamp$2,
		snapshotId: id,
		queryKey: id,
		scopeKey: id,
		query: momentumFocusQuerySchema,
		scope: _enum([
			"portfolio",
			"mine",
			"team"
		]),
		customerIndustry: momentumCustomerIndustrySchema,
		teamAvailable: boolean(),
		complete: boolean(),
		focusWindow: window,
		evidenceWindow: window,
		sources: array(momentumSourceHealthSchema).max(12),
		total: count$2,
		rows: array(momentumPrioritySchema).max(100),
		summary: object({
			advancingAccounts: count$2,
			weeklyPriorities: count$2,
			monthlyMilestones: count$2,
			reviewCandidates: count$2,
			busyWithoutMovement: count$2,
			usableHistory: count$2,
			totalRecords: count$2
		}).strict(),
		facets: object({
			accounts: array(object({
				id,
				name: label
			}).strict()),
			opportunities: array(object({
				id,
				name: label
			}).strict()),
			milestones: array(object({
				id,
				name: label
			}).strict()),
			owners: array(object({
				id,
				name: label
			}).strict()),
			stages: array(label),
			opportunityStatuses: array(label),
			milestoneStatuses: array(label),
			currencies: array(currency)
		}).strict(),
		charts: object({
			matrix: array(object({
				key: id,
				id,
				entity: _enum(["opportunity", "milestone"]),
				name: label,
				progressCount: count$2,
				signalCount: count$2.nullable(),
				coverage: _enum([
					"sufficient",
					"partial",
					"unknown"
				]),
				amount: number().finite().nullable(),
				basis: momentumBasisSchema,
				currency: currency.nullable()
			}).strict()),
			unknownHistoryKeys: array(id),
			accounts: array(object({
				accountId: id.nullable(),
				name: label,
				advancing: count$2,
				eligible: count$2,
				active: count$2,
				advancingShare: number().min(0).max(1).nullable(),
				progressCount: count$2,
				signalCount: count$2,
				reviewCount: count$2,
				latestMovement: timestamp$2.nullable()
			}).strict()),
			heatmap: array(object({
				stage: label,
				status: label,
				count: count$2,
				value: number().finite().nonnegative().nullable(),
				unit: label,
				missingValues: count$2
			}).strict()),
			deadlines: array(object({
				bucket: momentumDeadlineSchema,
				opportunities: count$2,
				milestones: count$2
			}).strict()).length(5),
			values: array(object({
				basis: momentumBasisSchema,
				currency,
				amount: number().finite().nonnegative(),
				records: count$2
			}).strict()),
			unknownValues: count$2
		}).strict()
	}).strict(),
	object({
		contractVersion: literal("1.2"),
		kind: literal("detail"),
		snapshotId: id,
		queryKey: id,
		scopeKey: id,
		item: momentumPrioritySchema
	}).strict(),
	object({
		contractVersion: literal("1.2"),
		kind: literal("unavailable"),
		code: _enum([
			"unauthorized",
			"forbidden",
			"source-unavailable",
			"throttled",
			"scope-unavailable",
			"industry-unavailable",
			"stale",
			"history-unavailable"
		]),
		message: string().min(1).max(2e3)
	}).strict()
]);
var knowledgeSourceIdSchema = _enum([
	"mcem",
	"seismic-m365",
	"seismic-mcp"
]);
var knowledgeFileTypeSchema = _enum([
	"ppt",
	"pptx",
	"pdf",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"html"
]);
var knowledgeSearchFiltersSchema = object({ fileTypes: array(knowledgeFileTypeSchema).min(1).max(8).optional() }).strict();
var knowledgeSearchRequestSchema = object({
	contractVersion: literal("1.0"),
	query: string().trim().min(1).max(500),
	source: knowledgeSourceIdSchema,
	filters: knowledgeSearchFiltersSchema.optional(),
	limit: number().int().min(1).max(50).optional(),
	offset: number().int().min(0).max(1e4).optional()
}).strict();
var httpsEvidenceUrl = url().max(4096).refine((value) => {
	const url = new URL(value);
	return url.protocol === "https:" && !url.username && !url.password;
}, "Knowledge evidence must use an HTTPS URL without credentials.");
var knowledgeHitSchema = object({
	id: string().min(1).max(500),
	evidenceId: string().min(1).max(1e3),
	source: knowledgeSourceIdSchema,
	title: string().trim().min(1).max(1e3),
	url: httpsEvidenceUrl,
	snippet: string().max(4e3).optional(),
	fileType: knowledgeFileTypeSchema.optional(),
	lastModifiedAt: datetime({ offset: true }).optional(),
	connectionId: string().min(1).max(32).optional(),
	untrusted: literal(true)
}).strict();
var knowledgeFailureCodeSchema = _enum([
	"source-not-configured",
	"mcp-not-configured",
	"graph-not-configured",
	"graph-auth-not-configured",
	"graph-sign-in-required",
	"graph-permission-denied",
	"graph-throttled",
	"graph-request-failed",
	"graph-transport-failed",
	"graph-response-invalid",
	"graph-response-too-large"
]);
var sourceHealth = object({
	state: _enum([
		"sample",
		"live",
		"partial",
		"unauthorized",
		"unavailable"
	]),
	detail: string().min(1).max(1e3),
	checkedAt: datetime()
}).strict();
var common = {
	contractVersion: literal("1.0"),
	source: knowledgeSourceIdSchema,
	mode: _enum(["sample", "live"]),
	sourceHealth
};
var knowledgeSearchResponseSchema = discriminatedUnion("kind", [object({
	...common,
	kind: literal("results"),
	hits: array(knowledgeHitSchema).max(50),
	hasMore: boolean(),
	nextOffset: number().int().min(1).max(1e4).optional(),
	warnings: array(_enum(["invalid-source-items", "unverified-file-types"])).max(2)
}).strict().superRefine((value, context) => {
	if (value.hasMore !== (value.nextOffset !== void 0)) context.addIssue({
		code: "custom",
		message: "A continuation offset is required exactly when more results are available."
	});
	if (value.sourceHealth.state !== value.mode && value.sourceHealth.state !== "partial") context.addIssue({
		code: "custom",
		message: "Results require an available source."
	});
	if (value.hits.some((hit) => hit.source !== value.source)) context.addIssue({
		code: "custom",
		message: "Knowledge hits must come from the requested source."
	});
}), object({
	...common,
	kind: literal("unavailable"),
	code: knowledgeFailureCodeSchema,
	message: string().min(1).max(1e3)
}).strict().refine((value) => ["unauthorized", "unavailable"].includes(value.sourceHealth.state), "Unavailable results must report an unavailable or unauthorized source.")]);
var inferenceModeSchema = _enum(["sample", "foundry"]);
var inferenceExecutionSchema = object({
	contractVersion: literal("1.0"),
	correlationId: string().uuid(),
	requested: inferenceModeSchema,
	provider: inferenceModeSchema,
	state: _enum(["complete", "fallback"]),
	reason: _enum([
		"configuration",
		"authentication",
		"quota",
		"timeout",
		"validation",
		"provider"
	]).optional()
}).strict().refine((value) => value.state !== "fallback" || value.provider === "sample" && value.reason !== void 0, "Fallback must identify the offline provider and its reason.");
function validateInferenceResponse(value, context) {
	if (value.contractVersion === "1.3" !== (value.inference !== void 0)) context.addIssue({
		code: "custom",
		message: "Inference metadata requires the versioned inference response shape."
	});
}
var shortText = (max) => string().trim().min(1).max(max);
var untrustedText = (max) => string().max(max);
var workingSessionTopicRequestSchema = object({
	contractVersion: literal("1.0"),
	opportunityId: shortText(200),
	opportunityName: shortText(300),
	opportunityComments: untrustedText(4e3).optional(),
	milestoneId: shortText(200).optional(),
	milestoneName: shortText(300),
	milestoneComments: untrustedText(4e3).optional()
}).strict();
var workingSessionTopicSchema = object({
	topic: shortText(200),
	domain: shortText(100),
	azureServices: array(shortText(80)).max(8),
	deckQueries: array(shortText(120)).min(1).max(5),
	learnQueries: array(shortText(120)).min(1).max(5),
	iacScenario: shortText(300),
	confidence: _enum([
		"low",
		"medium",
		"high"
	]),
	basis: _enum(["model", "rules"]),
	evidence: array(shortText(200)).max(8)
}).strict();
var workingSessionTopicResponseSchema = object({
	contractVersion: _enum(["1.0", "1.3"]),
	inference: inferenceExecutionSchema.optional(),
	mode: _enum(["sample", "live"]),
	topic: workingSessionTopicSchema
}).strict().superRefine(validateInferenceResponse);
var workingSessionDeliverablesSchema = object({
	decks: boolean(),
	learn: boolean(),
	iac: boolean()
}).strict().refine((value) => value.decks || value.learn || value.iac, "Choose at least one deliverable.");
var workingSessionPrepareRequestSchema = object({
	contractVersion: literal("1.0"),
	opportunityId: shortText(200),
	opportunityName: shortText(300),
	milestoneName: shortText(300),
	topic: workingSessionTopicSchema,
	deliverables: workingSessionDeliverablesSchema
}).strict();
var relativeFilePath = string().min(1).max(260).refine((value) => !/^([a-zA-Z]:|[\\/])/.test(value) && !value.split(/[\\/]/).some((part) => part === ".." || part === "" || part === "."), "File paths must be relative and stay inside the working-session folder.");
var httpsUrl = url().max(4096).refine((value) => {
	const url = new URL(value);
	return url.protocol === "https:" && !url.username && !url.password;
}, "Source links must use HTTPS without credentials.");
var workingSessionFileSchema = object({
	path: relativeFilePath,
	kind: _enum([
		"deck",
		"learn",
		"iac",
		"manifest"
	]),
	title: shortText(300),
	sourceLabel: shortText(200),
	sourceUrl: httpsUrl.optional(),
	bytes: number().int().min(0)
}).strict();
var workingSessionGapCodeSchema = _enum([
	"not-configured",
	"needs-consent",
	"not-available-here",
	"nothing-found",
	"unavailable",
	"tool-missing",
	"rejected"
]);
var workingSessionGapSchema = object({
	deliverable: _enum([
		"decks",
		"learn",
		"iac"
	]),
	source: shortText(120),
	code: workingSessionGapCodeSchema,
	message: shortText(600)
}).strict();
var workingSessionDeliverySchema = discriminatedUnion("kind", [object({
	kind: literal("folder"),
	folderPath: shortText(1e3)
}).strict(), object({
	kind: literal("download"),
	downloadId: string().uuid(),
	fileName: shortText(200),
	expiresAt: string().datetime()
}).strict()]);
var workingSessionResultSchema = object({
	contractVersion: _enum(["1.0", "1.3"]),
	inference: inferenceExecutionSchema.optional(),
	mode: _enum(["sample", "live"]),
	folderName: shortText(200),
	delivery: workingSessionDeliverySchema,
	files: array(workingSessionFileSchema).max(200),
	gaps: array(workingSessionGapSchema).max(50),
	summary: shortText(1e3)
}).strict().superRefine(validateInferenceResponse);
var workingSessionOpenFolderRequestSchema = object({ folderPath: shortText(1e3) }).strict();
//#endregion
//#region packages/common/contracts/agent-task-limits.ts
var agentTaskPromptMaxLength = 64e3;
var workflowAgentCapabilityValues = [
	"account-pulse",
	"mcem-coach",
	"pursuit-executive",
	"risk-solution-play"
];
var workflowAgentCapabilitySchema = _enum(workflowAgentCapabilityValues);
var scopeRefSchema = discriminatedUnion("kind", [
	object({ kind: literal("portfolio") }).strict(),
	object({
		kind: literal("account"),
		accountId: string().min(1)
	}).strict(),
	object({
		kind: literal("opportunity"),
		accountId: string().min(1),
		opportunityId: string().min(1)
	}).strict()
]);
var workflowExecutionModeSchema = _enum([
	"deterministic",
	"composite",
	"agentic"
]);
var workflowOutcomeStateSchema = _enum([
	"complete",
	"partial",
	"unauthorized"
]);
var workflowRunStatusSchema = _enum([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled"
]);
var workflowConnectorStepSchema = object({
	connector: _enum(["dataverse-mcp", "msx-mcp"]),
	operation: string().regex(/^[a-z][a-z0-9_]*$/),
	required: boolean()
}).strict();
object({
	contractVersion: literal("1.0"),
	id: string().regex(/^WF-[0-9]{3}$/),
	name: string().min(1).max(120),
	version: string().regex(/^\d+\.\d+\.\d+$/),
	scope: _enum([
		"portfolio",
		"account",
		"opportunity"
	]),
	personaTargets: array(string().min(1)).min(1),
	category: string().regex(/^[a-z][a-z0-9-]*$/),
	executionMode: workflowExecutionModeSchema,
	connectorPlan: array(workflowConnectorStepSchema).min(1).max(6),
	inputSchemaRef: string().min(1),
	outputSchemaRef: string().min(1),
	sla: object({
		targetMs: number().int().min(1),
		timeoutMs: number().int().min(1)
	}).strict().refine((sla) => sla.timeoutMs >= sla.targetMs, "Workflow timeout must not be less than its target."),
	auth: object({
		requiresDelegatedUser: literal(true),
		allowedWrite: boolean()
	}).strict(),
	ui: object({
		cardStyle: _enum([
			"exception-list",
			"metric-strip",
			"record-table",
			"timeline",
			"action-list"
		]),
		resultPriority: _enum([
			"high",
			"medium",
			"low"
		]),
		showInQuickLaunch: boolean()
	}).strict()
}).strict();
var workflowConnectorCallSchema = object({
	connector: _enum(["dataverse-mcp", "msx-mcp"]),
	operation: string().regex(/^[a-z][a-z0-9_]*$/),
	status: _enum([
		"success",
		"partial",
		"unauthorized",
		"failed",
		"cancelled"
	]),
	durationMs: number().int().nonnegative(),
	recordCount: number().int().nonnegative(),
	truncated: boolean()
}).strict();
object({
	contractVersion: literal("1.0"),
	runId: string().uuid(),
	workflowId: string().regex(/^WF-[0-9]{3}$/),
	status: workflowRunStatusSchema,
	state: workflowOutcomeStateSchema.optional(),
	scope: scopeRefSchema,
	startedAt: string().datetime().optional(),
	completedAt: string().datetime().optional(),
	connectorCalls: array(workflowConnectorCallSchema),
	resultRef: string().min(1).optional(),
	telemetry: object({
		correlationId: string().uuid(),
		firstResultMs: number().int().nonnegative().optional(),
		cacheHit: boolean()
	}).strict()
}).strict().superRefine((run, context) => {
	if (run.status === "queued" && (run.startedAt || run.completedAt || run.state)) context.addIssue({
		code: "custom",
		path: ["status"],
		message: "Queued runs cannot have execution results."
	});
	if (run.status === "running" && (!run.startedAt || run.completedAt || run.state)) context.addIssue({
		code: "custom",
		path: ["status"],
		message: "Running runs require startedAt and cannot be complete."
	});
	if (run.status === "completed" && (!run.startedAt || !run.completedAt || !run.state || !run.resultRef)) context.addIssue({
		code: "custom",
		path: ["status"],
		message: "Completed runs require timestamps, outcome state, and a result."
	});
	if ((run.status === "failed" || run.status === "cancelled") && (!run.startedAt || !run.completedAt || run.state)) context.addIssue({
		code: "custom",
		path: ["status"],
		message: "Terminal runs require timestamps and no outcome state."
	});
});
var cardBaseSchema = object({
	title: string().min(1),
	evidenceIds: array(string().min(1))
});
discriminatedUnion("kind", [
	cardBaseSchema.extend({
		kind: literal("exception-list"),
		exceptions: array(object({
			id: string().min(1),
			title: string().min(1),
			priority: _enum([
				"P0",
				"P1",
				"P2"
			]),
			detail: string().min(1),
			evidenceIds: array(string().min(1))
		}).strict())
	}).strict(),
	cardBaseSchema.extend({
		kind: literal("metric-strip"),
		metrics: array(object({
			label: string().min(1),
			value: union([string(), number()])
		}).strict()).min(1)
	}).strict(),
	cardBaseSchema.extend({
		kind: literal("record-table"),
		columns: array(string().min(1)).min(1),
		rows: array(record(string(), union([
			string(),
			number(),
			boolean(),
			_null()
		])))
	}).strict(),
	cardBaseSchema.extend({
		kind: literal("timeline"),
		events: array(object({
			at: string().datetime(),
			label: string().min(1)
		}).strict())
	}).strict(),
	cardBaseSchema.extend({
		kind: literal("action-list"),
		actions: array(object({
			id: string().min(1),
			label: string().min(1),
			priority: _enum([
				"P0",
				"P1",
				"P2"
			])
		}).strict())
	}).strict()
]);
object({
	connector: _enum(["dataverse-mcp", "msx-mcp"]),
	operation: string().regex(/^[a-z][a-z0-9_]*$/),
	queryTemplateId: string().min(1).optional(),
	toolCallId: string().min(1)
}).strict();
var changeSetItemSchema = object({
	itemId: string().uuid(),
	entity: string().min(1),
	recordId: string().min(1),
	field: string().min(1),
	before: unknown(),
	after: unknown(),
	rationale: string().min(1),
	evidenceIds: array(string().min(1)).min(1)
}).strict().refine((item) => !Object.is(item.before, item.after), "A change-set item must change its value.");
object({
	contractVersion: literal("1.0"),
	changeSetId: string().uuid(),
	proposedByCorrelationId: string().uuid(),
	scope: scopeRefSchema,
	proposedAt: string().datetime(),
	expiresAt: string().datetime(),
	items: array(changeSetItemSchema).min(1)
}).strict().refine((proposal) => proposal.expiresAt > proposal.proposedAt, "Change-set expiry must follow proposal time.");
object({
	contractVersion: literal("1.0"),
	changeSetId: string().uuid(),
	approvedItemIds: array(string().uuid()).min(1),
	approvedAt: string().datetime(),
	reason: string().trim().min(3).max(1e3)
}).strict();
object({
	contractVersion: literal("1.0"),
	changeSetId: string().uuid(),
	state: _enum([
		"applied",
		"conflict",
		"failed"
	]),
	auditNote: string().min(1),
	itemResults: array(object({
		itemId: string().uuid(),
		state: _enum([
			"applied",
			"conflict",
			"failed"
		]),
		detail: string().min(1)
	}).strict()).min(1)
}).strict();
object({
	contractVersion: literal("1.0"),
	capability: workflowAgentCapabilitySchema,
	scope: scopeRefSchema,
	prompt: string().min(3).max(agentTaskPromptMaxLength)
}).strict();
var workflowGuidanceFactSchema = object({
	label: string().trim().min(1).max(80),
	value: string().trim().min(1).max(500)
}).strict();
object({
	contractVersion: literal("1.0"),
	workflowId: string().regex(/^WF-[0-9]{3}$/),
	resultRef: string().min(1).max(200),
	capability: workflowAgentCapabilitySchema,
	scope: object({
		kind: literal("opportunity"),
		accountId: string().min(1).max(200),
		opportunityId: string().min(1).max(200)
	}).strict(),
	prompt: string().trim().min(3).max(1e3),
	context: object({
		cardTitle: string().trim().min(1).max(120),
		queueItemId: string().min(1).max(200).optional(),
		queueItemTitle: string().trim().min(1).max(240).optional(),
		facts: array(workflowGuidanceFactSchema).max(20),
		evidenceIds: array(string().min(1).max(200)).min(1).max(20)
	}).strict()
}).strict();
//#endregion
//#region packages/common/configuration/se-domains.ts
/**
* Solution Engineer domains used to route MSX opportunity discovery.
*
* The classification is derived from the MSX `opportunity` Dataverse schema:
* `msp_solutionarea` is too coarse to separate Infrastructure, Data, and
* AI/Apps work (all three fall under "Cloud and AI Platforms"), so the fine
* grained `msp_technicalcapability` choice is used as the primary discriminator.
*/
var seDomainIds = [
	"infra",
	"data",
	"ai-apps",
	"security",
	"modern-work",
	"biz-apps",
	"devices",
	"services"
];
var seDomainSchema = _enum(seDomainIds);
/**
* `msp_solutionarea` option code for "Cloud and AI Platforms". All three SE
* domains sit under this single solution area, so it is shared across them and
* used only as a coarse gate.
*/
var CLOUD_AND_AI_PLATFORMS = 39438e4;
var seDomainDefinitions = {
	infra: {
		id: "infra",
		label: "Infrastructure",
		description: "Azure infrastructure, migration, networking, and hybrid/edge opportunities.",
		solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
		technicalCapabilityCodes: [
			86198e4,
			861980074,
			861980075,
			861980076,
			861980005,
			861980029,
			861980011,
			861980008,
			861980015,
			861980024,
			861980030,
			861980072,
			861980028,
			861980026,
			861980019,
			861980018,
			861980014
		],
		conversationCodes: [884800006, 884800001]
	},
	data: {
		id: "data",
		label: "Data",
		description: "Analytics, data platform, and database modernization opportunities.",
		solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
		technicalCapabilityCodes: [
			861980073,
			861980077,
			861980085,
			861980020,
			861980049,
			861980027
		],
		conversationCodes: [
			884800007,
			884800015,
			884800002
		]
	},
	"ai-apps": {
		id: "ai-apps",
		label: "AI & Apps",
		description: "AI, machine learning, app modernization, and cloud-native application opportunities.",
		solutionAreaCodes: [CLOUD_AND_AI_PLATFORMS],
		technicalCapabilityCodes: [
			861980002,
			861980009,
			861980023,
			861980007,
			861980071,
			861980041,
			861980082
		],
		conversationCodes: [8848e5, 884800012]
	},
	security: {
		id: "security",
		label: "Security",
		description: "Security, identity, threat protection, and information governance opportunities.",
		solutionAreaCodes: [861980005],
		technicalCapabilityCodes: [
			861980063,
			861980059,
			861980054,
			861980056,
			861980062,
			861980052,
			861980061
		],
		conversationCodes: [884800003, 884800013]
	},
	"modern-work": {
		id: "modern-work",
		label: "Modern Work",
		description: "Teams, collaboration, frontline, and workplace productivity opportunities.",
		solutionAreaCodes: [],
		technicalCapabilityCodes: [
			861980068,
			861980057,
			861980058,
			861980067,
			861980086,
			861980069,
			861980065,
			861980084,
			861980070
		],
		conversationCodes: [884800004, 884800011]
	},
	"biz-apps": {
		id: "biz-apps",
		label: "BizApps / Power Platform / D365",
		description: "Dynamics 365 and Power Platform business application opportunities.",
		solutionAreaCodes: [394380002],
		technicalCapabilityCodes: [
			861980034,
			861980050,
			861980046,
			861980047,
			861980051,
			861980078,
			861980035,
			861980032,
			861980079,
			861980080,
			861980081,
			861980083,
			861980031,
			861980033
		],
		conversationCodes: [884800005, 884800014]
	},
	devices: {
		id: "devices",
		label: "Devices / Mixed Reality",
		description: "Surface, device deployment/management, and mixed reality opportunities.",
		solutionAreaCodes: [861980012],
		technicalCapabilityCodes: [
			861980064,
			861980060,
			861980022
		],
		conversationCodes: [884800009]
	},
	services: {
		id: "services",
		label: "Services",
		description: "Microsoft advisory and consulting services opportunities.",
		solutionAreaCodes: [861980011],
		technicalCapabilityCodes: [861980055],
		conversationCodes: [884800008]
	}
};
seDomainIds.map((id) => seDomainDefinitions[id]);
//#endregion
//#region packages/common/contracts/portfolio.ts
var accountProvenanceSchema = _enum([
	"deal-team",
	"manual",
	"both"
]);
var accountVisibilitySchema = _enum(["visible", "hidden"]);
var accountSchema$1 = object({
	id: string().min(1),
	name: string().min(1),
	segment: string().min(1),
	tpid: string().min(1).optional(),
	provenance: accountProvenanceSchema.optional(),
	visibility: accountVisibilitySchema.optional()
});
object({
	query: string().trim().min(1).max(120),
	matchBy: _enum(["name", "tpid"])
}).strict().superRefine((value, context) => {
	if (value.matchBy === "name" && value.query.length < 2) context.addIssue({
		code: "custom",
		path: ["query"],
		message: "Account name searches require at least two characters."
	});
});
accountSchema$1.extend({ state: _enum([
	"not-added",
	"visible",
	"hidden"
]) }).strict();
object({ includeHidden: boolean().optional() }).strict();
object({ visibility: accountVisibilitySchema }).strict();
object({
	opportunityId: string().min(1),
	onDealTeam: literal(true),
	alreadyMember: boolean()
}).strict();
object({
	opportunityId: string().min(1),
	onDealTeam: literal(false),
	alreadyAbsent: boolean()
}).strict();
//#endregion
//#region packages/common/contracts/mcp.ts
var canonicalFieldSchema = string().regex(/^[a-z][a-zA-Z0-9]*$/);
var guardedQueryValueSchema = union([
	string(),
	number(),
	boolean(),
	array(union([string(), number()])).min(1).max(50)
]);
var guardedQueryFilterSchema = object({
	field: canonicalFieldSchema,
	operator: _enum([
		"eq",
		"ne",
		"gt",
		"ge",
		"lt",
		"le",
		"contains",
		"startswith",
		"in",
		"on-or-after",
		"on-or-before"
	]),
	value: guardedQueryValueSchema
}).strict();
var guardedQueryOrderSchema = object({
	field: canonicalFieldSchema,
	direction: _enum(["asc", "desc"])
}).strict();
var guardedQueryExpandSchema = object({
	relationship: canonicalFieldSchema,
	select: array(canonicalFieldSchema).min(1).max(12).refine(isUnique, "Expanded select fields must be unique.")
}).strict();
object({
	entity: canonicalFieldSchema,
	select: array(canonicalFieldSchema).min(1).max(40).refine(isUnique, "Select fields must be unique."),
	filter: array(guardedQueryFilterSchema).max(12).default([]),
	orderBy: array(guardedQueryOrderSchema).max(3).default([]).refine((orders) => isUnique(orders.map((order) => order.field)), "Order fields must be unique."),
	top: number().int().min(1).max(2e3).default(200),
	expand: array(guardedQueryExpandSchema).max(3).default([]).refine((expands) => isUnique(expands.map((expand) => expand.relationship)), "Expanded relationships must be unique.")
}).strict();
function isUnique(values) {
	return new Set(values).size === values.length;
}
//#endregion
//#region packages/common/contracts/meeting.ts
/**
* Contracts for the meeting-signal extraction → review → injection flow.
* See docs/MeetingCapture.md (Parts B, D, H). The transcript is untrusted input; the
* proposal/approval/result mirror the generic change-set contract with the fields the
* review UI needs (MCEM criterion, confidence, evidence, target kind).
*/
var meetingTypeSchema = _enum(["customer", "internal"]);
var meetingSourceSchema = _enum([
	"teams",
	"upload",
	"paste"
]);
var transcriptMaximumCharacters = 15e4;
var transcriptMaximumBytes = 512e3;
var transcriptContentSchema = string().trim().min(11, "Paste at least 11 characters of transcript text.").max(transcriptMaximumCharacters, "Transcript text must not exceed 150,000 characters.").refine((value) => !value.includes("\0"), "Use a UTF-8 text transcript, not a binary file.").refine((value) => new TextEncoder().encode(value).byteLength <= transcriptMaximumBytes, "Transcript text must not exceed 500 KiB.");
object({
	contractVersion: literal("1.0"),
	opportunityId: string().min(1).max(200),
	meetingType: meetingTypeSchema,
	source: _enum(["paste", "upload"]),
	content: transcriptContentSchema,
	format: _enum(["vtt", "text"]).optional()
}).strict();
var meetingTargetKindSchema = _enum([
	"opportunity",
	"milestone",
	"new-milestone"
]);
var meetingValueTypeSchema = _enum([
	"text",
	"money",
	"date",
	"optionset",
	"boolean",
	"percent"
]);
var mcemCriterionSchema = _enum([
	"customer-outcome",
	"decision-team",
	"technical-validation",
	"business-case",
	"next-step",
	"risk",
	"sentiment",
	"stage",
	"notes"
]);
object({
	id: string().min(1),
	subject: string().min(1),
	occurredAt: string().datetime(),
	meetingType: meetingTypeSchema,
	source: meetingSourceSchema,
	opportunityId: string().min(1).optional(),
	opportunityName: string().min(1).optional(),
	/** Absent for calendar candidates, whose transcript is only fetched after the user chooses Extract. */
	segmentCount: number().int().nonnegative().optional()
}).strict();
var meetingTranscriptSegmentSchema = object({
	segmentId: string().min(1),
	startMs: number().int().nonnegative().optional(),
	endMs: number().int().nonnegative().optional(),
	speaker: string().min(1).optional(),
	speakerRole: meetingTypeSchema.optional(),
	text: string().min(1)
}).strict();
object({
	id: string().min(1),
	opportunityId: string().min(1).optional(),
	meetingType: meetingTypeSchema,
	title: string().min(1).optional(),
	source: meetingSourceSchema,
	segments: array(meetingTranscriptSegmentSchema)
}).strict();
/** One proposed field change, rendered as a review-table row. */
var meetingSlotSchema = object({
	slotId: string().min(1),
	label: string().min(1),
	mcemCriterion: mcemCriterionSchema,
	targetKind: meetingTargetKindSchema,
	targetRecordId: string().min(1).optional(),
	targetField: string().min(1),
	valueType: meetingValueTypeSchema,
	before: unknown().optional(),
	after: unknown(),
	displayBefore: string().optional(),
	displayAfter: string().min(1),
	confidence: number().min(0).max(1),
	checkedByDefault: boolean(),
	blocked: boolean(),
	blockedReason: string().min(1).optional(),
	sensitive: boolean(),
	rationale: string().min(1),
	evidence: array(string().min(1))
}).strict();
var meetingNewMilestoneSchema = object({
	tempId: string().min(1),
	name: string().min(1),
	milestoneDate: string().date().optional(),
	ownerName: string().min(1).optional(),
	commitment: _enum(["Uncommitted", "Committed"]).optional(),
	confidence: number().min(0).max(1),
	checkedByDefault: boolean(),
	evidence: array(string().min(1))
}).strict();
var meetingUnmappedSignalSchema = object({
	label: string().min(1),
	text: string().min(1),
	mcemCriterion: mcemCriterionSchema,
	evidence: array(string().min(1))
}).strict();
object({
	contractVersion: literal("1.3").optional(),
	inference: inferenceExecutionSchema.optional(),
	changeSetId: string().min(1),
	transcriptId: string().min(1),
	opportunityId: string().min(1),
	meetingType: meetingTypeSchema,
	slots: array(meetingSlotSchema),
	newMilestones: array(meetingNewMilestoneSchema),
	suggestedMilestoneIds: array(string().min(1)),
	unmappedSignals: array(meetingUnmappedSignalSchema),
	proposedAt: string().datetime()
}).strict().superRefine(validateInferenceResponse);
object({
	changeSetId: string().min(1),
	opportunityId: string().min(1),
	approvedSlotIds: array(string().min(1)),
	approvedNewMilestoneTempIds: array(string().min(1)),
	selectedMilestoneIds: array(string().min(1)),
	reason: string().trim().min(3).max(1e3)
}).strict();
var meetingInjectItemResultSchema = object({
	id: string().min(1),
	kind: _enum(["field", "new-milestone"]),
	state: _enum([
		"applied",
		"conflict",
		"failed",
		"skipped"
	]),
	detail: string().min(1)
}).strict();
object({
	changeSetId: string().min(1),
	state: _enum(["applied", "rolled-back"]),
	items: array(meetingInjectItemResultSchema),
	auditNote: string().min(1)
}).strict();
var voiceLimits = {
	maxAudioMs: 3e4,
	silenceMs: 1e4,
	maxTranscriptChars: 2e3,
	maxSegments: 64,
	finalizationMs: 1e3
};
var voiceAvailabilitySchema = discriminatedUnion("available", [object({
	available: literal(true),
	processing: literal("on-device"),
	engine: _enum(["windows-offline", "browser-offline"])
}).strict(), object({
	available: literal(false),
	reason: _enum([
		"unsupported-platform",
		"remote-host",
		"missing-language",
		"not-configured"
	]),
	message: string().min(1).max(400)
}).strict()]);
var voiceSegmentSchema = object({
	id: string().min(1).max(80),
	sequence: number().int().nonnegative(),
	text: string().max(voiceLimits.maxTranscriptChars),
	isFinal: boolean()
}).strict();
var voiceErrorCodeSchema = _enum([
	"permission-denied",
	"no-speech",
	"device-lost",
	"provider-error",
	"cancelled"
]);
discriminatedUnion("type", [
	object({
		contractVersion: literal("1.0"),
		type: literal("started")
	}).strict(),
	object({
		contractVersion: literal("1.0"),
		type: literal("segment"),
		segment: voiceSegmentSchema.extend({ text: string().max(16384) }).strict()
	}).strict(),
	object({
		contractVersion: literal("1.0"),
		type: literal("ended")
	}).strict(),
	object({
		contractVersion: literal("1.0"),
		type: literal("error"),
		code: voiceErrorCodeSchema,
		message: string().min(1).max(400)
	}).strict()
]);
var envelope$1 = { contractVersion: literal("1.0") };
var voiceStartRequestSchema = object({
	...envelope$1,
	operation: literal("start"),
	sessionId: string().uuid(),
	locale: literal("en-US"),
	consent: literal(true),
	hints: array(string().trim().min(1).max(200)).max(64).default([])
}).strict();
discriminatedUnion("operation", [
	object({
		...envelope$1,
		operation: literal("availability")
	}).strict(),
	voiceStartRequestSchema,
	object({
		...envelope$1,
		operation: _enum([
			"read",
			"stop",
			"cancel"
		]),
		sessionId: string().uuid()
	}).strict()
]);
var voiceSessionSchema = object({
	...envelope$1,
	kind: literal("session"),
	sessionId: string().uuid(),
	status: _enum([
		"arming",
		"listening",
		"finalizing",
		"ended",
		"cancelled",
		"error"
	]),
	segments: array(voiceSegmentSchema).max(voiceLimits.maxSegments),
	message: string().max(400),
	errorCode: voiceErrorCodeSchema.optional()
}).strict();
discriminatedUnion("kind", [object({
	...envelope$1,
	kind: literal("availability"),
	availability: voiceAvailabilitySchema
}).strict(), voiceSessionSchema]);
var text$1 = string().max(3e4);
var name$1 = string().min(1).max(500);
var identifier$2 = string().min(1).max(200);
var tpid = string().regex(/^[1-9][0-9]{0,19}$/);
var amount = number().finite();
var nonnegative$1 = amount.nonnegative();
var count$1 = number().int().nonnegative();
var date$1 = date$3();
var timestamp$1 = datetime({ offset: true });
var quality = _enum([
	"complete",
	"partial",
	"unavailable"
]);
var timing = _enum([
	"overdue",
	"in-quarter",
	"future",
	"undated"
]);
var bucketSchema = object({
	name: name$1,
	weight: amount.min(0).max(1),
	unit: literal("USD"),
	attainment: amount,
	actual: amount,
	quota: amount,
	recurring: amount,
	calcActual: amount,
	calcQuota: nonnegative$1,
	gap: nonnegative$1
}).strict();
var metricSchema = object({
	name: name$1,
	bucket: name$1,
	unit: literal("USD"),
	mappingSupported: boolean(),
	scenarioAllowed: boolean(),
	attainment: amount,
	actual: amount,
	quota: amount,
	recurring: amount,
	calcActual: amount,
	calcQuota: amount,
	gap: nonnegative$1,
	closedGap: nonnegative$1,
	closedAttainment: amount.nullable(),
	accountActualDifference: amount,
	accountQuotaDifference: amount
}).strict();
var accountSchema = object({
	tpid,
	name: name$1,
	metrics: array(object({
		metric: name$1,
		bucket: name$1,
		quota: nonnegative$1,
		actual: amount.nullable(),
		variance: amount.nullable(),
		gap: nonnegative$1.nullable()
	}).strict()).max(100),
	pipeline: object({
		status: quality,
		openCount: count$1,
		inQuarterCount: count$1,
		inQuarterValue: amount,
		productionCount: count$1,
		inQuarterProductionCount: count$1,
		committedMonthly: amount,
		uncommittedMonthly: amount,
		noPipeline: boolean(),
		noInQuarterPipeline: boolean()
	}).strict(),
	nextAction: text$1
}).strict();
var opportunitySchema$1 = object({
	id: identifier$2,
	number: text$1,
	tpid,
	account: name$1,
	name: name$1,
	owner: text$1,
	stage: text$1,
	solutionArea: text$1,
	salesPlay: text$1,
	intent: text$1,
	estimatedValue: amount.nullable(),
	currency: text$1,
	monthlyRunRate: amount.nullable(),
	closeDate: date$1.nullable(),
	state: text$1,
	forecastComments: text$1,
	timing,
	relevance: text$1,
	modifiedAt: timestamp$1.optional(),
	estimatedBilledRevenue: amount.nullable().optional(),
	estimatedSqlRevenue: amount.nullable().optional()
}).strict();
var milestoneSchema$1 = object({
	id: identifier$2,
	number: text$1,
	opportunityId: identifier$2,
	opportunityName: name$1,
	tpid,
	account: name$1,
	name: name$1,
	owner: text$1,
	category: text$1,
	status: text$1,
	commitment: text$1,
	monthly: amount.nullable(),
	date: date$1.nullable(),
	workload: text$1,
	forecastComments: text$1,
	currency: text$1,
	active: boolean().nullable(),
	timing,
	metricCandidates: array(name$1).max(100),
	mappingBasis: text$1,
	classification: text$1,
	scenarioCredit: amount.nullable(),
	modifiedAt: timestamp$1.optional(),
	commitmentChangedAt: timestamp$1.optional(),
	region: text$1.optional(),
	riskDetails: text$1.optional()
}).strict();
var coverageSchema = object({
	metric: name$1,
	bucket: name$1,
	gap: nonnegative$1,
	candidateCount: count$1,
	committedMonthly: amount,
	uncommittedMonthly: amount,
	verifiedPeriodCredit: _null(),
	state: text$1,
	mappingSupported: boolean(),
	mappingReviewRequired: boolean(),
	scenarioAllowed: boolean(),
	scenarioCommittedCredit: amount.nullable(),
	scenarioUncommittedCredit: amount.nullable(),
	scenarioRemainingGap: amount.nullable(),
	nextAction: text$1
}).strict();
var sellerDashboardReportSchema = object({
	schemaVersion: literal(1),
	generatedAt: timestamp$1,
	plan: object({
		currency: literal("USD"),
		unit: literal("USD"),
		fiscalYear: number().int().min(2e3).max(2200),
		sourceUnitsVerified: boolean(),
		metricMapping: array(object({
			metric: name$1,
			bucket: name$1,
			hintSupported: boolean(),
			state: text$1,
			scenarioAllowed: boolean()
		}).strict()).max(100),
		unmappedProductionCandidates: count$1
	}).strict(),
	period: object({
		label: name$1,
		start: date$1,
		end: date$1,
		today: date$1
	}).strict(),
	sources: object({
		earnings: object({
			status: _enum(["live", "stale"]),
			generatedAt: timestamp$1,
			refreshedAt: timestamp$1.nullable(),
			months: array(name$1).max(12),
			ageDays: number().int().nullable()
		}).strict(),
		pipeline: object({
			status: quality,
			asOf: timestamp$1.nullable(),
			errors: array(text$1).max(1e3)
		}).strict(),
		quota: object({
			name: name$1,
			rows: count$1,
			accounts: count$1.max(200)
		}).strict()
	}).strict(),
	warnings: array(text$1).max(1e3),
	official: object({
		weightedAttainment: amount,
		closedMonthAttainment: amount.nullable(),
		closedThrough: name$1.nullable(),
		buckets: array(bucketSchema).min(1).max(100),
		metrics: array(metricSchema).min(1).max(100)
	}).strict(),
	accounts: array(accountSchema).min(1).max(200),
	opportunities: array(opportunitySchema$1).max(5e4),
	milestones: array(milestoneSchema$1).max(5e4),
	coverage: array(coverageSchema).max(100),
	actions: array(object({
		account: name$1,
		tpid,
		metric: name$1,
		priority: _enum([
			"High",
			"Medium",
			"Low"
		]),
		issue: text$1,
		action: text$1,
		owner: text$1
	}).strict()).max(2e4),
	methodology: array(text$1).max(100)
}).strict().superRefine((report, context) => {
	const reject = (message) => context.addIssue({
		code: "custom",
		message
	});
	const unique = (values, label) => {
		if (new Set(values).size !== values.length) reject(`Duplicate ${label}.`);
	};
	const close = (left, right) => Math.abs(left - right) <= .01;
	const { buckets, metrics } = report.official;
	unique(buckets.map((row) => row.name), "bucket");
	unique(metrics.map((row) => row.name), "metric");
	unique(report.accounts.map((row) => row.tpid), "account");
	unique(report.opportunities.map((row) => row.id), "opportunity");
	unique(report.milestones.map((row) => row.id), "milestone");
	unique(report.coverage.map((row) => row.metric), "coverage metric");
	if (Math.abs(buckets.reduce((sum, row) => sum + row.weight, 0) - 1) > 1e-6) reject("Official bucket weights must sum to one.");
	if (report.period.start > report.period.end) reject("Invalid official reporting interval.");
	if (report.period.today < report.period.start || Date.parse(report.period.today) > Date.parse(report.period.end) + 26784e5) reject("As-of date is outside the supported official reporting interval.");
	if (report.period.start < `${report.plan.fiscalYear - 1}-07-01` || report.period.end > `${report.plan.fiscalYear}-06-30`) reject("Reporting interval is outside the fiscal year.");
	for (const row of [...buckets, ...metrics]) if (!close(row.gap, Math.max(row.calcQuota - row.calcActual, 0))) reject("Posted gap does not reconcile to signed calculated amounts.");
	const metricMap = new Map(metrics.map((row) => [row.name, row]));
	const bucketNames = new Set(buckets.map((row) => row.name));
	if (metrics.some((row) => !bucketNames.has(row.bucket))) reject("Unknown metric bucket.");
	if (report.plan.metricMapping.length !== metrics.length || report.plan.metricMapping.some((row) => metricMap.get(row.metric)?.bucket !== row.bucket)) reject("Plan metric mapping does not reconcile.");
	unique(report.plan.metricMapping.map((row) => row.metric), "plan mapping");
	const accountMap = new Map(report.accounts.map((row) => [row.tpid, row]));
	const opportunityMap = new Map(report.opportunities.map((row) => [row.id, row]));
	if (report.sources.quota.accounts !== report.accounts.length) reject("Quota account count does not reconcile.");
	for (const account of report.accounts) {
		unique(account.metrics.map((row) => row.metric), "account metric");
		const accountMetricNames = new Set(account.metrics.map((row) => row.metric));
		if (metrics.some((metric) => !accountMetricNames.has(metric.name))) reject("Account metrics must include the complete official metric set.");
		for (const row of account.metrics) {
			if (metricMap.get(row.metric)?.bucket !== row.bucket) reject("Unknown account metric mapping.");
			if (row.actual === null) {
				if (row.gap !== null || row.variance !== null) reject("Missing actuals cannot establish an account gap.");
			} else if (row.gap === null || row.variance === null || !close(row.gap, Math.max(row.quota - row.actual, 0)) || !close(row.variance, row.actual - row.quota)) reject("Account amounts do not reconcile.");
		}
		if (account.pipeline.status !== "complete" && (account.pipeline.noPipeline || account.pipeline.noInQuarterPipeline)) reject("Incomplete retrieval cannot establish absent pipeline.");
		if (report.sources.pipeline.status === "unavailable" && account.pipeline.status !== "unavailable") reject("Unavailable global retrieval cannot establish complete account data.");
	}
	for (const row of [...report.opportunities, ...report.milestones]) {
		if (accountMap.get(row.tpid)?.name !== row.account) reject("Pipeline is outside the quota roster.");
		const value = "date" in row ? row.date : row.closeDate;
		const expectedTiming = value === null ? "undated" : value < report.period.today ? "overdue" : value > report.period.end ? "future" : "in-quarter";
		if (row.timing !== expectedTiming) reject("Pipeline timing does not match source dates.");
	}
	for (const row of report.milestones) {
		const parent = opportunityMap.get(row.opportunityId);
		if (!parent || parent.tpid !== row.tpid) reject("Milestone parent attribution is invalid.");
		if (row.metricCandidates.some((metric) => !metricMap.has(metric))) reject("Unknown candidate metric.");
		if (parent?.state === "Lost" && row.active === true) reject("A lost parent cannot supply active consumption.");
		if (row.active === null && accountMap.get(row.tpid)?.pipeline.status === "complete") reject("Unknown milestone activity requires incomplete source quality.");
	}
	for (const row of report.coverage) {
		const metric = metricMap.get(row.metric);
		if (!metric || metric.bucket !== row.bucket || !close(row.gap, metric.gap)) reject("Coverage does not reconcile to the official metric.");
	}
	for (const row of report.actions) if (!accountMap.has(row.tpid) || !metricMap.has(row.metric)) reject("Action is outside the reporting scope.");
});
var supplementSourceSchema = object({
	name: name$1,
	status: quality,
	asOf: timestamp$1,
	start: date$1,
	end: date$1,
	detail: text$1
}).strict().refine((source) => source.start <= source.end, "Invalid supplemental source interval.");
var sellerDashboardSupplementSchema = object({
	schemaVersion: literal(1),
	consumption: object({
		source: supplementSourceSchema,
		accounts: array(object({
			tpid,
			actual: nonnegative$1,
			previousActual: nonnegative$1.nullable(),
			averageDaily: nonnegative$1,
			projected: nonnegative$1.nullable(),
			daysPosted: count$1,
			pillars: array(object({
				name: name$1,
				actual: nonnegative$1
			}).strict()).max(100)
		}).strict()).max(200),
		services: array(object({
			id: identifier$2,
			tpid,
			name: name$1,
			pillar: name$1,
			previousDaily: nonnegative$1,
			currentDaily: nonnegative$1,
			isNew: boolean()
		}).strict()).max(5e4),
		subscriptions: array(object({
			id: identifier$2,
			tpid,
			name: name$1,
			created: date$1,
			averageDaily: nonnegative$1
		}).strict()).max(5e4),
		sqlReclassification: array(object({
			id: identifier$2,
			tpid,
			workload: name$1,
			monthlyOpportunity: nonnegative$1,
			evidence: text$1
		}).strict()).max(5e4)
	}).strict().nullable(),
	conversion: object({
		source: supplementSourceSchema,
		accounts: array(object({
			tpid,
			territory: text$1,
			startingMonthly: nonnegative$1,
			convertedMonthly: nonnegative$1,
			inQuarterMonthly: nonnegative$1,
			shiftedOutMonthly: nonnegative$1,
			startingCount: count$1,
			convertedCount: count$1
		}).strict()).max(200)
	}).strict().nullable()
}).strict().superRefine((supplement, context) => {
	const reject = (message) => context.addIssue({
		code: "custom",
		message
	});
	const consumption = supplement.consumption;
	if (consumption) {
		if (new Set(consumption.accounts.map((row) => row.tpid)).size !== consumption.accounts.length) reject("Duplicate consumption account.");
		for (const row of consumption.accounts) {
			if (row.daysPosted > 31 || row.daysPosted === 0 && row.actual !== 0) reject("Invalid posted consumption days.");
			if (Math.abs(row.pillars.reduce((sum, pillar) => sum + pillar.actual, 0) - row.actual) > .01) reject("Pillar consumption does not reconcile to the account.");
		}
	}
	const conversion = supplement.conversion;
	if (conversion) {
		if (new Set(conversion.accounts.map((row) => row.tpid)).size !== conversion.accounts.length) reject("Duplicate conversion account.");
		for (const row of conversion.accounts) if (row.convertedCount > row.startingCount || row.convertedMonthly > row.startingMonthly || Math.abs(row.inQuarterMonthly + row.shiftedOutMonthly - row.convertedMonthly) > .01) reject("Conversion does not reconcile to the historical baseline.");
	}
});
discriminatedUnion("kind", [object({
	contractVersion: literal("1.0"),
	kind: literal("snapshot"),
	mode: _enum(["sample", "live"]),
	state: _enum(["ready", "stale"]),
	message: text$1,
	report: sellerDashboardReportSchema,
	supplement: sellerDashboardSupplementSchema.nullable()
}).strict().superRefine((snapshot, context) => {
	const tpids = new Set(snapshot.report.accounts.map((row) => row.tpid));
	const consumption = snapshot.supplement?.consumption;
	if ([
		...consumption?.accounts ?? [],
		...consumption?.services ?? [],
		...consumption?.subscriptions ?? [],
		...consumption?.sqlReclassification ?? [],
		...snapshot.supplement?.conversion?.accounts ?? []
	].some((row) => !tpids.has(row.tpid))) context.addIssue({
		code: "custom",
		message: "Supplemental data is outside the quota roster."
	});
	for (const source of [consumption, snapshot.supplement?.conversion]) if (source?.source.status === "complete" && source.accounts.length !== tpids.size) context.addIssue({
		code: "custom",
		message: "A complete supplemental source must cover the quota account roster."
	});
}), object({
	contractVersion: literal("1.0"),
	kind: literal("unavailable"),
	mode: literal("live"),
	code: _enum([
		"not-configured",
		"unsupported-platform",
		"identity-mismatch",
		"invalid-snapshot",
		"runtime-failed",
		"hosted-profile-denied"
	]),
	message: name$1
}).strict()]);
discriminatedUnion("operation", [object({
	contractVersion: literal("1.0"),
	operation: literal("get")
}).strict(), object({
	contractVersion: literal("1.0"),
	operation: literal("refresh"),
	confirmed: literal(true),
	asOf: date$1.optional()
}).strict()]);
var identifier$1 = string().min(1).max(200);
var name = string().min(1).max(500);
var text = string().max(3e4);
var nonnegative = number().finite().nonnegative();
var count = number().int().nonnegative();
var date = date$3();
var timestamp = datetime({ offset: true });
var month = string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
var stagePipelineStages = [
	"Listen & Consult",
	"Inspire & Design",
	"Empower & Achieve",
	"Realize Value",
	"Manage & Optimize"
];
var stagePipelineMilestoneStatuses = [
	"On Track",
	"At Risk",
	"Blocked",
	"Completed",
	"Cancelled",
	"Hygiene/Duplicate",
	"Lost to Competitor"
];
var stagePipelineStageSchema = _enum(stagePipelineStages);
var stagePipelineMilestoneStatusSchema = _enum(stagePipelineMilestoneStatuses);
var stagePipelineScopeSchema = _enum(["azure", "microsoft-services"]);
var stagePipelineThreatSchema = _enum([
	"None",
	"Low",
	"Medium",
	"High"
]);
var stagePipelineViewScopeSchema = _enum([
	"mine",
	"reports",
	"both"
]);
var stagePipelineSourceNames = [
	"opportunities",
	"milestones",
	"macc",
	"acr",
	"hierarchy"
];
var stagePipelineAcrSources = [
	"sample",
	"mint",
	"semantic-model",
	"derived-pipeline-only",
	"unavailable"
];
var stagePipelineOpportunitySchema = object({
	id: identifier$1,
	number: name,
	customer: name,
	name,
	owner: string().max(200),
	editable: boolean(),
	notes: text,
	contact: text,
	scope: stagePipelineScopeSchema,
	solutionArea: name,
	inbound: boolean(),
	stage: stagePipelineStageSchema,
	status: _enum([
		"In Progress",
		"On Hold",
		"Won",
		"Lost"
	]),
	forecast: name,
	closeDate: date,
	daysInStage: count,
	idleDays: count.nullable(),
	consumedRecurring: nonnegative,
	consumedNonRecurring: nonnegative,
	maccCommit: nonnegative,
	partner: text.nullable(),
	competitor: object({
		name: text.nullable(),
		threat: stagePipelineThreatSchema
	}).strict(),
	solutionTagReview: boolean()
}).strict();
var stagePipelineMilestoneSchema = object({
	id: identifier$1,
	number: name,
	opportunityId: identifier$1,
	name,
	workload: text,
	estimatedMonthlyAcr: nonnegative,
	commitment: _enum(["Committed", "Uncommitted"]),
	status: stagePipelineMilestoneStatusSchema,
	date: date.nullable(),
	comment: text,
	owner: text
}).strict();
var acrMonthSchema = object({
	month,
	actual: nonnegative.nullable(),
	baseline: nonnegative.nullable(),
	committed: nonnegative,
	uncommitted: nonnegative,
	stage1: nonnegative,
	target: nonnegative.nullable()
}).strict();
var stagePipelineAcrSchema = object({
	source: _enum(stagePipelineAcrSources),
	syncedAt: date.nullable(),
	lastActualMonth: month.nullable(),
	accounts: array(object({
		customer: name,
		months: array(acrMonthSchema).length(12)
	}).strict()).max(500)
}).strict().superRefine((acr, context) => {
	const connected = acr.source === "sample" || acr.source === "mint" || acr.source === "semantic-model";
	const measured = acr.accounts.flatMap((account) => account.months).flatMap((row) => [
		row.actual,
		row.baseline,
		row.target
	]);
	if (!(connected ? acr.syncedAt !== null && acr.lastActualMonth !== null && measured.every((value) => value !== null) : acr.syncedAt === null && acr.lastActualMonth === null && measured.every((value) => value === null))) context.addIssue({
		code: "custom",
		message: connected ? "A connected ACR source must provide actuals, baseline, target and sync dates." : "An unconnected ACR source must not report actuals, baseline, target or sync dates."
	});
});
var stagePipelineSourceHealthSchema = object({
	source: _enum(stagePipelineSourceNames),
	state: _enum([
		"complete",
		"partial",
		"unavailable"
	]),
	detail: text,
	count: count.optional()
}).strict();
var stagePipelineReportSchema = object({
	id: identifier$1,
	displayName: name
}).strict();
var stagePipelineSnapshotSchema = object({
	contractVersion: literal("1.1"),
	kind: literal("snapshot"),
	mode: _enum(["sample", "live"]),
	state: _enum(["fresh", "stale"]),
	message: text,
	generatedAt: timestamp,
	owner: string().max(200),
	asOf: date,
	fiscalYear: number().int().min(2e3).max(2100),
	scope: stagePipelineViewScopeSchema,
	reports: array(stagePipelineReportSchema).max(50),
	sources: array(stagePipelineSourceHealthSchema).max(10),
	opportunities: array(stagePipelineOpportunitySchema).max(5e3),
	milestones: array(stagePipelineMilestoneSchema).max(25e3),
	acr: stagePipelineAcrSchema
}).strict().superRefine((value, context) => {
	if (value.scope === "mine" && value.reports.length > 0) context.addIssue({
		code: "custom",
		path: ["reports"],
		message: "The seller portfolio scope has no direct reports."
	});
	if (new Set(value.reports.map((row) => row.id)).size !== value.reports.length) context.addIssue({
		code: "custom",
		path: ["reports"],
		message: "Report ids must be unique."
	});
	if (new Set(value.sources.map((row) => row.source)).size !== value.sources.length) context.addIssue({
		code: "custom",
		path: ["sources"],
		message: "Each source may be reported once."
	});
	const ids = /* @__PURE__ */ new Set();
	for (const [index, row] of value.opportunities.entries()) {
		if (ids.has(row.id)) context.addIssue({
			code: "custom",
			path: [
				"opportunities",
				index,
				"id"
			],
			message: "Opportunity ids must be unique."
		});
		ids.add(row.id);
	}
	const milestoneIds = /* @__PURE__ */ new Set();
	for (const [index, row] of value.milestones.entries()) {
		if (milestoneIds.has(row.id)) context.addIssue({
			code: "custom",
			path: [
				"milestones",
				index,
				"id"
			],
			message: "Milestone ids must be unique."
		});
		milestoneIds.add(row.id);
		if (!ids.has(row.opportunityId)) context.addIssue({
			code: "custom",
			path: [
				"milestones",
				index,
				"opportunityId"
			],
			message: "Milestone must reference a listed opportunity."
		});
	}
});
var stagePipelineUnavailableSchema = object({
	contractVersion: literal("1.1"),
	kind: literal("unavailable"),
	code: _enum([
		"source-unavailable",
		"unauthorized",
		"forbidden",
		"throttled",
		"invalid-snapshot"
	]),
	message: text
}).strict();
object({
	contractVersion: literal("1.1"),
	operation: _enum(["get", "refresh"]),
	scope: stagePipelineViewScopeSchema.default("mine"),
	reportIds: array(identifier$1).max(50).optional()
}).strict().superRefine((value, context) => {
	if (value.reportIds && value.scope === "mine") context.addIssue({
		code: "custom",
		path: ["reportIds"],
		message: "Direct reports can only be selected for a reports scope."
	});
});
union([stagePipelineSnapshotSchema, stagePipelineUnavailableSchema]);
//#endregion
//#region packages/common/contracts/record-creation.ts
var clientKeySchema = string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
var dateSchema = string().date();
var textSchema = string().trim().min(1).max(200);
var choiceRefSchema = object({
	value: number().int(),
	label: textSchema
}).strict();
var lookupRefSchema = object({
	id: string().trim().min(1).max(200),
	label: textSchema
}).strict();
var currencyRefSchema = lookupRefSchema.extend({ isoCode: string().length(3) });
var recordCreationTargetSchema = _enum([
	"sqlite",
	"draft",
	"live-msx"
]);
var milestoneCreateInputSchema = object({
	clientMilestoneKey: clientKeySchema,
	name: string().trim().min(1).max(100),
	category: choiceRefSchema,
	milestoneDate: dateSchema,
	workload: lookupRefSchema,
	owner: lookupRefSchema.optional(),
	status: choiceRefSchema.optional(),
	commitment: choiceRefSchema.optional(),
	estimatedMonthlyUsage: number().finite().nonnegative().max(922337203685477).optional(),
	comments: string().max(35e3).optional(),
	riskDetails: string().trim().max(2e3).optional(),
	customerBudgetApproved: choiceRefSchema.optional()
}).strict().superRefine((item, context) => {
	if ((item.status?.value === 861980001 || item.status?.value === 861980002) && !item.riskDetails) context.addIssue({
		code: "custom",
		path: ["riskDetails"],
		message: "Risk/Blocker Details are required for At Risk or Blocked milestones."
	});
});
var opportunityBundleSchema = object({
	opportunity: object({
		clientOpportunityKey: clientKeySchema,
		name: string().trim().min(1).max(200),
		intent: array(choiceRefSchema).min(1).max(2).refine((items) => new Set(items.map((item) => item.value)).size === items.length, "Opportunity Intent choices must not repeat."),
		estimatedValue: number().finite().nonnegative().max(0xe8d4a51000),
		priceList: lookupRefSchema.optional(),
		currency: lookupRefSchema.optional(),
		owner: lookupRefSchema.optional(),
		estimatedCloseDate: dateSchema,
		need: string().max(2e3).optional(),
		solutionArea: choiceRefSchema.optional(),
		technicalCapability: choiceRefSchema.optional()
	}).strict(),
	milestones: array(milestoneCreateInputSchema).max(50)
}).strict();
var recordCreationDraftSchema = discriminatedUnion("kind", [object({
	kind: literal("opportunity-batch"),
	account: lookupRefSchema,
	opportunities: array(opportunityBundleSchema).min(1).max(50)
}).strict(), object({
	kind: literal("existing-opportunity-milestone-batch"),
	account: lookupRefSchema,
	opportunity: lookupRefSchema,
	milestones: array(milestoneCreateInputSchema).min(1).max(50)
}).strict()]).superRefine((draft, context) => {
	const opportunityKeys = /* @__PURE__ */ new Set();
	const milestoneKeys = /* @__PURE__ */ new Set();
	const bundles = draft.kind === "opportunity-batch" ? draft.opportunities.map((bundle, index) => ({
		key: bundle.opportunity.clientOpportunityKey,
		milestones: bundle.milestones,
		index
	})) : [{
		key: draft.opportunity.id,
		milestones: draft.milestones,
		index: 0
	}];
	for (const { key, milestones, index } of bundles) {
		if (draft.kind === "opportunity-batch" && opportunityKeys.has(key)) context.addIssue({
			code: "custom",
			path: [
				"opportunities",
				index,
				"opportunity",
				"clientOpportunityKey"
			],
			message: "Opportunity keys must be unique."
		});
		opportunityKeys.add(key);
		for (const [milestoneIndex, milestone] of milestones.entries()) {
			if (milestoneKeys.has(milestone.clientMilestoneKey)) context.addIssue({
				code: "custom",
				path: draft.kind === "opportunity-batch" ? [
					"opportunities",
					index,
					"milestones",
					milestoneIndex
				] : ["milestones", milestoneIndex],
				message: "Milestone keys must be unique."
			});
			milestoneKeys.add(milestone.clientMilestoneKey);
		}
	}
});
var creationChoicesSchema = object({
	intent: array(choiceRefSchema),
	category: array(choiceRefSchema),
	status: array(choiceRefSchema),
	commitment: array(choiceRefSchema),
	customerBudgetApproved: array(choiceRefSchema),
	solutionArea: array(choiceRefSchema),
	technicalCapability: array(choiceRefSchema)
}).strict();
object({
	contractVersion: literal("1.2"),
	target: _enum(["sqlite", "draft"]),
	revision: string().min(1),
	account: lookupRefSchema,
	opportunities: array(lookupRefSchema.extend({ currency: currencyRefSchema.optional() })),
	priceLists: array(lookupRefSchema),
	currencies: array(currencyRefSchema),
	workloads: array(lookupRefSchema),
	owners: array(lookupRefSchema),
	defaults: object({
		owner: lookupRefSchema,
		priceList: lookupRefSchema.optional(),
		currency: currencyRefSchema.optional()
	}).strict(),
	choices: creationChoicesSchema,
	maxMutations: number().int().positive().max(999)
}).strict();
object({
	contractVersion: literal("1.2"),
	accountId: string().trim().min(1).max(200)
}).strict();
object({
	contractVersion: literal("1.2"),
	target: recordCreationTargetSchema,
	draft: recordCreationDraftSchema
}).strict();
var recordCreationPreviewSchema = object({
	contractVersion: literal("1.2"),
	batchId: string().min(1),
	digest: string().regex(/^[a-f0-9]{64}$/),
	target: _enum(["sqlite", "draft"]),
	catalogRevision: string().min(1),
	normalizedDraft: recordCreationDraftSchema,
	mutationCount: number().int().positive(),
	warnings: array(string().min(1)),
	expiresAt: string().datetime()
}).strict();
object({
	contractVersion: literal("1.2"),
	preview: recordCreationPreviewSchema,
	expectedDigest: string().regex(/^[a-f0-9]{64}$/),
	confirmed: literal(true)
}).strict();
var recordCreationItemResultSchema = object({
	clientKey: string().min(1),
	kind: _enum([
		"opportunity",
		"milestone",
		"deal-team"
	]),
	recordId: string().min(1).optional(),
	parentRecordId: string().min(1).optional()
}).strict();
var recordCreationResultSchema = object({
	contractVersion: literal("1.2"),
	batchId: string().min(1),
	target: _enum(["sqlite", "draft"]),
	state: _enum([
		"committed",
		"drafted",
		"rolled-back",
		"reconciled"
	]),
	created: array(recordCreationItemResultSchema),
	audit: object({
		correlationId: string().min(1),
		opportunityCount: number().int().nonnegative(),
		milestoneCount: number().int().nonnegative(),
		committedAt: string().datetime().optional()
	}).strict(),
	message: string().min(1)
}).strict().superRefine((result, context) => {
	if (result.target === "draft") {
		if (result.state !== "drafted" || result.created.length > 0 || result.audit.committedAt) context.addIssue({
			code: "custom",
			path: ["state"],
			message: "Drafts cannot claim committed records or a commit time."
		});
	} else if (result.state === "drafted") context.addIssue({
		code: "custom",
		path: ["state"],
		message: "A SQLite result cannot be a draft."
	});
	if (result.state === "committed") {
		const count = (kind) => result.created.filter((item) => item.kind === kind).length;
		if (!result.audit.committedAt || count("opportunity") !== result.audit.opportunityCount || count("deal-team") !== result.audit.opportunityCount || count("milestone") !== result.audit.milestoneCount) context.addIssue({
			code: "custom",
			path: ["created"],
			message: "A commit receipt must match its created-record counts and commit time."
		});
	}
});
object({
	contractVersion: literal("1.2"),
	result: recordCreationResultSchema,
	files: array(object({
		name: string().min(1),
		content: string(),
		mimeType: string().min(1)
	}).strict()).min(1)
}).strict();
object({
	code: _enum([
		"validation-failed",
		"parent-unavailable",
		"reference-unavailable",
		"catalog-changed",
		"stale-preview",
		"batch-too-large",
		"target-disabled",
		"already-committed",
		"transaction-failed",
		"ambiguous-outcome"
	]),
	message: string().min(1),
	path: array(union([string(), number()])).optional()
}).strict();
var cachePolicySchema = object({
	mutableFreshMs: number().int().positive().default(3e5),
	referenceFreshMs: number().int().positive().default(18e5),
	maxInactiveEntries: number().int().min(1).max(1e3).default(100),
	maxSerializedBytes: number().int().min(1024).default(67108864),
	readRetries: number().int().min(0).max(2).default(2),
	maxConcurrentWrites: number().int().min(1).max(2).default(2),
	confirmedRetentionMs: number().int().positive().default(2592e6)
}).strict();
Object.freeze(cachePolicySchema.parse({}));
var cacheReadStateSchema = object({
	revision: number().int().nonnegative(),
	dataRevision: number().int().nonnegative().optional(),
	generation: number().int().nonnegative(),
	fetchedAt: number().finite().nonnegative().optional(),
	validatedAt: number().finite().nonnegative().optional(),
	refreshing: boolean(),
	stale: boolean(),
	error: string().optional()
}).strict();
var readKey = string().min(1).max(500).regex(/^(portfolio|discovery|(?:milestones|activities|catalog|search):.+)$/);
discriminatedUnion("operation", [
	object({
		contractVersion: literal("1.0"),
		operation: literal("interest"),
		keys: array(readKey).max(100),
		active: boolean(),
		consumer: string().min(1).max(100).optional()
	}).strict(),
	object({
		contractVersion: literal("1.0"),
		operation: literal("refresh"),
		opportunityId: string().min(1).max(200).optional()
	}).strict(),
	object({
		contractVersion: literal("1.0"),
		operation: literal("state")
	}).strict()
]);
var cacheControlResponseSchema = object({
	contractVersion: literal("1.0"),
	state: cacheReadStateSchema
}).strict();
var syncMutationOperationSchema = _enum([
	"addAccount",
	"setAccountVisibility",
	"joinDealTeam",
	"leaveDealTeam",
	"joinMilestoneTeam",
	"leaveMilestoneTeam",
	"updateOpportunity",
	"updateMilestone",
	"createMilestoneActivity",
	"transitionOpportunityStage",
	"commitRecordCreation",
	"applyMeetingChangeSet"
]);
var mutationStateSchema = _enum([
	"accepted",
	"dispatching",
	"confirmed",
	"failed-before-send",
	"conflict",
	"effect-unknown",
	"reconciled-current-state"
]);
var mutationFailureCodeSchema = _enum([
	"validation",
	"access-denied",
	"auth-required",
	"source-conflict",
	"source-unavailable",
	"outcome-unconfirmed",
	"capacity",
	"session-changed",
	"storage-unavailable",
	"review-expired",
	"review-changed",
	"unsupported"
]);
var identifier = string().min(1).max(500);
var digest = string().regex(/^[a-f0-9]{64}$/);
var envelope = object({ contractVersion: literal("1.0") });
var mutationCapabilitiesSchema = envelope.extend({
	available: boolean(),
	recoveryAvailable: boolean().optional(),
	readCacheOwner: _enum(["host", "client"]),
	operations: array(syncMutationOperationSchema),
	reason: string().min(1).optional()
}).strict();
var mutationReviewSchema = envelope.extend({
	id: string().uuid(),
	operation: syncMutationOperationSchema,
	input: record(string(), unknown()),
	digest,
	expiresAt: string().datetime(),
	before: unknown().optional(),
	recordKeys: array(identifier).min(1).max(100)
}).strict();
var mutationReceiptSchema = envelope.extend({
	id: string().uuid(),
	operation: syncMutationOperationSchema,
	state: mutationStateSchema,
	acceptedAt: string().datetime(),
	updatedAt: string().datetime(),
	recordKeys: array(identifier).min(1).max(100),
	code: mutationFailureCodeSchema.optional(),
	result: unknown().optional()
}).strict();
discriminatedUnion("operation", [
	envelope.extend({ operation: literal("capabilities") }).strict(),
	envelope.extend({
		operation: literal("prepare"),
		mutation: syncMutationOperationSchema,
		input: record(string(), unknown())
	}).strict(),
	envelope.extend({
		operation: literal("submit"),
		id: string().uuid(),
		digest,
		reason: string().trim().min(3).max(1e3),
		confirmed: literal(true)
	}).strict(),
	envelope.extend({
		operation: literal("status"),
		id: string().uuid()
	}).strict(),
	envelope.extend({ operation: literal("pending") }).strict(),
	envelope.extend({
		operation: literal("reconcile"),
		id: string().uuid()
	}).strict()
]);
var mutationSyncResponseSchema = discriminatedUnion("kind", [
	envelope.extend({
		kind: literal("capabilities"),
		capabilities: mutationCapabilitiesSchema
	}).strict(),
	envelope.extend({
		kind: literal("review"),
		review: mutationReviewSchema
	}).strict(),
	envelope.extend({
		kind: literal("receipt"),
		receipt: mutationReceiptSchema
	}).strict(),
	envelope.extend({
		kind: literal("pending"),
		receipts: array(mutationReceiptSchema).max(100)
	}).strict()
]);
//#endregion
//#region packages/common/contracts/index.ts
var dataModeSchema = _enum(["sample", "live"]);
var sourceStateSchema = _enum([
	"sample",
	"live",
	"stale",
	"partial",
	"unauthorized",
	"unavailable"
]);
var sourceHealthSchema = object({
	source: _enum([
		"msx",
		"mcem",
		"seismic",
		"linkedin",
		"dataverse-mcp",
		"msx-mcp"
	]),
	state: sourceStateSchema,
	detail: string().min(1),
	checkedAt: string().datetime()
});
object({
	mode: dataModeSchema,
	auth: object({
		state: _enum([
			"ready",
			"cli-missing",
			"login-required",
			"tenant-mismatch",
			"consent-required",
			"permission-missing"
		]),
		displayName: string().min(1).optional(),
		userEmail: string().email().optional(),
		tenantName: string().min(1).optional(),
		detail: string().min(1)
	}),
	inference: object({
		contractVersion: literal("1.0"),
		mode: inferenceModeSchema
	}).strict().optional()
});
var opportunitySchema = object({
	id: string().min(1),
	accountId: string().min(1),
	name: string().min(1),
	owner: string().min(1).optional(),
	opportunityIntent: array(string().trim().min(1)).max(10).optional(),
	recordedStage: number().int().min(1).max(5),
	value: number().finite(),
	currency: string().length(3),
	closeDate: string().date(),
	comments: string().optional()
});
var milestoneSchema = object({
	id: string().min(1),
	opportunityId: string().min(1),
	name: string().min(1),
	status: string().min(1),
	targetDate: string().date().optional(),
	estimatedMonthlyUsage: number().optional(),
	owner: string().min(1).optional(),
	commitment: string().min(1).optional(),
	riskDetails: string().optional(),
	comments: string().optional(),
	/**
	* Whether the signed-in user is on this milestone's team. Independent of
	* opportunity Deal Team membership and of the milestone owner. Set per-user by
	* the connector at read time; omitted means membership is unknown/not evaluated.
	*/
	onMilestoneTeam: boolean().optional()
});
var portfolioReadRequestSchema = object({
	contractVersion: literal("1.0"),
	includeHidden: boolean().optional()
}).strict();
var portfolioIndexSchema = object({
	contractVersion: literal("1.0"),
	accounts: array(accountSchema$1.strict()),
	opportunities: array(opportunitySchema.strict())
}).strict();
portfolioReadRequestSchema.extend({
	accountId: string().min(1).max(200).optional(),
	opportunityId: string().min(1).max(200).optional()
}).strict();
portfolioIndexSchema.extend({
	selectedAccountId: string().min(1).optional(),
	selectedOpportunityId: string().min(1).optional(),
	milestones: array(milestoneSchema.strict())
}).strict();
var milestoneStatusSchema = _enum([
	"On Track",
	"At Risk",
	"Blocked",
	"Completed",
	"Cancelled",
	"Lost to Competitor",
	"Hygiene/Duplicate"
]);
var customerCommitmentSchema = _enum(["Uncommitted", "Committed"]);
object({
	status: milestoneStatusSchema.optional(),
	riskDetails: string().max(3e4).optional(),
	targetDate: string().date().optional(),
	customerCommitment: customerCommitmentSchema.optional(),
	comments: string().max(3e4).optional()
}).refine((value) => Object.keys(value).length > 0, "At least one milestone field is required.");
object({ comments: string().max(3e4) });
object({
	opportunityId: string().min(1),
	milestoneId: string().min(1),
	onMilestoneTeam: literal(true),
	alreadyMember: boolean()
}).strict();
object({
	opportunityId: string().min(1),
	milestoneId: string().min(1),
	onMilestoneTeam: literal(false),
	alreadyAbsent: boolean()
}).strict();
/** Activity priority, mapped to the Dataverse task `prioritycode` (Low 0 / Normal 1 / High 2). */
var milestoneActivityPrioritySchema = _enum([
	"Low",
	"Normal",
	"High"
]);
/**
* Task Category option set shown on the MSX "Quick Create: Task" form. Bundled so sample mode needs
* no network; in live mode the field + option codes are environment-configured.
*/
var taskCategorySchema = _enum([
	"Architecture Design Session",
	"Assessment",
	"Blocker Escalation",
	"Briefing",
	"Call Back Requested",
	"Consumption Plan",
	"Cross Segment",
	"Cross Workload",
	"Customer Engagement",
	"Demo",
	"External (Co-creation of Value)",
	"Internal",
	"L300+ Demo",
	"Negotiate Pricing",
	"New Partner Request",
	"PoC/Pilot",
	"Post Sales",
	"Rapid Prototyping",
	"RFP/RFI",
	"Solution Whiteboarding",
	"Tech Support",
	"Technical Close/Win Plan",
	"Technical Workshop",
	"Workshop"
]);
object({
	id: string().min(1),
	milestoneId: string().min(1),
	opportunityId: string().min(1),
	subject: string().min(1),
	activityType: string().min(1),
	status: string().min(1),
	priority: milestoneActivityPrioritySchema.optional(),
	taskCategory: string().min(1).optional(),
	due: string().date().optional(),
	durationMinutes: number().int().positive().optional(),
	description: string().optional(),
	owner: string().min(1).optional(),
	createdBy: string().min(1).optional(),
	createdOn: string().datetime().optional()
});
object({
	subject: string().trim().min(1).max(200),
	taskCategory: taskCategorySchema.optional(),
	description: string().max(3e4).optional(),
	due: string().date().optional(),
	priority: milestoneActivityPrioritySchema.default("Normal"),
	durationMinutes: number().int().positive().max(1e5).optional()
}).strict();
/**
* An opportunity surfaced by SE-domain discovery. It extends the base
* opportunity with the domain it matched and whether the signed-in user is
* already on its deal team, so a client can present a one-click join action.
*/
var discoverableOpportunitySchema = opportunitySchema.extend({
	domain: seDomainSchema,
	accountName: string().min(1).optional(),
	solutionArea: string().min(1).optional(),
	technicalCapability: string().min(1).optional(),
	onDealTeam: boolean()
});
object({ contractVersion: literal("1.0") }).strict();
object({
	contractVersion: literal("1.0"),
	generatedAt: string().datetime(),
	accounts: array(accountSchema$1.strict()),
	portfolioOpportunities: array(opportunitySchema.strict()),
	opportunities: array(discoverableOpportunitySchema.strict()),
	milestoneTeamOpportunityIds: array(string().min(1))
}).strict();
object({
	contractVersion: literal("1.2"),
	accountId: string().min(1),
	opportunityId: string().min(1),
	targetStage: number().int().min(1).max(5),
	reason: string().trim().min(10).max(1e3).optional()
}).strict();
object({
	opportunity: opportunitySchema,
	previousStage: number().int().min(1).max(5),
	targetStage: number().int().min(1).max(5),
	disposition: _enum([
		"advanced",
		"override",
		"recycled"
	]),
	auditNote: string().min(1)
}).strict();
var evidenceSchema = object({
	id: string().min(1),
	source: _enum([
		"msx",
		"mcem",
		"dataverse-mcp",
		"msx-mcp"
	]),
	recordId: string().min(1),
	title: string().min(1),
	url: string().url().optional(),
	retrievedAt: string().datetime(),
	modifiedAt: string().datetime().optional(),
	accessContext: _enum(["sample", "delegated-user"]),
	quality: _enum([
		"authoritative",
		"observed",
		"stale",
		"incomplete"
	]),
	excerpt: string().min(1)
});
var criterionSchema = object({
	id: string().min(1),
	label: string().min(1),
	status: _enum([
		"met",
		"partial",
		"missing"
	]),
	rationale: string().min(1),
	evidenceIds: array(string().min(1))
});
var recommendationSchema = object({
	id: string().min(1),
	action: string().min(1),
	ownerRole: string().min(1),
	rationale: string().min(1),
	evidenceIds: array(string().min(1)),
	assumption: boolean(),
	confidence: _enum([
		"high",
		"medium",
		"low"
	])
}).superRefine((recommendation, context) => {
	if (recommendation.evidenceIds.length === 0 && !recommendation.assumption) context.addIssue({
		code: "custom",
		path: ["evidenceIds"],
		message: "A recommendation must cite evidence or be labeled as an assumption."
	});
});
object({
	contractVersion: literal("1.2"),
	accountId: string().min(1),
	opportunityId: string().min(1),
	prompt: string().min(3).max(1e3)
});
var agentCapabilitySchema = _enum(workflowAgentCapabilityValues);
object({
	contractVersion: literal("1.2"),
	capability: agentCapabilitySchema,
	accountId: string().min(1),
	opportunityId: string().min(1),
	prompt: string().min(3).max(agentTaskPromptMaxLength)
});
var agentTaskResponseSchema = object({
	contractVersion: _enum(["1.2", "1.3"]),
	inference: inferenceExecutionSchema.optional(),
	correlationId: string().uuid(),
	capability: agentCapabilitySchema,
	agentVersion: string().min(1),
	generatedAt: string().datetime(),
	mode: dataModeSchema,
	state: _enum([
		"complete",
		"partial",
		"unauthorized"
	]),
	content: string().min(1),
	sourceHealth: array(sourceHealthSchema).min(1)
}).superRefine(validateInferenceResponse);
/**
* Progressive agent response. `context` carries an instant deterministic draft grounded in the same
* evidence as the model call; `delta` carries model text; `complete` always carries the full authoritative
* response; `error` ends the stream without a response.
*/
var agentTaskStreamEventSchema = discriminatedUnion("type", [
	object({
		type: literal("context"),
		streamVersion: literal("1.0"),
		capability: agentCapabilitySchema,
		instantDraft: string().min(1),
		sourceHealth: array(sourceHealthSchema).min(1)
	}).strict(),
	object({
		type: literal("delta"),
		text: string().min(1)
	}).strict(),
	object({
		type: literal("complete"),
		response: agentTaskResponseSchema
	}).strict(),
	object({
		type: literal("error"),
		code: _enum([
			"failed",
			"timeout",
			"cancelled"
		]),
		message: string().min(1).max(500)
	}).strict()
]);
object({
	contractVersion: literal("1.2"),
	recipients: array(string().email()).min(1).max(20),
	subject: string().trim().min(1).max(255),
	responseTitle: string().trim().min(1).max(255),
	responseMarkdown: string().min(1).max(2e5)
}).strict();
object({ state: literal("opened") }).strict();
object({
	contractVersion: literal("1.2"),
	responseTitle: string().trim().min(1).max(255),
	responseMarkdown: string().min(1).max(2e5),
	generatedAt: string().datetime()
}).strict();
discriminatedUnion("state", [object({
	state: literal("saved"),
	filePath: string().min(1)
}).strict(), object({ state: literal("cancelled") }).strict()]);
object({
	contractVersion: literal("1.2"),
	correlationId: string().uuid(),
	capability: literal("mcem-coach"),
	agentVersion: string().min(1),
	generatedAt: string().datetime(),
	mode: dataModeSchema,
	state: _enum([
		"complete",
		"partial",
		"unauthorized"
	]),
	summary: string().min(1),
	recordedStage: number().int().min(1).max(5),
	evidenceBasedStage: number().int().min(1).max(5),
	criteria: array(criterionSchema).min(1),
	recommendations: array(recommendationSchema).min(1),
	missingData: array(string().min(1)),
	evidence: array(evidenceSchema).min(1),
	sourceHealth: array(sourceHealthSchema).min(1)
});
object({
	correlationId: string().uuid(),
	agentVersion: string().min(1),
	capability: literal("mcem-coach"),
	category: _enum([
		"useful",
		"incorrect",
		"missing-source",
		"wrong-owner",
		"other"
	]),
	comment: string().max(500).optional()
});
//#endregion
//#region apps/desktop/electron/preload/index.ts
electron.contextBridge.exposeInMainWorld("tlc", {
	searchKnowledge: async (request) => knowledgeSearchResponseSchema.parse(await electron.ipcRenderer.invoke("tlc:search-knowledge", knowledgeSearchRequestSchema.parse(request))),
	deriveWorkingSessionTopic: async (request) => workingSessionTopicResponseSchema.parse(await electron.ipcRenderer.invoke("tlc:working-session-topic", workingSessionTopicRequestSchema.parse(request))),
	prepareWorkingSession: async (request) => workingSessionResultSchema.parse(await electron.ipcRenderer.invoke("tlc:working-session-prepare", workingSessionPrepareRequestSchema.parse(request))),
	openWorkingSessionFolder: async (folderPath) => {
		await electron.ipcRenderer.invoke("tlc:working-session-open", workingSessionOpenFolderRequestSchema.parse({ folderPath }));
	},
	invokeMutationSync: async (request) => mutationSyncResponseSchema.parse(await electron.ipcRenderer.invoke("tlc:mutation-sync", request)),
	cacheControl: async (request) => cacheControlResponseSchema.parse(await electron.ipcRenderer.invoke("tlc:cache-control", request)),
	onCacheChanged: (listener) => {
		const changed = (_event, value) => {
			listener(cacheControlResponseSchema.parse(value).state);
		};
		electron.ipcRenderer.on("tlc:cache-changed", changed);
		return () => {
			electron.ipcRenderer.removeListener("tlc:cache-changed", changed);
		};
	},
	invokeSellerDashboard: (request) => electron.ipcRenderer.invoke("tlc:seller-dashboard", request),
	invokeStagePipelineReview: (request) => electron.ipcRenderer.invoke("tlc:stage-pipeline-review", request),
	invokeMomentumFocus: async (request) => momentumFocusResponseSchema.parse(await electron.ipcRenderer.invoke("tlc:momentum-focus", momentumFocusRequestSchema.parse(request))),
	invokeSeReporting: (request) => electron.ipcRenderer.invoke("tlc:se-reporting", request),
	invokeVoice: (request) => electron.ipcRenderer.invoke("tlc:voice-input", request),
	exitApplication: () => electron.ipcRenderer.invoke("tlc:exit-application"),
	getDataStatus: () => electron.ipcRenderer.invoke("tlc:get-data-status"),
	getInferenceMode: () => electron.ipcRenderer.invoke("tlc:get-inference-mode"),
	connectMcem: () => electron.ipcRenderer.invoke("tlc:connect-mcem"),
	listAccounts: (options) => electron.ipcRenderer.invoke("tlc:list-accounts", options),
	getPortfolioIndex: (request) => electron.ipcRenderer.invoke("tlc:portfolio-index", request),
	getPortfolioWorkspace: (request) => electron.ipcRenderer.invoke("tlc:portfolio-workspace", request),
	getDiscoverySnapshot: (request) => electron.ipcRenderer.invoke("tlc:discovery-snapshot", request),
	searchAccounts: (request) => electron.ipcRenderer.invoke("tlc:search-accounts", request),
	addAccount: (accountId) => electron.ipcRenderer.invoke("tlc:add-account", accountId),
	setAccountVisibility: (accountId, visibility) => electron.ipcRenderer.invoke("tlc:set-account-visibility", accountId, visibility),
	listOpportunities: (accountId) => electron.ipcRenderer.invoke("tlc:list-opportunities", accountId),
	getRecordCreationCatalog: (request) => electron.ipcRenderer.invoke("tlc:get-record-creation-catalog", request),
	previewRecordCreation: (request) => electron.ipcRenderer.invoke("tlc:preview-record-creation", request),
	commitRecordCreation: (request) => electron.ipcRenderer.invoke("tlc:commit-record-creation", request),
	exportRecordCreationDraft: (request) => electron.ipcRenderer.invoke("tlc:export-record-creation-draft", request),
	discoverOpportunities: (domain) => electron.ipcRenderer.invoke("tlc:discover-opportunities", domain),
	joinDealTeam: (opportunityId) => electron.ipcRenderer.invoke("tlc:join-deal-team", opportunityId),
	leaveDealTeam: (opportunityId) => electron.ipcRenderer.invoke("tlc:leave-deal-team", opportunityId),
	joinMilestoneTeam: (opportunityId, milestoneId) => electron.ipcRenderer.invoke("tlc:join-milestone-team", opportunityId, milestoneId),
	leaveMilestoneTeam: (opportunityId, milestoneId) => electron.ipcRenderer.invoke("tlc:leave-milestone-team", opportunityId, milestoneId),
	listMilestones: (opportunityId) => electron.ipcRenderer.invoke("tlc:list-milestones", opportunityId),
	listDiscoverableMilestones: (opportunityId) => electron.ipcRenderer.invoke("tlc:list-discoverable-milestones", opportunityId),
	listMilestoneActivities: (opportunityId, milestoneId) => electron.ipcRenderer.invoke("tlc:list-milestone-activities", opportunityId, milestoneId),
	createMilestoneActivity: (opportunityId, milestoneId, request) => electron.ipcRenderer.invoke("tlc:create-milestone-activity", opportunityId, milestoneId, request),
	listMeetingTranscripts: (opportunityId) => electron.ipcRenderer.invoke("tlc:list-meeting-transcripts", opportunityId),
	getMeetingTranscript: (transcriptId) => electron.ipcRenderer.invoke("tlc:get-meeting-transcript", transcriptId),
	proposeMeetingChangeSet: (request) => electron.ipcRenderer.invoke("tlc:propose-meeting-change-set", request),
	applyMeetingChangeSet: (proposal, approval) => electron.ipcRenderer.invoke("tlc:apply-meeting-change-set", proposal, approval),
	updateMilestone: (opportunityId, milestoneId, update) => electron.ipcRenderer.invoke("tlc:update-milestone", opportunityId, milestoneId, update),
	updateOpportunity: (opportunityId, update) => electron.ipcRenderer.invoke("tlc:update-opportunity", opportunityId, update),
	runMcemCoach: (request) => electron.ipcRenderer.invoke("tlc:run-mcem-coach", request),
	transitionOpportunityStage: (request) => electron.ipcRenderer.invoke("tlc:transition-opportunity-stage", request),
	runAgentTask: (request) => electron.ipcRenderer.invoke("tlc:run-agent-task", request),
	runAgentTaskStream: (request, onEvent) => {
		const streamId = globalThis.crypto.randomUUID();
		let terminalDelivered = false;
		const listener = (_event, message) => {
			if (message?.streamId !== streamId || terminalDelivered) return;
			const event = message.event;
			if (event && typeof event === "object" && "type" in event && (event.type === "complete" || event.type === "error")) terminalDelivered = true;
			onEvent(event);
		};
		electron.ipcRenderer.on("tlc:agent-task-event", listener);
		return {
			cancel: () => {
				electron.ipcRenderer.invoke("tlc:cancel-agent-task-stream", streamId);
			},
			done: electron.ipcRenderer.invoke("tlc:run-agent-task-stream", request, streamId).then((raw) => {
				const terminal = agentTaskStreamEventSchema.parse(raw);
				if (terminal.type !== "complete" && terminal.type !== "error") throw new Error("The agent response ended before it completed.");
				if (!terminalDelivered) {
					terminalDelivered = true;
					onEvent(terminal);
				}
			}).finally(() => {
				electron.ipcRenderer.removeListener("tlc:agent-task-event", listener);
			})
		};
	},
	openEmailCompose: (request) => electron.ipcRenderer.invoke("tlc:open-email-compose", request),
	exportAgentResponse: (request) => electron.ipcRenderer.invoke("tlc:export-agent-response", request),
	openEvidence: (url) => electron.ipcRenderer.invoke("tlc:open-evidence", url),
	invokeWorkflow: (operation, request) => electron.ipcRenderer.invoke(`tlc:workflow-${operation}`, request)
});
//#endregion

//# sourceMappingURL=index.cjs.map