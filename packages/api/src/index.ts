/**
 * Public API package entrypoint.
 *
 * Keep the tRPC composition layer behind a named module so consumers can use
 * the package entrypoint without coupling to its internal layout.
 */
export * from "./trpc/index";
