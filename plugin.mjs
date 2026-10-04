/**
 * oxlint plugin holding structural lint rules the built-in rulesets don't cover.
 * Registered under the `oxc-config` namespace by the presets' `jsPlugins`.
 */

const textOf = (context, node) => context.sourceCode.getText(node);

const sameSource = (context, a, b) => textOf(context, a) === textOf(context, b);

const jsxNoConditionalLeak = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		messages: {
			leak: "Avoid `&&` short-circuit in JSX - a falsy `0`/`''` renders instead of nothing; use a ternary.",
		},
	},
	create(context) {
		return {
			JSXExpressionContainer(node) {
				if (node.parent.type === 'JSXAttribute') {
					return;
				}

				const { expression } = node;

				if (expression.type !== 'LogicalExpression' || expression.operator !== '&&') {
					return;
				}

				const left = textOf(context, expression.left);
				const right = textOf(context, expression.right);

				context.report({
					node,
					messageId: 'leak',
					fix: (fixer) => fixer.replaceText(node, `{${left} ? ${right} : null}`),
				});
			},
		};
	},
};

function isPromiseAll(node) {
	const { callee } = node;

	return (
		callee.type === 'MemberExpression' &&
		!callee.computed &&
		callee.object.type === 'Identifier' &&
		callee.object.name === 'Promise' &&
		callee.property.type === 'Identifier' &&
		callee.property.name === 'all'
	);
}

const noAwaitInPromiseAll = {
	meta: {
		type: 'problem',
		fixable: 'code',
		messages: {
			redundant:
				'Redundant `await` inside `Promise.all([...])` serializes the promises - drop it.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				if (!isPromiseAll(node)) {
					return;
				}

				const [arg] = node.arguments;

				if (!arg || arg.type !== 'ArrayExpression') {
					return;
				}

				for (const element of arg.elements) {
					if (!element || element.type !== 'AwaitExpression') {
						continue;
					}

					const inner = textOf(context, element.argument);

					context.report({
						node: element,
						messageId: 'redundant',
						fix: (fixer) => fixer.replaceText(element, inner),
					});
				}
			},
		};
	},
};

const isUnknownOrAny = (type) => type.type === 'TSUnknownKeyword' || type.type === 'TSAnyKeyword';

const noDoubleTypeAssertion = {
	meta: {
		type: 'problem',
		messages: {
			double: 'Double type assertion (`as unknown as` / `as any as`) is a silent cast and is banned - fix the underlying type instead.',
		},
	},
	create(context) {
		return {
			TSAsExpression(node) {
				if (
					node.expression.type === 'TSAsExpression' &&
					isUnknownOrAny(node.expression.typeAnnotation)
				) {
					context.report({ node, messageId: 'double' });
				}
			},
		};
	},
};

const noChainedTypeAssertions = {
	meta: {
		type: 'problem',
		messages: {
			chained:
				'Chained `as A as B` reasserts through an intermediate type to reach an unrelated one - fix the underlying type instead of stacking casts.',
		},
	},
	create(context) {
		return {
			TSAsExpression(node) {
				// The `as unknown as` / `as any as` form is handled by
				// no-double-type-assertion; this covers every other chain.
				if (
					node.expression.type === 'TSAsExpression' &&
					!isUnknownOrAny(node.expression.typeAnnotation)
				) {
					context.report({ node, messageId: 'chained' });
				}
			},
		};
	},
};

const WIDE_ANNOTATION_TYPES = new Set(['TSUnknownKeyword', 'TSAnyKeyword']);

/** A `const`/`let` declarator whose annotation widens to `unknown`/`any`, keyed by binding name. */
function widenedBindingName(declarator) {
	if (declarator.id.type !== 'Identifier') {
		return null;
	}

	const annotation = declarator.id.typeAnnotation?.typeAnnotation;

	return annotation && WIDE_ANNOTATION_TYPES.has(annotation.type) ? declarator.id.name : null;
}

const noWidenThenAssert = {
	meta: {
		type: 'problem',
		messages: {
			widen: 'Widening `{{name}}` to `{{wide}}` and later asserting it to a specific type is a double cast split across statements - fix the underlying type instead.',
		},
	},
	create(context) {
		const widened = new Map();

		return {
			VariableDeclarator(node) {
				const name = widenedBindingName(node);

				if (!name) {
					return;
				}

				const annotation = node.id.typeAnnotation.typeAnnotation;

				widened.set(name, annotation.type === 'TSAnyKeyword' ? 'any' : 'unknown');
			},
			TSAsExpression(node) {
				if (node.expression.type !== 'Identifier') {
					return;
				}

				const wide = widened.get(node.expression.name);

				if (wide) {
					context.report({
						node,
						messageId: 'widen',
						data: { name: node.expression.name, wide },
					});
				}
			},
		};
	},
};

const paramAnnotation = (param) =>
	(param.type === 'RestElement' ? param.argument : param).typeAnnotation;

/**
 * True when the declarator's type annotation is what types the arrow's
 * parameters. A `function` declaration cannot receive contextual typing, so
 * converting one of these would force every parameter to be respelled.
 */
const reliesOnContextualTyping = (node) =>
	Boolean(node.id.typeAnnotation) &&
	node.init.params.length > 0 &&
	node.init.params.some((param) => !paramAnnotation(param));

const noConstArrowFunction = {
	meta: {
		type: 'suggestion',
		messages: {
			arrow: 'Assigning a block-body arrow to `const` reads worse than a `function` declaration - use `function name(...) { ... }` instead. An annotated `const` is exempt only when its annotation contextually types the parameters (some parameter has no type of its own); here every parameter is already typed, so a `function` declaration is equivalent.',
		},
	},
	create(context) {
		return {
			VariableDeclarator(node) {
				if (
					node.parent.type === 'VariableDeclaration' &&
					node.parent.kind === 'const' &&
					node.init?.type === 'ArrowFunctionExpression' &&
					!node.init.expression &&
					!reliesOnContextualTyping(node)
				) {
					context.report({ node: node.init, messageId: 'arrow' });
				}
			},
		};
	},
};

const FUNCTION_LIKE_PARENTS = new Set([
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression',
	'TSDeclareFunction',
	'TSEmptyBodyFunctionExpression',
	'MethodDefinition',
	'TSMethodSignature',
	'TSFunctionType',
]);

/**
 * True when an object type sits somewhere it must be extracted: a generic type
 * argument, or the annotation of a function parameter or return type. Plain
 * variable annotations (`const x: { a: number }`) are allowed.
 */
function isInlineObjectTypeBanned(node) {
	const { parent } = node;

	if (parent.type === 'TSTypeParameterInstantiation') {
		return true;
	}

	if (parent.type !== 'TSTypeAnnotation') {
		return false;
	}

	const grandparent = parent.parent;

	if (grandparent.type === 'Identifier') {
		return grandparent.parent.type !== 'VariableDeclarator';
	}

	return FUNCTION_LIKE_PARENTS.has(grandparent.type);
}

const noInlineObjectType = {
	meta: {
		type: 'problem',
		messages: {
			inline: 'Inline object type banned in parameters, return types, and type arguments - extract it to a top-level `type` alias.',
		},
	},
	create(context) {
		return {
			TSTypeLiteral(node) {
				if (isInlineObjectTypeBanned(node)) {
					context.report({ node, messageId: 'inline' });
				}
			},
		};
	},
};

const isAnchor = (name) => name.type === 'JSXIdentifier' && name.name === 'a';

const noNestedLinks = {
	meta: {
		type: 'problem',
		messages: {
			nested: 'Nested `<a>` elements are invalid HTML and trigger a React warning - restructure so anchors are not nested.',
		},
	},
	create(context) {
		return {
			JSXElement(node) {
				if (!isAnchor(node.openingElement.name)) {
					return;
				}

				for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
					if (ancestor.type === 'JSXElement' && isAnchor(ancestor.openingElement.name)) {
						context.report({ node, messageId: 'nested' });

						return;
					}
				}
			},
		};
	},
};

const INFERABLE_TYPES = new Set(['TSNumberKeyword', 'TSStringKeyword', 'TSBooleanKeyword']);

const noUnnecessaryUseStateType = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		messages: {
			unnecessary:
				'Unnecessary `useState` type argument - TypeScript infers the primitive from the initial value.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				if (node.callee.type !== 'Identifier' || node.callee.name !== 'useState') {
					return;
				}

				const typeArguments = node.typeArguments;

				if (
					!typeArguments ||
					typeArguments.params.length !== 1 ||
					!INFERABLE_TYPES.has(typeArguments.params[0].type) ||
					node.arguments.length === 0
				) {
					return;
				}

				context.report({
					node: typeArguments,
					messageId: 'unnecessary',
					fix: (fixer) => fixer.removeRange([node.callee.end, typeArguments.end]),
				});
			},
		};
	},
};

const preferOptionalChaining = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		messages: {
			prefer: 'Prefer optional chaining: `x && x()` is the same as `x?.()`.',
		},
	},
	create(context) {
		return {
			LogicalExpression(node) {
				if (node.operator !== '&&') {
					return;
				}

				const { right } = node;

				if (
					right.type !== 'CallExpression' ||
					right.arguments.length !== 0 ||
					right.optional ||
					!sameSource(context, node.left, right.callee)
				) {
					return;
				}

				const target = textOf(context, node.left);

				context.report({
					node,
					messageId: 'prefer',
					fix: (fixer) => fixer.replaceText(node, `${target}?.()`),
				});
			},
		};
	},
};

const COMPOUND_ASSIGNMENTS = {
	'||': '||=',
	'&&': '&&=',
	'??': '??=',
};

const useLogicalAssignment = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		messages: {
			logical: 'Use logical assignment: `x = x {{op}} y` is `x {{op}}= y`.',
		},
	},
	create(context) {
		return {
			AssignmentExpression(node) {
				if (node.operator !== '=') {
					return;
				}

				const { right } = node;

				if (right.type !== 'LogicalExpression') {
					return;
				}

				const compound = COMPOUND_ASSIGNMENTS[right.operator];

				if (!compound || !sameSource(context, node.left, right.left)) {
					return;
				}

				const target = textOf(context, node.left);
				const value = textOf(context, right.right);

				context.report({
					node,
					messageId: 'logical',
					data: { op: right.operator },
					fix: (fixer) => fixer.replaceText(node, `${target} ${compound} ${value}`),
				});
			},
		};
	},
};

const MAX_COMMENT_LENGTH = 200;

const isJSDoc = (comment) => comment.type === 'Block' && comment.value.startsWith('*');

/** Total text length of a comment group: a single block, or a run of `//` lines joined by newlines. */
const commentGroupLength = (comments) =>
	comments.reduce((sum, comment) => sum + comment.value.trim().length, 0) + (comments.length - 1);

const maxCommentLength = {
	meta: {
		type: 'suggestion',
		messages: {
			tooLong: `Comment is {{length}} characters; keep comments under ${MAX_COMMENT_LENGTH}. Is a comment really needed here? If it is narration and does not explain something abnormal that cannot be seen from the code, you can remove it.`,
		},
	},
	create(context) {
		return {
			Program(node) {
				const commentable = node.comments.filter(
					(comment) => comment.type !== 'Shebang' && !isJSDoc(comment),
				);

				let group = [];

				function flush() {
					if (group.length === 0) {
						return;
					}

					const length = commentGroupLength(group);

					if (length > MAX_COMMENT_LENGTH) {
						const start = group[0];
						const end = group[group.length - 1];

						context.report({
							loc: { start: start.loc.start, end: end.loc.end },
							messageId: 'tooLong',
							data: { length: String(length) },
						});
					}

					group = [];
				}

				for (const comment of commentable) {
					const previous = group[group.length - 1];

					// A run of consecutive `//` lines reads as one comment; a `Block`
					// always stands alone.
					const contiguous =
						previous &&
						previous.type === 'Line' &&
						comment.type === 'Line' &&
						comment.loc.start.line === previous.loc.end.line + 1;

					if (contiguous) {
						group.push(comment);
						continue;
					}

					flush();
					group.push(comment);

					if (comment.type === 'Block') {
						flush();
					}
				}

				flush();
			},
		};
	},
};

/**
 * Resolves whether a `TSType` node "resolves to" a target keyword, following
 * parenthesized types, union members, and non-parameterized top-level aliases.
 * `aliasMap` maps alias names to their `typeAnnotation`; `seen` guards cycles.
 */
function resolvesTo(type, predicate, aliasMap, seen = new Set()) {
	if (!type) {
		return false;
	}

	if (predicate(type)) {
		return true;
	}

	if (type.type === 'TSParenthesizedType') {
		return resolvesTo(type.typeAnnotation, predicate, aliasMap, seen);
	}

	if (type.type === 'TSUnionType') {
		return type.types.some((member) => resolvesTo(member, predicate, aliasMap, seen));
	}

	if (
		type.type === 'TSTypeReference' &&
		type.typeName.type === 'Identifier' &&
		!type.typeArguments
	) {
		const { name } = type.typeName;

		if (seen.has(name) || !aliasMap.has(name)) {
			return false;
		}

		seen.add(name);

		return resolvesTo(aliasMap.get(name), predicate, aliasMap, seen);
	}

	return false;
}

function collectAliasMap(program) {
	const aliasMap = new Map();

	for (const statement of program.body) {
		const declaration =
			statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;

		if (
			declaration &&
			declaration.type === 'TSTypeAliasDeclaration' &&
			declaration.typeParameters == null
		) {
			aliasMap.set(declaration.id.name, declaration.typeAnnotation);
		}
	}

	return aliasMap;
}

const FUNCTION_LIKE_VISITORS = [
	'FunctionDeclaration',
	'FunctionExpression',
	'ArrowFunctionExpression',
	'TSDeclareFunction',
	'TSEmptyBodyFunctionExpression',
	'TSFunctionType',
	'TSConstructorType',
	'TSCallSignatureDeclaration',
	'TSConstructSignatureDeclaration',
	'TSMethodSignature',
];

const isUnknownKeyword = (type) => type.type === 'TSUnknownKeyword';

const isPromiseWrapper = (type) =>
	type.type === 'TSTypeReference' &&
	type.typeName.type === 'Identifier' &&
	(type.typeName.name === 'Promise' || type.typeName.name === 'PromiseLike') &&
	type.typeArguments?.params.length === 1;

function returnResolvesToUnknown(type, aliasMap, seen = new Set()) {
	if (resolvesTo(type, isUnknownKeyword, aliasMap, seen)) {
		return true;
	}

	if (isPromiseWrapper(type)) {
		return returnResolvesToUnknown(type.typeArguments.params[0], aliasMap, seen);
	}

	if (type.type === 'TSParenthesizedType') {
		return returnResolvesToUnknown(type.typeAnnotation, aliasMap, seen);
	}

	if (type.type === 'TSUnionType') {
		return type.types.some((member) => returnResolvesToUnknown(member, aliasMap, seen));
	}

	if (
		type.type === 'TSTypeReference' &&
		type.typeName.type === 'Identifier' &&
		!type.typeArguments &&
		aliasMap.has(type.typeName.name) &&
		!seen.has(type.typeName.name)
	) {
		seen.add(type.typeName.name);

		return returnResolvesToUnknown(aliasMap.get(type.typeName.name), aliasMap, seen);
	}

	return false;
}

const withFunctionLikeVisitors = (handler) =>
	Object.fromEntries(FUNCTION_LIKE_VISITORS.map((name) => [name, handler]));

const UNKNOWN_JUSTIFICATION = /^\s*UNKNOWN:/;

const STATEMENT_WRAPPERS = new Set([
	'VariableDeclarator',
	'VariableDeclaration',
	'ExportNamedDeclaration',
	'ExportDefaultDeclaration',
	'PropertyDefinition',
	'MethodDefinition',
	'Property',
	'TSTypeAliasDeclaration',
	'TSTypeAnnotation',
	'TSPropertySignature',
]);

/**
 * Start offset of the statement a function belongs to, so a comment leading
 * `export const fn = (...)` is still seen as attached to the function itself.
 */
function statementStart(node) {
	let outermost = node;

	for (
		let parent = node.parent;
		parent && STATEMENT_WRAPPERS.has(parent.type);
		parent = parent.parent
	) {
		outermost = parent;
	}

	return outermost.start;
}

/**
 * A type-predicate return (`value is T`, `asserts value is T`) makes `unknown`
 * parameters correct: discriminating an unconstrained input is the whole job.
 */
const isTypePredicate = (node) => node.returnType?.typeAnnotation.type === 'TSTypePredicate';

const unknownJustifications = (program) =>
	(program.comments ?? []).filter((comment) => UNKNOWN_JUSTIFICATION.test(comment.value));

/**
 * A justification counts when it leads the function's statement or sits inline
 * before `target`. Only whitespace may separate a leading comment from the
 * statement, so an unrelated comment further up the file never exempts anything.
 */
function isJustified(context, comments, functionNode, target) {
	const start = statementStart(functionNode);
	const { text } = context.sourceCode;

	return comments.some((comment) => {
		if (comment.end > target.start) {
			return false;
		}

		const gapEnd = comment.end <= start ? start : target.start;

		return text.slice(comment.end, gapEnd).trim() === '';
	});
}

const noUnknownReturns = {
	meta: {
		type: 'problem',
		messages: {
			unknown:
				'Return type resolves to `unknown` (or `Promise<unknown>`); give it a specific contract instead. If `unknown` is genuinely correct, justify it with a `// UNKNOWN: <reason>` comment on the function or the return type.',
		},
	},
	create(context) {
		let aliasMap = new Map();
		let comments = [];

		return {
			Program(node) {
				aliasMap = collectAliasMap(node);
				comments = unknownJustifications(node);
			},
			...withFunctionLikeVisitors((node) => {
				const annotation = node.returnType?.typeAnnotation;

				if (!annotation || !returnResolvesToUnknown(annotation, aliasMap)) {
					return;
				}

				if (isJustified(context, comments, node, annotation)) {
					return;
				}

				context.report({ node, messageId: 'unknown' });
			}),
		};
	},
};

/**
 * Yields the type annotation of each parameter across the param-pattern shapes
 * a function-like node can hold (plain binding, parameter property, rest).
 */
function paramTypeEntries(params) {
	const entries = [];

	for (const param of params) {
		const binding = param.type === 'TSParameterProperty' ? param.parameter : param;
		const target = binding.type === 'RestElement' ? binding.argument : binding;
		const annotation = target.typeAnnotation?.typeAnnotation;

		if (annotation) {
			entries.push({ param, binding, annotation });
		}
	}

	return entries;
}

const isObjectKeyword = (type) => type.type === 'TSObjectKeyword';

const noObjectParameters = {
	meta: {
		type: 'problem',
		messages: {
			object: 'Bare `object` accepts any non-primitive without narrowing; give the parameter a specific shape.',
		},
	},
	create(context) {
		let aliasMap = new Map();

		return {
			Program(node) {
				aliasMap = collectAliasMap(node);
			},
			...withFunctionLikeVisitors((node) => {
				for (const { param, annotation } of paramTypeEntries(node.params)) {
					if (resolvesTo(annotation, isObjectKeyword, aliasMap)) {
						context.report({ node: param, messageId: 'object' });
					}
				}
			}),
		};
	},
};

const bindingName = (binding) => (binding.type === 'Identifier' ? binding.name : null);

const noUnknownParameters = {
	meta: {
		type: 'problem',
		messages: {
			unknown:
				'`unknown` parameters push the burden onto callers; accept a specific type. If `unknown` is genuinely correct, make the function a type predicate (`value is T`) or justify it with a `// UNKNOWN: <reason>` comment on the function or the parameter (`cause` is exempt by convention).',
		},
	},
	create(context) {
		let aliasMap = new Map();
		let comments = [];

		return {
			Program(node) {
				aliasMap = collectAliasMap(node);
				comments = unknownJustifications(node);
			},
			...withFunctionLikeVisitors((node) => {
				if (isTypePredicate(node)) {
					return;
				}

				for (const { param, binding, annotation } of paramTypeEntries(node.params)) {
					if (bindingName(binding) === 'cause') {
						continue;
					}

					if (!resolvesTo(annotation, isUnknownKeyword, aliasMap)) {
						continue;
					}

					if (isJustified(context, comments, node, param)) {
						continue;
					}

					context.report({ node: param, messageId: 'unknown' });
				}
			}),
		};
	},
};

const isUnsafeDictionaryValue = (type) =>
	type.type === 'TSUnknownKeyword' ||
	type.type === 'TSAnyKeyword' ||
	type.type === 'TSObjectKeyword' ||
	(type.type === 'TSTypeLiteral' && type.members.length === 0);

const noUnsafeDictionaryType = {
	meta: {
		type: 'problem',
		messages: {
			unsafe: 'Dictionary value type is an unsafe escape hatch (`unknown`/`any`/`object`/`{}`); use a specific value type.',
		},
	},
	create(context) {
		let aliasMap = new Map();

		function reportIfUnsafe(valueType, reportNode) {
			if (valueType && resolvesTo(valueType, isUnsafeDictionaryValue, aliasMap)) {
				context.report({ node: reportNode, messageId: 'unsafe' });
			}
		}

		return {
			Program(node) {
				aliasMap = collectAliasMap(node);
			},
			TSTypeReference(node) {
				if (
					node.typeName.type === 'Identifier' &&
					node.typeName.name === 'Record' &&
					node.typeArguments?.params.length === 2
				) {
					reportIfUnsafe(node.typeArguments.params[1], node);
				}
			},
			TSIndexSignature(node) {
				reportIfUnsafe(node.typeAnnotation?.typeAnnotation, node);
			},
			TSMappedType(node) {
				reportIfUnsafe(node.typeAnnotation, node);
			},
		};
	},
};

const requireBlockExceptEmptyReturn = {
	meta: {
		type: 'suggestion',
		fixable: 'code',
		messages: {
			requireBlock:
				'Use a block (`{ ... }`) for this branch - only `return;` or `return null;` may be unbraced.',
		},
	},
	create(context) {
		function isAllowedReturn(node) {
			if (node.type !== 'ReturnStatement') {
				return false;
			}

			const argument = node.argument;

			if (!argument) {
				return true;
			}

			// Some parsers (oxc included) expose null literals as their own node type.
			return (
				(argument.type === 'Literal' && argument.value === null) ||
				argument.type === 'NullLiteral'
			);
		}

		function check(branch) {
			if (!branch || branch.type === 'BlockStatement') {
				return;
			}

			// `else if` chains: the alternate is itself an IfStatement, which is fine.
			if (branch.type === 'IfStatement' || isAllowedReturn(branch)) {
				return;
			}

			context.report({
				node: branch,
				messageId: 'requireBlock',
				fix: (fixer) => fixer.replaceText(branch, `{ ${textOf(context, branch)} }`),
			});
		}

		return {
			IfStatement(node) {
				check(node.consequent);
				check(node.alternate);
			},
		};
	},
};

const noForeach = {
	meta: {
		type: 'suggestion',
		messages: {
			noForeach:
				'Avoid `.forEach()` - use a `for...of` loop. It is faster, supports `await`/`break`/`continue`, and keeps control flow visible.',
		},
	},
	create(context) {
		return {
			CallExpression(node) {
				const { callee } = node;

				if (
					callee.type !== 'MemberExpression' ||
					callee.computed ||
					callee.property.type !== 'Identifier' ||
					callee.property.name !== 'forEach'
				) {
					return;
				}

				context.report({ node: callee.property, messageId: 'noForeach' });
			},
		};
	},
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `*` stands for one path segment, so `apps/*/src` names the source root of every app.
// The pattern may sit anywhere in the path; group 1 captures everything up to its end.
function directoryPattern(glob) {
	const body = escapeRegExp(glob.replace(/^\/+|\/+$/g, '')).replaceAll('\\*', '[^/]+');

	return new RegExp(`^(.*?(?:^|/)${body})/`);
}

function findRoot(path, globs) {
	for (const glob of globs) {
		const root = directoryPattern(glob).exec(path)?.[1];

		if (root) {
			return { glob, root };
		}
	}

	return null;
}

const DIRECTORY_PATTERNS = { type: 'array', items: { type: 'string', minLength: 1 } };

const MODULE_NAMES = { type: 'array', items: { type: 'string', pattern: '^[^/]+$' } };

// A layout rule has no meaningful default, so running one unconfigured is a config mistake.
function requireOptions(context, rule) {
	const [options] = context.options;

	if (!options) {
		throw new Error(
			`oxc-config/${rule} needs an options object describing the repository layout.`,
		);
	}

	return options;
}

const formatNames = (names) => names.map((name) => `\`${name}\``).join('/');

const noCrossDomainInternals = {
	meta: {
		type: 'problem',
		schema: [
			{
				type: 'object',
				properties: {
					domainRoots: DIRECTORY_PATTERNS,
					internals: { ...MODULE_NAMES, minItems: 1 },
					composable: MODULE_NAMES,
				},
				required: ['domainRoots', 'internals'],
				additionalProperties: false,
			},
		],
		messages: {
			internals:
				"Import a domain through its index (`{{index}}`), never its internals (`{{source}}`) - the index is the domain's public API (AGENTS.md).",
			composedInternals:
				"Import a domain through its index (`{{index}}`), never its {{banned}} - a `{{module}}` module may only compose another domain's `{{module}}` (AGENTS.md).",
		},
	},
	create(context) {
		const {
			domainRoots,
			internals,
			composable = [],
		} = requireOptions(context, 'no-cross-domain-internals');
		const path = context.filename.replaceAll('\\', '/');
		const match = findRoot(path, domainRoots);

		if (!match) {
			return {};
		}

		// A module directly inside a domain, named after a composable internal, may import
		// the same internal from another domain - the only non-circular way to compose them.
		const [domainFile, ...nested] = path
			.slice(match.root.length + 1)
			.split('/')
			.slice(1);
		const module = nested.length === 0 ? domainFile?.replace(/\.[^.]+$/, '') : undefined;
		const composes = composable.includes(module);
		const banned = composes ? internals.filter((name) => name !== module) : internals;
		const pattern = new RegExp(`^\\.\\./[^/.]+/(${banned.map(escapeRegExp).join('|')})$`);

		return {
			ImportDeclaration(node) {
				const source = node.source.value;

				if (!pattern.test(source)) {
					return;
				}

				context.report({
					node: node.source,
					messageId: composes ? 'composedInternals' : 'internals',
					data: {
						index: source.slice(0, source.lastIndexOf('/')),
						source,
						banned: formatNames(banned),
						module,
					},
				});
			},
		};
	},
};

const KEBAB_SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// TanStack Router encodes the route path in the filename, so `$id`, `$` and
// `__root` are framework syntax rather than a naming choice.
const ROUTER_FILENAME = /^(\$[a-z0-9]*|__root)$/i;

const isGeneratedFilename = (segments) => segments.includes('gen');

const kebabCaseFilename = {
	meta: {
		type: 'problem',
		messages: {
			kebab: 'Name files in kebab-case (`{{expected}}`), one concept each - every dot-separated segment is lowercase words joined by hyphens (AGENTS.md).',
		},
	},
	create(context) {
		const path = context.filename.replaceAll('\\', '/');
		const basename = path.slice(path.lastIndexOf('/') + 1);
		const [name, ...rest] = basename.split('.');

		if (!name || isGeneratedFilename(rest) || ROUTER_FILENAME.test(name)) {
			return {};
		}

		const segments = [name, ...rest.slice(0, -1)];

		if (segments.every((segment) => KEBAB_SEGMENT.test(segment))) {
			return {};
		}

		const expected = [
			...segments.map((segment) =>
				segment
					.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
					.toLowerCase()
					.replaceAll(/[^a-z0-9]+/g, '-')
					.replaceAll(/^-+|-+$/g, ''),
			),
			...rest.slice(-1),
		].join('.');

		return {
			Program(node) {
				context.report({ node, messageId: 'kebab', data: { expected } });
			},
		};
	},
};

function resolveImport(fromDirectory, specifier) {
	const segments = fromDirectory.split('/');

	for (const segment of specifier.split('/')) {
		if (segment === '..') {
			segments.pop();
		} else if (segment !== '.') {
			segments.push(segment);
		}
	}

	return segments.join('/');
}

const consistentImportPaths = {
	meta: {
		type: 'problem',
		fixable: 'code',
		schema: [
			{
				type: 'object',
				properties: {
					alias: { type: 'string', pattern: '/$' },
					aliasRoots: DIRECTORY_PATTERNS,
					relativeRoots: DIRECTORY_PATTERNS,
				},
				required: ['alias', 'aliasRoots'],
				additionalProperties: false,
			},
		],
		messages: {
			parent: 'Import across directories with `{{alias}}` (`{{expected}}`), never `../` - `./` is for siblings only (AGENTS.md).',
			packageAlias:
				'A `{{glob}}` is consumed from source, so `{{alias}}` resolves against the consuming package - use a relative import (AGENTS.md).',
		},
	},
	create(context) {
		const {
			alias,
			aliasRoots,
			relativeRoots = [],
		} = requireOptions(context, 'consistent-import-paths');
		const path = context.filename.replaceAll('\\', '/');
		const relativeMatch = findRoot(path, relativeRoots);
		const aliasMatch = relativeMatch ? null : findRoot(path, aliasRoots);

		function check(node) {
			const source = node.source;

			if (!source || typeof source.value !== 'string') {
				return;
			}

			const specifier = source.value;

			if (relativeMatch) {
				if (specifier.startsWith(alias)) {
					context.report({
						node: source,
						messageId: 'packageAlias',
						data: { alias, glob: relativeMatch.glob },
					});
				}

				return;
			}

			if (!aliasMatch || !specifier.startsWith('../')) {
				return;
			}

			const { root } = aliasMatch;
			const resolved = resolveImport(path.slice(0, path.lastIndexOf('/')), specifier);

			if (!resolved.startsWith(`${root}/`)) {
				return;
			}

			const expected = `${alias}${resolved.slice(root.length + 1)}`;

			context.report({
				node: source,
				messageId: 'parent',
				data: { alias, expected },
				fix: (fixer) => fixer.replaceText(source, `'${expected}'`),
			});
		}

		return {
			ImportDeclaration: check,
			ExportNamedDeclaration: check,
			ExportAllDeclaration: check,
		};
	},
};

const MAX_SUMMARY_LINES = 2;

const TAG_LINE = /^@\w/;

const FENCE = /^```/;

/** Strips the leading ` * ` gutter from one raw line of a JSDoc block. */
const jsdocLineText = (line) => line.replace(/^\s*\*/, '').trim();

const jsdocSummaryOnly = {
	meta: {
		type: 'suggestion',
		messages: {
			prose: 'A JSDoc block is a summary plus tags - move this paragraph into `@param`/`@returns`, or into a `//` comment beside the code it explains (AGENTS.md).',
			summary: `JSDoc summary is {{lines}} lines; keep it to ${MAX_SUMMARY_LINES} at most, and prefer one.`,
		},
	},
	create(context) {
		return {
			Program(node) {
				for (const comment of node.comments) {
					if (!isJSDoc(comment)) {
						continue;
					}

					const lines = comment.value.split('\n').slice(1).map(jsdocLineText);

					let summaryLines = 0;
					let seenTag = false;
					let seenBlank = false;
					let inExample = false;
					let inFence = false;
					let reported = false;

					for (const [index, text] of lines.entries()) {
						if (inFence) {
							if (FENCE.test(text)) {
								inFence = false;
							}

							continue;
						}

						if (text === '') {
							seenBlank = true;
							continue;
						}

						if (FENCE.test(text)) {
							inFence = true;
							continue;
						}

						if (TAG_LINE.test(text)) {
							inExample = text.startsWith('@example');
							seenTag = true;
							seenBlank = false;

							continue;
						}

						// An `@example` body runs until the next tag, so anything inside it
						// - blank lines included - is code rather than prose.
						if (inExample) {
							continue;
						}

						// Only a line after a blank one is a new paragraph; an unbroken run
						// continues either the summary or the preceding tag's description.
						if (seenBlank) {
							if (!reported) {
								context.report({
									loc: {
										start: {
											line: comment.loc.start.line + index + 1,
											column: 0,
										},
										end: {
											line: comment.loc.start.line + index + 1,
											column: text.length,
										},
									},
									messageId: 'prose',
								});

								reported = true;
							}

							continue;
						}

						// After the first tag an unbroken run is that tag's wrapped
						// description, not summary text.
						if (!seenTag) {
							summaryLines += 1;
						}
					}

					if (summaryLines > MAX_SUMMARY_LINES) {
						context.report({
							loc: comment.loc,
							messageId: 'summary',
							data: { lines: String(summaryLines) },
						});
					}
				}
			},
		};
	},
};

// A test asserts against stored rows, which is the one place reading a table
// directly is the point rather than a leak.
const TEST_FILE = /(^|\/)tests\/|\.test\.[cm]?tsx?$/;

const DRIZZLE_QUERY_BUILDER = /^drizzle-orm(\/|$)/;

// A driver entrypoint exports only the `drizzle()` constructor, so importing one
// builds a client rather than expressing a query. That is how the search indexer
// owns its projector and worker pools.
const DRIZZLE_DRIVER = /^drizzle-orm\/(node-postgres|postgres-js|neon-serverless|neon-http)$/;

// `import { type Executor, ... }` marks the kind per specifier rather than on
// the declaration, so an import is only type-only when every one of them is.
const isTypeSpecifier = (specifier) => specifier.importKind === 'type';

// Building a client takes the whole schema as one opaque value
// (`drizzle({ client, schema })`, `drizzleAdapter(db, { schema })`).
// Naming individual tables is what turns an import into a query.
const isNamespaceImport = (node) =>
	node.specifiers.length === 1 && node.specifiers[0].type === 'ImportNamespaceSpecifier';

const noRawDatabaseAccess = {
	meta: {
		type: 'problem',
		schema: [
			{
				type: 'object',
				properties: {
					schemas: { type: 'string', minLength: 1 },
					allowedIn: { ...DIRECTORY_PATTERNS, minItems: 1 },
				},
				required: ['schemas', 'allowedIn'],
				additionalProperties: false,
			},
		],
		messages: {
			builder:
				'Import `drizzle-orm` only inside {{allowed}} - a query belongs on a repository, and a caller joins one by passing an `Executor` (AGENTS.md).',
			schemas:
				'Import `{{schemas}}` only inside {{allowed}} - reach a table through its repository rather than building the query here (AGENTS.md).',
		},
	},
	create(context) {
		const { schemas, allowedIn } = requireOptions(context, 'no-raw-database-access');
		const path = context.filename.replaceAll('\\', '/');

		if (findRoot(path, allowedIn) || TEST_FILE.test(path)) {
			return {};
		}

		const schemasModule = new RegExp(`^${escapeRegExp(schemas)}(/|$)`);
		const allowed = allowedIn.map((glob) => `\`${glob}\``).join(' or ');

		return {
			ImportDeclaration(node) {
				// A type-only import reaches no runtime value, so deriving a row type
				// from a table cannot become a query.
				if (node.importKind === 'type' || node.specifiers.every(isTypeSpecifier)) {
					return;
				}

				const source = node.source.value;

				if (DRIZZLE_QUERY_BUILDER.test(source) && !DRIZZLE_DRIVER.test(source)) {
					context.report({ node: node.source, messageId: 'builder', data: { allowed } });

					return;
				}

				if (schemasModule.test(source) && !isNamespaceImport(node)) {
					context.report({
						node: node.source,
						messageId: 'schemas',
						data: { allowed, schemas },
					});
				}
			},
		};
	},
};

const plugin = {
	meta: { name: 'oxc-config' },
	rules: {
		'consistent-import-paths': consistentImportPaths,
		'jsdoc-summary-only': jsdocSummaryOnly,
		'jsx-no-conditional-leak': jsxNoConditionalLeak,
		'kebab-case-filename': kebabCaseFilename,
		'max-comment-length': maxCommentLength,
		'no-await-in-promise-all': noAwaitInPromiseAll,
		'no-chained-type-assertions': noChainedTypeAssertions,
		'no-const-arrow-function': noConstArrowFunction,
		'no-cross-domain-internals': noCrossDomainInternals,
		'no-double-type-assertion': noDoubleTypeAssertion,
		'no-foreach': noForeach,
		'no-object-parameters': noObjectParameters,
		'no-raw-database-access': noRawDatabaseAccess,
		'no-unknown-parameters': noUnknownParameters,
		'no-unknown-returns': noUnknownReturns,
		'no-unsafe-dictionary-type': noUnsafeDictionaryType,
		'no-widen-then-assert': noWidenThenAssert,
		'no-inline-object-type': noInlineObjectType,
		'no-nested-links': noNestedLinks,
		'no-unnecessary-usestate-type': noUnnecessaryUseStateType,
		'prefer-optional-chaining': preferOptionalChaining,
		'require-block-except-empty-return': requireBlockExceptEmptyReturn,
		'use-logical-assignment': useLogicalAssignment,
	},
};

export default plugin;
