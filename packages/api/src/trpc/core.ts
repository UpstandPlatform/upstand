import { initTRPC } from "@trpc/server";
import type { OpenApiMeta } from "trpc-to-openapi";
import type { Context } from "../context";

/** Shared tRPC factory. All procedures and routers are built from this type. */
export const t = initTRPC.context<Context>().meta<OpenApiMeta>().create();

export const router = t.router;
