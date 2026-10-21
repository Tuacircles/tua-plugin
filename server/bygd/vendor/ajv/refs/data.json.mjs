// Tua-plugin 0.5.5 — bygd av bygg.mjs 2026-10-21. IKKE REDIGER: kilden er server/*.js og node_modules.
var $id = "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#";
var description = "Meta-schema for $data reference (JSON AnySchema extension proposal)";
var type = "object";
var required = [
	"$data"
];
var properties = {
	$data: {
		type: "string",
		anyOf: [
			{
				format: "relative-json-pointer"
			},
			{
				format: "json-pointer"
			}
		]
	}
};
var additionalProperties = false;
const require$$9 = {
	$id: $id,
	description: description,
	type: type,
	required: required,
	properties: properties,
	additionalProperties: additionalProperties
};

export { require$$9 };
