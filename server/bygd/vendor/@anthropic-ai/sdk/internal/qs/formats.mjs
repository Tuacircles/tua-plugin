// Tua-plugin 0.5.12 — bygd av bygg.mjs 2026-11-02. IKKE REDIGER: kilden er server/*.js og node_modules.
const default_format = 'RFC3986';
const default_formatter = (v) => String(v);
const formatters = {
    RFC1738: (v) => String(v).replace(/%20/g, '+'),
    RFC3986: default_formatter,
};
const RFC1738 = 'RFC1738';

export { RFC1738, default_format, default_formatter, formatters };
